"""Cálculo y caché de métricas por estudio (ticket B3).

Las métricas se calculan **siempre** sobre las máscaras derivadas de B2
(``lung_right``, ``lung_left``, ``lesion``), nunca sobre las fuentes.

Fórmula de volumetría (litros), regla 05 de AGENTS.md:

    n_voxeles * (sx*sy*sz en mm³) / 1e6

donde ``(sx, sy, sz)`` son los tamaños de vóxel del **header** NIfTI
(``img.header.get_zooms()[:3]``) y no se deducen "a ojo" del affine.

Decisiones de cálculo (documentadas también en PLAN §6):

* ``lesion_pct_of_lung`` = vóxeles de lesión / (vóxeles de pulmón derecho +
  izquierdo, máscaras **crudas**) * 100. Es la misma fórmula que el notebook
  de referencia, para que los números sean comparables.
* ``lesion_by_lung_pct`` reparte la lesión entre pulmones con la máscara
  pulmonar **rellenada por corte axial** (``binary_fill_holes`` 2D): R231 deja
  huecos donde hay consolidación densa y ahí cae lesión real. Cada vóxel de
  lesión se asigna al pulmón cuya máscara rellena lo contiene (si estuviera en
  ambos, gana el derecho) y se divide entre los vóxeles de la máscara **cruda**
  de ese pulmón. Los vóxeles de lesión que no caen en ningún pulmón relleno no
  se cuentan en ningún numerador, así que los dos porcentajes pueden no sumar
  ``lesion_pct_of_lung``.
* ``lesion_components`` usa :func:`scipy.ndimage.label` con **conectividad 6**
  (``generate_binary_structure(3, 1)``): con cortes de ~2.5 mm, un contacto
  solo diagonal entre vóxeles no es una lesión continua, y 6 es el criterio
  conservador y reproducible.
* ``lesion_centroid_mm`` es el centroide en vóxeles de la lesión llevado a mm
  de mundo con :func:`nibabel.affines.apply_affine`; es ``null`` si no hay
  lesión.

Memoria (regla 10): las máscaras se cargan con ``np.asarray(img.dataobj)``
como ``uint8``, una cada vez, y se liberan con ``del``. El relleno de huecos se
hace por rebanadas sobre el array ya cargado (no con accesos sueltos al proxy
de un ``.nii.gz``, que descomprime desde el principio en cada acceso).

Caché: ``storage/derived/{id}/metrics.json`` con los ``mtime`` de las fuentes
(pulmón y lesión) en ``sources``; se recalcula solo si cambian. La escritura es
atómica y el cálculo se serializa con el mismo candado por estudio de B2
(``derive._lock_for``), que **no** es reentrante: se toma después de asegurar
las derivadas.
"""

from __future__ import annotations

import json
import os
import tempfile
from typing import Dict, Optional, Tuple

import nibabel as nib
import numpy as np
from nibabel.affines import apply_affine
from scipy import ndimage

from lungseg_api.catalog import _find_lesion, _find_lung
from lungseg_api.config import get_data_dir
from lungseg_api.derive import _derived_dir, _lock_for, _source_mtime, ensure_layer
from lungseg_api.schemas import LesionByLung, Metrics

# Conectividad 6 (ortogonal) para contar componentes de lesión.
_COMPONENT_STRUCTURE = ndimage.generate_binary_structure(3, 1)


def metrics_path(study_id: str) -> str:
    """Ruta del ``metrics.json`` cacheado de un estudio (id ya validado)."""
    return os.path.join(_derived_dir(study_id), "metrics.json")


def _read_json(path: str) -> Optional[dict]:
    """Lee un JSON del caché; ``None`` si no existe o está corrupto."""
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _current_sources(data_dir: str, study_id: str) -> Dict[str, Optional[float]]:
    """mtimes de las fuentes que invalidan la caché (``None`` si faltan)."""
    return {
        "lung": _source_mtime(data_dir, study_id, "lung_right"),
        "lesion": _source_mtime(data_dir, study_id, "lesion"),
    }


def _sources_match(stored: object, current: Dict[str, Optional[float]]) -> bool:
    """Compara los mtimes guardados con los actuales (sin cargar NIfTI)."""
    if not isinstance(stored, dict) or set(stored) != set(current):
        return False
    for key, value in current.items():
        saved = stored.get(key)
        if value is None or saved is None:
            if value is not None or saved is not None:
                return False
        elif not isinstance(saved, (int, float)) or abs(float(saved) - value) > 1e-6:
            return False
    return True


def read_cached_metrics(
    study_id: str, data_dir: Optional[str] = None
) -> Optional[Metrics]:
    """Devuelve las métricas cacheadas y vigentes, o ``None``.

    Solo hace ``stat`` y lee el JSON: **no** carga NIfTI ni calcula nada. Es lo
    que usan ``/api/studies`` y ``/api/studies/{id}`` para rellenar
    ``lesion_pct``/``lesion_l`` sin coste.
    """
    if data_dir is None:
        data_dir = get_data_dir()
    stored = _read_json(metrics_path(study_id))
    if stored is None or not _sources_match(
        stored.get("sources"), _current_sources(data_dir, study_id)
    ):
        return None
    try:
        return Metrics.model_validate(stored["metrics"])
    except (KeyError, ValueError):
        # Caché con formato inesperado: se trata como ausente y se recalcula.
        return None


def _write_metrics_cache(
    path: str, sources: Dict[str, Optional[float]], metrics: Metrics
):
    """Escribe el JSON de métricas de forma atómica."""
    payload = {"sources": sources, "metrics": metrics.model_dump()}
    directory = os.path.dirname(path)
    fd, tmp_name = tempfile.mkstemp(dir=directory, prefix=".metrics", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2, sort_keys=True)
        os.replace(tmp_name, path)
    except Exception:
        if os.path.isfile(tmp_name):
            os.remove(tmp_name)
        raise


def _header_geometry(path: str) -> Tuple[Tuple[float, float, float], np.ndarray]:
    """Tamaño de vóxel (mm, del header) y affine de una máscara."""
    img = nib.load(path)
    try:
        zooms = img.header.get_zooms()  # type: ignore[attr-defined]
        spacing = (float(zooms[0]), float(zooms[1]), float(zooms[2]))
        affine = np.asarray(img.affine, dtype=float)  # type: ignore[attr-defined]
    finally:
        del img
    return spacing, affine


def _axial_axis(axcodes: Tuple[str, str, str]) -> int:
    """Eje axial (superior/inferior) según los códigos de orientación del header.

    Se deriva del header (``nibabel.aff2axcodes``) en lugar de asumir que el
    eje 2 lo es: las máscaras reorientadas a LPS lo cumplen, pero no queremos
    depender de ello. Si el header no declara S/I, se usa el eje 2 (convención
    NIfTI habitual).
    """
    for axis, code in enumerate(axcodes):
        if code in ("S", "I"):
            return axis
    return 2


def _count_mask(path: str) -> int:
    """Cuenta los vóxeles distintos de cero de una máscara uint8.

    Carga una sola máscara y la libera al terminar (regla 10).
    """
    img = nib.load(path)
    data = None
    try:
        data = np.asarray(img.dataobj)  # type: ignore[attr-defined]
        return int(np.count_nonzero(data))
    finally:
        del data, img


def _lesion_stats(
    path: str,
) -> Tuple[int, int, Optional[Tuple[float, float, float]]]:
    """Devuelve (n_vóxeles, n_componentes, centroide en vóxeles o ``None``).

    Los componentes se cuentan con conectividad 6 (:data:`_COMPONENT_STRUCTURE`)
    y el centroide con :func:`scipy.ndimage.center_of_mass` (índices float).
    """
    img = nib.load(path)
    data = None
    try:
        data = np.asarray(img.dataobj)  # type: ignore[attr-defined]
        mask = data > 0
        count = int(np.count_nonzero(mask))
        if count == 0:
            return 0, 0, None
        labeling = ndimage.label(mask, structure=_COMPONENT_STRUCTURE)
        # Los tipos de scipy 1.18 + numpy 2.5 son imprecisos para pyright.
        components = int(labeling[1])  # type: ignore
        del labeling  # int32 del tamaño del volumen: se libera cuanto antes
        center = ndimage.center_of_mass(mask)  # type: ignore[assignment]
        return (
            count,
            components,
            (float(center[0]), float(center[1]), float(center[2])),  # type: ignore
        )
    finally:
        del data, img


def _binary_mask(path: str) -> np.ndarray:
    """Carga una máscara como ``bool`` y libera los datos originales.

    Los derivados son ``uint8``; la copia booleana ocupa lo mismo que el uint8,
    así que se descarta el array original en cuanto se tiene la máscara.
    """
    img = nib.load(path)
    data = None
    try:
        data = np.asarray(img.dataobj)  # type: ignore[attr-defined]
        return np.asarray(data) > 0
    finally:
        del data, img


def _filled_by_slice(path: str, axis: int) -> np.ndarray:
    """Máscara ``bool`` con los huecos rellenados corte a corte en el eje axial.

    Se rellena **en el propio array** (``binary_fill_holes`` 2D por rebanada),
    así que nunca hay dos volúmenes completos de la misma máscara a la vez.
    """
    img = nib.load(path)
    data = None
    try:
        data = np.asarray(img.dataobj)  # type: ignore[attr-defined]
        filled = np.asarray(data, dtype=bool)
    finally:
        del data, img
    for index in range(filled.shape[axis]):
        slicer: list = [slice(None)] * 3
        slicer[axis] = index
        key = tuple(slicer)
        filled[key] = ndimage.binary_fill_holes(filled[key])
    return filled


def _lesion_in_lung_counts(
    lung_right_path: str,
    lung_left_path: str,
    lesion_path: Optional[str],
) -> Tuple[int, int]:
    """Cuenta vóxeles de lesión dentro de cada pulmón relleno por corte axial.

    Se aplica ``binary_fill_holes`` 2D por corte axial (eje deducido del
    header) para incluir la lesión que cae en un hueco de la máscara cruda
    (R231). Si un vóxel estuviera en los dos pulmones rellenos, se asigna al
    derecho.

    Nota de rendimiento: los volúmenes se cargan completos (una máscara cada
    vez) y se recorren en memoria. Leer rebanadas sueltas del proxy de un
    ``.nii.gz`` obliga a descomprimir desde el principio en cada acceso y es
    ~100x más lento. Pico de memoria: tres máscaras ``bool`` del tamaño del
    volumen (≈75 MB cada una en un CT de 512×512×300).
    """
    if lesion_path is None:
        return 0, 0

    _, affine = _header_geometry(lung_right_path)
    axis = _axial_axis(nib.aff2axcodes(affine))

    right_filled = _filled_by_slice(lung_right_path, axis)
    left_filled = _filled_by_slice(lung_left_path, axis)
    lesion = _binary_mask(lesion_path)
    try:
        if (
            lesion.shape != right_filled.shape
            or left_filled.shape != right_filled.shape
        ):
            raise ValueError("Las máscaras del estudio no tienen la misma forma")

        counts = {"right": 0, "left": 0}
        for index in range(right_filled.shape[axis]):
            slicer: list = [slice(None)] * 3
            slicer[axis] = index
            key = tuple(slicer)
            lesion_slice = lesion[key]
            if not lesion_slice.any():
                continue
            in_right = lesion_slice & right_filled[key]
            in_left = lesion_slice & left_filled[key]
            counts["right"] += int(np.count_nonzero(in_right))
            counts["left"] += int(np.count_nonzero(in_left & ~in_right))
            del in_right, in_left
    finally:
        del lesion, left_filled, right_filled
    return counts["right"], counts["left"]


def volume_l(voxel_count: int, voxel_mm3: float) -> float:
    """Volumen en litros: ``n_voxeles * (sx*sy*sz en mm³) / 1e6`` (regla 05)."""
    return voxel_count * voxel_mm3 / 1e6


def _pct(numerator: int, denominator: int) -> float:
    """Porcentaje seguro ante denominador cero."""
    if denominator <= 0:
        return 0.0
    return numerator / denominator * 100.0


def _compute_from_paths(
    lung_right_path: str,
    lung_left_path: str,
    lesion_path: Optional[str],
) -> Metrics:
    """Calcula ``Metrics`` a partir de las rutas de los derivados de B2."""
    spacing, affine = _header_geometry(lung_right_path)
    voxel_mm3 = spacing[0] * spacing[1] * spacing[2]

    right_voxels = _count_mask(lung_right_path)
    left_voxels = _count_mask(lung_left_path)

    lesion_voxels = 0
    components = 0
    centroid_voxels: Optional[Tuple[float, float, float]] = None
    if lesion_path is not None:
        lesion_voxels, components, centroid_voxels = _lesion_stats(lesion_path)

    right_lesion, left_lesion = _lesion_in_lung_counts(
        lung_right_path, lung_left_path, lesion_path
    )

    centroid_mm: Optional[list[float]] = None
    if centroid_voxels is not None:
        world = apply_affine(affine, np.asarray(centroid_voxels))
        centroid_mm = [round(float(value), 2) for value in world]

    lung_total_voxels = right_voxels + left_voxels
    return Metrics(
        lung_right_l=round(volume_l(right_voxels, voxel_mm3), 6),
        lung_left_l=round(volume_l(left_voxels, voxel_mm3), 6),
        lung_total_l=round(volume_l(lung_total_voxels, voxel_mm3), 6),
        lesion_l=round(volume_l(lesion_voxels, voxel_mm3), 6),
        lesion_pct_of_lung=round(_pct(lesion_voxels, lung_total_voxels), 2),
        lesion_by_lung_pct=LesionByLung(
            right=round(_pct(right_lesion, right_voxels), 2),
            left=round(_pct(left_lesion, left_voxels), 2),
        ),
        lesion_components=components,
        lesion_centroid_mm=centroid_mm,
    )


def ensure_derived_masks(data_dir: str, study_id: str) -> None:
    """Asegura los derivados que necesitan las métricas (delega en B2)."""
    ensure_layer(data_dir, study_id, "lung_right")
    ensure_layer(data_dir, study_id, "lung_left")
    if _find_lesion(data_dir, study_id) is not None:
        ensure_layer(data_dir, study_id, "lesion")


def compute_metrics(study_id: str, data_dir: Optional[str] = None) -> Metrics:
    """Calcula las métricas sin usar la caché (asegura antes las derivadas)."""
    if data_dir is None:
        data_dir = get_data_dir()
    ensure_derived_masks(data_dir, study_id)
    lesion_path = (
        os.path.join(_derived_dir(study_id), "lesion.nii.gz")
        if _find_lesion(data_dir, study_id) is not None
        else None
    )
    return _compute_from_paths(
        os.path.join(_derived_dir(study_id), "lung_right.nii.gz"),
        os.path.join(_derived_dir(study_id), "lung_left.nii.gz"),
        lesion_path,
    )


def get_metrics(study_id: str, data_dir: Optional[str] = None) -> Metrics:
    """Métricas del estudio, desde caché o calculadas y cacheadas.

    El candado por estudio de B2 se toma **después** de asegurar las derivadas:
    ``ensure_layer`` ya lo usa y ``threading.Lock`` no es reentrante. Así dos
    peticiones simultáneas calculan como mucho una vez.
    """
    if data_dir is None:
        data_dir = get_data_dir()
    if _find_lung(data_dir, study_id) is None:
        raise ValueError(f"Estudio no encontrado: {study_id!r}")

    cached = read_cached_metrics(study_id, data_dir)
    if cached is not None:
        return cached

    ensure_derived_masks(data_dir, study_id)

    with _lock_for(study_id):
        cached = read_cached_metrics(study_id, data_dir)
        if cached is not None:
            return cached
        # Los mtimes se leen antes de calcular: si la fuente cambia a mitad,
        # la caché queda marcada como obsoleta y se recalcula la próxima vez.
        sources = _current_sources(data_dir, study_id)
        lesion_path = (
            os.path.join(_derived_dir(study_id), "lesion.nii.gz")
            if sources["lesion"] is not None
            else None
        )
        metrics = _compute_from_paths(
            os.path.join(_derived_dir(study_id), "lung_right.nii.gz"),
            os.path.join(_derived_dir(study_id), "lung_left.nii.gz"),
            lesion_path,
        )
        _write_metrics_cache(metrics_path(study_id), sources, metrics)
        return metrics
