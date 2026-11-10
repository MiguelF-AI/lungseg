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

- Último ticket completado: **ninguno**.
- El repo contiene solo `AGENTS.md`, `opencode.json` y `docs/`.
- **Siguiente paso recomendado:** ticket **A0** (scaffold).

## 3. Trabajo en curso / a medias

_(nada)_

## 4. Notas, desviaciones y deuda anotada

_(Aquí van las cosas fuera de alcance que el agente vea mientras trabaja, las adaptaciones por diferencias de API de NiiVue y el resultado de V0.)_

## 5. Entorno de la máquina objetivo

Ryzen 5 5600G · 16 GB RAM · RX 6600 8 GB (AMD, sin CUDA). El visor usa WebGL2 del navegador (Chrome/Edge con aceleración por hardware activada). Los CT pesan cientos de MB: cuidar memoria tanto en backend como en frontend.
