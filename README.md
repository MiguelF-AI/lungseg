# LungSeg WebViewer

App web **local** para explorar tomografías de tórax con las segmentaciones COVID-19 generadas por el notebook del proyecto: pulmón derecho, pulmón izquierdo (R231 / `lungmask`) y tejido dañado (COPLE-Net). Backend **FastAPI**; frontend **React + Vite + TypeScript + NiiVue** como visor médico (cortes axial/coronal/sagital + 3D).

> Las máscaras son salida de un modelo experimental. **Uso académico, no es un dispositivo médico.** 

## Flujo completo del proyecto

El proyecto se divide en tres etapas:

1. **Segmentación** (`/segmentacion`): procesa las tomografías del dataset público de InRad (AWS Open Data) con R231 y COPLE-Net en GPU y sube los resultados al almacenamiento.
2. **Entrenamiento del clasificador** (`/train`): lee esos resultados del bucket y entrena un modelo que predice la etiqueta del paciente (otra enfermedad / COVID-19).
3. **Aplicación de visualización** (carpeta raíz): visor web para explorar la CT original junto con las máscaras derivadas, con cortes en 3 planos, render 3D, métricas de volumen y descarga de resultados.

---

## 1. Etapa 1 — Segmentación (`/segmentacion`)

Por cada tomografía (`.nii`) del bucket público de AWS:

1. Segmenta los pulmones con **R231** (`lungmask`): 1 = pulmón derecho, 2 = izquierdo.
2. Recorta el volumen a la región pulmonar y segmenta el **tejido dañado** con **COPLE-Net** (ventana deslizante MONAI, ROI 96³, solape 0.5; ventana de intensidad nivel −650 / ancho 1500 HU). La lesión se limita al interior del pulmón (con relleno de huecos).
3. Calcula volumen pulmonar, volumen de tejido dañado y porcentaje que representa.
4. Busca la etiqueta del paciente en `clinicaldata.csv` (0 = sano, 1 = otra enfermedad, 2 = COVID-19).
5. Genera dos imágenes 2D con el contorno de la lesión en rojo: una cuadrícula de 12 cortes axiales y una vista ortogonal (axial, coronal, sagital).
6. Opcionalmente envía métricas e imágenes a un LLM de NVIDIA (`nvidia/nemotron-3.5-super-vl-120b-a12b`, build.nvidia.com) y guarda una breve conclusión (en este caso no se hizo para optimizar tiempos).
7. Sube todo al almacenamiento y escribe un `result.json` por caso.

### Archivos

| Archivo | Para qué sirve |
|---|---|
| `process_dataset.py` | Pipeline completo y todas las opciones de línea de comandos |
| `run_parallel.sh` | Lanza varios procesos en la misma GPU y reconstruye el índice al final |
| `requirements.txt` | Dependencias de Python (PyTorch viene aparte) |
| `.env.example` | Plantilla de variables de entorno |
| `README_segmentacion.md` | Documentación detallada de esta etapa |

### Requisitos

- **GPU NVIDIA** con PyTorch/CUDA. Probado en una **RTX 3090 (24 GB)**. Sin GPU funciona, pero es muy lento.
- **Pesos de COPLE-Net**, `coplenet_pretrain.pt` (≈126 MB). [Aquí](https://drive.google.com/file/d/1vdDADnmzFgj3Wvn65OUzTGsqCXovErVm/view?usp=drive_link%22)
- **Bucket compatible con S3** con permisos de lectura y escritura (Cloudflare R2, AWS S3, Backblaze B2, MinIO…).
- **API key de NVIDIA** (build.nvidia.com), solo si vas a usar el LLM.
- Disco suficiente en la instancia para las descargas temporales; el script borra cada tomografía al terminar su segmentación.

### Uso resumido

```bash
# 1) Prueba en carpeta local, sin nube
python process_dataset.py --hash <HASH> --storage local --skip-llm

# 2) Un caso a tu bucket
python process_dataset.py --hash <HASH>

# 3) Todo el dataset, un solo proceso
python process_dataset.py --all

# 4) Todo el dataset, varios procesos en la misma GPU (recomendado)
./run_parallel.sh 3 --skip-original-upload
```

Para ver los `<HASH>` disponibles revisa la columna `image_id` de `clinicaldata.csv`.

> **Rendimiento de referencia:** la segmentación se ejecutó en una **RTX 3090 de 24 GB en vast.ai** y el script estuvo corriendo durante **5 horas**.

Consulta `README_segmentacion.md` para la instalación en vast.ai, variables de entorno, opciones de línea de comandos, reanudación, errores y solución de problemas.

---

## 2. Etapa 2 — Entrenamiento del clasificador (`/train`)

Lee los `result.json` del bucket, extrae características de las máscaras y entrena un clasificador que predice la etiqueta del paciente (sano / otra enfermedad / COVID-19).

### Archivos

| Archivo | Para qué sirve |
|---|---|
| `train_classifier.py` | Entrenamiento y evaluación del clasificador |
| `requirements-train.txt` | Dependencias de `train_classifier.py` |
| `.env.example` | Plantilla de variables de entorno |
| `README.md` (en `/train`) | Documentación detallada de esta etapa |

### Comandos principales

```bash
pip install -r requirements-train.txt
python train_classifier.py                       # COVID vs resto, todos los casos
python train_classifier.py --modo 3_clases       # 0 sano · 1 otra enfermedad · 2 COVID-19
python train_classifier.py --max-casos 40        # prueba rápida
python train_classifier.py --sin-mascaras        # solo las métricas de result.json
python train_classifier.py --no-subir            # no escribe nada en el bucket
python train_classifier.py --help
```

Guarda en `resultados/` (cambiable con `--salida`): validación cruzada (`cv_{modo}.csv`), resumen (`resumen_{modo}.json`), matriz de confusión y curvas ROC, importancia de variables, boxplots, modelo final (`modelo_{modo}.joblib`) y log de entrenamiento.

Consulta `train/README.md` para características usadas, resultados de referencia, limitaciones y créditos del dataset.

---

## 3. Etapa 3 — Aplicación de visualización (carpeta raíz)

Visor web para explorar la CT original junto con las máscaras derivadas (pulmón derecho, pulmón izquierdo, tejido dañado), con cortes axial/coronal/sagital, render 3D, métricas de volumen, centrado en lesión y exportación de máscaras a ZIP.

### Datos

Copia a `Data/` los archivos que genera el notebook de Colab:

- `{id}_lung.nii.gz` — máscara pulmonar (derivada de R231)
- `{id}_cople_lesion.nii.gz` — máscara de tejido dañado (COPLE-Net)
- `{id}.nii` — CT original (opcional, para el visor de cortes)

Variable opcional: `LUNGSEG_DATA_DIR` para cambiar la carpeta de datos.

Los datos médicos (`.nii`, `.nii.gz`) y `Data/`/`storage/` no entran en la imagen Docker (`.dockerignore`).

### Comandos de arranque local

```bash
# Backend
uv sync                                                          # deps Python
uv run uvicorn lungseg_api.main:app --reload --port 8000         # API (docs en /docs)

# Frontend (en otra terminal)
cd frontend && npm install && npm run dev                        # UI en :5173 (proxy /api → :8000)
```

La API expone, entre otros: `/api/health`, `/api/studies`, `/api/studies/{id}`, `GET/HEAD /api/studies/{id}/files/{layer}.nii.gz`, `GET /api/studies/{id}/metrics` y `GET /api/studies/{id}/export.zip`.

---

## 4. Despliegue completo con Docker Compose

Requiere [Docker Compose](https://docs.docker.com/compose/). Levanta ambos servicios (API + frontend) de forma reproducible.

```bash
docker compose up --build   # construye y levanta API + frontend (nginx) en http://localhost
docker compose up -d        # en segundo plano
docker compose down         # detiene y elimina contenedores
```

### Servicios

| Servicio | Descripción | Puerto |
|---|---|---|
| `api` | Backend FastAPI | 8000 (solo interno a la red de compose) |
| `web` | Frontend React+Vite compilado servido por nginx; reenvía `/api` al backend | 80 (expuesto al host) |

### Volúmenes y variables de entorno

- `./Data` se monta de solo lectura en `/data` y `./storage` (derivados/caché) en `/storage`.
- Sobreescribe `LUNGSEG_DATA_DIR` / `LUNGSEG_STORAGE_DIR` en `compose.yaml` si usas otras rutas.
- La API (FastAPI) escucha internamente en el puerto 8000 de la red de compose; **no se expone al host**. La UI queda disponible en `http://localhost`.

Los `.nii`/`.nii.gz`, `Data/` y `storage/` no entran en la imagen (`.dockerignore`).

---

## 5. Checks obligatorios antes de dar un ticket por terminado

```bash
uv run ruff check backend && uv run ruff format --check backend && uv run pyright && uv run pytest
cd frontend && npm run build                                     # tsc -b && vite build
```

---

## 6. Datos y créditos

Imágenes y metadatos: InRad, Hospital das Clínicas (HCFMUSP), Facultad de Medicina de la Universidad de São Paulo, vía [AWS Open Data](https://registry.opendata.aws/inlab-covid-19-images-dataset/). Consulta su licencia y cómo citarlo en el registro del dataset.
