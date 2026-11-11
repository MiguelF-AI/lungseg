"""Generación y caché de capas derivadas (ticket B2).

Producción de ``ct.nii.gz``, ``lung_right.nii.gz``, ``lung_left.nii.gz`` y
``lesion.nii.gz`` en ``storage/derived/{id}/``, con:

* invalidación por ``mtime`` de los archivos fuente (sidecar ``metadata.json``),
* escritura atómica (archivo temporal + :func:`os.replace`),
* un candado por estudio para que dos peticiones simultáneas no generen lo
  mismo dos veces,
* una sola CT completa en memoria a la vez, con ``del`` al terminar.

Fórmula de volumetría (litros):
    n_voxeles * (sx*sy*sz en mm³) / 1e6   (citada en B3, no aquí).
"""

from __future__ import annotations

import gzip
import json
import os
import shutil
import tempfile
import threading
from dataclasses import dataclass
from typing import Callable, Dict, Optional

import nibabel as nib
import numpy as np

from lungseg_api.catalog import _find_ct, _find_lesion, _find_lung
from lungseg_api.config import get_data_dir, get_storage_dir

DERIVED_LAYERS = ("ct", "lung_right", "lung_left", "lesion")

# Nivel de gzip para la CT derivada: 4 es un compromiso rápido/tamaño.
# Nivel 1 deja archivos muy grandes (CTs de cientos de MB que se descargan);
# nivel 9 es más lento y apenas reduce tamaño frente al 4 en datos de imagen
# médica (alta entropía).
CT_GZIP_LEVEL = 4

_derivation_locks: Dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(study_id: str) -> threading.Lock:
    """Candado (reutilizado) por estudio."""
    with _locks_guard:
        lock = _derivation_locks.get(study_id)
        if lock is None:
            lock = threading.Lock()
            _derivation_locks[study_id] = lock
        return lock


@dataclass
class DerivedLayer:
    key: str
    path: str
    mtime: float


def _derived_dir(study_id: str) -> str:
    return os.path.join(get_storage_dir(), "derived", study_id)


def _sidecar_path(study_id: str) -> str:
    return os.path.join(_derived_dir(study_id), "metadata.json")


def _read_sidecar(path: str) -> Optional[dict]:
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None


def _write_sidecar_atomic(path: str, data: dict) -> None:
    directory = os.path.dirname(path)
    fd, tmp_name = tempfile.mkstemp(dir=directory, prefix=".metadata", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, sort_keys=True)
        os.replace(tmp_name, path)
    except Exception:
        if os.path.isfile(tmp_name):
            os.remove(tmp_name)
        raise


def _source_path(data_dir: str, study_id: str, key: str) -> Optional[str]:
    """Ruta completa del archivo fuente de una capa, o None si no existe."""
    if key == "ct":
        name = _find_ct(data_dir, study_id)
        return os.path.join(data_dir, name) if name else None
    if key in ("lung_right", "lung_left"):
        return _find_lung(data_dir, study_id)
    if key == "lesion":
        return _find_lesion(data_dir, study_id)
    return None


def _source_mtime(data_dir: str, study_id: str, key: str) -> Optional[float]:
    path = _source_path(data_dir, study_id, key)
    if path is None or not os.path.isfile(path):
        return None
    return os.path.getmtime(path)


def _save_nifti_gz(
    data_uint8: np.ndarray,
    affine: np.ndarray,
    header,
    out_path: str,
    compresslevel: int = CT_GZIP_LEVEL,
) -> None:
    """Escribe un NIfTI uint8 como .nii.gz, comprimiendo una sola vez.

    Escribe un .nii temporal y lo comprime con gzip al nivel indicado, para no
    depender del nivel por defecto de nibabel (9, lento en CTs grandes).
    """
    img = nib.Nifti1Image(data_uint8, affine, header=header)
    img.header.set_data_dtype(data_uint8.dtype)  # el archivo destino es uint8
    tmp_nii = out_path + ".tmp.nii"
    try:
        nib.save(img, tmp_nii)
        with open(tmp_nii, "rb") as f_in:
            with gzip.open(out_path, "wb", compresslevel=compresslevel) as f_out:
                shutil.copyfileobj(f_in, f_out)
    finally:
        if os.path.isfile(tmp_nii):
            os.remove(tmp_nii)
    del img


def _write_atomic(dirpath: str, tmp_name: str, writer: Callable[[str], None]) -> str:
    """Ejecuta ``writer`` sobre un archivo temporal y lo renombra al final."""
    tmp_path = os.path.join(dirpath, tmp_name)
    try:
        writer(tmp_path)
    except Exception:
        if os.path.isfile(tmp_path):
            os.remove(tmp_path)
        raise
    return tmp_path


def _build_ct(data_dir: str, study_id: str, source_path: str, out_path: str) -> None:
    """Copia o comprime la CT fuente a ``ct.nii.gz`` (nivel 4 si no está comprimida).

    No lee los voxeles de la CT en memoria: se copia/comprime el archivo, de
    modo que nunca hay más de una CT completa cargada a la vez.
    """
    if source_path.lower().endswith(".gz"):
        # Ya está comprimida: copiar tal cual (una sola vez, caché después).
        shutil.copyfile(source_path, out_path)
    else:
        with open(source_path, "rb") as f_in:
            with gzip.open(out_path, "wb", compresslevel=CT_GZIP_LEVEL) as f_out:
                shutil.copyfileobj(f_in, f_out)


def _image_parts(img) -> tuple:
    """Devuelve (data, affine, header) de una imagen NIfTI cargada.

    Los tipos de nibabel son débiles para pyright (FileBasedImage no expone
    dataobj/affine), por eso se ignora el acceso a atributos aquí, una sola vez.
    """
    data = np.asarray(img.dataobj)  # type: ignore[attr-defined]
    affine = img.affine  # type: ignore[attr-defined]
    header = img.header  # type: ignore[attr-defined]
    return data, affine, header


def _build_mask(
    data_dir: str,
    study_id: str,
    key: str,
    source_path: str,
    out_path: str,
) -> None:
    """Construye una máscara binaria uint8 conservando affine y shape de la fuente.

    Regla 10: los voxeles se cargan con np.asarray(img.dataobj) y se liberan
    (del) justo después de procesar.
    """
    img = nib.load(source_path)
    data = affine = header = None
    try:
        data, affine, header = _image_parts(img)
        if key == "lung_right":
            mask = (data == 1).astype(np.uint8)
        elif key == "lung_left":
            mask = (data == 2).astype(np.uint8)
        elif key == "lesion":
            mask = (data > 0).astype(np.uint8)
        else:  # pragma: no cover - validado antes
            raise ValueError(f"Layer no soportada: {key!r}")
        _save_nifti_gz(mask, affine, header, out_path)
    finally:
        del data, affine, header, img


def _ensure_layer_locked(data_dir: str, study_id: str, key: str) -> str:
    """Garantiza que exista el derivado de ``key`` (dentro del candado)."""
    if key not in DERIVED_LAYERS:
        raise ValueError(f"Layer no válida: {key!r}")

    derived_dir = _derived_dir(study_id)
    os.makedirs(derived_dir, exist_ok=True)
    dest = os.path.join(derived_dir, f"{key}.nii.gz")
    sidecar = _sidecar_path(study_id)

    source_path = _source_path(data_dir, study_id, key)
    if source_path is None:
        raise FileNotFoundError(
            f"Fuente no disponible para la capa {key!r} del estudio {study_id!r}"
        )

    source_mtime = os.path.getmtime(source_path)

    stored = _read_sidecar(sidecar) or {}
    sources: dict = stored.get("sources", {})
    if sources.get(key) == source_mtime and os.path.isfile(dest):
        # Caché válida: la fuente no ha cambiado desde la última generación.
        return dest

    # Generar en archivo temporal y renombrar al final (escritura atómica).
    tmp_name = f".{key}.nii.gz.tmp"
    if key == "ct":
        tmp_path = _write_atomic(
            derived_dir,
            tmp_name,
            lambda p: _build_ct(data_dir, study_id, source_path, p),
        )
    else:
        tmp_path = _write_atomic(
            derived_dir,
            tmp_name,
            lambda p: _build_mask(data_dir, study_id, key, source_path, p),
        )
    os.replace(tmp_path, dest)

    # Actualizar solo la entrada de esta capa en el sidecar (invalidación
    # granular: si cambia una fuente, se regenera solo lo que depende de ella).
    sources[key] = source_mtime
    stored["sources"] = sources
    _write_sidecar_atomic(sidecar, stored)

    return dest


def ensure_layer(data_dir: Optional[str], study_id: str, key: str) -> str:
    """Devuelve la ruta al .nii.gz derivado de ``key``, generándolo si hace falta.

    Serializa por estudio mediante un candado, para que peticiones
    simultáneas no generen el mismo derivado dos veces.
    """
    if data_dir is None:
        data_dir = get_data_dir()
    lock = _lock_for(study_id)
    with lock:
        return _ensure_layer_locked(data_dir, study_id, key)


def ensure_all_layers(
    data_dir: Optional[str], study_id: str
) -> Dict[str, DerivedLayer]:
    """Asegura todas las capas disponibles y devuelve sus metadatos."""
    if data_dir is None:
        data_dir = get_data_dir()
    result: Dict[str, DerivedLayer] = {}
    for key in DERIVED_LAYERS:
        source_path = _source_path(data_dir, study_id, key)
        if source_path is None:
            continue
        path = ensure_layer(data_dir, study_id, key)
        result[key] = DerivedLayer(key=key, path=path, mtime=os.path.getmtime(path))
    return result
