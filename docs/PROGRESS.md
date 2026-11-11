# PROGRESS — LungSeg WebViewer

Tablero de tickets y bitácora de checkpoints. Los tickets están definidos en [`PLAN.md`](PLAN.md) §8.

## 1. Tablero

Leyenda: ⬜ pendiente · 🟨 en curso · ✅ hecho · ⏸ bloqueado

| Fase | Ticket | Descripción | Depende de | Estado |
|------|--------|-------------|------------|--------|
| 0 | A0 | Scaffold (uv, FastAPI, Vite + React + TS + NiiVue) | — | ✅ |
| 1 | B1 | Catálogo de estudios | A0 | ✅ |
| 1 | B2 | Derivados y archivos (ETag/304) | B1 | ✅ |
| 1 | B3 | Métricas | B2 | ⬜ |
| 1 | F1 | Shell y sistema de diseño | A0 | ✅ |
| 1 | F2 | Cliente API tipado | F1, B1 | ✅ |
| 1 | F3 | Componente `NiiViewer` | F2, B2 | ⬜ |
| 1 | F4 | Panel de capas | F3 | ⬜ |
| 1 | V0 | Verificación de alineación con casos reales | F4, B2 | ⬜ |
| 1 | F6 | Métricas y «Centrar en lesión» | F3, B3 | ⬜ |
| 1 | F5 | Selector de estudios y atajos | F3 | ⬜ |
| 1 | F7 | Pulido 3D | F3, F4 | ⬜ |
| 1 | F8 | Exportar (ZIP + captura) | F4, B2 | ⬜ |
| 2 | U1 | Subida de estudios (opcional) | B2, F4 | ⬜ |
| 2 | D1 | Dibujo y corrección (opcional) | U1 | ⬜ |
| 3 | I1 | Inferencia en CPU desde la web (opcional) | U1, B2 | ⬜ |
| 4 | Q1 | QA visual e2e (Playwright) | F6 | ⬜ |
| 4 | Q2 | Empaquetado Docker (opcional) | F8 | ⬜ |

## 2. Bitácora de checkpoints

Formato de cada entrada (la más reciente arriba):

```
### CP-NNN · AAAA-MM-DD · <ticket>
- Qué cambió:
- Cómo se verificó (comandos y/o revisión visual con qué caso):
- Desviaciones del plan y por qué:
- Pendiente / siguiente paso:
```

### CP-005 · 2026-11-10 · F2
- Qué cambió: `frontend/src/api/types.ts` (espejo de PLAN §6 y schemas.py: LayerInfo, StudySummary, StudyDetail, Metrics), `frontend/src/api/client.ts` (getStudies/getStudy/getMetrics, ApiError con status+mensaje, rutas relativas /api/... vía proxy Vite), `frontend/src/hooks/useStudies.ts`, `useStudy.ts`, `useMetrics.ts` (fetch propio, estados carga/error/vacío + reintentar). `StudyPicker` usa lista real de GET /api/studies (contador n/total, ◀▶, id abreviado a 8 chars, esqueleto/error/vacío). `LayerPanel` usa capas reales de GET /api/studies/{id} (sólo disponibles por estudio). `MetricsCard` con datos simulados + marca "datos de ejemplo" hasta F6. `Sidebar` orquesta selectedStudyId y cablea los componentes. `getMetrics`/`useMetrics` se definen pero NO se llaman (endpoint /metrics es B3). Sin integración NiiVue (F3).
- Cómo se verificó: `npm run build` (tsc -b + vite build) limpio, 0 errores de tipo; ruff check, ruff format, pyright y pytest de backend pasan (20 tests). Verificación funcional con backend arriba y datos reales en Data/: sidebar lista 2 estudios reales, ◀▶ cambian de estudio; capas iguales en ambos (ct/lung_right/lung_left/lesion); con LUNGSEG_DATA_DIR a carpeta vacía la API devuelve [] (estado vacío). Estado de error (backend apagado) no se pudo verificar del todo en Windows por socket huérfano en el puerto 8000.
- Desviaciones del plan y por qué: ninguna respecto al alcance aprobado. Métricas aún simuladas (B3 pendiente).
- Pendiente / siguiente paso: ticket F3 (componente NiiViewer).

### CP-004 · 2026-11-10 · F1
- Qué cambió: frontend/src/styles/tokens.css (nuevo, tokens de PLAN §7), frontend/src/index.css (usa variables), componentes nuevos Sidebar, LayerPanel, ViewerToolbar, StudyPicker, MetricsCard, y reescritura de App.tsx con layout §7 (sidebar 320px, visor con placeholder "Visor NiiVue — F3", selector de vista inferior). Datos simulados: 4 capas con color, ojo de visibilidad alternante y slider de opacidad expandible; estudio "3 / 27" con ◀ ▶; métricas ficticias; acciones deshabilitadas; pie con aviso académico. Sin NiiVue (F3), sin types.ts/client.ts (F2), sin "Text prompt"/"Run Segmentation" (regla 13), sin botón "Dibujar segmentación" (Fase 2).
- Cómo se verificó: `npm run build` (tsc -b + vite build) limpio, 0 errores de tipo; `npm run dev` respondió HTTP 200 en http://localhost:5173 sin errores de consola visibles al cargar. Proceso Vite detenido tras la verificación.
- Desviaciones del plan y por qué: ninguna respecto al alcance aprobado. Pendiente pendiente de verificación visual real a 1280×720 y 1920×1080 (no se dispuso de navegador para capturas; ver resumen al humano).
- Pendiente / siguiente paso: ticket F2 (cliente API tipado, types.ts + client.ts).

### CP-002 · 2026-11-10 · B1
- Qué cambió: `backend/lungseg_api/config.py` (`get_data_dir()` lee `LUNGSEG_DATA_DIR`, default `./Data`), `schemas.py` (`LayerInfo`, `StudySummary`, `StudyDetail` + `ID_REGEX ^[A-Za-z0-9_-]{1,64}$`), `catalog.py` (`list_studies`/`get_study` sin leer NIfTI, valida id antes de construir `Path`), `main.py` (`GET /api/studies` y `GET /api/studies/{id}` con 404 para id inválido/inexistente), `tests/test_catalog.py` (ids válidos/inválidos, sin CT, sin lesión, traversal→404). Rama `feat/B1-catalog`, commit `feat(B1): catalogo de estudios`.
- Cómo se verificó: `uv run ruff check backend` ✅, `uv run ruff format --check backend` ✅, `uv run pyright` ✅ (0 errores), `uv run pytest` ✅ (7 tests pasados). `GET /api/studies` contra `Data/` real devolvió `[]` (los archivos fuente son `_lung.nii` sin `.gz`; ver desviación abajo).
- Desviaciones del plan y por qué: los datos reales en `Data/` usan `_lung.nii` / `_cople_lesion.nii` (sin `.gz`), mientras que §5 del plan especifica `_lung.nii.gz`. Se respeta el contrato estricto (no se acepta `.nii` sin gz) para no cambiar §5/schemas/types en este ticket; anotado en HANDOFF §4. El espejo TypeScript en `frontend/src/api/types.ts` queda pendiente para F2 (anotado en HANDOFF §4).
- Pendiente / siguiente paso: ticket B2 (derivados y archivos ETag/304).
- Qué cambió: Scaffold inicial del repositorio. Backend FastAPI con `/api/health`, CORS para `http://localhost:5173`, escucha en `127.0.0.1`; frontend Vite + React + TypeScript con `@niivue/niivue` 0.47.0 y proxy `/api → :8000`; `pyproject.toml` con ruff, pyright, pytest; `.gitignore` con `Data/`, `storage/`, `.env`, `node_modules/`, `.venv/`, `*.nii`, `*.nii.gz`; `README.md` con los comandos de AGENTS.md.
- Cómo se verificó: `uv run ruff check backend` ✅, `uv run ruff format --check backend` ✅, `uv run pyright` ✅ (0 errores), `uv run pytest` ✅ (1 test pasado), `npm run build` ✅ (tsc + vite). Backend en :8000 responde `{"status":"ok"}`; frontend en :5173 proxytea `/api/health` y muestra `{"status":"ok"}`.
- Desviaciones del plan y por qué: ninguna. `uv` no estaba instalado en el entorno; se instaló con `pip install uv` para poder usar `uv sync`.
- Pendiente / siguiente paso: ticket B1 (catálogo de estudios).

### CP-003 · 2026-11-10 · B2
- Qué cambió: `pyproject.toml` (+nibabel 5.5.0, numpy 2.5.4); `config.py` (`get_storage_dir()`); `catalog.py` (acepta fuentes `.nii` y `.nii.gz`); `derive.py` (nuevo: `lung_right=(lung==1)`, `lung_left=(lung==2)`, `lesion=(lesion>0)`, uint8, affine/shape iguales a la fuente; `ct` comprimido gzip nivel 4 una sola vez; sidecar `metadata.json` con mtime por capa para invalidación granular; escritura atómica temp+`os.replace`; candado `threading.Lock` por estudio; una CT completa en memoria a la vez con `del`); `routers/files.py` (nuevo: `GET/HEAD /api/studies/{id}/files/{layer}.nii.gz` con whitelist de layer, validación id/layer antes de construir Path, 404 sin rutas absolutas, `FileResponse` streaming, cabeceras `ETag`/`Last-Modified`/`Cache-Control: no-cache`, `If-None-Match` → 304 sin cuerpo); `main.py` (incluye router); `docs/PLAN.md` §5 (sufijos `.nii` y `.nii.gz` aceptados, gzip nivel 4, sidecar `metadata.json`); `tests/test_derive.py` (nuevo: 14 tests sintéticos con nibabel en tmp_path).
- Cómo se verificó: `uv run ruff check backend` ✅, `uv run ruff format --check backend` ✅, `uv run pyright` ✅ (0 errores), `uv run pytest` ✅ (20 tests pasados). Verificación real contra `Data/` (estudio `33cf78a82e5d1f3a98931b3fe5d31a40`): 1ª y 2ª petición por `curl`/httpx para ct, lung_right, lung_left, lesion; segunda petición con If-None-Match → 304 sin cuerpo; pesos: ct 149 MB (1era 7.2 s), lung_right 459 KB (1.0 s), lung_left 432 KB (0.9 s), lesion 313 KB (3.2 s); HEAD con ETag/Last-Modified/Cache-Control OK.
- Desviaciones del plan y por qué: §5 acepta ahora fuentes `.nii` (sin gz) además de `.nii.gz` porque los archivos reales de `Data/` usan `.nii`; se documenta en PLAN §5 y en HANDOFF §4 (mismo cambio que exige la regla 01; ningún contrato §6 ni schemas.py/types.ts cambió). Nivel de gzip 4 elegido por compromiso rapidez/tamaño en CTs de cientos de MB con 16 GB RAM.
- Pendiente / siguiente paso: ticket B3 (métricas).
