# LungSeg WebViewer

## Comandos

```
uv sync                                                          # deps Python
uv run uvicorn lungseg_api.main:app --reload --port 8000         # API (docs en /docs)
cd frontend && npm install && npm run dev                        # UI en :5173 (proxy /api → :8000)
```

## Checks obligatorios

```
uv run ruff check backend && uv run ruff format --check backend && uv run pyright && uv run pytest
cd frontend && npm run build                                     # tsc -b && vite build
```

## Despliegue con Docker (opcional, ticket Q2)

Requiere [Docker Compose](https://docs.docker.com/compose/).

```
docker compose up --build   # construye y levanta API + frontend (nginx) en http://localhost
docker compose up -d        # en segundo plano
docker compose down         # detiene y elimina contenedores
```

- La UI queda disponible en `http://localhost` (nginx sirve el `dist` compilado y reenvía `/api` al backend).
- La API (FastAPI) escucha internamente en el puerto 8000 de la red de compose; no se expone al host.
- `./Data` se monta de solo lectura en `/data` y `./storage` (derivados/caché) en `/storage`.
- Sobreescribe `LUNGSEG_DATA_DIR` / `LUNGSEG_STORAGE_DIR` en `compose.yaml` si usas otras rutas.

Los datos médicos (`.nii`, `.nii.gz`) y `Data/`/`storage/` no entran en la imagen (`.dockerignore`).
