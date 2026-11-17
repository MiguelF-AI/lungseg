"""Tests de métricas (ticket B3).

Usan NIfTI sintéticos en ``tmp_path``: nunca leen datos reales ni usan red.
Geometría de prueba: espaciado anisótropo 0.8 x 0.8 x 2.5 mm y un affine **no
identidad** (rotación de 90° en el plano + traslación), para que el centroide
en mm no coincida con el centroide en vóxeles.

Fórmula comprobada: ``n_voxeles * (sx*sy*sz en mm³) / 1e6`` litros.
"""

import json
import os
import time

import nibabel as nib
import numpy as np
import pytest
from fastapi.testclient import TestClient
from lungseg_api import metrics as metrics_module
from lungseg_api.main import app
from nibabel.affines import apply_affine

client = TestClient(app)

# Affine no identidad: columnas de 0.8/0.8/2.5 mm rotadas 90° en el plano xy.
AFFINE = np.array(
    [
        [0.0, -0.8, 0.0, 10.0],
        [0.8, 0.0, 0.0, -20.0],
        [0.0, 0.0, 2.5, 30.0],
        [0.0, 0.0, 0.0, 1.0],
    ],
    dtype=float,
)
SHAPE = (20, 20, 10)
VOXEL_MM3 = 0.8 * 0.8 * 2.5


def _save(path, data, affine=AFFINE, zooms=None):
    """Guarda un NIfTI sintético con affine (y, opcionalmente, zooms) dados."""
    img = nib.Nifti1Image(data, affine)
    if zooms is not None:
        img.header.set_zooms(zooms)
    nib.save(img, str(path))


def _make_study(tmp_path, study_id, lung, lesion=None, lung_ext=".nii", zooms=None):
    """Crea un estudio sintético: máscara de pulmón (1/2) y lesión opcional."""
    lung_path = tmp_path / f"{study_id}_lung{lung_ext}"
    _save(lung_path, lung, zooms=zooms)
    if lesion is not None:
        _save(tmp_path / f"{study_id}_cople_lesion{lung_ext}", lesion, zooms=zooms)
    return lung_path


def _set_env(tmp_path):
    # os.environ (no monkeypatch) para que el valor sea visible también en el
    # hilo interno de TestClient/httpx.
    os.environ["LUNGSEG_DATA_DIR"] = str(tmp_path)
    os.environ["LUNGSEG_STORAGE_DIR"] = str(tmp_path / "storage")


def _split_lung():
    """Máscara de pulmón con derecho (i 0..4) e izquierdo (i 15..19) de 1000 vóxeles."""
    lung = np.zeros(SHAPE, dtype=np.uint8)
    lung[0:5] = 1
    lung[15:20] = 2
    return lung


def _count_calls(monkeypatch):
    """Envuelve ``_compute_from_paths`` para contar cuántas veces se recalcula."""
    calls = {"count": 0}
    original = metrics_module._compute_from_paths

    def wrapper(*args, **kwargs):
        calls["count"] += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(metrics_module, "_compute_from_paths", wrapper)
    return calls


def test_volume_l_formula():
    # 1e6 vóxeles de 1 mm³ = 1 litro (regla 05).
    assert metrics_module.volume_l(1_000_000, 1.0) == pytest.approx(1.0)
    assert metrics_module.volume_l(100, 1.6) == pytest.approx(0.00016)


def test_known_volumes_within_one_percent(tmp_path, monkeypatch):
    _set_env(tmp_path)
    lung = _split_lung()
    lesion = np.zeros(SHAPE, dtype=np.uint8)
    lesion[1:4, 5:10, 2:8] = 1  # 3*5*6 = 90 vóxeles, dentro del pulmón derecho
    _make_study(tmp_path, "vol_conocido", lung, lesion)

    response = client.get("/api/studies/vol_conocido/metrics")
    assert response.status_code == 200
    body = response.json()

    # Valores esperados a mano: 1000 vóxeles por pulmón y 90 de lesión.
    expected_right = 1000 * VOXEL_MM3 / 1e6
    expected_left = 1000 * VOXEL_MM3 / 1e6
    expected_lesion = 90 * VOXEL_MM3 / 1e6
    for key, expected in (
        ("lung_right_l", expected_right),
        ("lung_left_l", expected_left),
        ("lung_total_l", expected_right + expected_left),
        ("lesion_l", expected_lesion),
    ):
        relative_error = abs(body[key] - expected) / expected
        assert relative_error < 0.01, f"{key}: error {relative_error:.4%}"
    assert body["lesion_pct_of_lung"] == pytest.approx(90 / 2000 * 100, abs=0.01)
    # La lesión cae dentro del pulmón derecho: 90 / 1000.
    assert body["lesion_by_lung_pct"]["right"] == pytest.approx(9.0, abs=0.01)
    assert body["lesion_by_lung_pct"]["left"] == 0.0
    assert body["lesion_components"] == 1


def test_spacing_comes_from_header_not_affine(tmp_path, monkeypatch):
    _set_env(tmp_path)
    lung = _split_lung()
    # Header con zooms distintos de los del affine: manda el header.
    _make_study(tmp_path, "zooms_header", lung, zooms=(0.9, 0.9, 3.0))

    body = client.get("/api/studies/zooms_header/metrics").json()

    expected_right = 1000 * 0.9 * 0.9 * 3.0 / 1e6
    assert body["lung_right_l"] == pytest.approx(expected_right, rel=0.01)
    # Si se hubiera usado el affine (1.6 mm³/vóxel) el error sería > 30 %.
    assert abs(body["lung_right_l"] - 0.0016) / 0.0016 > 0.3


def test_centroid_in_world_mm(tmp_path, monkeypatch):
    _set_env(tmp_path)
    lung = _split_lung()
    lesion = np.zeros(SHAPE, dtype=np.uint8)
    lesion[4:6, 3:8, 2:4] = 1  # centroide en vóxeles (4.5, 5.0, 2.5)
    _make_study(tmp_path, "centroide", lung, lesion)

    body = client.get("/api/studies/centroide/metrics").json()

    expected_mm = apply_affine(AFFINE, np.array([4.5, 5.0, 2.5]))
    assert body["lesion_centroid_mm"] == pytest.approx(
        [float(value) for value in expected_mm], abs=0.01
    )
    # El centroide en vóxeles no coincide con el de mundo (affine no identidad).
    assert body["lesion_centroid_mm"][2] == pytest.approx(36.25, abs=0.01)


def test_focus_is_inside_largest_component_with_bilateral_lesions(
    tmp_path, monkeypatch
):
    """Dos focos separados: el centroide global cae fuera y el foco dentro.

    Los dos focos comparten y/z y están separados en x, así que el centroide
    ponderado de la unión cae en x≈12.6, un vóxel **sin lesión**. El foco debe
    caer en el componente mayor (el de x 15..19).
    """
    _set_env(tmp_path)
    lung = _split_lung()
    lesion = np.zeros(SHAPE, dtype=np.uint8)
    lesion[1:3, 5:8, 2:5] = 1  # foco pequeño: 2*3*3 = 18 vóxeles
    lesion[15:20, 5:8, 2:5] = 1  # foco grande: 5*3*3 = 45 vóxeles
    _make_study(tmp_path, "focos_bilaterales", lung, lesion)

    body = client.get("/api/studies/focos_bilaterales/metrics").json()
    assert body["lesion_components"] == 2
    assert body["lesion_centroid_mm"] is not None
    assert body["lesion_focus_mm"] is not None

    inverse = np.linalg.inv(AFFINE)
    centroid_vox = np.round(
        apply_affine(inverse, np.array(body["lesion_centroid_mm"]))
    ).astype(int)
    # El centroide global cae fuera de la lesión (es el caso que motiva F6).
    assert lesion[tuple(centroid_vox)] == 0

    focus_vox = np.round(
        apply_affine(inverse, np.array(body["lesion_focus_mm"]))
    ).astype(int)
    # El foco es un vóxel de lesión y pertenece al componente más grande.
    assert lesion[tuple(focus_vox)] == 1
    assert focus_vox[0] >= 15
    # El mm devuelto es el centro de ese vóxel con el affine (no el de vóxeles).
    expected_mm = apply_affine(AFFINE, np.array(focus_vox, dtype=float))
    assert body["lesion_focus_mm"] == pytest.approx(
        [float(value) for value in expected_mm], abs=0.01
    )
    assert body["lesion_focus_mm"] != pytest.approx(body["lesion_centroid_mm"])


def test_focus_single_component_is_its_centroid(tmp_path, monkeypatch):
    _set_env(tmp_path)
    lung = _split_lung()
    lesion = np.zeros(SHAPE, dtype=np.uint8)
    lesion[4:6, 3:8, 2:4] = 1  # mismo bloque que test_centroid_in_world_mm
    _make_study(tmp_path, "foco_unico", lung, lesion)

    body = client.get("/api/studies/foco_unico/metrics").json()

    assert body["lesion_components"] == 1
    # Con un único componente convexo, el vóxel más cercano al centroide es el
    # que lo contiene: el foco coincide con el centroide redondeado a vóxel.
    inverse = np.linalg.inv(AFFINE)
    centroid_vox = np.round(
        apply_affine(inverse, np.array(body["lesion_centroid_mm"]))
    ).astype(int)
    focus_vox = np.round(
        apply_affine(inverse, np.array(body["lesion_focus_mm"]))
    ).astype(int)
    assert tuple(focus_vox) == tuple(centroid_vox)


def test_cache_version_invalidates_b3_format(tmp_path, monkeypatch):
    """Una caché de B3 (sin `schema_version` ni `lesion_focus_mm`) se recalcula."""
    _set_env(tmp_path)
    lung = _split_lung()
    lesion = np.zeros(SHAPE, dtype=np.uint8)
    lesion[5:10, 5:10, 2:8] = 1
    _make_study(tmp_path, "cache_v1", lung, lesion)

    cache_file = tmp_path / "storage" / "derived" / "cache_v1" / "metrics.json"
    cache_file.parent.mkdir(parents=True)
    cache_file.write_text(
        json.dumps(
            {
                # Formato de B3: sin "schema_version" y sin "lesion_focus_mm".
                "sources": {
                    "lung": os.path.getmtime(tmp_path / "cache_v1_lung.nii"),
                    "lesion": os.path.getmtime(tmp_path / "cache_v1_cople_lesion.nii"),
                },
                "metrics": {
                    "lung_right_l": 0.5,
                    "lung_left_l": 0.5,
                    "lung_total_l": 1.0,
                    "lesion_l": 0.1,
                    "lesion_pct_of_lung": 10.0,
                    "lesion_by_lung_pct": {"right": 20.0, "left": 0.0},
                    "lesion_components": 1,
                    "lesion_centroid_mm": [0.0, 0.0, 0.0],
                },
            }
        ),
        encoding="utf-8",
    )

    calls = _count_calls(monkeypatch)
    body = client.get("/api/studies/cache_v1/metrics").json()
    assert calls["count"] == 1, "una caché sin versión debe recalcularse"
    # Los valores de la caché falsa no se sirven: el volumen real es otro.
    assert body["lung_right_l"] != pytest.approx(0.5)
    assert body["lesion_focus_mm"] is not None

    stored = json.loads(cache_file.read_text(encoding="utf-8"))
    assert stored["schema_version"] == metrics_module._METRICS_CACHE_VERSION
    assert stored["metrics"]["lesion_focus_mm"] == body["lesion_focus_mm"]

    # Y la siguiente llamada sí usa la caché nueva.
    calls = _count_calls(monkeypatch)
    again = client.get("/api/studies/cache_v1/metrics").json()
    assert again == body
    assert calls["count"] == 0


def test_lesion_inside_filled_lung_hole(tmp_path, monkeypatch):
    _set_env(tmp_path)
    # Pulmón derecho en anillo por corte axial: 480 vóxeles crudos y un hueco
    # interior de 11x11x10 que R231 dejaría vacío.
    right_ring = np.zeros(SHAPE, dtype=bool)
    right_ring[2:15, 2:15, :] = True
    right_ring[3:14, 3:14, :] = False
    assert int(np.count_nonzero(right_ring)) == 480
    lung = np.zeros(SHAPE, dtype=np.uint8)
    lung[right_ring] = 1
    lung[2:6, 16:20, :] = 2  # izquierdo: 160 vóxeles crudos

    lesion = np.zeros(SHAPE, dtype=np.uint8)
    lesion[5:9, 5:9, 3:7] = 1  # 64 vóxeles dentro del hueco derecho
    lesion[18, 18, 9] = 1  # 1 vóxel fuera de cualquier pulmón (no asignado)
    _make_study(tmp_path, "hueco_r231", lung, lesion)

    body = client.get("/api/studies/hueco_r231/metrics").json()

    # Total: fórmula del notebook con las máscaras crudas (65 / 640).
    assert body["lesion_pct_of_lung"] == pytest.approx(65 / 640 * 100, abs=0.01)
    # Por pulmón: 64 vóxeles del hueco / 480 crudos del derecho.
    assert body["lesion_by_lung_pct"]["right"] == pytest.approx(
        64 / 480 * 100, abs=0.01
    )
    assert body["lesion_by_lung_pct"]["left"] == 0.0
    # El vóxel no asignado no entra en ningún numerador (si entrara: 65 / 480).
    assert body["lesion_by_lung_pct"]["right"] != pytest.approx(
        65 / 480 * 100, abs=0.01
    )
    # Dos componentes: bloque del hueco + vóxel aislado.
    assert body["lesion_components"] == 2


def test_components_use_six_connectivity(tmp_path, monkeypatch):
    _set_env(tmp_path)
    lung = _split_lung()
    lesion = np.zeros(SHAPE, dtype=np.uint8)
    lesion[2, 2, 2] = 1
    lesion[3, 3, 2] = 1  # contacto solo diagonal en el plano → otro componente
    lesion[7, 7, 2] = 1
    lesion[8, 7, 2] = 1  # contacto por cara → mismo componente
    lesion[10, 10, 5] = 1  # aislado
    _make_study(tmp_path, "conectividad", lung, lesion)

    body = client.get("/api/studies/conectividad/metrics").json()

    # 6 conectividad: {A}, {B}, {C, D}, {E} = 4 componentes (26 daría 3).
    assert body["lesion_components"] == 4


def test_without_lesion_and_empty_lesion_are_zero(tmp_path, monkeypatch):
    _set_env(tmp_path)
    lung = _split_lung()
    _make_study(tmp_path, "sin_lesion_b3", lung)  # sin archivo de lesión
    empty = np.zeros(SHAPE, dtype=np.uint8)
    _make_study(tmp_path, "lesion_vacia_b3", lung, empty)  # máscara vacía

    for study_id in ("sin_lesion_b3", "lesion_vacia_b3"):
        response = client.get(f"/api/studies/{study_id}/metrics")
        assert response.status_code == 200
        body = response.json()
        assert body["lesion_l"] == 0
        assert body["lesion_pct_of_lung"] == 0
        assert body["lesion_by_lung_pct"] == {"right": 0.0, "left": 0.0}
        assert body["lesion_components"] == 0
        assert body["lesion_centroid_mm"] is None
        assert body["lesion_focus_mm"] is None
        assert body["lung_total_l"] > 0


def test_second_call_uses_cache_and_studies_fill_from_it(tmp_path, monkeypatch):
    _set_env(tmp_path)
    lung = _split_lung()
    lesion = np.zeros(SHAPE, dtype=np.uint8)
    lesion[5:10, 5:10, 2:8] = 1
    _make_study(tmp_path, "cache_b3", lung, lesion)

    # Antes de calcular: la lista y el detalle no tienen métricas.
    listed = client.get("/api/studies").json()
    assert listed[0]["lesion_pct"] is None
    assert listed[0]["lesion_l"] is None
    detail = client.get("/api/studies/cache_b3").json()
    assert detail["lesion_pct"] is None
    assert detail["lesion_l"] is None

    calls = _count_calls(monkeypatch)
    first = client.get("/api/studies/cache_b3/metrics")
    assert first.status_code == 200
    assert calls["count"] == 1
    metrics = first.json()

    # Segunda llamada: servida de caché, sin recalcular.
    second = client.get("/api/studies/cache_b3/metrics")
    assert second.status_code == 200
    assert second.json() == metrics
    assert calls["count"] == 1

    cache_file = tmp_path / "storage" / "derived" / "cache_b3" / "metrics.json"
    assert cache_file.is_file()

    # La lista y el detalle rellenan solo desde la caché ya existente.
    listed = client.get("/api/studies").json()
    assert listed[0]["lesion_pct"] == metrics["lesion_pct_of_lung"]
    assert listed[0]["lesion_l"] == metrics["lesion_l"]
    detail = client.get("/api/studies/cache_b3").json()
    assert detail["lesion_pct"] == metrics["lesion_pct_of_lung"]
    assert detail["lesion_l"] == metrics["lesion_l"]
    # Y no han disparado ningún cálculo extra.
    assert calls["count"] == 1


def test_recompute_after_source_mtime_change(tmp_path, monkeypatch):
    _set_env(tmp_path)
    lung = _split_lung()
    lesion = np.zeros(SHAPE, dtype=np.uint8)
    lesion[5:10, 5:10, 2:8] = 1
    lung_path = _make_study(tmp_path, "recalc_b3", lung, lesion)

    first = client.get("/api/studies/recalc_b3/metrics")
    assert first.status_code == 200

    calls = _count_calls(monkeypatch)
    time.sleep(0.05)
    os.utime(lung_path, None)  # simula que el notebook ha regenerado la máscara

    second = client.get("/api/studies/recalc_b3/metrics")
    assert second.status_code == 200
    assert calls["count"] == 1, "debería recalcular al cambiar el mtime de la fuente"
    assert second.json() == first.json()


def test_invalid_id_and_missing_study_404(tmp_path, monkeypatch):
    _set_env(tmp_path)
    for bad_id in ("../etc/passwd", "id con espacios", "a" * 65):
        response = client.get(f"/api/studies/{bad_id}/metrics")
        assert response.status_code == 404
        detail = response.json()["detail"]
        assert "C:" not in detail and "\\" not in detail

    assert client.get("/api/studies/no_existe/metrics").status_code == 404
