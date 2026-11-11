"""Tests del catálogo de estudios (B1).

Usan carpetas sintéticas en tmp_path: nunca leen NIfTI reales ni usan red.
"""

from fastapi.testclient import TestClient
from lungseg_api.main import app

client = TestClient(app)


def _make_study(tmp_path, study_id, with_ct=True, with_lesion=True, lung_ext=".nii.gz"):
    lung = tmp_path / f"{study_id}_lung{lung_ext}"
    lung.write_bytes(b"dummy lung")
    if with_ct:
        ct = tmp_path / f"{study_id}.nii"
        ct.write_bytes(b"dummy ct")
    if with_lesion:
        lesion = tmp_path / f"{study_id}_cople_lesion{lung_ext}"
        lesion.write_bytes(b"dummy lesion")


def test_list_studies_valid_and_invalid(tmp_path, monkeypatch):
    monkeypatch.setenv("LUNGSEG_DATA_DIR", str(tmp_path))
    _make_study(tmp_path, "estudio_01")
    _make_study(tmp_path, "ESTUDIO-02", with_ct=False)
    _make_study(tmp_path, "bad id!")  # id inválido -> ignorado
    (tmp_path / "_lung.nii.gz").write_bytes(b"x")  # id vacío -> ignorado

    response = client.get("/api/studies")
    assert response.status_code == 200
    ids = [s["id"] for s in response.json()]
    assert ids == ["ESTUDIO-02", "estudio_01"]


def test_list_studies_layers(tmp_path, monkeypatch):
    monkeypatch.setenv("LUNGSEG_DATA_DIR", str(tmp_path))
    _make_study(tmp_path, "solo_lung", with_ct=False, with_lesion=False)  # sin CT, sin lesión
    _make_study(tmp_path, "con_todo")

    response = client.get("/api/studies")
    by_id = {s["id"]: s["layers"] for s in response.json()}
    assert by_id["solo_lung"] == ["lung_right", "lung_left"]
    assert by_id["con_todo"] == ["ct", "lung_right", "lung_left", "lesion"]


def test_get_study_ok(tmp_path, monkeypatch):
    monkeypatch.setenv("LUNGSEG_DATA_DIR", str(tmp_path))
    _make_study(tmp_path, "caso_real")

    response = client.get("/api/studies/caso_real")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "caso_real"
    assert body["shape"] is None
    assert body["spacing_mm"] is None
    keys = [layer["key"] for layer in body["layers"]]
    assert "lung_right" in keys
    assert "lung_left" in keys
    assert "lesion" in keys


def test_get_study_without_lesion(tmp_path, monkeypatch):
    monkeypatch.setenv("LUNGSEG_DATA_DIR", str(tmp_path))
    _make_study(tmp_path, "sin_lesion", with_lesion=False)

    response = client.get("/api/studies/sin_lesion")
    assert response.status_code == 200
    keys = [layer["key"] for layer in response.json()["layers"]]
    assert "lesion" not in keys


def test_get_study_invalid_id_404(tmp_path, monkeypatch):
    monkeypatch.setenv("LUNGSEG_DATA_DIR", str(tmp_path))
    # Intento de path traversal y ids raros -> 404
    assert client.get("/api/studies/../etc/passwd").status_code == 404
    assert client.get("/api/studies/id con espacios").status_code == 404
    assert client.get("/api/studies/a" * 65).status_code == 404


def test_get_study_missing_404(tmp_path, monkeypatch):
    monkeypatch.setenv("LUNGSEG_DATA_DIR", str(tmp_path))
    assert client.get("/api/studies/no_existe").status_code == 404
