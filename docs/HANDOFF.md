# HANDOFF — LungSeg WebViewer

Estado vivo del proyecto para quien (humano o agente) retome el trabajo. **Léelo primero.** Se reescribe en cada checkpoint.

## 1. Cómo arrancar

```
uv sync
uv run uvicorn lungseg_api.main:app --reload --port 8000
cd frontend && npm install && npm run dev      # http://localhost:5173
```

Datos: copiar a `Data/` los archivos que genera el notebook de Colab (`{id}_lung.nii.gz`, `{id}_cople_lesion.nii.gz`) y, si se quiere el visor de cortes, la CT original `{id}.nii`. Variable opcional: `LUNGSEG_DATA_DIR`.

## 2. Estado actual

- Último ticket completado: **B1** (catálogo de estudios).
- El repo contiene `AGENTS.md`, `opencode.json`, `docs/`, `backend/`, `frontend/`, `pyproject.toml`, `uv.lock`, `README.md`, `.gitignore`.
- Backend: FastAPI con `/api/health`, `/api/studies` y `/api/studies/{id}`, CORS para `http://localhost:5173`, escucha en `127.0.0.1:8000`.
- Frontend: Vite + React + TypeScript con `@niivue/niivue` 0.47.0, proxy `/api → http://localhost:8000`, escucha en `:5173`.
- Checks obligatorios pasan en limpio (ruff, ruff format, pyright, pytest, `npm run build`).
- **Siguiente paso recomendado:** ticket **B2** (derivados y archivos ETag/304).

## 3. Trabajo en curso / a medias

_(nada)_

## 4. Notas, desviaciones y deuda anotada

- `uv` no estaba instalado en el entorno; se instaló con `pip install uv` para poder usar `uv sync`. No es una desviación del plan, solo una condición del entorno.
- **Desviación B1:** los archivos reales en `Data/` usan sufijos `_lung.nii` / `_cople_lesion.nii` (sin `.gz`), mientras que PLAN §5 especifica `_lung.nii.gz` / `_cople_lesion.nii.gz`. B1 respeta el contrato estricto, así que `GET /api/studies` contra `Data/` real devuelve `[]`. Aceptar `.nii` sin gz requeriría cambiar §5 del plan + schemas + types en el mismo cambio (regla 01); se deja como decisión humana, no se implementó en B1.
- **Deuda B1:** el espejo TypeScript en `frontend/src/api/types.ts` (contrato §6) queda pendiente para **F2**; no se tocó en este ticket.
- Aún no se ha leído la API real de `@niivue/niivue` (regla 08 del plan); se verificará en F3/F4.

## 5. Entorno de la máquina objetivo

Ryzen 5 5600G · 16 GB RAM · RX 6600 8 GB (AMD, sin CUDA). El visor usa WebGL2 del navegador (Chrome/Edge con aceleración por hardware activada). Los CT pesan cientos de MB: cuidar memoria tanto en backend como en frontend.
