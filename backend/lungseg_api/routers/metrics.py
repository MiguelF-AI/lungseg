"""Endpoint de métricas por estudio (ticket B3).

GET /api/studies/{study_id}/metrics

* Valida el ``id`` con la regex de §5 **antes** de construir cualquier ruta
  (regla 09); si no coincide → 404.
* Sin archivo de pulmón para ese estudio → 404 (no hay nada que medir).
* La respuesta no filtra rutas absolutas del servidor.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from lungseg_api.catalog import _find_lung, get_data_dir
from lungseg_api.metrics import get_metrics
from lungseg_api.schemas import ID_REGEX, Metrics

router = APIRouter()


@router.get("/api/studies/{study_id}/metrics", response_model=Metrics)
def study_metrics(study_id: str) -> Metrics:
    if not ID_REGEX.match(study_id):
        raise HTTPException(
            status_code=404, detail=f"Id de estudio inválido: {study_id!r}"
        )

    if _find_lung(get_data_dir(), study_id) is None:
        raise HTTPException(
            status_code=404, detail=f"Estudio no encontrado: {study_id!r}"
        )

    try:
        return get_metrics(study_id)
    except ValueError:
        # Mensajes propios, sin rutas del servidor.
        raise HTTPException(
            status_code=404, detail=f"Estudio no encontrado: {study_id!r}"
        )
