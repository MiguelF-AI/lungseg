# Segmentación pulmonar de tomografías COVID-19 en GPU (vast.ai)

Procesa el dataset público de tomografías de tórax de InRad (AWS Open Data) y guarda los resultados en un
bucket compatible con S3, listos para consultarse desde una aplicación o para entrenar modelos.

Dataset: <https://registry.opendata.aws/inlab-covid-19-images-dataset/>

> Proyecto de investigación. Las segmentaciones y las conclusiones del LLM **no son un diagnóstico**.

## Qué hace

Por cada tomografía (`.nii`) del bucket público de AWS:

1. Segmenta los pulmones con **R231** (`lungmask`): 1 = pulmón derecho, 2 = izquierdo.
2. Recorta el volumen a la región pulmonar y segmenta el **tejido dañado** con **COPLE-Net** (ventana
   deslizante MONAI, ROI 96³, solape 0.5; ventana de intensidad nivel −650 / ancho 1500 HU). La lesión se
   limita al interior del pulmón (con relleno de huecos).
3. Calcula volumen pulmonar, volumen de tejido dañado y porcentaje que representa.
4. Busca la etiqueta del paciente en `clinicaldata.csv` (0 = sano, 1 = otra enfermedad, 2 = COVID-19).
5. Genera dos imágenes 2D con el contorno de la lesión en rojo: una cuadrícula de 12 cortes axiales y una
   vista ortogonal (axial, coronal, sagital).
6. Opcionalmente envía métricas e imágenes a un LLM de NVIDIA (`nvidia/nemotron-3.5-super-vl-120b-a12b`,
   build.nvidia.com) y guarda una breve conclusión.
7. Sube todo al almacenamiento y escribe un `result.json` por caso.

Las **radiografías** (`--modality xray`) solo se copian al almacenamiento; no se segmentan, porque el
pipeline funciona con volúmenes 3D.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `process_dataset.py` | Pipeline completo y todas las opciones de línea de comandos |
| `run_parallel.sh` | Lanza varios procesos en la misma GPU y reconstruye el índice al final |
| `requirements.txt` | Dependencias de Python (PyTorch viene aparte) |
| `.env.example` | Plantilla de variables de entorno |

## Requisitos

- **GPU NVIDIA** con PyTorch/CUDA. Probado en una RTX 3090 (24 GB). Sin GPU funciona, pero es muy lento.
- **Pesos de COPLE-Net**, `coplenet_pretrain.pt` (≈126 MB; en la prueba de referencia pesó 126,380,733 bytes).
- **Bucket compatible con S3** con permisos de lectura y escritura (Cloudflare R2, AWS S3, Backblaze B2,
  MinIO...).
- **API key de NVIDIA** (build.nvidia.com), solo si vas a usar el LLM.
- **Disco** suficiente en la instancia para las descargas temporales; el script borra cada tomografía al
  terminar su segmentación.
- Salida a internet para: el bucket de AWS, `raw.githubusercontent.com` (descarga `coplenet.py` la primera
  vez), GitHub releases (pesos de R231 la primera vez) y `integrate.api.nvidia.com`.

## Instalación en vast.ai

1. Crea una instancia con una plantilla de **PyTorch** y suficiente disco.
2. Sube a `/workspace` los tres archivos del proyecto y `coplenet_pretrain.pt`. Para los pesos conviene una
   herramienta que se pueda reanudar y **verificar el tamaño**:
   ```bash
   rsync -avP --partial -e "ssh -p <PUERTO>" coplenet_pretrain.pt root@<IP>:/workspace/
   ls -l coplenet_pretrain.pt        # debe coincidir con el original
   sha256sum coplenet_pretrain.pt    # compara también con el original
   ```
3. Instala dependencias:
   ```bash
   cd /workspace
   pip install -r requirements.txt
   chmod +x run_parallel.sh
   ```
4. Crea el archivo de variables **directamente en la terminal** (los archivos que empiezan con punto suelen
   desaparecer al subirlos):
   ```bash
   cat > covid.env <<'EOF'
   NVIDIA_API_KEY=nvapi-xxxxxxxx
   STORAGE_BUCKET=nombre-del-bucket
   STORAGE_ENDPOINT_URL=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   STORAGE_ACCESS_KEY_ID=xxxxxxxx
   STORAGE_SECRET_ACCESS_KEY=xxxxxxxx
   STORAGE_REGION=auto
   EOF
   chmod 600 covid.env
   set -a; source covid.env; set +a
   ```
   - `STORAGE_ENDPOINT_URL` es **solo el host**, sin `/nombre-del-bucket` (si lo incluyes, el script lo
     corrige y avisa). Déjalo vacío si usas AWS S3.
   - Las variables solo viven en esa terminal: repite el `source` si abres otra o entras a `tmux`.
   - **Nunca subas este archivo a Git.**
5. Comprueba la configuración antes de lanzar nada:
   ```bash
   python process_dataset.py --check                # con LLM
   python process_dataset.py --check --skip-llm     # sin LLM
   ```
   Verifica por separado el bucket de AWS, el almacenamiento (escribir, listar, leer y borrar), la API de
   NVIDIA y los pesos.

## Uso

Corre las tandas largas dentro de `tmux` (Ctrl+B y luego D para desconectarte sin detenerlas) o con `nohup`.

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

Para ver los `<HASH>` disponibles revisa la columna `image_id` de `clinicaldata.csv`. Con `--list-prefixes`
se muestra la estructura del bucket de AWS.

### Lanzador paralelo (`run_parallel.sh`)

```bash
nohup ./run_parallel.sh 3 --skip-original-upload > launcher.log 2>&1 &
```

- El primer argumento es el número de procesos; el resto se pasa a todos ellos (`--skip-llm`,
  `--skip-original-upload`...).
- Cada proceso recibe su `--shard i/N`, escribe en `shard{i}.log` y usa su propia carpeta de trabajo
  (`work/shard{i}_of_{N}/`). Arrancan escalonados 5 s para no saturar CPU y disco.
- Al terminar, informa el código de salida de cada proceso (con las últimas líneas de su log si falló) y
  reconstruye una sola vez `index.json`.
- Requiere haber cargado las variables en esa terminal.

Para seguir el avance:

```bash
ls shard*.log
tail -f shard0.log
grep -c " ok ·" shard*.log        # casos terminados por proceso
nvidia-smi
```

Para detenerlo: `pkill -f process_dataset.py`. Para reanudar, vuelve a lanzar el mismo comando.

### Otras operaciones

```bash
python process_dataset.py --retry-llm            # repite el LLM solo en casos fallidos u omitidos
python process_dataset.py --build-index          # regenera index.json
python process_dataset.py --modality xray --all  # copia radiografías (revisa el prefijo con --list-prefixes)
```

`--retry-llm` reutiliza las imágenes ya guardadas: no vuelve a segmentar nada. También sirve para llenar las
conclusiones de una corrida hecha con `--skip-llm`.

## Opciones de `process_dataset.py`

| Opción | Descripción |
|---|---|
| `--hash H` / `--all` | Un caso concreto / todo lo pendiente |
| `--limit N` | Máximo de casos en esta ejecución |
| `--shard i/N` | Reparte el trabajo entre N procesos o instancias |
| `--force` | Reprocesa aunque ya exista `result.json` |
| `--storage auto\|s3\|local` | `auto` usa S3 si hay `STORAGE_BUCKET`, si no carpeta local |
| `--local-dir` | Carpeta para `--storage local` (por defecto `./output`) |
| `--workdir` | Carpeta de trabajo y descargas (por defecto `./work`) |
| `--weights` | Ruta de los pesos de COPLE-Net (por defecto `./coplenet_pretrain.pt`) |
| `--sw-batch` | Ventanas 96³ por lote en COPLE-Net (por defecto 2) |
| `--lung-batch` | Cortes por lote en R231 (por defecto 16) |
| `--post-workers` | Casos que se finalizan (imágenes, subida, LLM) en paralelo mientras la GPU sigue (por defecto 2) |
| `--skip-llm` | No llama al LLM (los casos quedan con `llm.status = "skipped"`) |
| `--thinking` | Activa el modo de razonamiento del LLM (más lento) |
| `--skip-original-upload` | No sube `original.nii.gz` (ya es público en AWS; ahorra mucho espacio) |
| `--no-index` | No reconstruye `index.json` al terminar |
| `--modality ct\|xray` | Tomografías (por defecto) o radiografías |
| `--xray-prefix` | Prefijo de las radiografías en el bucket de AWS |
| `--check`, `--retry-llm`, `--build-index`, `--list-prefixes` | Operaciones auxiliares descritas arriba |

## Qué se guarda en tu bucket

```
ct/{hash}/original.nii.gz      volumen reorientado a LPS (omitido con --skip-original-upload)
ct/{hash}/lung_mask.nii.gz     1 = pulmón derecho, 2 = izquierdo
ct/{hash}/lesion_mask.nii.gz   tejido dañado (0/1)
ct/{hash}/grid.jpg             cuadrícula de 12 cortes axiales (la que ve el LLM)
ct/{hash}/ortho.jpg            vista axial + coronal + sagital (la que ve el LLM)
ct/{hash}/result.json          métricas, etiqueta, respuesta del LLM, rutas y tiempos
index.json                     resumen de todos los casos (para la app)
xray/{hash}.png                radiografías originales (solo con --modality xray)
```

Las máscaras y el original comparten orientación (LPS) y geometría, así que se pueden superponer en un
visor de NIfTI (por ejemplo NiiVue en el navegador). Los JPG se muestran directamente.

`result.json` incluye, entre otros: `metrics` (`volumen_pulmonar_ml`, `volumen_tejido_danado_ml`,
`porcentaje_tejido_danado`, `etiqueta_csv`), `image` (forma, espaciado, HU mínimo y máximo), `files`,
`llm` (`status`, `conclusion`, `error`, `attempts`) y `timings_s`.

## Reanudación y errores

- `result.json` se escribe **al final** de cada caso: su existencia marca el caso como terminado. Al
  relanzar, los casos terminados se saltan (se listan de una sola vez al empezar) y los que fallaron o
  quedaron a medias se rehacen.
- Si un caso falla, no detiene la corrida: queda registrado en `errors.jsonl` (en la carpeta de trabajo) y en
  el log.
- Si el LLM falla tras 5 intentos con espera creciente, el caso se guarda igualmente con
  `llm.status = "error"`; repítelo después con `--retry-llm`.

## Rendimiento

Medido en una RTX 3090 con 9 tomografías: un proceso tardó 7 min 30 s y tres procesos en paralelo 3 min
58 s (≈50 s frente a ≈26 s por caso). Subir `--sw-batch` o `--lung-batch` no produjo una mejora apreciable:
el cuello de botella no era el tamaño de lote. Los tiempos dependen de la máquina; mide tú con unos pocos
casos antes de lanzar todo:

```bash
time python process_dataset.py --all --limit 9 --skip-llm --storage local --local-dir ./bench1 --no-index
```

Con varios procesos, la RAM y los núcleos de CPU importan más que la VRAM (cada proceso mantiene varias
copias del volumen en memoria). Revisa `nproc` y `free -h`, y si hay errores de memoria baja el número de
procesos o usa `--post-workers 1`.

## Solución de problemas

| Síntoma | Causa probable y arreglo |
|---|---|
| `Permission denied` al ejecutar `run_parallel.sh` | Falta el permiso de ejecución: `chmod +x run_parallel.sh` o `bash run_parallel.sh ...` |
| `bad interpreter` / `^M` | Saltos de línea de Windows: `sed -i 's/\r$//' run_parallel.sh` |
| No existen `shard*.log` | El lanzador no arrancó; revisa el error al ejecutarlo y los permisos |
| `.env` desaparece al subirlo | Es un archivo oculto: créalo con `cat > covid.env <<'EOF'` o súbelo sin el punto inicial |
| `NoSuchKey` al listar el bucket | `STORAGE_ENDPOINT_URL` incluía `/nombre-del-bucket`; debe ser solo el host (el script ya lo corrige) |
| `unexpected EOF, expected N more bytes` al cargar los pesos | `coplenet_pretrain.pt` está truncado: vuelve a subirlo y compara tamaño y `sha256sum` |
| `403 Forbidden` de NVIDIA | Key inválida o sin acceso al modelo; usa `--skip-llm` y repite después con `--retry-llm` |
| Errores `429` de NVIDIA | Límite de peticiones: se reintenta con espera; baja los procesos o usa `--retry-llm` al final |
| Memoria de GPU o RAM insuficiente | Menos procesos en paralelo, `--post-workers 1`, o bajar `--sw-batch` / `--lung-batch` |
| `--modality xray` no encuentra archivos | El prefijo por defecto (`chest_xray/`) es un supuesto: revisa `--list-prefixes` y usa `--xray-prefix` |

## Seguridad y datos

- No subas `covid.env` ni ninguna llave a Git ni a ningún lugar público. Si se filtra una, revócala y crea
  una nueva.
- Si tu bucket es público, cualquiera podrá descargar los resultados; para una app propia suele ser mejor un
  bucket privado con URLs firmadas generadas desde tu backend.
- `original.nii.gz` puede ocupar del orden de 100 MB por caso (estimación): para todo el dataset superaría
  con holgura los planes gratuitos de la mayoría de proveedores. Con `--skip-original-upload` no se sube;
  `result.json` conserva la ruta del original en AWS.
- Las imágenes y los metadatos pertenecen a InRad (Hospital das Clínicas, Facultad de Medicina de la
  Universidad de São Paulo). Consulta su licencia y cómo citarlos en el registro del dataset.
