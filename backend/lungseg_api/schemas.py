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
