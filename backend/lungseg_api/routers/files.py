"""Endpoint de archivos derivados (ticket B2).

GET/HEAD /api/studies/{study_id}/files/{layer}.nii.gz

* layer ∈ {ct, lung_right, lung_left, lesion} (lista blanca; cualquier otro → 404).
* Se valida id y layer ANTES de construir cualquier Path (regla 09).
* Si la capa no existe para ese estudio → 404 con mensaje claro, sin filtrar
  rutas absolutas al cliente.
* Cabeceras: ETag, Last-Modified, Cache-Control: no-cache.
* If-None-Match válido → 304 sin cuerpo.
* El archivo se sirve en streaming (FileResponse), sin leerlo entero a memoria.
"""

from __future__ import annotations

import email.utils
import os

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse

from lungseg_api.catalog import _find_lung, get_data_dir
from lungseg_api.derive import DERIVED_LAYERS, _source_path, ensure_layer
from lungseg_api.schemas import ID_REGEX

router = APIRouter()

VALID_LAYERS = frozenset(DERIVED_LAYERS)


def _valid_id(study_id: str) -> bool:
    return bool(ID_REGEX.match(study_id))


def _layer_unavailable_detail(study_id: str, layer: str) -> str:
    """Mensaje de 404 que nunca revela rutas absolutas del servidor."""
    return f"La capa '{layer}' no está disponible para el estudio '{study_id}'"


@router.get("/api/studies/{study_id}/files/{layer}.nii.gz")
@router.head("/api/studies/{study_id}/files/{layer}.nii.gz")
def get_derived_file(study_id: str, layer: str, request: Request) -> Response:
    # Regla 09: validar id y layer ANTES de construir cualquier Path.
    if not _valid_id(study_id):
        raise HTTPException(
            status_code=404, detail=f"Id de estudio inválido: {study_id!r}"
        )
    if layer not in VALID_LAYERS:
        raise HTTPException(status_code=404, detail=f"Layer no válida: {layer}")

    data_dir = get_data_dir()

    # El estudio debe existir (tener al menos su archivo de pulmón).
    if _find_lung(data_dir, study_id) is None:
        raise HTTPException(
            status_code=404, detail=f"Estudio no encontrado: {study_id!r}"
        )

    # La capa debe tener fuente disponible (ct sin CT, lesión sin lesión).
    source_path = _source_path(data_dir, study_id, layer)
    if source_path is None:
        raise HTTPException(
            status_code=404, detail=_layer_unavailable_detail(study_id, layer)
        )

    # Generar / recuperar el derivado (caché por mtime, escritura atómica).
    try:
        dest = ensure_layer(data_dir, study_id, layer)
    except FileNotFoundError:
        raise HTTPException(
            status_code=404, detail=_layer_unavailable_detail(study_id, layer)
        )

    stat = os.stat(dest)
    mtime = stat.st_mtime
    size = stat.st_size
    etag = f'"{mtime}-{size}"'
    last_modified = email.utils.formatdate(mtime, usegmt=True)

    # Revalidación condicional: If-None-Match válido → 304 sin cuerpo.
    if_none_match = request.headers.get("if-none-match")
    if if_none_match == etag:
        return Response(
            status_code=304,
            headers={
                "ETag": etag,
                "Last-Modified": last_modified,
                "Cache-Control": "no-cache",
            },
        )

    return FileResponse(
        path=dest,
        media_type="application/gzip",
        headers={
            "ETag": etag,
            "Last-Modified": last_modified,
            "Cache-Control": "no-cache",
        },
    )
