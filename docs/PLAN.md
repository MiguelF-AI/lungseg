# PLAN — LungSeg WebViewer

> Fuente de verdad del alcance, contratos, UI y tickets. Si algo de aquí choca con la realidad (APIs de librerías, rendimiento), adapta, **documéntalo en `HANDOFF.md`** y corrige este archivo en el mismo cambio.

## 1. Objetivo y alcance

**Objetivo.** Un visor web local para revisar, tomografía por tomografía, las segmentaciones COVID-19 del proyecto: pulmón derecho, pulmón izquierdo y tejido dañado, sobre la CT original, con cortes y vista 3D en una interfaz oscura estilo «workstation» (referencia visual: VoxTell WebViewer, §7).

**Dentro del MVP (Fase 1)**
- Catálogo de estudios desde una carpeta local (`Data/`).
- Visor NiiVue: multiplanar + 3D, capas con visibilidad/opacidad, crosshair, lectura de coordenadas/HU.
- Métricas por estudio: volumen de cada pulmón, volumen de lesión, % de lesión, centroide de la lesión.
- Navegación entre todos los estudios, atajos de teclado, descarga de máscaras, captura.

**Opcional (Fases 2–3):** subir estudios desde la web, dibujar/corregir máscaras, lanzar la inferencia desde la web (CPU).

**Fuera de alcance (no implementar):** segmentación guiada por texto (el «Text prompt / Run Segmentation» de la referencia), autenticación, multiusuario, base de datos, DICOM, despliegue en la nube.

## 2. Contexto de datos

Las segmentaciones **ya existen**: las genera el notebook de Colab y se copian a `Data/`. La app es de solo lectura sobre `Data/` en el MVP.

- Dataset origen: CT de tórax anonimizadas (inLab open data), NIfTI.
- `{id}_lung.nii.gz`: etiquetas **1 = pulmón derecho, 2 = pulmón izquierdo** (modelo R231 de `lungmask`).
- `{id}_cople_lesion.nii.gz`: máscara binaria, **1 = tejido dañado** (COPLE-Net; ya limitada al pulmón).
- `{id}.nii` (o `.nii.gz`): CT original en HU. Es opcional, pero sin ella no hay visor de cortes: se muestra solo un aviso.
- Las máscaras se guardaron **reorientadas a LPS** (el notebook las escribe con la geometría de la CT reorientada); la CT original conserva su orientación de origen. NiiVue trabaja con coordenadas de mundo (affine), así que debe alinearlas; el ticket **V0** lo verifica con un caso real.
- Hardware objetivo: Ryzen 5 5600G, 16 GB RAM, RX 6600 (sin CUDA). El visor usa WebGL2 en el navegador; la inferencia **no** corre aquí en el MVP.

## 3. Decisiones de arquitectura

| # | Decisión | Motivo |
|---|----------|--------|
| D1 | Backend **FastAPI** (uv) + frontend **React + Vite + TS + NiiVue** | El navegador no puede listar carpetas ni calcular métricas; patrón probado en Cerberus. |
| D2 | **Sin** Redis/arq/Docker/Keycloak en el MVP | Todo es lectura y cálculo rápido; se agregan solo si llega la Fase 3. |
| D3 | El backend **deriva** máscaras binarias separadas (`lung_right`, `lung_left`, `lesion`) y una `ct.nii.gz` comprimida, en `storage/derived/` | Cada capa necesita alternar visibilidad, color y opacidad por separado; y una CT `.nii` cruda de cientos de MB es mala para el navegador. |
| D4 | Las derivadas se **cachean** con invalidación por `mtime` del archivo fuente | La segunda apertura de un caso debe ser instantánea. |
| D5 | Servir NIfTI con `ETag`/`Last-Modified`/`Cache-Control: no-cache` y respuesta 304 | Revalidar sin volver a descargar cientos de MB. |
| D6 | Colores y opacidades de capa definidos en **frontend** vía colormaps personalizados de NiiVue; el backend solo sugiere `color` en el contrato | Una sola fuente de verdad visual. |
| D7 | Estado de UI en React (sin Redux); datos del servidor con `fetch` + TanStack Query (permitido) | Mantenerlo simple. |

## 4. Estructura del repo

```
lungseg/
├── AGENTS.md / opencode.json
├── pyproject.toml / uv.lock
├── backend/
│   ├── lungseg_api/        # main.py, config.py, schemas.py, catalog.py, derive.py, metrics.py, routers/
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── api/            # types.ts, client.ts
│   │   ├── components/     # Sidebar, LayerPanel, StudyPicker, MetricsCard, ViewerToolbar, NiiViewer
│   │   ├── hooks/          # useNiivue, useHotkeys
│   │   ├── styles/         # tokens.css
│   │   └── App.tsx
│   └── vite.config.ts      # proxy /api → http://localhost:8000
├── docs/                   # PLAN.md, PROGRESS.md, HANDOFF.md, PROMPTS.md
├── Data/                   # (ignorado) CT + máscaras copiadas desde Colab
└── storage/                # (ignorado) derivadas, caché, capturas
```

## 5. Contrato de disco

Layout plano (coincide con lo que produce el notebook; no hay que renombrar nada):

```
Data/
├── {id}.nii | {id}.nii.gz           # CT original (opcional)
├── {id}_lung.nii.gz                 # etiquetas 1=derecho, 2=izquierdo
└── {id}_cople_lesion.nii.gz         # binaria (opcional)

storage/derived/{id}/                # generado por la app
├── ct.nii.gz
├── lung_right.nii.gz   (uint8, 0/1)
├── lung_left.nii.gz    (uint8, 0/1)
├── lesion.nii.gz       (uint8, 0/1)
└── metrics.json        # incluye mtimes de las fuentes para invalidar
```

- **Descubrimiento:** un estudio existe si hay `{id}_lung.nii.gz`. `id` = el nombre antes de `_lung.nii`.
- **Validación de `id`:** regex `^[A-Za-z0-9_-]{1,64}$`; si no coincide, se ignora el archivo (y la API responde 404).
- **`layer` válidos:** `ct`, `lung_right`, `lung_left`, `lesion`. Cualquier otro → 404.
- Los derivados mantienen **la misma geometría (affine y shape)** que su fuente.

## 6. Contrato de API (prefijo `/api`)

| Método | Ruta | Respuesta |
|--------|------|-----------|
| GET | `/api/health` | `{"status": "ok"}` |
| GET | `/api/studies` | `StudySummary[]` ordenado por `id` |
| GET | `/api/studies/{id}` | `StudyDetail` |
| GET | `/api/studies/{id}/metrics` | `Metrics` (calcula y cachea en la primera llamada) |
| GET/HEAD | `/api/studies/{id}/files/{layer}.nii.gz` | NIfTI; soporta `If-None-Match` → 304 |
| GET | `/api/studies/{id}/export.zip` | ZIP con las máscaras derivadas (**F8**) |

```jsonc
// StudySummary
{ "id": "…", "layers": ["ct","lung_right","lung_left","lesion"],   // solo las disponibles
  "lesion_pct": 3.4,      // null si aún no hay métricas cacheadas
  "lesion_l": 0.12 }

// StudyDetail
{ "id": "…",
  "shape": [512,512,300], "spacing_mm": [0.8,0.8,1.0],
  "layers": [
    { "key":"ct",         "label":"Tomografía",       "kind":"base", "color":null,      "url":"/api/studies/…/files/ct.nii.gz" },
    { "key":"lung_right", "label":"Pulmón derecho",   "kind":"mask", "color":"#4169e1", "url":"…" },
    { "key":"lung_left",  "label":"Pulmón izquierdo", "kind":"mask", "color":"#3cb371", "url":"…" },
    { "key":"lesion",     "label":"Tejido dañado",    "kind":"mask", "color":"#ff2a2a", "url":"…" } ] }

// Metrics   (volúmenes en litros; centroide en mm de mundo NIfTI)
{ "lung_right_l": 2.1, "lung_left_l": 1.8, "lung_total_l": 3.9,
  "lesion_l": 0.12, "lesion_pct_of_lung": 3.1,
  "lesion_by_lung_pct": { "right": 3.9, "left": 2.1 },
  "lesion_components": 14,
  "lesion_centroid_mm": [x, y, z] }          // null si no hay lesión
```

Errores: 404 (id/layer inexistente o inválido), 422 (validación), 500 sin filtrar rutas absolutas. La app corre solo en `127.0.0.1`; CORS solo para `http://localhost:5173` en desarrollo.

## 7. Especificación de UI

**Referencia visual** (captura «VoxTell WebViewer»): sidebar izquierda oscura, visor central 2×2, selector de vista abajo. Se replica la **estructura y la estética**, no las funciones de IA.

```
┌──────────────┬────────────────────────────────────────────────┐
│ Sidebar 320px│  Visor NiiVue (un único canvas, fondo negro)   │
│  Marca       │  ┌ Coronal ┬ Sagital ┐   lectura (arriba dcha):│
│  Estudio     │  ├ Axial   ┼  3D     ┤   x y z · HU · capa     │
│  Capas       │  └─────────┴─────────┘                         │
│  Métricas    │  [Axial|Coronal|Sagital|Multi|3D]  (abajo ctr) │
│  Descargar   │                                                │
└──────────────┴────────────────────────────────────────────────┘
```

**Sidebar (de arriba a abajo)**
1. **Marca:** icono + «LungSeg WebViewer» + subtítulo «Segmentación COVID-19 · TC de tórax».
2. **Estudio:** selector (id abreviado, p. ej. 8 primeros caracteres), botones ◀ ▶, contador «3 / 27».
3. **Capas:** una fila por capa: punto de color, nombre, ojo (visibilidad), y al expandir un slider de opacidad. La CT base tiene además control de ventana (preajuste pulmonar: nivel −650, ancho 1500).
4. **Métricas:** tarjeta con volumen de cada pulmón, volumen de lesión y % de lesión.
5. **Acciones:** botón «Centrar en lesión», botón «Descargar todo (N)». (El botón «Dibujar segmentación» solo aparece en la Fase 2.)
6. **Pie:** aviso fijo «Uso académico, no es un dispositivo médico».

**Visor**
- Vista por defecto: **Multi** (coronal, sagital, axial y 3D). Selector inferior con cinco modos. Crosshair rojo, letras de orientación visibles.
- Convención neurológica por defecto (como en la referencia); alternable a radiológica.
- Overlays: pulmones con opacidad baja (~0.25) y lesión alta (~0.8) para que la lesión se distinga **también en el 3D**.
- CT base con ventana pulmonar (−1350 a 150 HU).

**Atajos** (no se activan con foco en inputs): `1` Multi · `2` Axial · `3` Coronal · `4` Sagital · `5` 3D · `G` centrar en lesión · `E` mostrar/ocultar lesión · `P` mostrar/ocultar pulmones · `R` convención radiológica · `[` `]` estudio anterior/siguiente · `?` ayuda.

**Tokens de diseño** (`styles/tokens.css`): fondo `#0a0c14`, superficies `#11141f` / `#161a28`, borde `#232842`, acento violeta `#6c5ce7`, texto `#e6e8f2`, atenuado `#8b90a8`; colores de capa: pulmón derecho `#4169e1`, izquierdo `#3cb371`, lesión `#ff2a2a`. Tipografía sans moderna (Inter o IBM Plex Sans). Estados: cargando (skeleton), error (mensaje + reintentar), vacío (instrucciones para copiar datos a `Data/`).

## 8. Tickets

Estado en [`PROGRESS.md`](PROGRESS.md). Un ticket = una rama = un conjunto de commits pequeños.

### Fase 0 — Base
**A0 · Scaffold.** Repo con `uv` (Python 3.11+), FastAPI mínimo con `/api/health`, ruff + pyright + pytest configurados; frontend Vite + React + TS con `@niivue/niivue` instalado; proxy `/api`; `.gitignore` (§AGENTS regla 03); README con los comandos.
*Aceptación:* los checks de AGENTS.md pasan en limpio; `npm run dev` muestra una página que llama a `/api/health` y pinta «ok».

### Fase 1 — Backend
**B1 · Catálogo.** Escanear `Data/` (ruta por `LUNGSEG_DATA_DIR`), validar ids, implementar `GET /api/studies` y `GET /api/studies/{id}` (sin métricas todavía: `metrics: null`).
*Aceptación:* tests con carpeta sintética (ids válidos, inválidos, sin CT, sin lesión); un `../` o id raro devuelve 404.

**B2 · Derivados y archivos.** Generar y cachear `ct.nii.gz`, `lung_right`, `lung_left`, `lesion` (uint8) con invalidación por `mtime`; `GET/HEAD /files/{layer}.nii.gz` con `ETag`, `Last-Modified`, 304 y `Cache-Control: no-cache`.
*Aceptación:* test: shape y affine de cada derivada coinciden con la fuente; `lung_right ∪ lung_left` = `lung > 0`; segunda petición con `If-None-Match` devuelve 304 sin cuerpo; no se carga más de una CT completa en memoria a la vez.

**B3 · Métricas.** Calcular `Metrics` (§6) y guardarlas en `metrics.json`; endpoint `/metrics`; rellenar `lesion_pct`/`lesion_l` en `/api/studies`. Centroide en mm vía affine; componentes con `scipy.ndimage.label`.
*Aceptación:* test con volumen sintético de volúmenes conocidos (error < 1 %); estudio sin lesión → `lesion_l = 0`, centroide `null`; la segunda llamada usa caché.

### Fase 1 — Frontend
**F1 · Shell y sistema de diseño.** Layout de §7 con datos simulados, `tokens.css`, componentes `Sidebar`, `LayerPanel` (estático), `ViewerToolbar` (selector de vista, sin lógica).
*Aceptación:* a 1280×720 y 1920×1080 el layout no desborda; se ve fiel a la estructura de §7; sin errores de consola.

**F2 · Cliente API.** `types.ts` espejo de §6, `client.ts` y hooks (`useStudies`, `useStudy`, `useMetrics`) con estados de carga y error.
*Aceptación:* la sidebar lista estudios reales; con el backend apagado se muestra el estado de error con «Reintentar».

**F3 · `NiiViewer`.** Componente que monta NiiVue en un canvas, carga CT + capas del `StudyDetail`, soporta los modos Axial/Coronal/Sagital/Multi/3D, crosshair, lectura de coordenadas/HU y limpieza al desmontar.
*Aceptación:* con un caso real se ven CT + máscaras alineadas en los cuatro paneles; cambiar de modo no recarga volúmenes; al cambiar de estudio se libera el anterior (sin fugas de memoria visibles tras 10 cambios).

**F4 · Panel de capas.** Visibilidad, opacidad, color y ventana de la CT, sincronizados con NiiVue **sin recargar** volúmenes. Colores por colormaps personalizados.
*Aceptación:* ocultar/mostrar y mover opacidad es instantáneo; la lesión se distingue dentro del pulmón translúcido en 2D y en 3D.

**F5 · Estudios y atajos.** `StudyPicker` (◀ ▶, contador, buscar por id), `useHotkeys` (§7), modal de ayuda `?`, recordar la última vista elegida.
*Aceptación:* todos los atajos funcionan y no se disparan escribiendo en inputs.

**F6 · Métricas y «Centrar en lesión».** `MetricsCard`; botón/atajo `G` que lleva el crosshair al centroide de la lesión.
*Aceptación:* las cifras coinciden con `/metrics`; con estudio sin lesión el botón está deshabilitado y la tarjeta lo dice.

**V0 · Verificación de alineación (manual + registro).** Con 3 casos reales: confirmar que CT y máscaras coinciden, que «derecha/izquierda» son anatómicamente correctas, y que el centroide cae sobre la lesión visible. Documentar el resultado en `HANDOFF.md`.
*Si no alinean:* abrir ticket correctivo B2b (reorientar la CT derivada a la geometría de las máscaras).

**F7 · Pulido 3D.** Presets de cámara (frontal, posterior, izquierda, derecha, superior), plano de corte (clip plane), calidad/iluminación del render, opcionalmente mallas de las máscaras si el render volumétrico no distingue bien la lesión.
*Aceptación:* los presets orientan el modelo correctamente; el 3D sigue fluido (> 20 fps percibidos) con un estudio completo.

**F8 · Exportar.** Endpoint `export.zip` (contrato §6) + botón «Descargar todo (N)»; captura PNG del visor.
*Aceptación:* el ZIP contiene las máscaras derivadas con nombres claros; la captura respeta el modo de vista actual.

### Fase 2 — Opcional
**U1 · Subida de estudios.** `POST /api/uploads` para CT + máscaras NIfTI, con límites de tamaño, validación de cabecera y de shape coincidente. No procesar nada antes de validar.
**D1 · Dibujo y corrección.** Herramienta «Dibujar segmentación» con el dibujo nativo de NiiVue; guardar como NIfTI en `storage/user_masks/{id}/`; aparece como capa extra con papelera.

### Fase 3 — Opcional (inferencia desde la web)
**I1 · Inferencia en CPU.** Job asíncrono que ejecute `lungmask` + COPLE-Net portando la lógica del notebook, con progreso. Requiere decidir cola (arq/Redis o proceso en segundo plano). **Antes de implementarlo**, medir en el equipo objetivo el tiempo por estudio; sin CUDA puede ser lento y quizá convenga seguir usando Colab.

### Fase 4 — Calidad
**Q1 · QA visual e2e.** Playwright con capturas de los cinco modos y del panel de capas; checklist de accesibilidad básica (foco, contraste, `aria-label` en botones de icono).
**Q2 · Empaquetado (opcional).** `compose.yaml` con nginx sirviendo el frontend compilado y reenviando `/api`.

## 9. Dependencias entre tickets

```
A0 → B1 → B2 → B3
A0 → F1 → F2 (requiere B1) → F3 (requiere B2) → F4 → F5
                                  F3 + B3 → F6
                                  F4 + B2 → V0
                                  F3 + F4 → F7
                                  F4 + B2 → F8
B2 + F4 → U1 → D1
U1 + B2 → I1            Q1 tras F6 · Q2 tras F8
```

Orden sugerido: A0 → B1 → B2 → F1 → F2 → F3 → F4 → V0 → B3 → F6 → F5 → F7 → F8 → Q1.

## 10. Riesgos y preguntas abiertas

| ID | Riesgo | Mitigación |
|----|--------|------------|
| R1 | CT original y máscaras en orientaciones distintas | V0 temprano; fallback B2b. |
| R2 | CT de cientos de MB: carga lenta y memoria en el navegador | CT derivada comprimida, caché 304, medir en V0; si hace falta, versión reducida para el 3D. |
| R3 | La API de NiiVue difiere de lo asumido aquí (capas, colormaps personalizados, cámara 3D, captura) | Regla 08: verificar en `node_modules`; documentar adaptaciones. |
| R4 | El render 3D volumétrico no distingue bien la lesión translúcida | Subir opacidad/contraste de la lesión; F7 contempla mallas. |
| R5 | WebGL2 desactivado o sin aceleración por hardware en el navegador | Detectarlo y mostrar un aviso claro con instrucciones. |
| R6 | COPLE-Net puede segmentar mal en otro dataset | No es del visor, pero la UI mantiene el aviso de «uso académico» (regla 12). |

**Preguntas abiertas** (resolver con el humano antes del ticket indicado): ¿la CT original estará siempre disponible junto a las máscaras? (B1) · ¿cuántos estudios habrá y qué tamaño total? (B2) · ¿se quiere mostrar datos clínicos del CSV de inLab en la sidebar? (F6).

## 11. Protocolo de checkpoints

Al terminar un ticket: (1) marcar ✅ en `PROGRESS.md` y añadir `CP-NNN` con fecha, ticket, qué cambió, cómo se verificó y qué queda pendiente; (2) reescribir la sección 2 de `HANDOFF.md` con el estado actual y el siguiente paso recomendado; (3) si el trabajo queda a medias, describirlo en `HANDOFF.md` §3.
