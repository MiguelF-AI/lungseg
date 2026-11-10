# AGENTS.md — LungSeg WebViewer

Instrucciones para cualquier agente de código (opencode, Codex, Claude Code, Cursor…) y para humanos.

## Qué es LungSeg

App web **local** para explorar tomografías de tórax con las segmentaciones COVID-19 generadas por el notebook del proyecto: pulmón derecho, pulmón izquierdo (R231 / `lungmask`) y tejido dañado (COPLE-Net). Backend **FastAPI**; frontend **React + Vite + TypeScript + NiiVue** como visor médico (cortes axial/coronal/sagital + 3D).

**Fuente de verdad del alcance, contratos, UI y tickets: [`docs/PLAN.md`](docs/PLAN.md).** Léelo antes de escribir código. Las secciones §5 (disco) y §6 (API) son contratos.

El notebook `Segmentacion_monai.ipynb` (fuera de este repo) es la implementación de referencia de las fórmulas de volumetría. Si necesitas portar lógica de ahí, pide al humano el fragmento; no lo inventes.

## Comandos

```
uv sync                                                          # deps Python
uv run uvicorn lungseg_api.main:app --reload --port 8000         # API (docs en /docs)
cd frontend && npm install && npm run dev                        # UI en :5173 (proxy /api → :8000)

# Checks obligatorios antes de dar un ticket por terminado
uv run ruff check backend && uv run ruff format --check backend && uv run pyright && uv run pytest
cd frontend && npm run build                                     # tsc -b && vite build
```

## Flujo de trabajo

0. **Antes de nada:** lee [`docs/HANDOFF.md`](docs/HANDOFF.md) (estado vivo y trabajo a medias) y [`docs/PROGRESS.md`](docs/PROGRESS.md) (tablero + último checkpoint).
1. Elige **un** ticket de `docs/PLAN.md` §8 cuyas dependencias ya estén en ✅ en `PROGRESS.md`.
2. Crea la rama `feat/<ID>-<slug>` (ej. `feat/B2-derived-files`).
3. Implementa **solo** ese ticket. Si ves algo fuera de alcance, anótalo en `HANDOFF.md` §4; no lo hagas.
4. Corre los checks hasta que pasen.
5. Haz commits pequeños con el ID del ticket (`feat(B2): …`).
6. **Checkpoint:** al terminar, actualiza `docs/PROGRESS.md` (ticket ✅ + entrada `CP-NNN`) **y** la sección 2 de `docs/HANDOFF.md`. Si dejas trabajo a medias, anótalo en el handoff.
7. **Verificación visual** (tickets de frontend): arranca API + Vite, abre la UI y revisa con un caso real de `Data/`. Dilo explícitamente si no pudiste hacerlo.

## Reglas

01. **Contratos:** no cambies §5 o §6 del plan sin actualizar, en el mismo cambio, `backend/lungseg_api/schemas.py`, `frontend/src/api/types.ts` y `docs/PLAN.md`.
02. **Python:** solo `uv add` / `uv run`. Nunca `pip install`.
03. **No commitear:** `Data/`, `storage/`, `.env`, `node_modules/`, `.venv/`, ni ningún `.nii`/`.nii.gz`. Verifica el `.gitignore` en A0.
04. **Datos médicos:** aunque el dataset esté anonimizado, nunca imprimas ni registres en logs cabeceras NIfTI completas. Los nombres de archivo de error no deben filtrar rutas absolutas al cliente.
05. **Fórmulas:** volumen en litros = `n_voxeles * (sx*sy*sz en mm³) / 1e6`. Cítalo en el docstring de la función que lo implemente.
06. **Tests:** cada función nueva del backend lleva tipos y al menos un test. Los tests **no usan red** ni datos reales: generan NIfTI sintéticos pequeños con `nibabel` en `tmp_path`. Marca `@pytest.mark.slow` lo pesado.
07. **Idioma:** identificadores en inglés; comentarios, docs y textos de la UI en español.
08. **APIs de librerías: no inventes firmas.** Verifícalas en el código instalado (`.venv/`, `frontend/node_modules/@niivue/niivue/`: lee los `.d.ts` y la documentación incluida). NiiVue cambia entre versiones; si el plan choca con la API real, adapta y explícalo en `HANDOFF.md`. Fija la versión exacta instalada en `package.json`.
09. **Seguridad de rutas:** valida `id` y `layer` contra las listas/regex del plan (§5) **antes** de construir cualquier `Path`. Nunca concatenes entrada del cliente a una ruta.
10. **NIfTI en backend:** carga con `nibabel`; usa los datos como `np.asarray(img.dataobj)` solo cuando necesites los voxeles, y libera memoria (`del`) tras procesar: la máquina objetivo tiene 16 GB de RAM y los CT pesan cientos de MB.
11. **Rendimiento del visor:** al cambiar visibilidad u opacidad de una capa **no se recarga el volumen**; se modifica el volumen ya cargado en NiiVue.
12. **Terminología y aviso:** las máscaras son salida de un modelo experimental. La UI muestra un aviso fijo «Uso académico, no es un dispositivo médico». No uses lenguaje diagnóstico («tumor», «diagnóstico»); di «tejido dañado» o «opacidades segmentadas».
13. **Alcance de UI:** no copies funciones de la referencia visual que el plan marca como fuera de alcance (segmentación por texto, etc.).

## Definición de hecho

- Se cumplen los criterios de aceptación del ticket.
- Pasan los checks de arriba.
- Docs actualizadas si cambió algo de §5–§6 del plan o de los comandos.
- Checkpoint registrado en `docs/PROGRESS.md` y `docs/HANDOFF.md` actualizado.
