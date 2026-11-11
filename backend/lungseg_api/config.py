"""Configuración del backend LungSeg."""

import os


def get_data_dir() -> str:
    """Directorio de datos (./Data por defecto, sobrescrito por LUNGSEG_DATA_DIR)."""
    return os.environ.get("LUNGSEG_DATA_DIR", "./Data")


def get_storage_dir() -> str:
    """Directorio de derivados y caché (./storage por defecto)."""
    return os.environ.get("LUNGSEG_STORAGE_DIR", "./storage")
