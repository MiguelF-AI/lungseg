"""Configuración del backend LungSeg."""

import os


def get_data_dir() -> str:
    """Directorio de datos (./Data por defecto, sobrescrito por LUNGSEG_DATA_DIR)."""
    return os.environ.get("LUNGSEG_DATA_DIR", "./Data")
