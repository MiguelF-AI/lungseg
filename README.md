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
