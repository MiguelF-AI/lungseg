"""Catálogo de estudios: detección de archivos en disco sin leer NIfTI.

Solo inspecciona qué archivos existen en el directorio de datos. No carga ni
lee cabeceras NIfTI (eso le corresponde a B2).
"""

import os
from typing import List, Optional

from lungseg_api.config import get_data_dir
from lungseg_api.schemas import ID_REGEX, LayerInfo, StudyDetail, StudySummary

CT_EXTS = (".nii", ".nii.gz")
LUNG_SUFFIXES = ("_lung.nii.gz", "_lung.nii")
LESION_SUFFIXES = ("_cople_lesion.nii.gz", "_cople_lesion.nii")


def _valid_id(study_id: str) -> bool:
    return bool(ID_REGEX.match(study_id))


def _find_ct(data_dir: str, study_id: str) -> Optional[str]:
    """Devuelve el nombre del archivo CT fuente si existe, o None."""
    for ext in CT_EXTS:
        path = os.path.join(data_dir, f"{study_id}{ext}")
        if os.path.isfile(path):
            return f"{study_id}{ext}"
    return None


def _find_lung(data_dir: str, study_id: str) -> Optional[str]:
    """Devuelve el nombre del archivo de pulmón fuente si existe, o None."""
    for suffix in LUNG_SUFFIXES:
        path = os.path.join(data_dir, f"{study_id}{suffix}")
        if os.path.isfile(path):
            return path
    return None


def _find_lesion(data_dir: str, study_id: str) -> Optional[str]:
    """Devuelve el nombre del archivo de lesión fuente si existe, o None."""
    for suffix in LESION_SUFFIXES:
        path = os.path.join(data_dir, f"{study_id}{suffix}")
        if os.path.isfile(path):
            return path
    return None


def _strip_lung_suffix(entry: str) -> Optional[str]:
    """Quita el sufijo de archivo de pulmón de una entrada de directorio."""
    for suffix in LUNG_SUFFIXES:
        if entry.endswith(suffix):
            return entry[: -len(suffix)]
    return None


def _list_valid_studies(data_dir: str) -> List[str]:
    """Lista ids válidos que tienen archivo de pulmón, ignorando inválidos."""
    if not os.path.isdir(data_dir):
        return []
    studies: List[str] = []
    for entry in os.listdir(data_dir):
        study_id = _strip_lung_suffix(entry)
        if study_id is None or not _valid_id(study_id):
            continue
        studies.append(study_id)
    studies.sort()
    return studies


def list_studies(data_dir: Optional[str] = None) -> List[StudySummary]:
    """Devuelve todos los estudios válidos con las capas disponibles."""
    if data_dir is None:
        data_dir = get_data_dir()

    summaries: List[StudySummary] = []
    for study_id in _list_valid_studies(data_dir):
        layers = _layers_for(data_dir, study_id)
        summaries.append(StudySummary(id=study_id, layers=layers))
    return summaries


def _layers_for(data_dir: str, study_id: str) -> List[str]:
    """Capas disponibles para un estudio (por existencia de archivo fuente)."""
    layers: List[str] = []
    if _find_ct(data_dir, study_id) is not None:
        layers.append("ct")
    # El estudio existe si hay _lung.nii(.gz), así que siempre tiene ambos pulmones.
    layers.extend(["lung_right", "lung_left"])
    if _find_lesion(data_dir, study_id) is not None:
        layers.append("lesion")
    return layers


def get_study(study_id: str, data_dir: Optional[str] = None) -> StudyDetail:
    """Devuelve el detalle de un estudio o ValueError si no existe / id inválido."""
    if data_dir is None:
        data_dir = get_data_dir()

    if not _valid_id(study_id):
        raise ValueError(f"Id de estudio inválido: {study_id!r}")

    if _find_lung(data_dir, study_id) is None:
        raise ValueError(f"Estudio no encontrado: {study_id!r}")

    layers = _layers_for_detail(data_dir, study_id)
    return StudyDetail(id=study_id, layers=layers)


def _layers_for_detail(data_dir: str, study_id: str) -> List[LayerInfo]:
    ct_name = _find_ct(data_dir, study_id)
    lesion_path = _find_lesion(data_dir, study_id)

    layers: List[LayerInfo] = []
    if ct_name is not None:
        layers.append(
            LayerInfo(
                key="ct",
                label="Tomografía",
                kind="base",
                color=None,
                url=f"/api/studies/{study_id}/files/ct.nii.gz",
            )
        )
    layers.append(
        LayerInfo(
            key="lung_right",
            label="Pulmón derecho",
            kind="mask",
            color="#4169e1",
            url=f"/api/studies/{study_id}/files/lung_right.nii.gz",
        )
    )
    layers.append(
        LayerInfo(
            key="lung_left",
            label="Pulmón izquierdo",
            kind="mask",
            color="#3cb371",
            url=f"/api/studies/{study_id}/files/lung_left.nii.gz",
        )
    )
    if lesion_path is not None:
        layers.append(
            LayerInfo(
                key="lesion",
                label="Tejido dañado",
                kind="mask",
                color="#ff2a2a",
                url=f"/api/studies/{study_id}/files/lesion.nii.gz",
            )
        )
    return layers
