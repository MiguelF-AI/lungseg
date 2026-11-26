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
├── {id}_lung.nii | {id}_lung.nii.gz # etiquetas 1=derecho, 2=izquierdo
└── {id}_cople_lesion.nii | {id}_cople_lesion.nii.gz  # binaria (opcional)

storage/derived/{id}/                # generado por la app
├── ct.nii.gz
├── lung_right.nii.gz   (uint8, 0/1)
├── lung_left.nii.gz    (uint8, 0/1)
├── lesion.nii.gz       (uint8, 0/1)
└── metadata.json       # mtimes de las fuentes por capa (invalidación)
```

- **Descubrimiento:** un estudio existe si hay `{id}_lung.nii` o `{id}_lung.nii.gz`. `id` = el nombre antes del sufijo `_lung`.
- **Validación de `id`:** regex `^[A-Za-z0-9_-]{1,64}$`; si no coincide, se ignora el archivo (y la API responde 404).
- **`layer` válidos:** `ct`, `lung_right`, `lung_left`, `lesion`. Cualquier otro → 404.
- Los derivados mantienen **la misma geometría (affine y shape)** que su fuente y se escriben siempre como `.nii.gz`.
- Las fuentes se aceptan tanto sin comprimir (`.nii`) como comprimidas (`.nii.gz`); la CT derivada se comprime una sola vez (gzip nivel 4) y se cachea.

## 6. Contrato de API (prefijo `/api`)

| Método | Ruta | Respuesta |
|--------|------|-----------|
| GET | `/api/health` | `{"status": "ok"}` |
| GET | `/api/studies` | `StudySummary[]` ordenado por `id` |
| GET | `/api/studies/{id}` | `StudyDetail` |
| GET | `/api/studies/{id}/metrics` | `Metrics` (calcula y cachea en la primera llamada) |
| GET/HEAD | `/api/studies/{id}/files/{layer}.nii.gz` | NIfTI; soporta `If-None-Match` → 304 |
| GET | `/api/studies/{id}/export.zip` | ZIP con las máscaras derivadas disponibles (**F8**): nombres planos `{id}_{key}.nii.gz` (`key` ∈ `lung_right`, `lung_left`, `lesion`; **nunca CT**) y `LEEME.txt` UTF-8. `ZIP_STORED`, `Content-Type: application/zip`, `Content-Disposition: attachment; filename="{id}_masks.zip"`, `Cache-Control: no-store`. 404 si el id es inválido, el estudio no existe o no hay máscaras. |

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
    { "key":"lesion",     "label":"Tejido dañado",    "kind":"mask", "color":"#ff2a2a", "url":"…" } ],
  "lesion_pct": 3.1, "lesion_l": 0.12 }   // solo desde métricas ya cacheadas; null si no hay

// Metrics   (volúmenes en litros; centroide y foco en mm de mundo NIfTI)
{ "lung_right_l": 2.1, "lung_left_l": 1.8, "lung_total_l": 3.9,
  "lesion_l": 0.12, "lesion_pct_of_lung": 3.1,
  "lesion_by_lung_pct": { "right": 3.9, "left": 2.1 },
  "lesion_components": 14,
  "lesion_centroid_mm": [x, y, z],   // centroide global; null si no hay lesión
  "lesion_focus_mm": [x, y, z] }     // punto garantizado DENTRO de la lesión; null si no hay

// lesion_by_lung_pct: cada vóxel de lesión se asigna al pulmón cuya máscara rellenada por corte axial
// (binary_fill_holes 2D; R231 deja huecos con consolidación densa) lo contiene; el denominador son los
// vóxeles crudos de ese pulmón. `lesion_pct_of_lung` usa la fórmula del notebook (vóxeles de lesión /
// vóxeles crudos de ambos pulmones).

// lesion_centroid_mm puede caer FUERA de cualquier foco con lesiones multifocales o bilaterales
// (p. ej. en el mediastino), así que no sirve para «centrar en lesión». `lesion_focus_mm` (F6) es el
// centro del vóxel del componente conexo MÁS GRANDE (misma conectividad 6 que lesion_components) más
// cercano en mm al centroide de ese componente: siempre cae sobre tejido segmentado.
// La caché `metrics.json` lleva `schema_version`; al cambiar el esquema se descarta y se recalcula.
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

**Atajos** (no se activan con foco en inputs): `1` Multi · `2` Axial · `3` Coronal · `4` Sagital · `5` 3D · `G` centrar en lesión · `E` mostrar/ocultar lesión · `P` mostrar/ocultar pulmones · `R` convención radiológica · `C` plano de corte (activar/desactivar) · `[` `]` / `,` `.` estudio anterior/siguiente · `?` ayuda.

**Controles 3D (F7)** — sección de la sidebar, visible en modo 3D o Multi:
- **Presets de cámara:** Anterior, Posterior, Izquierda, Derecha y Superior. Cada preset aplica un par (azimut, elevación) en grados; la tabla exacta se documenta en este apartado tras verificación empírica con el cubo de orientación y anatomía real (ambas convenciones). Mientras no se verifique, los valores son una tabla de partida marcada en el código.
- **Cubo de orientación:** interruptor, activado por defecto en 3D (`isOrientCube`).
- **Plano de corte:** interruptor + deslizador de profundidad (0 a ~1.73) + botón «Alinear con la cámara» (usa azimut/elevación actuales). Desactivado → profundidad > 2.0 (recorte desactivado). La tecla `C` de NiiVue se desactiva (`clipPlaneHotKey: ''`); nuestra `C` (misma lógica de F5) activa/desactiva el recorte.
- **Calidad:** iluminación (`setVolumeRenderIllumination`), opacidad por gradiente (`setGradientOpacity`) y mezcla CT+overlays (`renderOverlayBlend`), con valores por defecto elegidos probando con estudios reales, más botón «Restablecer 3D».
- **«Solo segmentaciones en 3D»:** la CT se oculta (opacidad 0) solo en el panel 3D puro; en Multi gobierna todo lo del panel de capas (F4). NiiVue no permite ocultar un volumen solo en un tipo de corte, así que es un compromiso documentado.
- **Cámara y plano de corte sincronizados:** los cambios hechos arrastrando con el ratón se leen de los eventos `azimuthElevationChange` y `clipPlaneChange` de NiiVue y se reflejan en los controles (única fuente de verdad en React; sin props→estado).
- **Cambio de estudio:** las preferencias 3D se conservan (como F4); la cámara vuelve a «Anterior». Sin recargar volúmenes (regla 11). Una instancia y un canvas (regla 16).

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

**F6 · Métricas y «Centrar en lesión».** `MetricsCard` con datos reales de `/metrics`; botón que lleva el crosshair a `lesion_focus_mm` (punto garantizado dentro de la lesión, porque el centroide global puede caer fuera). El atajo `G` se añade en F5 reutilizando esa función.
*Aceptación:* las cifras coinciden con `/metrics`; con estudio sin lesión el botón está deshabilitado y la tarjeta lo dice; el crosshair queda sobre tejido dañado en 2D y 3D.

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
| R3 | La API de NiiVue difiere de lo asumido aquí (capas, colormaps personalizados, cámara 3D, captura) | Regla 08: verificar en `node_modules`; documentar adaptaciones. Actualizado a 0.69.0 en ticket N1 (chore/N1-niivue-upgrade): todas las APIs usadas se verificaron contra el `.d.ts` real con firmas idénticas; los métodos `@internal` (`refreshLayers`, `mm2frac`, `createOnLocationChange`) siguen presentes. |
| R4 | El render 3D volumétrico no distingue bien la lesión translúcida | Subir opacidad/contraste de la lesión; F7 contempla mallas. |
| R5 | WebGL2 desactivado o sin aceleración por hardware en el navegador | Detectarlo y mostrar un aviso claro con instrucciones. |
| R6 | COPLE-Net puede segmentar mal en otro dataset | No es del visor, pero la UI mantiene el aviso de «uso académico» (regla 12). |

**Preguntas abiertas** (resolver con el humano antes del ticket indicado): ¿la CT original estará siempre disponible junto a las máscaras? (B1) · ¿cuántos estudios habrá y qué tamaño total? (B2) · ¿se quiere mostrar datos clínicos del CSV de inLab en la sidebar? (F6).

## 11. Protocolo de checkpoints

Al terminar un ticket: (1) marcar ✅ en `PROGRESS.md` y añadir `CP-NNN` con fecha, ticket, qué cambió, cómo se verificó y qué queda pendiente; (2) reescribir la sección 2 de `HANDOFF.md` con el estado actual y el siguiente paso recomendado; (3) si el trabajo queda a medias, describirlo en `HANDOFF.md` §3.

## 12. Fase 5 — Fuentes remotas y caché temporal

### 12.1 Objetivo y alcance

Permitir elegir un caso entre los del CSV público de inLab (AWS S3, acceso anónimo, sin credenciales), descargar su CT (AWS) y sus segmentaciones (Cloudflare R2, API compatible con S3, token de solo lectura), generar los derivados (B2/B3) y abrirlo en el visor como hoy. Todo lo descargado y derivado de fuentes remotas vive solo en un directorio de caché temporal con política configurable (TTL por inactividad, número máximo de casos, tope total en bytes, expulsión LRU, purga al arrancar y botón «Liberar espacio»). El modo local (`Data/`) sigue funcionando sin cambios ni credenciales.

Dentro de la Fase 5:
- Catálogo unificado de casos locales (`Data/`) y remotos (CSV), con búsqueda y paginación en el servidor.
- Cada caso muestra si tiene segmentaciones en R2 (listado por prefijo `ct/` con delimitador, paginado y cacheado con TTL) y si está preparado en el caché.
- Preparación de un caso no listo: descarga CT (AWS) + segmentaciones (R2), derivados (B2/B3), progreso por etapas, cancelar y reintentar. Al terminar se abre en el visor.
- Caso sin segmentación en R2: se ve solo la CT con aviso claro.
- Caché temporal con política de retención y borrado seguro.
- Configuración por variables de entorno; secretos nunca en el frontend, logs ni Git.

Fuera de la Fase 5:
- Autenticación, multiusuario, base de datos, DICOM, subida de estudios desde la web, inferencia desde la web (Fase 2/3).
- Cambiar el comportamiento del modo local cuando `LUNGSEG_SOURCE=local`.

### 12.2 Decisiones de arquitectura y alternativas descartadas

| # | Decisión | Motivo / alternativa descartada |
|---|----------|---------------------------------|
| D5.1 | `LUNGSEG_SOURCE = local \| remote \| both` (default `both`) | `local` mantendría el comportamiento actual; `both` muestra casos locales y remotos desde el arranque sin romper instalaciones existentes. |
| D5.2 | Directorio de caché temporal `LUNGSEG_CACHE_DIR` (default `storage/cache`) separado de `storage/derived/` | Los derivados de casos locales siguen en `storage/derived/` (B2/B3 sin tocar); lo remoto vive solo en caché, fácil de purgar por completo. |
| D5.3 | Reusar la lógica de derivación de B2/B3 apuntando `LUNGSEG_DATA_DIR` al caché del caso | No se duplica código de máscaras/métricas; el caso descargado se trata como una "fuente" temporal. |
| D5.4 | No conservar el `.nii` crudo de la CT tras derivar: comprimir al vuelo a `ct.nii.gz` mientras se descansa | CTs de cientos de MB en disco limitado. Alternativa descartada: guardar `ct.nii` crudo y borrarlo tras derivar (pico de disco 2×, solo se gana CPU). |
| D5.5 | Claves de R2/S3 solo por plantillas configurables + id validado por regex | Los nombres reales en R2 son `lung_mask.nii.gz` y `lesion_mask.nii.gz` dentro de `ct/{hash}/`, no `{id}_lung.nii.gz`; las plantillas evitan suponer y evitan inyección de rutas (regla 09 ampliada). |
| D5.6 | Preparación asíncrona con job y endpoint de estado/progreso (cola interna, sin nuevas dependencias) | La descarga de una CT (cientos de MB) y la derivación tardan segundos; la API no debe bloquear. Cola externa (Redis/arq) descartada por ahora. |
| D5.7 | Paginación y búsqueda del catálogo en el servidor | El CSV tiene 1294 casos y puede crecer; traer todos los ids al frontend no escala. |
| D5.8 | Tests sin red: moto para S3/R2 + servidor HTTP falso para AWS | La regla 06 prohíbe red en tests; las pruebas reales con un caso remoto solo con autorización previa del humano. |

Compromiso CT cruda (D5.4): comprimir al vuelo gasta CPU durante la descarga pero evita tener dos copias (cruda + `.gz`) en disco a la vez. En la máquina objetivo (16 GB RAM, disco compartido con `storage/`) es la opción más segura.

### 12.3 Contrato de configuración

Variables de entorno (backend; se pasan también a `compose.yaml` y al `Dockerfile`):

| Variable | Obligatoria | Default | Descripción |
|---|---|---|---|
| `LUNGSEG_SOURCE` | No | `both` | `local` \| `remote` \| `both`. Fuente de casos para el catálogo. |
| `LUNGSEG_DATA_DIR` | No | `./Data` | Directorio de fuentes locales (B1, sin cambios). |
| `LUNGSEG_STORAGE_DIR` | No | `./storage` | Directorio de derivados locales y raíz del caché. |
| `LUNGSEG_CACHE_DIR` | No | `{LUNGSEG_STORAGE_DIR}/cache` | Directorio de caché temporal para casos remotos. |
| `LUNGSEG_CACHE_TTL_MIN` | No | `30` | TTL de inactividad (minutos) antes de expirar un caso del caché. |
| `LUNGSEG_CACHE_MAX_CASES` | No | `3` | Número máximo de casos retenidos en el caché. |
| `LUNGSEG_CACHE_MAX_BYTES` | No | `4294967296` (4 GB) | Tope total en bytes del caché. |
| `LUNGSEG_CACHE_PURGE_ON_START` | No | `true` | Purga el caché al arrancar la API. |
| `LUNGSEG_CACHE_MAX_CONCURRENT_DOWNLOADS` | No | `2` | Máximo de descargas simultáneas (CT + segmentaciones). |
| `LUNGSEG_REMOTE_BASE` | Sí si `remote`/`both` | — | Base AWS S3 pública: `https://inlab-opendata-covid-anonymized-images.s3.us-west-2.amazonaws.com/chest_ct` |
| `LUNGSEG_REMOTE_CSV_TEMPLATE` | No | `{base}/metadata/clinicaldata.csv` | Plantilla con `{base}` para el CSV de metadatos. |
| `LUNGSEG_REMOTE_CT_TEMPLATE` | No | `{base}/images/{id}.nii` | Plantilla con `{base}` y `{id}` para la CT de un caso. |
| `LUNGSEG_R2_ENDPOINT` | Sí si `remote`/`both` | `https://0c05fdf08be0e1e5280c6728598341b9.r2.cloudflarestorage.com` | Endpoint S3-compatible de Cloudflare R2. |
| `LUNGSEG_R2_BUCKET` | Sí si `remote`/`both` | `covid-ct-results` | Bucket de segmentaciones. |
| `LUNGSEG_R2_KEY_READ` | Sí si `remote`/`both` | — | Token de solo lectura, limitado al bucket (secreto, solo env/Docker). |
| `LUNGSEG_R2_KEY_LUNG_TEMPLATE` | No | `ct/{id}/lung_mask.nii.gz` | Plantilla de clave de la máscara de pulmón (campo `{id}`). |
| `LUNGSEG_R2_KEY_LESION_TEMPLATE` | No | `ct/{id}/lesion_mask.nii.gz` | Plantilla de clave de la máscara de lesión (campo `{id}`). |

Ejemplo `.env` (sin valores, solo nombres; no se comitea):
```
LUNGSEG_SOURCE=both
LUNGSEG_CACHE_DIR=./storage/cache
LUNGSEG_CACHE_TTL_MIN=30
LUNGSEG_CACHE_MAX_CASES=3
LUNGSEG_CACHE_MAX_BYTES=4294967296
LUNGSEG_CACHE_PURGE_ON_START=true
LUNGSEG_REMOTE_BASE=https://inlab-opendata-covid-anonymized-images.s3.us-west-2.amazonaws.com/chest_ct
LUNGSEG_R2_ENDPOINT=https://0c05fdf08be0e1e5280c6728598341b9.r2.cloudflarestorage.com
LUNGSEG_R2_BUCKET=covid-ct-results
LUNGSEG_R2_KEY_READ=<solo en entorno o secreto de Docker>
```

### 12.4 Contrato de API (prefijo `/api`)

Cambios sobre §6 (regla 01: actualizar `schemas.py`, `types.ts` y `PLAN.md` en el mismo cambio).

**Extensiones de `StudySummary` y `StudyDetail`:**
```jsonc
// StudySummary (ampliada en Fase 5)
{ "id": "…",
  "source": "local",          // "local" | "remote"
  "layers": ["ct","lung_right","lung_left","lesion"],
  "lesion_pct": 3.4,          // solo desde métricas cacheadas; null si no hay
  "lesion_l": 0.12,
  "masks_remote": true,       // ¿tiene segmentaciones listadas en R2?
  "prepared": false           // ¿tiene derivados listos en caché para ver en el visor?
}

// StudyDetail (ampliada en Fase 5): idem + source, masks_remote, prepared
```

**Nuevos endpoints:**

| Método | Ruta | Respuesta / comportamiento |
|---|---|---|
| GET | `/api/catalog?source=&search=&page=&page_size=` | `PaginatedCatalog` con `items` (`StudySummary` ampliada), `total`, `page`, `page_size`. Búsqueda por subcadena de `id` (sin mayúsculas). `source` filtra `local`/`remote`/`both`. Paginación en servidor. |
| POST | `/api/prepare/{id}` | Inicia la preparación de un caso remoto (descarga CT + segmentaciones, derivados B2/B3). Devuelve `{ job_id, status: "queued" }`. 404 si id inválido o caso no existe en el catálogo. 409 si ya se está preparando. |
| GET | `/api/prepare/{job_id}/status` | `{ job_id, status, stage, progress_pct, bytes_done, bytes_total, error }`. Etapas: `ct_downloading`, `ct_done`, `masks_downloading`, `masks_done`, `deriving`, `done`, `error`, `cancelled`. Progreso por etapas (CT con bytes, segmentaciones, preparación). |
| DELETE | `/api/prepare/{job_id}` | Cancela la preparación en curso. 404 si el job no existe; 400 si ya terminó. |
| POST | `/api/cache/purge` | "Liberar espacio": aplica expulsión LRU hasta respetar `MAX_CASES`/`MAX_BYTES`/TTL. Nunca borra un caso en uso (descarga abierta o estudio cargado en el visor). Devuelve `{ freed_cases, freed_bytes }`. |
| GET | `/api/cache/stats` | `{ cases, bytes, ttl_min, max_cases, max_bytes, purge_on_start }` |

`GET /api/studies` y `GET /api/studies/{id}` siguen funcionando en modo local; en modo `remote`/`both` devuelven también casos remotos preparados y rellenan `source`/`masks_remote`/`prepared`. `lesion_pct`/`lesion_l` solo desde métricas cacheadas (como hoy, nunca calculan en el listado).

### 12.5 Diagrama de estados de un caso

```
        ┌──────────────┐
        │ no preparado │  (en catálogo, sin derivados; listo para verse solo CT si no hay lesión)
        └──────┬───────┘
               │ elegir / preparar
               ▼
        ┌──────────────┐
        │ descargando  │──┐  CT (con bytes) + segmentaciones (R2); cancelable
        └──────┬───────┘  │
               │ OK       │ cancelar / fallo
               ▼          ▼
        ┌──────────────┐  ┌──────────┐
        │ derivando    │  │ error    │◄── reintentar
        └──────┬───────┘  └──────────┘
               │ OK
               ▼
        ┌──────────────┐
        │ listo        │────┐  derivados en caché; visible en el visor
        └──────┬───────┘    │  (TTL de inactividad arranca al verse)
               │ se ve      │ expira (TTL) / LRU / "liberar espacio"
               │ (reinicia  │
               │  TTL)      ▼
        ┌──────────────┐ ┌───────────┐
        │ expirado     │◄─┤           │  derivados borrados, queda metadato;
        └──────┬───────┘ │           │  se re-prepara de forma transparente al verlo
               │ re-preparar └───────┘
               ▼
             (vuelve a listo)
```

"Caso en uso" = descarga abierta en ese job o estudio actualmente cargado en el visor del frontend; esos casos quedan excluidos de la expulsión/purga.

### 12.6 Contrato del caché temporal

- Ubicación: `LUNGSEG_CACHE_DIR` (default `storage/cache`). Estructura por caso: `cache/{id}/` con `ct.nii.gz`, `lung_right.nii.gz`, `lung_left.nii.gz`, `lesion.nii.gz` (si existen), `metrics.json`, `meta.json` (fuente, tamaño, última sesión de uso, bytes totales).
- Política de retención: TTL por inactividad (se renueva cada vez que el caso se abre en el visor), número máximo de casos, tope total en bytes, expulsión LRU (el menos usado se borra primero), purga al arrancar si está habilitado, botón «Liberar espacio» que ejecuta la expulsión bajo demanda.
- Borrado seguro (regla ampliada): antes de borrar, resolver la ruta absoluta, comprobar que está dentro de `LUNGSEG_CACHE_DIR`, no seguir enlaces simbólicos, validar el `id` con `ID_REGEX` antes de construir cualquier ruta. Nunca se borra un caso en uso.
- Si un caso expira mientras el usuario lo ve, el frontend detecta que los derivados ya no están y lo re-prepara de forma transparente (descarga + derivado de nuevo).
- El `.nii` crudo de la CT no se conserva: se comprime al vuelo a `ct.nii.gz` durante la descarga (o se borra el crudo tan pronto existe el derivado); véase el compromiso D5.4.

### 12.7 Tickets de la Fase 5

| Ticket | Descripción | Depende de | Estado |
|---|---|---|---|
| R1 | Caché temporal y configuración (variables, política de retención, borrado seguro, `cache/stats`, `cache/purge`) | A0, B2, B3 | ⬜ |
| R2 | Cliente AWS público (CSV y CT con progreso, `.part` + atómico, reintentos, timeouts, servidor HTTP falso en tests) | R1 | ⬜ |
| R3 | Cliente R2 (listado por prefijo `ct/` con delimitador paginado+cacheado TTL, descarga de máscaras, plantillas de clave configurables, moto en tests) | R1 | ⬜ |
| R4 | Catálogo y preparación en el backend (`/api/catalog`, `/api/prepare`, estado/progreso, cancelar, integración B1-B3, modo local intacto, cambios en `StudySummary`/`StudyDetail`) | R1, R2, R3, B1-B3 | ⬜ |
| R5 | Frontend (selector de casos del CSV con búsqueda/paginación, progreso por etapas, cancelar, liberar espacio; comportamiento de atajos `[` `]` `,` `.` sobre catálogo grande) | R4, F1-F6 | ⬜ |
| R6 | Docker/compose (variables, secretos, volumen del caché, límites, healthcheck, README) | R1, Q2 | ⬜ |

Criterios de aceptación medibles (ejemplos):
- R1: tests sin red verifican TTL, max casos, max bytes, expulsión LRU, purga al arrancar, borrado seguro (ruta fuera de caché no se borra, symlink no se sigue), y que nunca se borra un caso marcado como en uso.
- R2: descarga de CT de prueba con progreso de bytes, reintentos con espera creciente y tope, archivo `.part` renombrado atómicamente, comprobación de tamaño contra `Content-Length`, máximo 2 descargas simultáneas, sin URLs firmadas en errores.
- R3: listado paginado de R2 con delimitador, cacheado con TTL, plantillas de clave respetadas, descarga de máscaras.
- R4: `GET /api/catalog` paginado y con búsqueda devuelve casos locales y remotos; `POST /api/prepare` + `/status` completa un caso remoto y lo deja `prepared`; modo local (`LUNGSEG_SOURCE=local`) idéntico a hoy.
- R5: el selector muestra búsqueda y contador n/total del catálogo; los atajos navegan por la página filtrada actual; progreso, cancelar y «Liberar espacio» tienen estados claros en la UI.
- R6: `docker compose up --build` levanta API + frontend; `/api/health`, `/api/catalog` y `/api/cache/stats` responden a través de nginx; el volumen del caché se monta y los secretos solo por env.

### 12.8 Riesgos y preguntas abiertas (Fase 5)

| ID | Riesgo / pregunta | Estado |
|----|-------------------|--------|
| F5-R1 | ¿Se prefiere comprimir la CT al vuelo (menos disco, más CPU) o guardar crudo y borrar tras derivar? | Resuelto: comprimir al vuelo (D5.4). |
| F5-R2 | Default de `LUNGSEG_SOURCE`: ¿`local` o `both`? | Resuelto: `both` (D5.1). |
| F5-R3 | Estructura real de claves en R2: ¿cómo se nombran los archivos dentro de `ct/{hash}/`? | Resuelto: `lung_mask.nii.gz` y `lesion_mask.nii.gz` (plantillas en D5.5). |
| F5-R4 | ¿Qué indica `type` del CSV (0 = sano, 1 = otra enfermedad, 2 = covid)? ¿Sirve para filtrar o etiquetar en el menú? | Abierto: por ahora se ignora; el menú muestra solo `id` (abreviado). |
| F5-R5 | ¿Cuántos casos se esperan en el CSV en producción y qué tamaño medio tienen las CT? (impacta `MAX_CASES`/`MAX_BYTES`). | Abierto: defaults 3 casos / 4 GB. |
| F5-R6 | Preparación asíncrona: ¿cola interna (propuesta) o externa (Redis/arq)? | Resuelto: cola interna sin nuevas dependencias (D5.6). |

**Preguntas abiertas pendientes (resolver con el humano antes del ticket indicado):** ¿se quiere usar `type` del CSV para filtrar o etiquetar casos en el menú? (R5) · ¿cuántos casos y qué tamaño medio de CT en producción? (R1).
