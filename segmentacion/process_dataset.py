#!/usr/bin/env python3
"""
Pipeline de segmentación pulmonar + tejido dañado + conclusión LLM para el dataset
InRad COVID-19 (AWS Open Data: s3://inlab-opendata-covid-anonymized-images).

Por cada tomografía (.nii):
  R231 (lungmask) → recorte → COPLE-Net → métricas → imágenes 2D → Nemotron VL → almacenamiento.

Almacenamiento (cualquier servicio compatible con S3: Cloudflare R2, Backblaze B2, AWS S3, MinIO...)
o carpeta local (--storage local) para pruebas.

Estructura que se guarda:
  ct/{hash}/original.nii.gz   volumen original (reorientado a LPS, igual que los resultados)
  ct/{hash}/lung_mask.nii.gz  1 = pulmón derecho, 2 = izquierdo
  ct/{hash}/lesion_mask.nii.gz
  ct/{hash}/grid.jpg          cuadrícula de cortes axiales (la misma que ve el LLM)
  ct/{hash}/ortho.jpg         vista axial/coronal/sagital (la misma que ve el LLM)
  ct/{hash}/result.json       métricas + etiqueta + respuesta del LLM + rutas (se escribe al FINAL)
  index.json                  resumen de todos los casos (para la app)
  xray/{hash}.png             radiografías originales (solo copia; ver --modality xray)

Uso rápido:
  python process_dataset.py --hash 33cf78a82e5d1f3a98931b3fe5d31a40 --storage local   # prueba local
  python process_dataset.py --hash 33cf78a82e5d1f3a98931b3fe5d31a40                    # un caso → nube
  python process_dataset.py --all                                                     # todas las CT
  python process_dataset.py --retry-llm                                               # reintenta LLM fallidos
  python process_dataset.py --modality xray --all                                     # copia radiografías
"""
import argparse
import base64
import io
import json
import logging
import os
import random
import shutil
import sys
import time
import traceback
import urllib.request
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

log = logging.getLogger("pipeline")

# ───────────────────────────── Configuración ─────────────────────────────
SRC_BUCKET = "inlab-opendata-covid-anonymized-images"
SRC_REGION = "us-west-2"
CT_PREFIX = "chest_ct/"            # imágenes: chest_ct/images/{hash}.nii · metadatos: chest_ct/metadata/clinicaldata.csv
XRAY_PREFIX_DEFAULT = "chest_xray/"  # ⚠ supuesto: verifica con --list-prefixes

# Idénticos al notebook aprobado
WIN_LEVEL, WIN_WIDTH = -650, 1500
CROP_MARGIN = 5
APPLY_LUNG_MASK = True
ROI_SIZE = (96, 96, 96)
OVERLAP = 0.5

NVIDIA_MODEL = "nvidia/nemotron-3.5-super-vl-120b-a12b"
NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"

GRID_FILAS, GRID_COLS = 3, 4
TILE_GRID, TILE_ORTO = 256, 384
MAX_B64 = 170_000

ETIQUETAS = {
    0: "paciente sano",
    1: "paciente con otra enfermedad (no COVID-19)",
    2: "paciente con COVID-19",
}

SYSTEM_PROMPT = (
    "Eres un asistente de apoyo para el análisis de tomografías de tórax en un proyecto de investigación. "
    "No emites diagnósticos definitivos: resumes los hallazgos cuantitativos y visuales con cautela y en español. "
    "Tienes la capacidad de dar un pronóstico, no un diagnóstico sobre el paciente."
)


# ───────────────────────────── Almacenamiento ─────────────────────────────
class LocalStorage:
    """Carpeta local con la misma interfaz que S3Storage (para pruebas)."""

    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.description = f"carpeta local {self.root.resolve()}"

    def _p(self, key):
        p = self.root / key
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    def exists(self, key):
        return (self.root / key).exists()

    def put_file(self, path, key, content_type=None):
        shutil.copyfile(path, self._p(key))

    def put_bytes(self, data, key, content_type=None):
        self._p(key).write_bytes(data)

    def get_bytes(self, key):
        return (self.root / key).read_bytes()

    def delete(self, key):
        (self.root / key).unlink(missing_ok=True)

    def list_keys(self, prefix):
        base = self.root
        for p in base.rglob("*"):
            if p.is_file():
                k = p.relative_to(base).as_posix()
                if k.startswith(prefix):
                    yield k


class S3Storage:
    """Cualquier almacenamiento compatible con S3. Configuración por variables de entorno."""

    def __init__(self):
        import boto3
        from botocore.config import Config

        self.bucket = os.environ["STORAGE_BUCKET"]
        kwargs = dict(retries={"max_attempts": 8, "mode": "standard"}, max_pool_connections=32)
        try:  # boto3 >= 1.36 añade checksums que algunos servicios S3-compatibles (R2) no aceptan siempre
            cfg = Config(request_checksum_calculation="when_required",
                         response_checksum_validation="when_required", **kwargs)
        except TypeError:
            cfg = Config(**kwargs)
        self.client = boto3.client(
            "s3",
            endpoint_url=os.environ.get("STORAGE_ENDPOINT_URL") or None,
            aws_access_key_id=os.environ["STORAGE_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["STORAGE_SECRET_ACCESS_KEY"],
            region_name=os.environ.get("STORAGE_REGION", "auto"),
            config=cfg,
        )
        self.description = f"bucket '{self.bucket}' ({os.environ.get('STORAGE_ENDPOINT_URL') or 'AWS S3'})"

    def exists(self, key):
        from botocore.exceptions import ClientError
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError as e:
            if e.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
                return False
            raise

    def put_file(self, path, key, content_type=None):
        extra = {"ContentType": content_type} if content_type else None
        self.client.upload_file(str(path), self.bucket, key, ExtraArgs=extra)

    def put_bytes(self, data, key, content_type=None):
        kw = {"ContentType": content_type} if content_type else {}
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, **kw)

    def get_bytes(self, key):
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def delete(self, key):
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def list_keys(self, prefix):
        pag = self.client.get_paginator("list_objects_v2")
        for page in pag.paginate(Bucket=self.bucket, Prefix=prefix):
            for o in page.get("Contents", []):
                yield o["Key"]


def make_storage(args):
    mode = args.storage
    if mode == "auto":
        mode = "s3" if os.environ.get("STORAGE_BUCKET") else "local"
    if mode == "local":
        return LocalStorage(args.local_dir)
    missing = [v for v in ("STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY")
               if not os.environ.get(v)]
    if missing:
        sys.exit(f"Faltan variables de entorno de almacenamiento: {', '.join(missing)} (ver .env.example)")
    return S3Storage()


# ───────────────────────────── Fuente (AWS público) ─────────────────────────────
def make_source():
    import boto3
    from botocore.config import Config
    from botocore import UNSIGNED
    return boto3.client("s3", region_name=SRC_REGION,
                        config=Config(signature_version=UNSIGNED, max_pool_connections=16,
                                      retries={"max_attempts": 8, "mode": "standard"}))


def list_source(src, prefix, suffixes):
    pag = src.get_paginator("list_objects_v2")
    out = []
    for page in pag.paginate(Bucket=SRC_BUCKET, Prefix=prefix):
        for o in page.get("Contents", []):
            if o["Key"].lower().endswith(suffixes):
                out.append(o["Key"])
    return sorted(out)


def list_prefixes(src):
    print(f"Prefijos de primer nivel en s3://{SRC_BUCKET}/")
    for p in src.list_objects_v2(Bucket=SRC_BUCKET, Delimiter="/").get("CommonPrefixes", []):
        print("  ", p["Prefix"])
    for top in (CT_PREFIX, XRAY_PREFIX_DEFAULT):
        r = src.list_objects_v2(Bucket=SRC_BUCKET, Prefix=top, Delimiter="/")
        print(f"Dentro de {top}:")
        for p in r.get("CommonPrefixes", []):
            print("  ", p["Prefix"])
        for o in r.get("Contents", [])[:5]:
            print("  ", o["Key"], o["Size"])


def hash_from_key(key):
    name = key.split("/")[-1]
    for ext in (".nii.gz", ".nii", ".png"):
        if name.lower().endswith(ext):
            return name[: -len(ext)]
    return name.split(".")[0]


def load_labels(src, workdir):
    import pandas as pd
    path = Path(workdir) / "clinicaldata.csv"
    if not path.exists():
        tmp = path.with_name(f"clinicaldata.csv.{os.getpid()}.part")
        src.download_file(SRC_BUCKET, f"{CT_PREFIX}metadata/clinicaldata.csv", str(tmp))
        os.replace(tmp, path)   # atómico: nunca se lee un CSV a medio descargar
    df = pd.read_csv(path)
    labels = {}
    for iid, t in zip(df["image_id"].astype(str), df["type"]):
        k = hash_from_key(iid.strip())
        if k not in labels and not pd.isna(t):
            labels[k] = int(t)
    log.info("clinicaldata.csv: %d filas, %d etiquetas", len(df), len(labels))
    return labels


# ───────────────────────────── Modelos (carga única) ─────────────────────────────
class Segmenter:
    """R231 (lungmask) + COPLE-Net. Los imports pesados son perezosos."""

    def __init__(self, weights_path, sw_batch_size=2, lung_batch=16):
        import torch
        from lungmask import LMInferer

        self.torch = torch
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.sw_batch_size = sw_batch_size
        log.info("Dispositivo: %s", self.device)
        if self.device.type == "cuda":
            torch.backends.cudnn.benchmark = True   # ROI fijo en la ventana deslizante → autotuning útil
        if self.device.type == "cpu":
            log.warning("¡No hay GPU! El procesamiento será muy lento.")

        self.inferer = LMInferer(modelname="R231", force_cpu=self.device.type == "cpu", batch_size=lung_batch)

        coplenet_py = Path(__file__).parent / "coplenet.py"
        if not coplenet_py.exists():
            log.info("Descargando coplenet.py desde GitHub...")
            urllib.request.urlretrieve(
                "https://raw.githubusercontent.com/hilab-git/cople-net/master/coplenet.py", coplenet_py)
        sys.path.insert(0, str(coplenet_py.parent))
        from coplenet import COPLENet

        params = {"in_chns": 1, "feature_chns": [32, 64, 128, 256, 512], "class_num": 2,
                  "bilinear": True, "dropout": [0.1, 0.1, 0.2, 0.2, 0.3]}
        self.model = COPLENet(params).to(self.device)
        if not Path(weights_path).exists():
            sys.exit(f"No existe el archivo de pesos: {weights_path} (ver --weights)")
        size = Path(weights_path).stat().st_size
        try:
            try:
                ckpt = torch.load(weights_path, map_location=self.device)
            except RuntimeError:
                raise
            except Exception:  # torch >= 2.6 usa weights_only=True por defecto
                ckpt = torch.load(weights_path, map_location=self.device, weights_only=False)
        except RuntimeError as e:
            sys.exit(f"No se pudo leer {weights_path} ({size:,} bytes): {e}\n"
                     "El archivo parece truncado o corrupto. Vuelve a subirlo/descargarlo y compara su "
                     "tamaño y sha256 con el original (sha256sum).")
        self.model.load_state_dict(ckpt["model_state_dict"] if "model_state_dict" in ckpt else ckpt)
        self.model.eval()
        log.info("Modelos cargados.")

    def lung(self, img):
        return self.inferer.apply(img)  # (z,y,x): 1 = derecho, 2 = izquierdo

    def lesion(self, arr, lung):
        """Misma lógica que el notebook: recorte → ventana → ventana deslizante → pegar → limitar al pulmón."""
        from scipy import ndimage as ndi
        from monai.inferers import sliding_window_inference
        torch = self.torch

        arr_f = arr.astype(np.float32)
        zz, yy, xx = np.where(lung)
        m = CROP_MARGIN
        z0, z1 = max(zz.min() - m, 0), min(zz.max() + m + 1, arr_f.shape[0])
        y0, y1 = max(yy.min() - m, 0), min(yy.max() + m + 1, arr_f.shape[1])
        x0, x1 = max(xx.min() - m, 0), min(xx.max() + m + 1, arr_f.shape[2])
        crop = arr_f[z0:z1, y0:y1, x0:x1]

        vmin, vmax = WIN_LEVEL - WIN_WIDTH / 2.0, WIN_LEVEL + WIN_WIDTH / 2.0
        crop_norm = (np.clip(crop, vmin, vmax) - vmin) / (vmax - vmin)
        tensor_img = torch.from_numpy(crop_norm).float()[None, None].to(self.device)

        with torch.no_grad():
            output = sliding_window_inference(inputs=tensor_img, roi_size=ROI_SIZE,
                                              sw_batch_size=self.sw_batch_size,
                                              predictor=self.model, overlap=OVERLAP)
            if output.shape[1] > 1:
                pred = torch.argmax(output, dim=1)[0].cpu().numpy()
            else:
                pred = (torch.sigmoid(output)[0, 0] > 0.5).cpu().numpy()
        del tensor_img, output
        if self.device.type == "cuda":
            torch.cuda.empty_cache()

        lesion_raw = np.zeros(arr_f.shape, dtype=bool)
        lesion_raw[z0:z1, y0:y1, x0:x1] = pred > 0
        lung_limit = np.stack([ndi.binary_fill_holes(s) for s in lung])
        outside = int((lesion_raw & ~lung_limit).sum())
        lesion = (lesion_raw & lung_limit) if APPLY_LUNG_MASK else lesion_raw
        return lesion, outside


# ───────────────────────────── Imágenes 2D para el LLM ─────────────────────────────
def _tile(corte_hu, mascara, esp_fila, esp_col, size, texto):
    from PIL import Image, ImageDraw
    from skimage.segmentation import find_boundaries
    lo, hi = WIN_LEVEL - WIN_WIDTH / 2.0, WIN_LEVEL + WIN_WIDTH / 2.0
    g8 = ((np.clip(corte_hu, lo, hi) - lo) / (hi - lo) * 255).astype(np.uint8)
    h, w = g8.shape
    alto_mm, ancho_mm = h * esp_fila, w * esp_col
    esc = size / max(alto_mm, ancho_mm)
    nw, nh = max(1, round(ancho_mm * esc)), max(1, round(alto_mm * esc))
    rgb = np.array(Image.fromarray(g8).resize((nw, nh), Image.BILINEAR).convert("RGB"))
    if mascara.any():
        mk = np.array(Image.fromarray(mascara.astype(np.uint8) * 255).resize((nw, nh), Image.NEAREST)) > 0
        rgb[find_boundaries(mk, mode="inner")] = (255, 0, 0)
    lienzo = Image.new("RGB", (size, size), (0, 0, 0))
    lienzo.paste(Image.fromarray(rgb), ((size - nw) // 2, (size - nh) // 2))
    ImageDraw.Draw(lienzo).text((5, 5), texto, fill=(255, 255, 0))
    return lienzo


def make_images(arr, lung, lesion, spacing_zyx):
    """Devuelve (img_grid, img_orto, lista_de_cortes_axiales)."""
    from PIL import Image
    from scipy import ndimage as ndi

    zz, yy, xx = np.where(lung)
    mg = 8
    bz = slice(max(zz.min() - mg, 0), min(zz.max() + mg + 1, arr.shape[0]))
    by = slice(max(yy.min() - mg, 0), min(yy.max() + mg + 1, arr.shape[1]))
    bx = slice(max(xx.min() - mg, 0), min(xx.max() + mg + 1, arr.shape[2]))
    sz, sy, sx = spacing_zyx

    def axial(z, size):
        return _tile(arr[z, by, bx], lesion[z, by, bx], sy, sx, size, f"Axial z={z}")

    n = GRID_FILAS * GRID_COLS
    zs = [int(z) for z in np.unique(np.linspace(zz.min(), zz.max(), n + 2)[1:-1].round().astype(int))]
    grid = Image.new("RGB", (GRID_COLS * TILE_GRID, GRID_FILAS * TILE_GRID))
    for i, z in enumerate(zs):
        grid.paste(axial(z, TILE_GRID), ((i % GRID_COLS) * TILE_GRID, (i // GRID_COLS) * TILE_GRID))

    cz, cy, cx = (int(round(c)) for c in ndi.center_of_mass(lesion if lesion.any() else lung))
    tiles = [
        axial(cz, TILE_ORTO),
        _tile(arr[bz, cy, bx][::-1], lesion[bz, cy, bx][::-1], sz, sx, TILE_ORTO, f"Coronal y={cy}"),
        _tile(arr[bz, by, cx][::-1], lesion[bz, by, cx][::-1], sz, sy, TILE_ORTO, f"Sagital x={cx}"),
    ]
    orto = Image.new("RGB", (3 * TILE_ORTO, TILE_ORTO))
    for i, t in enumerate(tiles):
        orto.paste(t, (i * TILE_ORTO, 0))
    return grid, orto, zs


def encode_jpeg(im, max_b64=MAX_B64):
    """PIL → bytes JPEG (baja la calidad si el base64 supera el tope)."""
    q = 90
    while True:
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=q)
        data = buf.getvalue()
        if len(data) * 4 / 3 <= max_b64 or q <= 40:
            break
        q -= 10
    return data


def data_url(jpeg_bytes):
    return "data:image/jpeg;base64," + base64.b64encode(jpeg_bytes).decode()


# ───────────────────────────── LLM ─────────────────────────────
def build_messages(metricas, etiqueta, n_cortes, jpg_grid, jpg_orto):
    texto = f"""Datos cuantitativos del paciente (obtenidos con segmentación automática R231 + COPLE-Net):
- Volumen pulmonar total: {metricas['volumen_pulmonar_ml']:.0f} mL ({metricas['volumen_pulmonar_ml']/1000:.2f} L)
- Volumen de tejido dañado: {metricas['volumen_tejido_danado_ml']:.0f} mL
- Porcentaje de tejido dañado respecto al volumen pulmonar: {metricas['porcentaje_tejido_danado']:.2f} %
- Etiqueta del archivo de metadatos: {etiqueta} → {metricas['etiqueta_descripcion']}
  (0 = sano, 1 = otra enfermedad, 2 = COVID-19)

No es posible enviar el volumen 3D, así que se adjuntan dos imágenes 2D de la misma TC (ventana pulmonar):
1) Imagen 1: cuadrícula de {n_cortes} cortes axiales equiespaciados desde el ápice hasta la base de los pulmones.
2) Imagen 2: vista ortogonal (axial, coronal y sagital) centrada en el centroide de la lesión.
Los contornos ROJOS delimitan el tejido dañado según la segmentación automática (puede contener errores).
No infieras lateralidad (derecha/izquierda) a partir de las imágenes.

Redacta una conclusión breve (máximo 5 oraciones) sobre la condición del paciente que integre las cifras, la
distribución de las lesiones que observas y la etiqueta del metadato. Indica si lo observado es coherente con
esa etiqueta, menciona las limitaciones relevantes y aclara que no sustituye la valoración de un médico."""
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": [
            {"type": "text", "text": texto},
            {"type": "image_url", "image_url": {"url": data_url(jpg_grid)}},
            {"type": "image_url", "image_url": {"url": data_url(jpg_orto)}},
        ]},
    ]


def make_llm_client():
    key = os.environ.get("NVIDIA_API_KEY")
    if not key:
        sys.exit("Falta NVIDIA_API_KEY (o usa --skip-llm).")
    from openai import OpenAI
    return OpenAI(base_url=NVIDIA_BASE_URL, api_key=key, timeout=180, max_retries=1)


def call_llm(client, messages, use_thinking, retries=5):
    """Devuelve dict {status, model, conclusion, error, attempts}. Nunca lanza excepción."""
    last = None
    for attempt in range(1, retries + 1):
        try:
            r = client.chat.completions.create(
                model=NVIDIA_MODEL, messages=messages, temperature=0.3, top_p=0.95,
                max_tokens=4096 if use_thinking else 1024,
                extra_body={"chat_template_kwargs": {"enable_thinking": use_thinking}},
                stream=False)
            text = (r.choices[0].message.content or "").strip()
            if not text:
                raise RuntimeError("respuesta vacía del modelo")
            return {"status": "ok", "model": NVIDIA_MODEL, "conclusion": text, "error": None, "attempts": attempt}
        except Exception as e:  # 429, timeouts, 5xx...
            last = e
            wait = min(60, 2 ** attempt) + random.random()
            log.warning("LLM intento %d/%d falló (%s); espero %.0fs", attempt, retries, e, wait)
            if attempt < retries:
                time.sleep(wait)
    return {"status": "error", "model": NVIDIA_MODEL, "conclusion": None, "error": str(last), "attempts": retries}


# ───────────────────────────── Procesamiento de una tomografía ─────────────────────────────
def segment_ct(h, nii_path, seg):
    """Parte GPU: lectura, R231 y COPLE-Net. Devuelve un 'job' con todo lo necesario para finalizar."""
    import SimpleITK as sitk
    t0 = time.time()
    img = sitk.ReadImage(str(nii_path))
    try:
        img = sitk.DICOMOrient(img, "LPS")
    except Exception as e:
        log.warning("%s: no se pudo reorientar (%s)", h, e)
    arr = sitk.GetArrayFromImage(img).astype(np.int16)
    spacing_zyx = tuple(float(s) for s in img.GetSpacing()[::-1])

    lung_lr = seg.lung(img)
    lung = lung_lr > 0
    if lung.sum() == 0:
        raise ValueError("R231 no encontró pulmón (máscara vacía)")
    t_lung = time.time()

    lesion, fuera = seg.lesion(arr, lung)
    t_seg = time.time()
    return {"h": h, "src_name": Path(nii_path).name, "img": img, "arr": arr, "spacing_zyx": spacing_zyx,
            "lung_lr": lung_lr, "lung": lung, "lesion": lesion, "fuera": fuera,
            "t0": t0, "t_lung": t_lung, "t_seg": t_seg}


def finalize_ct(job, storage, labels, llm_client, args, tmp_dir):
    """Parte CPU/red: métricas, imágenes, subida, LLM y result.json. Se ejecuta en un hilo aparte
    mientras la GPU ya está procesando el siguiente caso."""
    import SimpleITK as sitk
    h, img, arr = job["h"], job["img"], job["arr"]
    lung, lung_lr, lesion = job["lung"], job["lung_lr"], job["lesion"]
    spacing_zyx = job["spacing_zyx"]
    t0, t_lung, t_seg = job["t0"], job["t_lung"], job["t_seg"]
    base = f"ct/{h}"

    vox_ml = float(np.prod(spacing_zyx) / 1000.0)
    etiqueta = labels.get(h)
    metricas = {
        "hash_imagen": h,
        "volumen_pulmonar_ml": round(float(lung.sum() * vox_ml), 1),
        "volumen_tejido_danado_ml": round(float(lesion.sum() * vox_ml), 1),
        "porcentaje_tejido_danado": round(100.0 * float(lesion.sum()) / max(int(lung.sum()), 1), 2),
        "etiqueta_csv": etiqueta,
        "etiqueta_descripcion": ETIQUETAS.get(etiqueta, "desconocida"),
    }

    grid, orto, zs = make_images(arr, lung, lesion, spacing_zyx)
    jpg_grid, jpg_orto = encode_jpeg(grid), encode_jpeg(orto)

    d = Path(tmp_dir) / h
    d.mkdir(parents=True, exist_ok=True)

    def save_mask(mask, name):
        out = sitk.GetImageFromArray(mask.astype(np.uint8))
        out.CopyInformation(img)
        sitk.WriteImage(out, str(d / name), useCompression=True)

    sitk.WriteImage(img, str(d / "original.nii.gz"), useCompression=True)
    save_mask(lung_lr, "lung_mask.nii.gz")
    save_mask(lesion, "lesion_mask.nii.gz")
    (d / "grid.jpg").write_bytes(jpg_grid)
    (d / "ortho.jpg").write_bytes(jpg_orto)

    uploads = [("original.nii.gz", "application/gzip"), ("lung_mask.nii.gz", "application/gzip"),
               ("lesion_mask.nii.gz", "application/gzip"), ("grid.jpg", "image/jpeg"),
               ("ortho.jpg", "image/jpeg")]
    if args.skip_original_upload:
        uploads = uploads[1:]
    with ThreadPoolExecutor(max_workers=5) as ex:
        list(ex.map(lambda u: storage.put_file(d / u[0], f"{base}/{u[0]}", u[1]), uploads))
    t_up = time.time()

    if args.skip_llm:
        llm = {"status": "skipped", "model": NVIDIA_MODEL, "conclusion": None, "error": None, "attempts": 0}
    else:
        llm = call_llm(llm_client, build_messages(metricas, etiqueta, len(zs), jpg_grid, jpg_orto),
                       args.thinking)
    t_llm = time.time()

    result = {
        "schema_version": 1,
        "modality": "ct",
        "hash": h,
        "source": f"s3://{SRC_BUCKET}/{CT_PREFIX}images/{job['src_name']}",
        "processed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "image": {"shape_zyx": list(arr.shape), "spacing_zyx_mm": [round(s, 4) for s in spacing_zyx],
                  "hu_min": int(arr.min()), "hu_max": int(arr.max()), "orientation": "LPS"},
        "metrics": metricas,
        "lesion_outside_lung_voxels": job["fuera"],
        "grid_slices_z": zs,
        "files": {
            "original": None if args.skip_original_upload else f"{base}/original.nii.gz",
            "lung_mask": f"{base}/lung_mask.nii.gz",
            "lesion_mask": f"{base}/lesion_mask.nii.gz",
            "grid": f"{base}/grid.jpg",
            "ortho": f"{base}/ortho.jpg",
        },
        "llm": llm,
        # lung/lesion = GPU · images_upload = imágenes+compresión+subida · llm = espera de la API
        "timings_s": {"lung": round(t_lung - t0, 1), "lesion": round(t_seg - t_lung, 1),
                      "images_upload": round(t_up - t_seg, 1), "llm": round(t_llm - t_up, 1),
                      "total": round(t_llm - t0, 1)},
    }
    # result.json se escribe al final: su existencia marca el caso como terminado
    storage.put_bytes(json.dumps(result, ensure_ascii=False, indent=2).encode("utf-8"),
                      f"{base}/result.json", "application/json")
    shutil.rmtree(d, ignore_errors=True)
    return result


def retry_llm_for(h, storage, llm_client, args):
    base = f"ct/{h}"
    result = json.loads(storage.get_bytes(f"{base}/result.json"))
    m = result["metrics"]
    msgs = build_messages(m, m["etiqueta_csv"], len(result["grid_slices_z"]),
                          storage.get_bytes(f"{base}/grid.jpg"), storage.get_bytes(f"{base}/ortho.jpg"))
    result["llm"] = call_llm(llm_client, msgs, args.thinking)
    storage.put_bytes(json.dumps(result, ensure_ascii=False, indent=2).encode("utf-8"),
                      f"{base}/result.json", "application/json")
    return result["llm"]["status"]


# ───────────────────────────── Índice para la app ─────────────────────────────
def build_index(storage, workers=16):
    keys = [k for k in storage.list_keys("ct/") if k.endswith("/result.json")]
    log.info("Construyendo index.json con %d casos...", len(keys))

    def load(k):
        try:
            return json.loads(storage.get_bytes(k))
        except Exception as e:
            log.warning("No se pudo leer %s: %s", k, e)
            return None

    with ThreadPoolExecutor(max_workers=workers) as ex:
        results = [r for r in ex.map(load, keys) if r]
    items = []
    for r in sorted(results, key=lambda r: r["hash"]):
        items.append({"hash": r["hash"], **{k: v for k, v in r["metrics"].items() if k != "hash_imagen"},
                      "llm_status": r["llm"]["status"], "conclusion": r["llm"]["conclusion"],
                      "files": r["files"], "processed_at": r["processed_at"]})
    index = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
             "count": len(items), "items": items}
    storage.put_bytes(json.dumps(index, ensure_ascii=False).encode("utf-8"), "index.json", "application/json")
    log.info("index.json actualizado (%d casos).", len(items))


# ───────────────────────────── Utilidades de ejecución ─────────────────────────────
def prefetch(keys, src, dest_dir, depth=2):
    """Descarga las siguientes `depth` imágenes en segundo plano mientras la GPU trabaja."""
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)

    def dl(key):
        path = dest_dir / key.split("/")[-1]
        src.download_file(SRC_BUCKET, key, str(path))
        return path

    with ThreadPoolExecutor(max_workers=depth) as ex:
        pending = deque()
        it = iter(keys)

        def fill():
            while len(pending) < depth:
                try:
                    k = next(it)
                except StopIteration:
                    return
                pending.append((k, ex.submit(dl, k)))

        fill()
        while pending:
            k, fut = pending.popleft()
            fill()
            try:
                yield k, fut.result(), None
            except Exception as e:
                yield k, None, e


def parse_shard(s):
    i, n = (int(x) for x in s.split("/"))
    if not (0 <= i < n):
        raise argparse.ArgumentTypeError("usa --shard i/n con 0 <= i < n, p. ej. 0/2")
    return i, n


def select_keys(all_keys, args, done):
    if args.hash:
        keys = [k for k in all_keys if hash_from_key(k) == args.hash]
        if not keys:
            sys.exit(f"No se encontró {args.hash} en el bucket.")
        return keys
    keys = all_keys
    if args.shard:
        i, n = args.shard
        keys = keys[i::n]
    if not args.force:
        keys = [k for k in keys if hash_from_key(k) not in done]
    if args.limit:
        keys = keys[: args.limit]
    return keys


def run_ct(args, storage, src):
    import threading
    workdir = Path(args.workdir)
    workdir.mkdir(parents=True, exist_ok=True)

    all_keys = list_source(src, f"{CT_PREFIX}images/", (".nii", ".nii.gz"))
    log.info("Tomografías en el bucket: %d", len(all_keys))
    done = {k.split("/")[1] for k in storage.list_keys("ct/") if k.endswith("/result.json")}
    log.info("Ya procesadas en el almacenamiento: %d", len(done))
    keys = select_keys(all_keys, args, done)
    if not keys:
        log.info("Nada que procesar.")
        return
    log.info("Por procesar ahora: %d", len(keys))

    labels = load_labels(src, workdir)
    seg = Segmenter(args.weights, args.sw_batch, args.lung_batch)
    llm_client = None if args.skip_llm else make_llm_client()

    lock = threading.Lock()
    stats = {"ok": 0, "failed": []}
    # Como máximo post_workers casos finalizando + 1 en la GPU → acota la RAM usada
    slots = threading.BoundedSemaphore(args.post_workers + 1)

    def record_error(h, n, e):
        with lock:
            stats["failed"].append(h)
            with open(workdir / "errors.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps({"hash": h, "error": str(e), "at": datetime.now().isoformat()}) + "\n")
        log.error("[%d/%d] %s FALLÓ: %s", n, len(keys), h, e)

    def finalize_task(job, n):
        h = job["h"]
        try:
            r = finalize_ct(job, storage, labels, llm_client, args, workdir / "tmp")
            with lock:
                stats["ok"] += 1
            m, t = r["metrics"], r["timings_s"]
            log.info("[%d/%d] %s ok · pulmón %.0f mL · lesión %.2f%% · etiqueta %s · LLM %s · "
                     "GPU %.0fs+%.0fs · post %.0fs",
                     n, len(keys), h, m["volumen_pulmonar_ml"], m["porcentaje_tejido_danado"],
                     m["etiqueta_csv"], r["llm"]["status"], t["lung"], t["lesion"],
                     t["images_upload"] + t["llm"])
        except Exception as e:
            log.debug(traceback.format_exc())
            record_error(h, n, e)
        finally:
            slots.release()

    t_start = time.time()
    with ThreadPoolExecutor(max_workers=args.post_workers) as post:
        for n, (key, path, err) in enumerate(prefetch(keys, src, workdir / "downloads"), 1):
            h = hash_from_key(key)
            try:
                if err:
                    raise err
                job = segment_ct(h, path, seg)
            except Exception as e:
                log.debug(traceback.format_exc())
                record_error(h, n, e)
                continue
            finally:
                if path:
                    Path(path).unlink(missing_ok=True)   # libera disco
            slots.acquire()
            post.submit(finalize_task, job, n)
            del job
    # al salir del 'with' ya terminaron todas las finalizaciones
    log.info("Terminado: %d ok, %d con error en %.1f min", stats["ok"], len(stats["failed"]),
             (time.time() - t_start) / 60)
    if stats["failed"]:
        log.info("Casos con error (se reintentan al volver a ejecutar): %s", ", ".join(stats["failed"]))
    if not args.no_index:
        build_index(storage)


def run_retry_llm(args, storage):
    keys = [k for k in storage.list_keys("ct/") if k.endswith("/result.json")]
    pend = []
    for k in keys:
        r = json.loads(storage.get_bytes(k))
        if r["llm"]["status"] != "ok":
            pend.append(r["hash"])
    log.info("Casos con LLM pendiente/fallido: %d de %d", len(pend), len(keys))
    if args.limit:
        pend = pend[: args.limit]
    if not pend:
        return
    client = make_llm_client()
    for n, h in enumerate(pend, 1):
        try:
            log.info("[%d/%d] %s → LLM %s", n, len(pend), h, retry_llm_for(h, storage, client, args))
        except Exception as e:
            log.error("%s: %s", h, e)
    if not args.no_index:
        build_index(storage)


def run_xray(args, storage, src):
    """Radiografías: solo se copian los PNG originales al almacenamiento (sin segmentación)."""
    prefix = args.xray_prefix
    keys = list_source(src, prefix, (".png",))
    if not keys:
        log.error("No hay .png bajo '%s'. Ejecuta --list-prefixes para ver la estructura real.", prefix)
        return
    log.info("Radiografías en el bucket: %d", len(keys))
    done = {k.split("/")[-1][:-4] for k in storage.list_keys("xray/") if k.endswith(".png")}
    todo = [k for k in keys if args.hash == hash_from_key(k)] if args.hash else \
        [k for k in (keys[args.shard[0]::args.shard[1]] if args.shard else keys)
         if args.force or hash_from_key(k) not in done]
    if args.limit:
        todo = todo[: args.limit]
    log.info("Por copiar: %d", len(todo))
    tmp = Path(args.workdir) / "xray_tmp"
    tmp.mkdir(parents=True, exist_ok=True)

    def one(key):
        h = hash_from_key(key)
        p = tmp / f"{h}.png"
        try:
            src.download_file(SRC_BUCKET, key, str(p))
            storage.put_file(p, f"xray/{h}.png", "image/png")
            return h, None
        except Exception as e:
            return h, e
        finally:
            p.unlink(missing_ok=True)

    ok = bad = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        for i, (h, e) in enumerate(ex.map(one, todo), 1):
            if e:
                bad += 1
                log.error("%s: %s", h, e)
            else:
                ok += 1
            if i % 50 == 0:
                log.info("  %d/%d", i, len(todo))
    log.info("Radiografías: %d copiadas, %d con error", ok, bad)


def run_check(args):
    """Verifica por separado: AWS (fuente), almacenamiento, API de NVIDIA y pesos. No procesa nada."""
    print("== Comprobación de configuración ==")
    bad = 0

    # 1) Fuente pública
    try:
        r = make_source().list_objects_v2(Bucket=SRC_BUCKET, Prefix=f"{CT_PREFIX}images/", MaxKeys=1)
        print(f"[OK]  Bucket público de AWS accesible ({len(r.get('Contents', []))} objeto de muestra).")
    except Exception as e:
        bad += 1
        print(f"[ERR] No se pudo acceder al bucket de AWS: {e}")

    # 2) Almacenamiento
    needed = ("STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY")
    if args.storage == "local":
        print("[--]  Almacenamiento: modo local, no se prueba la nube.")
    else:
        missing = [v for v in needed if not os.environ.get(v)]
        if missing:
            bad += 1
            print(f"[ERR] Faltan variables de almacenamiento: {', '.join(missing)}")
            print("      → ¿cargaste el archivo en ESTA terminal?  set -a; source covid.env; set +a")
        else:
            try:
                st = S3Storage()
                st.put_bytes(b"ok", "_check/ping.txt", "text/plain")
                assert st.get_bytes("_check/ping.txt") == b"ok"
                st.delete("_check/ping.txt")
                print(f"[OK]  Almacenamiento: escribir, leer y borrar funcionan en {st.description}.")
            except Exception as e:
                bad += 1
                print(f"[ERR] Almacenamiento falló: {e}")
                print("      Revisa endpoint, nombre del bucket, llaves y que el token tenga permiso de lectura y escritura.")

    # 3) API de NVIDIA
    if args.skip_llm:
        print("[--]  LLM: omitido por --skip-llm.")
    elif not os.environ.get("NVIDIA_API_KEY"):
        bad += 1
        print("[ERR] Falta NVIDIA_API_KEY.")
    else:
        r = call_llm(make_llm_client(), [{"role": "user", "content": "Responde solo con la palabra OK."}],
                     False, retries=1)
        if r["status"] == "ok":
            print(f"[OK]  API de NVIDIA responde (modelo {NVIDIA_MODEL}).")
        else:
            bad += 1
            print(f"[ERR] API de NVIDIA falló: {r['error']}")

    # 4) Pesos
    w = Path(args.weights)
    if w.exists():
        print(f"[OK]  Pesos encontrados: {w} ({w.stat().st_size:,} bytes).")
    else:
        bad += 1
        print(f"[ERR] No existe el archivo de pesos: {w}")

    print("\n" + ("Todo listo para lanzar." if not bad else f"{bad} problema(s) por resolver antes de lanzar."))
    sys.exit(1 if bad else 0)


# ───────────────────────────── CLI ─────────────────────────────
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--modality", choices=["ct", "xray"], default="ct")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--hash", help="procesa solo este hash")
    g.add_argument("--all", action="store_true", help="procesa todo lo pendiente")
    g.add_argument("--retry-llm", action="store_true", help="reintenta la respuesta del LLM en casos fallidos")
    g.add_argument("--build-index", action="store_true", help="solo regenera index.json")
    g.add_argument("--list-prefixes", action="store_true", help="muestra la estructura del bucket de AWS")
    g.add_argument("--check", action="store_true", help="verifica credenciales, almacenamiento y pesos")
    ap.add_argument("--limit", type=int, help="máximo de casos a procesar en esta ejecución")
    ap.add_argument("--shard", type=parse_shard, help="i/n: reparte el trabajo entre n instancias (p. ej. 0/2)")
    ap.add_argument("--force", action="store_true", help="reprocesa aunque ya exista result.json")
    ap.add_argument("--storage", choices=["auto", "s3", "local"], default="auto")
    ap.add_argument("--local-dir", default="./output")
    ap.add_argument("--workdir", default="./work")
    ap.add_argument("--weights", default="./coplenet_pretrain.pt")
    ap.add_argument("--sw-batch", type=int, default=2,
                    help="ventanas 96³ por lote en COPLE-Net (RTX 3090 24 GB: prueba 8-16)")
    ap.add_argument("--lung-batch", type=int, default=16,
                    help="cortes por lote en R231 (RTX 3090: prueba 32-64)")
    ap.add_argument("--post-workers", type=int, default=2,
                    help="casos que se finalizan (imágenes, subida, LLM) en paralelo mientras la GPU sigue")
    ap.add_argument("--skip-llm", action="store_true")
    ap.add_argument("--thinking", action="store_true", help="activa el modo de razonamiento del LLM")
    ap.add_argument("--skip-original-upload", action="store_true",
                    help="no sube original.nii.gz (ya es público en AWS; ahorra almacenamiento)")
    ap.add_argument("--no-index", action="store_true")
    ap.add_argument("--xray-prefix", default=XRAY_PREFIX_DEFAULT)
    args = ap.parse_args()

    log_name = "run.log"
    if args.shard:   # cada shard con su propia carpeta de trabajo y su propio log
        args.workdir = str(Path(args.workdir) / f"shard{args.shard[0]}_of_{args.shard[1]}")
        log_name = f"run_shard{args.shard[0]}.log"
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.StreamHandler(), logging.FileHandler(log_name, encoding="utf-8")])

    if not (args.hash or args.all or args.retry_llm or args.build_index or args.list_prefixes or args.check):
        ap.error("indica --hash HASH, --all, --retry-llm, --build-index, --list-prefixes o --check")

    if args.list_prefixes:
        list_prefixes(make_source())
        return

    if args.check:
        run_check(args)

    storage = make_storage(args)
    log.info("Almacenamiento: %s", storage.description)

    if args.build_index:
        build_index(storage)
    elif args.retry_llm:
        run_retry_llm(args, storage)
    elif args.modality == "xray":
        run_xray(args, storage, make_source())
    else:
        run_ct(args, storage, make_source())


if __name__ == "__main__":
    main()
