"""Tests de exportación ZIP (ticket F8).

Usan NIfTI sintéticos generados con nibabel en tmp_path: nunca leen NIfTI
reales ni usan red (regla 06).
"""

from __future__ import annotations

import io
import os
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor

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


def _set_env(tmp_path):
    # os.environ (no solo monkeypatch) para que el valor sea visible también
    # en el hilo interno de TestClient/httpx y en los hilos del test concurrente.
    os.environ["LUNGSEG_DATA_DIR"] = str(tmp_path)
    os.environ["LUNGSEG_STORAGE_DIR"] = str(tmp_path / "storage")


def _make_study(tmp_path, study_id, with_ct=True, with_lesion=True):
    """Crea un estudio sintético pequeño con pulmón, CT y lesión opcionales."""
    lung_data = np.zeros(SHAPE, dtype=np.int16)
    lung_data[0:3] = 1
    lung_data[3:6] = 2
    nib.save(nib.Nifti1Image(lung_data, AFFINE), tmp_path / f"{study_id}_lung.nii.gz")

    if with_ct:
        ct_data = np.zeros(SHAPE, dtype=np.int16)
        nib.save(nib.Nifti1Image(ct_data, AFFINE), tmp_path / f"{study_id}.nii.gz")

    if with_lesion:
        lesion_data = np.zeros(SHAPE, dtype=np.uint8)
        lesion_data[2:4, 2:4, 1:3] = 1
        nib.save(
            nib.Nifti1Image(lesion_data, AFFINE),
            tmp_path / f"{study_id}_cople_lesion.nii.gz",
        )


def _export_temps(tmp_path):
    return list((tmp_path / "storage" / "exports").glob(".export_*.zip"))


def _open_zip(response):
    assert response.headers["content-type"] == "application/zip"
    return zipfile.ZipFile(io.BytesIO(response.content))


def test_export_zip_contains_only_masks_and_readme(tmp_path):
    _set_env(tmp_path)
    _make_study(tmp_path, "caso_full")

    response = client.get("/api/studies/caso_full/export.zip")

    assert response.status_code == 200
    assert response.headers["content-disposition"] == (
        'attachment; filename="caso_full_masks.zip"'
    )
    assert response.headers["cache-control"] == "no-store"

    with _open_zip(response) as zf:
        assert zf.testzip() is None
        names = sorted(zf.namelist())
        assert names == [
            "LEEME.txt",
            "caso_full_lesion.nii.gz",
            "caso_full_lung_left.nii.gz",
            "caso_full_lung_right.nii.gz",
        ]
        # Nombres planos: ni carpetas ni '..'.
        assert all(
            "/" not in name and "\\" not in name and ".." not in name for name in names
        )

        readme = zf.read("LEEME.txt").decode("utf-8")
        for expected in (
            "ID del estudio: caso_full",
            "R231",
            "COPLE-Net",
            "misma geometría (affine)",
            "UTC",
            "Uso académico, no es un dispositivo médico.",
        ):
            assert expected in readme

        # Cada máscara del ZIP es byte a byte idéntica al derivado en disco.
        for key in ("lung_right", "lung_left", "lesion"):
            derived = tmp_path / "storage" / "derived" / "caso_full" / f"{key}.nii.gz"
            assert derived.is_file()
            assert zf.read(f"caso_full_{key}.nii.gz") == derived.read_bytes()

        # La geometría del derivado coincide con la fuente sintética.
        for name in names[1:]:
            key = name.removeprefix("caso_full_").removesuffix(".nii.gz")
            derived = tmp_path / "storage" / "derived" / "caso_full" / f"{key}.nii.gz"
            img = nib.load(str(derived))
            assert img.shape == SHAPE  # type: ignore[attr-defined]
            assert np.allclose(img.affine, AFFINE)  # type: ignore[attr-defined]

    # No queda ningún archivo temporal tras la respuesta.
    assert _export_temps(tmp_path) == []


def test_export_without_lesion_has_two_masks(tmp_path):
    _set_env(tmp_path)
    _make_study(tmp_path, "sin_lesion", with_lesion=False)

    response = client.get("/api/studies/sin_lesion/export.zip")

    assert response.status_code == 200
    with _open_zip(response) as zf:
        assert zf.testzip() is None
        assert sorted(zf.namelist()) == [
            "LEEME.txt",
            "sin_lesion_lung_left.nii.gz",
            "sin_lesion_lung_right.nii.gz",
        ]
    assert _export_temps(tmp_path) == []


def test_export_missing_study_returns_404(tmp_path):
    _set_env(tmp_path)
    # Un archivo sin _lung no define un estudio, por lo que no hay máscaras.
    nib.save(nib.Nifti1Image(np.zeros(SHAPE), AFFINE), tmp_path / "solo_ct.nii.gz")

    assert client.get("/api/studies/no_existe/export.zip").status_code == 404
    assert client.get("/api/studies/solo_ct/export.zip").status_code == 404
    assert _export_temps(tmp_path) == []


def test_export_invalid_id_and_traversal_return_404(tmp_path):
    _set_env(tmp_path)
    _make_study(tmp_path, "valido")

    for bad_id in ("../etc/passwd", "id%20con%20espacios", "bad%2Fid", "a" * 65):
        response = client.get(f"/api/studies/{bad_id}/export.zip")
        assert response.status_code == 404
    assert _export_temps(tmp_path) == []


def test_concurrent_exports_do_not_regenerate_derivatives(tmp_path, monkeypatch):
    _set_env(tmp_path)
    _make_study(tmp_path, "concurrente")

    import lungseg_api.derive as derive

    calls = {"builds": 0}
    original_build = derive._build_mask

    def counting_build(*args, **kwargs):
        calls["builds"] += 1
        time.sleep(0.05)  # fuerza solapamiento si no hubiera candado
        return original_build(*args, **kwargs)

    monkeypatch.setattr(derive, "_build_mask", counting_build)

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda _: client.get("/api/studies/concurrente/export.zip"),
                range(2),
            )
        )

    assert [response.status_code for response in responses] == [200, 200]
    assert calls["builds"] == 3  # una sola generación de cada máscara
    assert _export_temps(tmp_path) == []
