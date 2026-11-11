# PROGRESS — LungSeg WebViewer

Tablero de tickets y bitácora de checkpoints. Los tickets están definidos en [`PLAN.md`](PLAN.md) §8.

## 1. Tablero

Leyenda: ⬜ pendiente · 🟨 en curso · ✅ hecho · ⏸ bloqueado

| Fase | Ticket | Descripción | Depende de | Estado |
|------|--------|-------------|------------|--------|
| 0 | A0 | Scaffold (uv, FastAPI, Vite + React + TS + NiiVue) | — | ✅ |
| 1 | B1 | Catálogo de estudios | A0 | ✅ |
| 1 | B2 | Derivados y archivos (ETag/304) | B1 | ⬜ |
| 1 | B3 | Métricas | B2 | ⬜ |
| 1 | F1 | Shell y sistema de diseño | A0 | ⬜ |
| 1 | F2 | Cliente API tipado | F1, B1 | ⬜ |
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

### CP-002 · 2026-11-10 · B1
- Qué cambió: `backend/lungseg_api/config.py` (`get_data_dir()` lee `LUNGSEG_DATA_DIR`, default `./Data`), `schemas.py` (`LayerInfo`, `StudySummary`, `StudyDetail` + `ID_REGEX ^[A-Za-z0-9_-]{1,64}$`), `catalog.py` (`list_studies`/`get_study` sin leer NIfTI, valida id antes de construir `Path`), `main.py` (`GET /api/studies` y `GET /api/studies/{id}` con 404 para id inválido/inexistente), `tests/test_catalog.py` (ids válidos/inválidos, sin CT, sin lesión, traversal→404). Rama `feat/B1-catalog`, commit `feat(B1): catalogo de estudios`.
- Cómo se verificó: `uv run ruff check backend` ✅, `uv run ruff format --check backend` ✅, `uv run pyright` ✅ (0 errores), `uv run pytest` ✅ (7 tests pasados). `GET /api/studies` contra `Data/` real devolvió `[]` (los archivos fuente son `_lung.nii` sin `.gz`; ver desviación abajo).
- Desviaciones del plan y por qué: los datos reales en `Data/` usan `_lung.nii` / `_cople_lesion.nii` (sin `.gz`), mientras que §5 del plan especifica `_lung.nii.gz`. Se respeta el contrato estricto (no se acepta `.nii` sin gz) para no cambiar §5/schemas/types en este ticket; anotado en HANDOFF §4. El espejo TypeScript en `frontend/src/api/types.ts` queda pendiente para F2 (anotado en HANDOFF §4).
- Pendiente / siguiente paso: ticket B2 (derivados y archivos ETag/304).
- Qué cambió: Scaffold inicial del repositorio. Backend FastAPI con `/api/health`, CORS para `http://localhost:5173`, escucha en `127.0.0.1`; frontend Vite + React + TypeScript con `@niivue/niivue` 0.47.0 y proxy `/api → :8000`; `pyproject.toml` con ruff, pyright, pytest; `.gitignore` con `Data/`, `storage/`, `.env`, `node_modules/`, `.venv/`, `*.nii`, `*.nii.gz`; `README.md` con los comandos de AGENTS.md.
- Cómo se verificó: `uv run ruff check backend` ✅, `uv run ruff format --check backend` ✅, `uv run pyright` ✅ (0 errores), `uv run pytest` ✅ (1 test pasado), `npm run build` ✅ (tsc + vite). Backend en :8000 responde `{"status":"ok"}`; frontend en :5173 proxytea `/api/health` y muestra `{"status":"ok"}`.
- Desviaciones del plan y por qué: ninguna. `uv` no estaba instalado en el entorno; se instaló con `pip install uv` para poder usar `uv sync`.
- Pendiente / siguiente paso: ticket B1 (catálogo de estudios).
