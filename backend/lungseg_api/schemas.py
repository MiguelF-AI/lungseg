"""Schemas Pydantic del contrato de API (§6 del plan)."""

import re
from typing import List, Optional

from pydantic import BaseModel

# Regex de validación de id de estudio (§5 del plan).
ID_REGEX = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class LayerInfo(BaseModel):
    key: str
    label: str
    kind: str
    color: Optional[str] = None
    url: Optional[str] = None


class StudySummary(BaseModel):
    id: str
    layers: List[str] = []
    lesion_pct: Optional[float] = None
    lesion_l: Optional[float] = None


class StudyDetail(BaseModel):
    id: str
    shape: Optional[List[int]] = None
    spacing_mm: Optional[List[float]] = None
    layers: List[LayerInfo] = []
    lesion_pct: Optional[float] = None
    lesion_l: Optional[float] = None


class LesionByLung(BaseModel):
    right: float = 0.0
    left: float = 0.0


class Metrics(BaseModel):
    """Métricas de un estudio (§6 del plan). Volúmenes en litros."""

    lung_right_l: float
    lung_left_l: float
    lung_total_l: float
    lesion_l: float
    lesion_pct_of_lung: float
    lesion_by_lung_pct: LesionByLung
    lesion_components: int
    lesion_centroid_mm: Optional[List[float]] = None
