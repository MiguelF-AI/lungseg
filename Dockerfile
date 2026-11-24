# Imagen del backend LungSeg (API FastAPI)
# Construir con: docker build -t lungseg-api .
# Ejecutar: docker run -p 8000:8000 -v ./Data:/data:ro -v ./storage:/storage lungseg-api
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LUNGSEG_DATA_DIR=/data \
    LUNGSEG_STORAGE_DIR=/storage \
    PORT=8000

WORKDIR /app

# Dependencias del sistema (mínimas; no se compila nada de scipy/nibabel si hay wheel)
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copiar solo lo necesario para resolver dependencias primero (capa de cache)
COPY pyproject.toml uv.lock ./
# Copiar el código de la aplicación (necesario para que uv sync resuelva el
# paquete local lungseg-api definido en pyproject.toml con where=["backend"])
COPY backend ./backend

# Instalar uv y sincronizar solo dependencias de producción
RUN pip install --no-cache-dir uv \
    && uv sync --frozen --no-dev

# Expone el puerto de la API (solo se usa internamente por nginx en compose)
EXPOSE 8000

# uvicorn escucha en todas las interfaces para que nginx del contenedor web lo alcance
CMD ["uv", "run", "uvicorn", "lungseg_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
