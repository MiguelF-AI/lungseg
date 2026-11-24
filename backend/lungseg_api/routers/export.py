"""Endpoint de exportación de máscaras (ticket F8).

GET /api/studies/{study_id}/export.zip

* Valida el ``id`` con la regex de §5 **antes** de construir cualquier ruta
  (regla 09); si no coincide → 404.
* Incluye SOLO las máscaras derivadas disponibles (nunca la CT: tamaño y
  privacidad), con nombres planos y un ``LEEME.txt`` en español.
* El ZIP se construye en un archivo temporal con ``ZIP_STORED`` (las máscaras
  ya son ``.nii.gz``) y se sirve en streaming; el temporal se borra al terminar
  la respuesta. No se cargan archivos enteros en memoria (regla 10).
* Los errores nunca filtran rutas absolutas del servidor (regla 04).
"""

from __future__ import annotations

import os
import tempfile
import zipfile
from datetime import datetime, timezone
from typing import Dict

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from lungseg_api.catalog import _find_lung, get_data_dir
from lungseg_api.config import get_storage_dir
from lungseg_api.derive import DerivedLayer, ensure_mask_layers
from lungseg_api.schemas import ID_REGEX

router = APIRouter()

# Texto de cada máscara para el LEEME (regla 12: lenguaje no diagnóstico).
_MASK_DESCRIPTIONS = {
    "lung_right": "1 = pulmón derecho (modelo R231 / lungmask).",
    "lung_left": "1 = pulmón izquierdo (modelo R231 / lungmask).",
    "lesion": "1 = tejido dañado u opacidades segmentadas (COPLE-Net).",
}


def _readme_text(study_id: str, layers: Dict[str, DerivedLayer]) -> str:
    """Contenido del LEEME.txt del ZIP, en español y UTF-8."""
    files = "\n".join(
        f"- {study_id}_{key}.nii.gz: {_MASK_DESCRIPTIONS.get(key, '')}"
        for key in layers
    )
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    return (
        "LungSeg WebViewer — exportación de máscaras\n"
        "\n"
        f"ID del estudio: {study_id}\n"
        "\n"
        "Archivos incluidos:\n"
        f"{files}\n"
        "\n"
        "Significado del valor 1 en cada máscara binaria:\n"
        f"{files}\n"
        "\n"
        "Todas las máscaras conservan la misma geometría (affine) que los "
        "archivos de origen.\n"
        "Modelos: R231/lungmask para los pulmones y COPLE-Net para la lesión.\n"
        f"Fecha de generación: {generated}\n"
        "\n"
        "Uso académico, no es un dispositivo médico.\n"
    )


def _safe_remove(path: str) -> None:
    """Borra el temporal de exportación sin lanzar al cerrar la respuesta."""
    try:
        os.remove(path)
    except OSError:
        pass


@router.get("/api/studies/{study_id}/export.zip")
def export_study(study_id: str) -> FileResponse:
    # Regla 09: validar antes de construir cualquier Path.
    if not ID_REGEX.match(study_id):
        raise HTTPException(
            status_code=404, detail=f"Id de estudio inválido: {study_id!r}"
        )

    data_dir = get_data_dir()
    if _find_lung(data_dir, study_id) is None:
        raise HTTPException(
            status_code=404, detail=f"Estudio no encontrado: {study_id!r}"
        )

    try:
        layers = ensure_mask_layers(study_id, data_dir)
    except (FileNotFoundError, ValueError):
        raise HTTPException(
            status_code=404, detail=f"Estudio no encontrado: {study_id!r}"
        )

    if not layers:
        raise HTTPException(
            status_code=404, detail="El estudio no tiene máscaras segmentadas."
        )

    export_dir = os.path.join(get_storage_dir(), "exports")
    os.makedirs(export_dir, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        dir=export_dir, prefix=f".export_{study_id}_", suffix=".zip"
    )
    try:
        with os.fdopen(fd, "wb") as raw:
            with zipfile.ZipFile(raw, "w", compression=zipfile.ZIP_STORED) as zf:
                # arcname plano: el id ya validado no contiene '/' ni '..'.
                for key, layer in layers.items():
                    zf.write(layer.path, arcname=f"{study_id}_{key}.nii.gz")
                zf.writestr("LEEME.txt", _readme_text(study_id, layers).encode("utf-8"))
    except Exception:
        _safe_remove(tmp_path)
        raise

    return FileResponse(
        path=tmp_path,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{study_id}_masks.zip"',
            "Cache-Control": "no-store",
        },
        background=BackgroundTask(_safe_remove, tmp_path),
    )
