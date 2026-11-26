# Segmentación pulmonar y clasificación de pacientes con COVID-19

Pipeline en dos pasos sobre el dataset público de InRad (AWS Open Data):
<https://registry.opendata.aws/inlab-covid-19-images-dataset/>

1. **`process_dataset.py`** (GPU): para cada tomografía segmenta los pulmones (R231) y el tejido dañado
   (COPLE-Net), calcula volúmenes, genera imágenes 2D y, opcionalmente, una conclusión con un LLM de
   NVIDIA. Guarda todo en un bucket compatible con S3.
2. **`train_classifier.py`** (CPU): lee esos resultados del bucket y entrena un clasificador que predice la
   etiqueta del paciente (sano / otra enfermedad / COVID-19).

> Proyecto de investigación. No es una herramienta de diagnóstico.

## Estructura

```
process_dataset.py      segmentación + métricas + subida al bucket (requiere GPU y los pesos de COPLE-Net)
run_parallel.sh         lanza varios procesos en la misma GPU y reconstruye el índice
train_classifier.py     entrenamiento y evaluación del clasificador
requirements.txt        dependencias de process_dataset.py
requirements-train.txt  dependencias de train_classifier.py
.env.example            plantilla de variables de entorno
```

## Configuración

Copia `.env.example` a `.env`, rellénalo y no lo subas nunca al repositorio (ya está en `.gitignore`).

```bash
STORAGE_BUCKET=nombre-del-bucket
STORAGE_ENDPOINT_URL=https://<ACCOUNT_ID>.r2.cloudflarestorage.com   # solo el host, sin /bucket
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...
STORAGE_REGION=auto
NVIDIA_API_KEY=nvapi-...            # solo para process_dataset.py si usas el LLM
```

Para cargarlas en la terminal: `set -a; source .env; set +a`. `train_classifier.py` también lee `.env`
automáticamente si está instalado `python-dotenv`.

## Entrenar el clasificador

```bash
pip install -r requirements-train.txt
python train_classifier.py                      # COVID vs resto, todos los casos
python train_classifier.py --modo 3_clases      # 0 sano · 1 otra enfermedad · 2 COVID-19
python train_classifier.py --max-casos 40       # prueba rápida
python train_classifier.py --sin-mascaras       # solo las métricas de result.json
python train_classifier.py --no-subir           # no escribe nada en el bucket
python train_classifier.py --help
```

La primera ejecución descarga las máscaras de cada caso y calcula las características (≈1.6 s por caso en
la prueba de referencia); las guarda en `ml/features_mascaras.csv` del bucket y las siguientes ejecuciones
solo calculan los casos nuevos.

### Qué se guarda

En la carpeta `resultados/` (cambia con `--salida`):

| Archivo | Contenido |
|---|---|
| `cv_{modo}.csv` | validación cruzada de cada modelo (balanced accuracy, F1, AUC) |
| `resumen_{modo}.json` | modelo elegido, variables, métricas y reporte de clasificación |
| `matriz_confusion_roc.png` | matriz de confusión y curvas ROC (predicciones fuera de muestra) |
| `importancia_permutacion.png`, `importancia_variables.csv` | importancia de cada variable en un 25 % reservado |
| `exploracion_boxplot.png` | volumen pulmonar, volumen dañado y % dañado por etiqueta |
| `modelo_{modo}.joblib` | modelo final entrenado con todos los casos |
| `entrenamiento.log` | registro de la ejecución |

Con credenciales de escritura, el modelo y la tabla de validación también se suben a `ml/modelos/`.

### Características usadas

- De cada `result.json`: volumen pulmonar, volumen y % de tejido dañado (y sus logaritmos).
- De las máscaras: volumen y asimetría de cada pulmón, % de lesión por pulmón y por tercio del eje z,
  fracción de la lesión a ≤15 mm del borde pulmonar, distancia media al borde, número de lesiones, fracción
  de la mayor y número de lesiones ≥ 0.5 mL.
- Las variables del escáner (tamaño, espaciado, HU) se excluyen por defecto; actívalas con
  `--incluir-adquisicion` solo si sabes lo que haces, porque pueden delatar la etiqueta sin relación con
  la enfermedad.
- La etiqueta es la variable objetivo y nunca una entrada. Tampoco se usa la conclusión del LLM, porque su
  prompt incluía la etiqueta.

## Corrida de referencia

1,251 casos (650 no COVID, 601 COVID-19), modo `covid_vs_resto`, 20 variables, validación cruzada
estratificada 5 × 3:

| Modelo | Balanced accuracy | AUC |
|---|---|---|
| Dummy (clase mayoritaria) | 0.500 | 0.500 |
| Regresión logística | 0.834 ± 0.021 | 0.895 |
| Random Forest | 0.822 ± 0.023 | 0.896 |
| Gradient Boosting | 0.824 ± 0.021 | 0.899 |

Balanced accuracy en un 25 % reservado: 0.840.

## Limitaciones

- Las máscaras las produce un modelo automático, no son anotaciones médicas: sus errores se propagan al
  clasificador.
- El dataset está anonimizado, así que no se puede comprobar si un mismo paciente aparece en varias
  tomografías; de ser así, la validación cruzada estaría inflada.
- Las clases podrían diferir en equipo o protocolo de adquisición. Este script excluye por defecto las
  variables del escáner, pero no evalúa si otras variables (p. ej. el volumen pulmonar) también arrastran
  ese sesgo.
- No hay densidad (HU) entre las características porque los originales no forman parte de las entradas.

## Datos y créditos

Imágenes y metadatos: InRad, Hospital das Clínicas (HCFMUSP), Facultad de Medicina de la Universidad de
São Paulo, vía AWS Open Data. Consulta su licencia y cómo citarlo en el registro del dataset.
