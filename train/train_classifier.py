#!/usr/bin/env python3
"""
Clasificador de pacientes a partir de las segmentaciones pulmonares (sano / otra enfermedad / COVID-19).

Lee de un bucket compatible con S3 (Cloudflare R2, AWS S3, Backblaze B2, MinIO...) lo que genera
`process_dataset.py`:  ct/{hash}/result.json  y las máscaras  lung_mask.nii.gz / lesion_mask.nii.gz.

Pasos:
  1. Carga los result.json (volumen pulmonar, volumen y % de tejido dañado, etiqueta del CSV).
  2. Calcula características desde las máscaras (por pulmón, por zona, periferia, nº de lesiones).
     Se guardan en el bucket (ml/features_mascaras.csv) y se reutilizan en las siguientes ejecuciones.
  3. Compara modelos con validación cruzada estratificada (5 pliegues x 3 repeticiones).
  4. Genera matriz de confusión, curvas ROC e importancia de variables del mejor modelo.
  5. Entrena el modelo final con todos los casos y lo guarda (local y, opcionalmente, en el bucket).

La etiqueta del paciente es la variable objetivo; nunca se usa como entrada. Tampoco se usa la
conclusión del LLM, porque su prompt incluía la etiqueta.

Configuración (variables de entorno, o un archivo .env si está instalado python-dotenv):
  STORAGE_BUCKET, STORAGE_ENDPOINT_URL (solo el host, sin /bucket), STORAGE_ACCESS_KEY_ID,
  STORAGE_SECRET_ACCESS_KEY, STORAGE_REGION (opcional, por defecto "auto")

Ejemplos:
  python train_classifier.py                              # covid vs resto, todos los casos
  python train_classifier.py --modo 3_clases              # 0 sano · 1 otra enfermedad · 2 COVID-19
  python train_classifier.py --max-casos 40               # prueba rápida
  python train_classifier.py --sin-mascaras               # solo las métricas de result.json
  python train_classifier.py --no-subir                   # credenciales de solo lectura / sin escribir en el bucket
"""
import argparse
import datetime
import gzip
import io
import json
import logging
import os
import sys
import time
import warnings
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse

import matplotlib

matplotlib.use("Agg")  # sin pantalla: las figuras se guardan en archivos
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

log = logging.getLogger("train")

ETIQUETAS = {0: "sano", 1: "otra enfermedad", 2: "COVID-19"}
CLAVE_CACHE = "ml/features_mascaras.csv"
STEP = 3          # submuestreo por eje al calcular características desde las máscaras
BORDE_MM = 15.0   # "periferia" = a <= 15 mm del borde pulmonar

FEATS_BASE = ["volumen_pulmonar_ml", "volumen_tejido_danado_ml", "porcentaje_tejido_danado",
              "log_lesion_pct", "log_lesion_ml", "lesion_fuera_pulmon_vox"]
FEATS_MASCARAS = ["vol_pulmon_der_ml", "vol_pulmon_izq_ml", "asimetria_pulmonar",
                  "lesion_pct_der", "lesion_pct_izq", "lesion_pct_dif_lados",
                  "lesion_pct_z1", "lesion_pct_z2", "lesion_pct_z3",
                  "frac_lesion_periferica", "dist_borde_media_lesion_mm",
                  "n_lesiones", "frac_lesion_mayor", "n_lesiones_ge_0_5ml"]
# Dependen del escáner/protocolo, no de la enfermedad: desactivadas por defecto
FEATS_ADQUISICION = ["shape_z", "shape_y", "shape_x", "spacing_z", "spacing_y", "spacing_x",
                     "hu_min", "hu_max"]


# ───────────────────────────── Bucket ─────────────────────────────
def variable(nombre, obligatoria=True, default=None):
    v = os.environ.get(nombre) or default
    if obligatoria and not v:
        sys.exit(f"Falta la variable de entorno {nombre} (ver .env.example).")
    return v


def limpiar_endpoint(url):
    """El endpoint debe ser solo el host (sin /bucket)."""
    if not url:
        return None
    u = urlparse(url.strip())
    if u.path.strip("/"):
        log.warning("STORAGE_ENDPOINT_URL traía una ruta; se usa solo el host. "
                    "Corrige tu .env: el bucket va en STORAGE_BUCKET.")
        return f"{u.scheme}://{u.netloc}"
    return url.strip().rstrip("/")


class Bucket:
    def __init__(self):
        import boto3
        from botocore.config import Config

        self.nombre = variable("STORAGE_BUCKET")
        kw = dict(retries={"max_attempts": 8, "mode": "standard"}, max_pool_connections=32)
        try:  # boto3 >= 1.36: evita checksums que algunos servicios S3-compatibles no aceptan
            cfg = Config(request_checksum_calculation="when_required",
                         response_checksum_validation="when_required", **kw)
        except TypeError:
            cfg = Config(**kw)
        self.s3 = boto3.client(
            "s3",
            endpoint_url=limpiar_endpoint(variable("STORAGE_ENDPOINT_URL", obligatoria=False)),
            aws_access_key_id=variable("STORAGE_ACCESS_KEY_ID"),
            aws_secret_access_key=variable("STORAGE_SECRET_ACCESS_KEY"),
            region_name=variable("STORAGE_REGION", obligatoria=False, default="auto"),
            config=cfg,
        )

    def listar(self, prefix):
        for page in self.s3.get_paginator("list_objects_v2").paginate(Bucket=self.nombre, Prefix=prefix):
            for o in page.get("Contents", []):
                yield o["Key"]

    def leer_bytes(self, key):
        return self.s3.get_object(Bucket=self.nombre, Key=key)["Body"].read()

    def existe(self, key):
        return any(k == key for k in self.listar(key))

    def subir_bytes(self, data, key, content_type=None):
        kw = {"ContentType": content_type} if content_type else {}
        self.s3.put_object(Bucket=self.nombre, Key=key, Body=data, **kw)


# ───────────────────────────── 1. result.json ─────────────────────────────
def cargar_resultados(bucket, max_casos, seed):
    claves = [k for k in bucket.listar("ct/") if k.endswith("/result.json")]
    log.info("Conectado a '%s'. Casos procesados (result.json): %d", bucket.nombre, len(claves))
    if not claves:
        sys.exit("No se encontró ningún ct/*/result.json: revisa el bucket y el endpoint.")

    t0 = time.time()
    with ThreadPoolExecutor(16) as ex:
        resultados = list(ex.map(lambda k: json.loads(bucket.leer_bytes(k)), claves))
    log.info("%d result.json leídos en %.0f s", len(resultados), time.time() - t0)

    filas = []
    for r in resultados:
        m, im = r["metrics"], r["image"]
        filas.append({
            "hash": r["hash"],
            "etiqueta": m["etiqueta_csv"],
            "volumen_pulmonar_ml": m["volumen_pulmonar_ml"],
            "volumen_tejido_danado_ml": m["volumen_tejido_danado_ml"],
            "porcentaje_tejido_danado": m["porcentaje_tejido_danado"],
            "lesion_fuera_pulmon_vox": r.get("lesion_outside_lung_voxels"),
            # variables de adquisición (dependen del escáner/protocolo, no de la enfermedad)
            "shape_z": im["shape_zyx"][0], "shape_y": im["shape_zyx"][1], "shape_x": im["shape_zyx"][2],
            "spacing_z": im["spacing_zyx_mm"][0], "spacing_y": im["spacing_zyx_mm"][1],
            "spacing_x": im["spacing_zyx_mm"][2],
            "hu_min": im["hu_min"], "hu_max": im["hu_max"],
        })
    df_base = pd.DataFrame(filas)

    sin_etiqueta = int(df_base["etiqueta"].isna().sum())
    if sin_etiqueta:
        log.warning("%d casos sin etiqueta en el CSV; se excluyen.", sin_etiqueta)
    df_base = df_base.dropna(subset=["etiqueta"]).copy()
    df_base["etiqueta"] = df_base["etiqueta"].astype(int)
    df_base = df_base.drop_duplicates("hash").reset_index(drop=True)

    if max_casos:
        df_base = df_base.sample(min(max_casos, len(df_base)), random_state=seed).reset_index(drop=True)
        log.info("MODO PRUEBA: se usan solo %d casos.", len(df_base))
    log.info("Casos con etiqueta: %d", len(df_base))
    return df_base


def explorar(df_base, out_dir):
    conteo = df_base["etiqueta"].map(ETIQUETAS).value_counts()
    log.info("Casos por clase:\n%s", conteo.to_frame("casos").to_string())

    cols = ["volumen_pulmonar_ml", "volumen_tejido_danado_ml", "porcentaje_tejido_danado"]
    log.info("Descripción por etiqueta:\n%s", df_base.groupby("etiqueta")[cols].describe().T.round(2).to_string())

    fig, ax = plt.subplots(1, 3, figsize=(14, 4))
    for a, c in zip(ax, cols):
        datos = [df_base.loc[df_base.etiqueta == e, c].values for e in sorted(ETIQUETAS)]
        a.boxplot(datos)
        a.set_xticklabels([ETIQUETAS[e] for e in sorted(ETIQUETAS)])
        a.set_title(c)
        a.set_yscale("symlog", linthresh=0.1)
    fig.tight_layout()
    fig.savefig(out_dir / "exploracion_boxplot.png", dpi=150)
    plt.close(fig)

    if conteo.min() < 10:
        log.warning("Hay una clase con menos de 10 casos: los resultados de validación serán muy inestables.")


# ───────────────────────────── 2. Características desde las máscaras ─────────────────────────────
def leer_mascara(bucket, key):
    import nibabel as nib
    raw = gzip.decompress(bucket.leer_bytes(key))
    img = nib.Nifti1Image.from_bytes(raw)
    arr = np.asanyarray(img.dataobj)[::STEP, ::STEP, ::STEP].copy()   # nibabel: ejes (x, y, z)
    zooms = tuple(float(z) * STEP for z in img.header.get_zooms()[:3])
    return arr, zooms


def pct(num, den):
    return float(100.0 * num / den) if den > 0 else np.nan


def calcular_features(lung, les, zooms):
    from scipy import ndimage as ndi

    sx, sy, sz = zooms
    vox_ml = sx * sy * sz / 1000.0
    pulm = lung > 0
    les = (les > 0) & pulm
    R, L = lung == 1, lung == 2
    f = {}
    vR, vL = R.sum() * vox_ml, L.sum() * vox_ml
    f["vol_pulmon_der_ml"], f["vol_pulmon_izq_ml"] = vR, vL
    f["asimetria_pulmonar"] = float(abs(vR - vL) / (vR + vL)) if (vR + vL) > 0 else np.nan
    f["lesion_pct_der"] = pct((les & R).sum(), R.sum())
    f["lesion_pct_izq"] = pct((les & L).sum(), L.sum())
    f["lesion_pct_dif_lados"] = abs(f["lesion_pct_der"] - f["lesion_pct_izq"])

    # Tercios a lo largo de z (dentro de la extensión pulmonar)
    zs = np.where(pulm.any(axis=(0, 1)))[0]
    if len(zs):
        bordes = np.linspace(zs.min(), zs.max() + 1, 4).round().astype(int)
        for i in range(3):
            a, b = bordes[i], bordes[i + 1]
            f[f"lesion_pct_z{i+1}"] = pct(les[:, :, a:b].sum(), pulm[:, :, a:b].sum())
    else:
        for i in range(3):
            f[f"lesion_pct_z{i+1}"] = np.nan

    # Periferia: distancia al borde del pulmón (en mm)
    n_les = int(les.sum())
    if n_les > 0:
        pulm_f = ndi.binary_fill_holes(pulm)
        dist = ndi.distance_transform_edt(pulm_f, sampling=(sx, sy, sz))
        d_les = dist[les]
        f["frac_lesion_periferica"] = float((d_les <= BORDE_MM).mean())
        f["dist_borde_media_lesion_mm"] = float(d_les.mean())
        # Componentes conexos
        lab, n = ndi.label(les)
        tam = np.bincount(lab.ravel())[1:] * vox_ml
        f["n_lesiones"] = int(n)
        f["frac_lesion_mayor"] = float(tam.max() / tam.sum())
        f["n_lesiones_ge_0_5ml"] = int((tam >= 0.5).sum())
    else:
        f.update({"frac_lesion_periferica": np.nan, "dist_borde_media_lesion_mm": np.nan,
                  "n_lesiones": 0, "frac_lesion_mayor": np.nan, "n_lesiones_ge_0_5ml": 0})
    return f


def extraer_caso(bucket, h):
    try:
        lung, z1 = leer_mascara(bucket, f"ct/{h}/lung_mask.nii.gz")
        les, _ = leer_mascara(bucket, f"ct/{h}/lesion_mask.nii.gz")
        return {"hash": h, **calcular_features(lung, les, z1)}
    except Exception as e:
        return {"hash": h, "_error": str(e)}


def obtener_features(bucket, df_base, n_workers, forzar, subir):
    previas = pd.DataFrame(columns=["hash"])
    if not forzar and bucket.existe(CLAVE_CACHE):
        previas = pd.read_csv(io.BytesIO(bucket.leer_bytes(CLAVE_CACHE)))
        log.info("Caché en el bucket: %d casos ya calculados.", len(previas))

    ya = set(previas["hash"])
    pendientes = [h for h in df_base["hash"] if h not in ya]
    log.info("Por calcular ahora: %d", len(pendientes))
    if not pendientes:
        return previas

    nuevos, errores = [], []
    t0 = time.time()
    with ThreadPoolExecutor(n_workers) as ex:
        for i, r in enumerate(ex.map(lambda h: extraer_caso(bucket, h), pendientes), 1):
            (errores if "_error" in r else nuevos).append(r)
            if i % 25 == 0 or i == len(pendientes):
                ritmo = (time.time() - t0) / i
                log.info("  %d/%d · %.1f s/caso · faltan ~%.0f min", i, len(pendientes), ritmo,
                         ritmo * (len(pendientes) - i) / 60)
    if errores:
        log.warning("%d casos con error (se omiten). Ejemplo: %s", len(errores), errores[0])

    df_feat = pd.concat([previas, pd.DataFrame(nuevos)], ignore_index=True).drop_duplicates("hash", keep="last")
    if subir:
        try:
            bucket.subir_bytes(df_feat.to_csv(index=False).encode("utf-8"), CLAVE_CACHE, "text/csv")
            log.info("Guardado en el bucket: %s (%d casos)", CLAVE_CACHE, len(df_feat))
        except Exception as e:
            log.warning("No se pudo subir la caché al bucket (%s); sigue funcionando en esta ejecución.", e)
    return df_feat


# ───────────────────────────── 3. Tabla de entrenamiento ─────────────────────────────
def construir_tabla(df_base, df_feat, modo, usar_mascaras, incluir_adquisicion):
    df = df_base.copy()
    if usar_mascaras and len(df_feat):
        extra = df_feat.drop(columns=[c for c in df_feat.columns if c.startswith("_")])
        df = df.merge(extra, on="hash", how="left")
        antes = len(df)
        if "vol_pulmon_der_ml" in df:
            df = df.dropna(subset=["vol_pulmon_der_ml"])
        if len(df) < antes:
            log.info("Se excluyen %d casos sin características de máscara.", antes - len(df))

    # Transformaciones logarítmicas (ayudan a modelos lineales; a los árboles les da igual)
    df["log_lesion_pct"] = np.log10(df["porcentaje_tejido_danado"] + 0.001)
    df["log_lesion_ml"] = np.log10(df["volumen_tejido_danado_ml"] + 0.1)

    feats_masc = [c for c in FEATS_MASCARAS if c in df.columns]
    features = FEATS_BASE + (feats_masc if usar_mascaras else []) + (FEATS_ADQUISICION if incluir_adquisicion else [])

    if modo == "3_clases":
        y = df["etiqueta"].values.astype(int)
        nombres = [ETIQUETAS[i] for i in sorted(np.unique(y))]
    elif modo == "covid_vs_resto":
        y = (df["etiqueta"].values == 2).astype(int)
        nombres = ["no COVID", "COVID-19"]
    else:
        raise ValueError("modo debe ser '3_clases' o 'covid_vs_resto'")
    clases = np.unique(y)
    X = df[features].astype(float)

    log.info("Modo: %s · casos: %d · variables: %d", modo, len(X), len(features))
    log.info("Casos por clase:\n%s", pd.Series(y).map(dict(zip(clases, nombres))).value_counts().to_string())
    return df, X, y, features, clases, nombres


# ───────────────────────────── 4. Modelos ─────────────────────────────
def crear_modelos(seed):
    from sklearn.dummy import DummyClassifier
    from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    return {
        "Dummy (clase mayoritaria)": DummyClassifier(strategy="prior"),
        "Regresión logística": make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                                             LogisticRegression(max_iter=3000, class_weight="balanced")),
        "Random Forest": make_pipeline(SimpleImputer(strategy="median"),
                                       RandomForestClassifier(n_estimators=400, min_samples_leaf=3, n_jobs=1,
                                                              class_weight="balanced_subsample",
                                                              random_state=seed)),
        "Gradient Boosting": HistGradientBoostingClassifier(learning_rate=0.05, max_iter=250, max_leaf_nodes=15,
                                                            class_weight="balanced", random_state=seed),
    }


def comparar_modelos(modelos, X, y, clases, seed):
    from sklearn.model_selection import RepeatedStratifiedKFold, cross_validate

    n_min = int(pd.Series(y).value_counts().min())
    n_splits = int(min(5, n_min))
    if n_splits < 2:
        sys.exit("Alguna clase tiene menos de 2 casos: no se puede validar.")
    if n_splits < 5:
        log.warning("Se usan %d pliegues porque la clase más pequeña tiene %d casos.", n_splits, n_min)
    cv = RepeatedStratifiedKFold(n_splits=n_splits, n_repeats=3, random_state=seed)
    auc = "roc_auc_ovr" if len(clases) > 2 else "roc_auc"
    scoring = {"balanced_accuracy": "balanced_accuracy", "f1_macro": "f1_macro", "auc": auc}

    filas = []
    for nombre, modelo in modelos.items():
        t0 = time.time()
        r = cross_validate(modelo, X, y, cv=cv, scoring=scoring, n_jobs=-1)
        filas.append({"modelo": nombre,
                      **{m: r[f"test_{m}"].mean() for m in scoring},
                      **{f"{m}_std": r[f"test_{m}"].std() for m in scoring},
                      "seg": time.time() - t0})
    tabla = pd.DataFrame(filas).set_index("modelo")
    log.info("Validación cruzada (%d pliegues x 3):\n%s", n_splits, tabla.round(3).to_string())

    mejor = tabla.drop(index="Dummy (clase mayoritaria)")["balanced_accuracy"].idxmax()
    log.info("Mejor modelo por balanced accuracy: %s", mejor)
    log.info("Piso aleatorio (balanced accuracy): %.2f", 1 / len(clases))
    return tabla, mejor, n_splits


def detalle_mejor(modelo, nombre, X, y, clases, nombres, n_splits, seed, out_dir):
    from sklearn.metrics import (ConfusionMatrixDisplay, classification_report, roc_auc_score, roc_curve)
    from sklearn.model_selection import StratifiedKFold, cross_val_predict

    cv1 = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=seed)
    proba = cross_val_predict(modelo, X, y, cv=cv1, method="predict_proba", n_jobs=-1)
    y_pred = clases[proba.argmax(axis=1)]

    texto = classification_report(y, y_pred, target_names=nombres, digits=3, zero_division=0)
    log.info("Reporte de clasificación (predicciones fuera de muestra):\n%s", texto)
    reporte = classification_report(y, y_pred, target_names=nombres, zero_division=0, output_dict=True)

    fig, ax = plt.subplots(1, 2, figsize=(12, 4.5))
    ConfusionMatrixDisplay.from_predictions(y, y_pred, display_labels=nombres, normalize="true",
                                            values_format=".2f", cmap="Blues", ax=ax[0], colorbar=False)
    ax[0].set_title(f"Matriz de confusión (normalizada por fila) · {nombre}")
    if len(clases) == 2:
        fpr, tpr, _ = roc_curve(y, proba[:, 1])
        ax[1].plot(fpr, tpr, label=f"AUC = {roc_auc_score(y, proba[:, 1]):.3f}")
    else:
        for i, c in enumerate(clases):
            fpr, tpr, _ = roc_curve((y == c).astype(int), proba[:, i])
            auc_c = roc_auc_score((y == c).astype(int), proba[:, i])
            ax[1].plot(fpr, tpr, label=f"{nombres[i]} (AUC = {auc_c:.3f})")
    ax[1].plot([0, 1], [0, 1], "k--", lw=1)
    ax[1].set_xlabel("Falsos positivos")
    ax[1].set_ylabel("Verdaderos positivos")
    ax[1].legend()
    ax[1].set_title("Curvas ROC (una clase contra el resto)")
    fig.tight_layout()
    fig.savefig(out_dir / "matriz_confusion_roc.png", dpi=150)
    plt.close(fig)
    return reporte


def importancia_variables(modelo, nombre, X, y, features, seed, out_dir):
    from sklearn.base import clone
    from sklearn.inspection import permutation_importance
    from sklearn.metrics import balanced_accuracy_score
    from sklearn.model_selection import train_test_split

    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.25, stratify=y, random_state=seed)
    m_hold = clone(modelo).fit(X_tr, y_tr)
    ba = balanced_accuracy_score(y_te, m_hold.predict(X_te))
    log.info("Balanced accuracy en el 25 %% reservado: %.3f", ba)

    pi = permutation_importance(m_hold, X_te, y_te, scoring="balanced_accuracy", n_repeats=20,
                                random_state=seed, n_jobs=-1)
    imp = pd.DataFrame({"variable": features, "importancia": pi.importances_mean, "std": pi.importances_std}) \
        .sort_values("importancia", ascending=True)
    imp.sort_values("importancia", ascending=False).to_csv(out_dir / "importancia_variables.csv", index=False)

    top = imp.tail(15)
    fig = plt.figure(figsize=(7, 5))
    plt.barh(top["variable"], top["importancia"], xerr=top["std"])
    plt.xlabel("Caída del balanced accuracy al barajar la variable")
    plt.title(f"Importancia por permutación · {nombre}")
    fig.tight_layout()
    fig.savefig(out_dir / "importancia_permutacion.png", dpi=150)
    plt.close(fig)
    return ba


# ───────────────────────────── 5. Modelo final ─────────────────────────────
def predecir(paquete, fila):
    """fila: dict o Series con las variables de paquete['features'] → probabilidades por clase."""
    d = pd.DataFrame([dict(fila)])[paquete["features"]].astype(float)
    p = paquete["modelo"].predict_proba(d)[0]
    return {n: round(float(v), 3) for n, v in zip(paquete["nombres_clases"], p)}


def entrenar_y_guardar(modelos, mejor, tabla, X, y, features, clases, nombres, modo, out_dir, bucket, subir):
    import joblib
    from sklearn.base import clone

    modelo_final = clone(modelos[mejor]).fit(X, y)
    paquete = {
        "modelo": modelo_final, "nombre": mejor, "features": features, "modo": modo,
        "clases": [int(c) for c in clases], "nombres_clases": nombres,
        "n_casos": int(len(X)), "creado": datetime.datetime.now().isoformat(timespec="seconds"),
        "cv_balanced_accuracy": float(tabla.loc[mejor, "balanced_accuracy"]),
        "cv_auc": float(tabla.loc[mejor, "auc"]),
    }
    nombre_archivo = f"modelo_{modo}.joblib"
    ruta = out_dir / nombre_archivo
    joblib.dump(paquete, ruta)
    log.info("Guardado local: %s", ruta)

    if subir:
        try:
            bucket.subir_bytes(ruta.read_bytes(), f"ml/modelos/{nombre_archivo}", "application/octet-stream")
            bucket.subir_bytes(tabla.round(4).to_csv().encode("utf-8"), f"ml/modelos/cv_{modo}.csv", "text/csv")
            log.info("Subido al bucket: ml/modelos/%s", nombre_archivo)
        except Exception as e:
            log.warning("No se pudo subir al bucket (%s). El modelo está en %s", e, ruta)
    return paquete


# ───────────────────────────── CLI ─────────────────────────────
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--modo", choices=["3_clases", "covid_vs_resto"], default="covid_vs_resto",
                    help="3_clases: 0 sano · 1 otra enfermedad · 2 COVID-19. covid_vs_resto: 2 contra {0, 1}")
    ap.add_argument("--sin-mascaras", action="store_true",
                    help="no calcula características desde las máscaras (solo result.json)")
    ap.add_argument("--incluir-adquisicion", action="store_true",
                    help="incluye variables del escáner (tamaño, espaciado, HU); ojo: riesgo de atajo")
    ap.add_argument("--max-casos", type=int, help="usa solo N casos al azar (prueba rápida)")
    ap.add_argument("--workers", type=int, default=4, help="descargas/cálculos en paralelo")
    ap.add_argument("--forzar-recalculo", action="store_true",
                    help="ignora ml/features_mascaras.csv y recalcula todo")
    ap.add_argument("--no-subir", action="store_true",
                    help="no escribe nada en el bucket (ni caché de características ni modelo)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--salida", default="./resultados", help="carpeta local para figuras, modelo y reportes")
    args = ap.parse_args()

    try:  # .env opcional
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    out_dir = Path(args.salida)
    out_dir.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", force=True,
                        handlers=[logging.StreamHandler(sys.stdout),
                                  logging.FileHandler(out_dir / "entrenamiento.log", encoding="utf-8")])
    warnings.filterwarnings("ignore", category=UserWarning)

    usar_mascaras = not args.sin_mascaras
    subir = not args.no_subir
    t_inicio = time.time()

    bucket = Bucket()
    df_base = cargar_resultados(bucket, args.max_casos, args.seed)
    explorar(df_base, out_dir)

    df_feat = pd.DataFrame(columns=["hash"])
    if usar_mascaras:
        df_feat = obtener_features(bucket, df_base, args.workers, args.forzar_recalculo, subir)
        log.info("Resumen de características:\n%s", df_feat.describe().T.round(3).head(20).to_string())

    df, X, y, features, clases, nombres = construir_tabla(
        df_base, df_feat, args.modo, usar_mascaras, args.incluir_adquisicion)

    modelos = crear_modelos(args.seed)
    tabla, mejor, n_splits = comparar_modelos(modelos, X, y, clases, args.seed)
    tabla.round(4).to_csv(out_dir / f"cv_{args.modo}.csv")

    reporte = detalle_mejor(modelos[mejor], mejor, X, y, clases, nombres, n_splits, args.seed, out_dir)
    ba_holdout = importancia_variables(modelos[mejor], mejor, X, y, features, args.seed, out_dir)

    paquete = entrenar_y_guardar(modelos, mejor, tabla, X, y, features, clases, nombres,
                                 args.modo, out_dir, bucket, subir)

    resumen = {"modo": args.modo, "n_casos": int(len(X)), "n_variables": len(features), "variables": features,
               "mejor_modelo": mejor, "balanced_accuracy_holdout_25pct": ba_holdout,
               "validacion_cruzada": json.loads(tabla.round(4).to_json(orient="index")),
               "reporte_clasificacion": reporte, "creado": paquete["creado"]}
    (out_dir / f"resumen_{args.modo}.json").write_text(
        json.dumps(resumen, ensure_ascii=False, indent=2), encoding="utf-8")

    ej = df.iloc[0]
    log.info("Ejemplo → %s | etiqueta real: %s | predicción: %s",
             ej["hash"], ETIQUETAS[int(ej["etiqueta"])], predecir(paquete, ej))
    log.info("Terminado en %.1f min. Resultados en %s", (time.time() - t_inicio) / 60, out_dir.resolve())


if __name__ == "__main__":
    main()
