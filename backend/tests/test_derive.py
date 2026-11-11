"""Tests de derivados y archivos (ticket B2).

Usan NIfTI sintéticos generados con nibabel en tmp_path: nunca leen NIfTI
reales ni usan red.
"""

import os
import time

import nibabel as nib
import numpy as np
from fastapi.testclient import TestClient
from lungseg_api.main import app

client = TestClient(app)

AFFINE = np.array(
    [
        [1.5, 0.0, 0.0, 10.0],
        [0.0, 1.5, 0.0, 20.0],
        [0.0, 0.0, 2.0, 30.0],
        [0.0, 0.0, 0.0, 1.0],
    ],
    dtype=float,
)
SHAPE = (6, 6, 4)


def _make_study(
    tmp_path,
    study_id,
    with_ct=True,
    with_lesion=True,
    lung_ext=".nii.gz",
    ct_ext=".nii.gz",
    lesion_ext=".nii.gz",
):
    """Crea un estudio sintético con pulmón (etiquetas 1/2) y opcional CT y lesión."""
    lung_data = np.zeros(SHAPE, dtype=np.int16)
    lung_data[0:3] = 1  # pulmón derecho
    lung_data[3:6] = 2  # pulmón izquierdo
    lung_img = nib.Nifti1Image(lung_data, AFFINE)
    lung_path = tmp_path / f"{study_id}_lung{lung_ext}"
    nib.save(lung_img, lung_path)

    ct_path = None
    if with_ct:
        ct_data = np.zeros(SHAPE, dtype=np.int16)
        ct_img = nib.Nifti1Image(ct_data, AFFINE)
        ct_path = tmp_path / f"{study_id}{ct_ext}"
        nib.save(ct_img, ct_path)

    lesion_path = None
    if with_lesion:
        lesion_data = np.zeros(SHAPE, dtype=np.uint8)
        lesion_data[2:4, 2:4, 1:3] = 1  # tejido dañado
        lesion_img = nib.Nifti1Image(lesion_data, AFFINE)
        lesion_path = tmp_path / f"{study_id}_cople_lesion{lesion_ext}"
        nib.save(lesion_img, lesion_path)

    return str(lung_path), ct_path, lesion_path


def _set_env(tmp_path):
    # os.environ (no monkeypatch) para que el valor sea visible también en el
    # hilo interno de TestClient/httpx (monkeypatch.setenv no llega hasta ahí).
    os.environ["LUNGSEG_DATA_DIR"] = str(tmp_path)
    os.environ["LUNGSEG_STORAGE_DIR"] = str(tmp_path / "storage")


def _read_nii(path):
    """Carga un NIfTI y devuelve (data_array, affine, header).

    Los tipos de nibabel son débiles para pyright; se ignora aquí, una sola vez.
    """
    img = nib.load(str(path))  # type: ignore[arg-type]
    data = np.asarray(img.dataobj)  # type: ignore[attr-defined]
    return data, img.affine, img.header  # type: ignore[attr-defined]


def test_ct_derivative_shape_and_affine(tmp_path, monkeypatch):
    _set_env(tmp_path)
    lung_path, ct_path, _ = _make_study(
        tmp_path, "caso_ct", with_ct=True, with_lesion=False
    )

    from lungseg_api.derive import ensure_layer

    dest = ensure_layer(str(tmp_path), "caso_ct", "ct")

    src_data, src_affine, _ = _read_nii(ct_path)
    out_data, out_affine, _ = _read_nii(dest)
    assert np.array_equal(out_data.shape, src_data.shape)
    assert np.allclose(out_affine, src_affine)


def test_lung_right_derivative_shape_and_affine(tmp_path, monkeypatch):
    _set_env(tmp_path)
    lung_path, _, _ = _make_study(tmp_path, "caso_r", with_ct=False, with_lesion=False)

    from lungseg_api.derive import ensure_layer

    dest = ensure_layer(str(tmp_path), "caso_r", "lung_right")

    _, src_affine, _ = _read_nii(lung_path)
    out_data, out_affine, _ = _read_nii(dest)
    assert np.array_equal(out_data.shape, SHAPE)
    assert np.allclose(out_affine, src_affine)
    assert out_data.dtype == np.uint8


def test_lung_left_derivative_shape_and_affine(tmp_path, monkeypatch):
    _set_env(tmp_path)
    lung_path, _, _ = _make_study(tmp_path, "caso_l", with_ct=False, with_lesion=False)

    from lungseg_api.derive import ensure_layer

    dest = ensure_layer(str(tmp_path), "caso_l", "lung_left")

    _, src_affine, _ = _read_nii(lung_path)
    out_data, out_affine, _ = _read_nii(dest)
    assert np.array_equal(out_data.shape, SHAPE)
    assert np.allclose(out_affine, src_affine)
    assert out_data.dtype == np.uint8


def test_lesion_derivative_shape_and_affine(tmp_path, monkeypatch):
    _set_env(tmp_path)
    _, _, lesion_path = _make_study(
        tmp_path, "caso_les", with_ct=False, with_lesion=True
    )

    from lungseg_api.derive import ensure_layer

    dest = ensure_layer(str(tmp_path), "caso_les", "lesion")

    _, src_affine, _ = _read_nii(lesion_path)
    out_data, out_affine, _ = _read_nii(dest)
    assert np.array_equal(out_data.shape, SHAPE)
    assert np.allclose(out_affine, src_affine)
    assert out_data.dtype == np.uint8


def test_lung_right_union_equals_lung_over_zero(tmp_path, monkeypatch):
    _set_env(tmp_path)
    lung_path, _, _ = _make_study(tmp_path, "caso_u", with_ct=False, with_lesion=False)

    from lungseg_api.derive import ensure_layer

    right_data, _, _ = _read_nii(ensure_layer(str(tmp_path), "caso_u", "lung_right"))
    left_data, _, _ = _read_nii(ensure_layer(str(tmp_path), "caso_u", "lung_left"))
    lung_data, _, _ = _read_nii(lung_path)

    assert right_data.dtype == np.uint8 and left_data.dtype == np.uint8
    # Unión de ambos pulmones == (lung > 0)
    assert np.array_equal(((right_data > 0) | (left_data > 0)), (lung_data > 0))
    # Sin solapamiento entre derecho e izquierdo
    assert np.count_nonzero((right_data > 0) & (left_data > 0)) == 0


def test_ct_without_ct_404(tmp_path, monkeypatch):
    _set_env(tmp_path)
    _make_study(tmp_path, "sin_ct", with_ct=False, with_lesion=True)

    response = client.get("/api/studies/sin_ct/files/ct.nii.gz")
    assert response.status_code == 404
    # Mensaje claro y sin rutas absolutas del servidor
    body = response.json()
    assert "ct" in body["detail"].lower()
    assert "C:" not in body["detail"] and "\\" not in body["detail"]


def test_lesion_without_lesion_404(tmp_path, monkeypatch):
    _set_env(tmp_path)
    _make_study(tmp_path, "sin_lesion", with_ct=True, with_lesion=False)

    response = client.get("/api/studies/sin_lesion/files/lesion.nii.gz")
    assert response.status_code == 404
    body = response.json()
    assert "lesion" in body["detail"].lower()


def test_second_request_if_none_match_304(tmp_path, monkeypatch):
    _set_env(tmp_path)
    _make_study(tmp_path, "caso_cache", with_ct=True, with_lesion=True)

    first = client.get("/api/studies/caso_cache/files/ct.nii.gz")
    assert first.status_code == 200
    etag = first.headers["etag"]
    assert "last-modified" in first.headers
    assert first.headers["cache-control"] == "no-cache"
    assert len(first.content) > 0

    second = client.get(
        "/api/studies/caso_cache/files/ct.nii.gz",
        headers={"If-None-Match": etag},
    )
    assert second.status_code == 304
    assert second.content == b""


def test_head_request(tmp_path, monkeypatch):
    _set_env(tmp_path)
    _make_study(tmp_path, "caso_head", with_ct=True, with_lesion=False)

    response = client.head("/api/studies/caso_head/files/ct.nii.gz")
    assert response.status_code == 200
    assert response.headers["etag"]
    assert response.headers["cache-control"] == "no-cache"
    assert response.content == b""


def test_regeneration_after_source_mtime_change(tmp_path, monkeypatch):
    _set_env(tmp_path)
    lung_path, _, _ = _make_study(
        tmp_path, "caso_regen", with_ct=False, with_lesion=False
    )

    from lungseg_api.derive import ensure_layer

    dest1 = ensure_layer(str(tmp_path), "caso_regen", "lung_right")
    mtime1 = os.path.getmtime(dest1)

    # Tocar el mtime de la fuente de pulmón
    time.sleep(0.05)
    os.utime(lung_path, None)

    dest2 = ensure_layer(str(tmp_path), "caso_regen", "lung_right")
    mtime2 = os.path.getmtime(dest2)
    assert mtime2 > mtime1, (
        "El derivado debería regenerarse al cambiar el mtime de la fuente"
    )


def test_invalid_id_404(tmp_path, monkeypatch):
    _set_env(tmp_path)
    assert client.get("/api/studies/../etc/passwd/files/ct.nii.gz").status_code == 404
    assert client.get("/api/studies/id con espacios/files/ct.nii.gz").status_code == 404
    assert (
        client.get("/api/studies/" + "a" * 65 + "/files/ct.nii.gz").status_code == 404
    )


def test_invalid_layer_404(tmp_path, monkeypatch):
    _set_env(tmp_path)
    _make_study(tmp_path, "caso_layer", with_ct=True, with_lesion=True)

    for layer in ("tumores", "lung", "CT", "", "lung_right_extra"):
        response = client.get(f"/api/studies/caso_layer/files/{layer}.nii.gz")
        assert response.status_code == 404, f"layer {layer!r} debería ser 404"


def test_nonexistent_study_404(tmp_path, monkeypatch):
    _set_env(tmp_path)
    assert client.get("/api/studies/no_existe/files/ct.nii.gz").status_code == 404
    assert client.get("/api/studies/no_existe/files/lesion.nii.gz").status_code == 404
