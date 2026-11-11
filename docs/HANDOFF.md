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

- Último ticket completado: **F2** (cliente API tipado). Previo: **F1** (shell y sistema de diseño).
- El repo contiene `AGENTS.md`, `opencode.json`, `docs/`, `backend/`, `frontend/`, `pyproject.toml`, `uv.lock`, `README.md`, `.gitignore`.
- Backend: FastAPI con `/api/health`, `/api/studies`, `/api/studies/{id}` y `GET/HEAD /api/studies/{id}/files/{layer}.nii.gz` (ETag, Last-Modified, Cache-Control: no-cache, 304), CORS para `http://localhost:5173`, escucha en `127.0.0.1:8000`. Genera y cachea `ct.nii.gz`, `lung_right`, `lung_left`, `lesion` en `storage/derived/{id}/` con invalidación por mtime (sidecar `metadata.json`), escritura atómica y candado por estudio.
- Frontend: Vite + React + TypeScript con `@niivue/niivue` 0.47.0, proxy `/api → http://localhost:8000`, escucha en `:5173`. **F2 añadido:** `frontend/src/api/types.ts` (espejo de PLAN §6 y schemas.py: LayerInfo, StudySummary, StudyDetail, Metrics), `frontend/src/api/client.ts` (getStudies/getStudy/getMetrics, clase ApiError con status + mensaje, rutas relativas /api/... vía proxy Vite), hooks `frontend/src/hooks/useStudies.ts`, `useStudy.ts`, `useMetrics.ts` (fetch propio, estados carga/error/vacío + reintentar). `StudyPicker` usa lista real de GET /api/studies (contador n/total, ◀▶ funcionales, id abreviado a 8 primeros caracteres, esqueleto/error con "Reintentar"/vacío con instrucciones para copiar a Data/). `LayerPanel` usa capas reales de GET /api/studies/{id} (sólo las disponibles por estudio; una capa inexistente no se muestra). `MetricsCard` mantiene datos simulados con marca "datos de ejemplo" hasta F6. `Sidebar` orquesta `selectedStudyId` y cablea StudyPicker/LayerPanel/MetricsCard; al cambiar de estudio se descarta el anterior. Sin integración NiiVue (F3), `getMetrics`/`useMetrics` definidos pero no llamados (endpoint /metrics es B3).
- Checks obligatorios pasan en limpio (ruff, ruff format, pyright, pytest, `npm run build`).
- **Siguiente paso recomendado:** ticket **F3** (componente `NiiViewer`).

## 3. Trabajo en curso / a medias

_(nada)_

## 4. Notas, desviaciones y deuda anotada

- `uv` no estaba instalado en el entorno; se instaló con `pip install uv` para poder usar `uv sync`. No es una desviación del plan, solo una condición del entorno.
- **Desviación B1/B2:** los archivos reales en `Data/` usan sufijos `_lung.nii` / `_cople_lesion.nii` (sin `.gz`), mientras que PLAN §5 especificaba `.nii.gz`. B1/B2 aceptan ahora tanto `.nii` como `.nii.gz` como fuentes; los derivados siempre se escriben como `.nii.gz`. El catálogo contra `Data/` real sí devuelve estudios (`33cf78a82e5d1f3a98931b3fe5d31a40`, `6b79babd91e6376cf8df9bfd061d117f`). Cambiado en PLAN §5, schemas.py y types.ts no tocados (contrato §6 sin cambios).
- **Nivel de compresión de ct derivada:** gzip nivel 4 (rápido). Nivel 1 deja archivos muy grandes; nivel 9 apenas reduce tamaño frente al 4 en datos de imagen médica y es mucho más lento. CT de 266 MB → 149 MB (~7 s primera petición, 304 sin cuerpo en la segunda).
- **Deuda B1:** el espejo TypeScript en `frontend/src/api/types.ts` (contrato §6) queda pendiente para **F2**; no se tocó en este ticket.
- Aún no se ha leído la API real de `@niivue/niivue` (regla 08 del plan); se verificará en F3/F4.
- Al terminar B2 se detuvo uvicorn (puerto :8000 liberado).

## 5. Entorno de la máquina objetivo

Ryzen 5 5600G · 16 GB RAM · RX 6600 8 GB (AMD, sin CUDA). El visor usa WebGL2 del navegador (Chrome/Edge con aceleración por hardware activada). Los CT pesan cientos de MB: cuidar memoria tanto en backend como en frontend.
