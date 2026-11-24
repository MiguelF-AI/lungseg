import { useCallback, useEffect, useRef, useState } from 'react'
import { Niivue, SLICE_TYPE, type NiiVueLocation, type NiiVueLocationValue, NVImageFromUrlOptions } from '@niivue/niivue'

import type { LayerInfo } from '../api/types'
import {
  DEFAULT_CT_WINDOW,
  DEFAULT_OPACITY,
  windowToRange,
  type CtWindow,
  type LayerVisualSettings,
} from '../layers'

/** Tipo de las opciones de carga de volumen (NVImageFromUrlOptions es una factory, no un type). */
type VolumeOptions = ReturnType<typeof NVImageFromUrlOptions>

/** Opacidad por defecto de una capa según su clave (las desconocidas: 0.5). */
function defaultOpacity(key: string): number {
  return DEFAULT_OPACITY[key] ?? 0.5
}

/**
 * Firmas de los ajustes aplicados sobre los volúmenes.
 *
 * Se separan en dos grupos porque su coste en NiiVue es muy distinto:
 * - `base` (CT: visibilidad, opacidad y ventana) requiere reconstruir la
 *   textura de la CT y las capas (`updateGLVolume`).
 * - `masks` (visibilidad, opacidad y color de las máscaras) solo requiere
 *   volver a hornear la textura de overlays, sin tocar la CT.
 */
interface AppliedVisualKeys {
  base: string
  masks: string
}

/** Calcula las firmas de `settings` + `ctWindow` para las capas del estudio. */
function computeVisualKeys(
  layers: LayerInfo[],
  settings: Record<string, LayerVisualSettings>,
  ctWindow: CtWindow,
): AppliedVisualKeys {
  const baseLayer = layers.find((layer) => layer.kind === 'base')
  const baseSettings = baseLayer ? settings[baseLayer.key] : undefined
  const baseVisible = baseSettings?.visible === false ? 0 : 1
  const baseOpacity = (baseSettings?.opacity ?? defaultOpacity('ct')).toFixed(3)
  const base = `${baseVisible}:${baseOpacity}:${ctWindow.level}/${ctWindow.width}`

  const masks = layers
    .filter((layer) => layer.kind === 'mask')
    .map((layer) => {
      const maskSettings = settings[layer.key]
      const visible = maskSettings?.visible === false ? 0 : 1
      const opacity = (maskSettings?.opacity ?? defaultOpacity(layer.key)).toFixed(3)
      const color = maskSettings?.color ?? layer.color ?? ''
      return `${layer.key}:${visible}:${opacity}:${color}`
    })
    .join('|')

  return { base, masks }
}

/** Firmas que dejan horneadas `buildVolumeOptions` + `loadVolumes`. */
function loadedVisualKeys(layers: LayerInfo[]): AppliedVisualKeys {
  const settings: Record<string, LayerVisualSettings> = {}
  for (const layer of layers) {
    settings[layer.key] = {
      visible: true,
      opacity: defaultOpacity(layer.key),
      color: layer.kind === 'mask' ? layer.color : null,
    }
  }
  return computeVisualKeys(layers, settings, DEFAULT_CT_WINDOW)
}

/**
 * Rehornea SOLO la textura de overlays (máscaras) con los valores actuales,
 * sin re-subir la textura de la CT. Equivale a la parte de `updateGLVolume`
 * que recorre las capas > 0; se usa en el camino caliente de los sliders de
 * máscara, donde reconstruir la CT (cientos de MB) sería desproporcionado.
 */
function rebakeOverlays(nv: Niivue): void {
  let layer = 0
  for (const vol of nv.volumes) {
    if (!vol.toRAS) continue
    if (layer > 0) nv.refreshLayers(vol, layer)
    layer++
  }
  nv.drawScene()
}

/**
 * Clave de capa a partir del `name` de un volumen.
 *
 * `buildVolumeOptions` nombra los volúmenes `<key>.nii.gz` porque NiiVue
 * 0.47.0 necesita una extensión en `name` (ver `getFileExt`). En la lectura
 * de posición `values[].name` es exactamente ese nombre y `id` es un UUID
 * (`v4()`), así que la capa se identifica quitando la extensión.
 */
function volumeLayerKey(name: string | undefined | null): string | null {
  if (!name) return null
  return name.replace(/\.nii(\.gz)?$/i, '')
}

/** Modos de vista del visor (estilo ViewerToolbar). */
export type ViewMode = 'Axial' | 'Coronal' | 'Sagital' | 'Multi' | '3D'

/** Valor de posición del crosshair leído de NiiVue. */
export type CrosshairLocation = {
  mm: [number, number, number]
  vox: [number, number, number]
  hu: number | null
  layerName: string | null
}

/** Opacidad inicial por capa (PLAN §7). */
const DEFAULT_CT_RANGE = windowToRange(DEFAULT_CT_WINDOW)

/** Ventana pulmonar de la CT (PLAN §7: −650 / 1500 HU → −1400..100). */
const CT_CAL_MIN = DEFAULT_CT_RANGE.calMin
const CT_CAL_MAX = DEFAULT_CT_RANGE.calMax

const VIEW_MODE_TO_SLICE_TYPE: Record<ViewMode, SLICE_TYPE> = {
  Axial: SLICE_TYPE.AXIAL,
  Coronal: SLICE_TYPE.CORONAL,
  Sagital: SLICE_TYPE.SAGITTAL,
  Multi: SLICE_TYPE.MULTIPLANAR,
  '3D': SLICE_TYPE.RENDER,
}

/** Forma del colormap de un solo color (ColorMap de NiiVue no se exporta públicamente). */
type SingleColorColormap = {
  R: number[]
  G: number[]
  B: number[]
  A: number[]
  I: number[]
  min?: number
  max?: number
  labels?: string[]
}

/**
 * Detección de WebGL2 con un canvas desechable, una sola vez y fuera del
 * ciclo de render. Se memoiza para no consultar el navegador en cada
 * render y para no invalidar el contexto que va a usar NiiVue.
 */
let webgl2AvailableCached: boolean | null = null
function detectWebGL2(): boolean {
  if (webgl2AvailableCached !== null) {
    return webgl2AvailableCached
  }
  const canvas = document.createElement('canvas')
  webgl2AvailableCached = !!canvas.getContext('webgl2')
  return webgl2AvailableCached
}

/**
 * Colormap de un solo color para máscaras.
 *
 * NiiVue trabaja con canales R/G/B/A en el rango 0–255 y `makeLut` usa la
 * longitud de `R` como número de puntos de control: con un solo punto no
 * genera LUT (la máscara queda transparente). Por eso se usan dos puntos
 * (inicio y fin) con el mismo color. La opacidad final la aplica el volumen
 * (`opacity` en `loadVolumes`), no el colormap: así F4 puede ajustarla sin
 * recrear la LUT.
 */
function makeSingleColorColormap(hex: string): SingleColorColormap {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return {
    R: [r, r],
    G: [g, g],
    B: [b, b],
    // Alfa 0 en el fondo (vóxel 0) y 255 en la máscara (vóxel 1): así el
    // tejido no segmentado es transparente y no tiñe todo el volumen.
    A: [0, 255],
    I: [0, 255],
    min: 0,
    max: 1,
    labels: ['background', 'mask'],
  }
}

/** Clave de un preset de cámara 3D. */
export type View3DCameraPreset =
  | 'Anterior'
  | 'Posterior'
  | 'Izquierda'
  | 'Derecha'
  | 'Superior'
  | 'Personalizado'

/** Preferencias de vista 3D: única fuente de verdad en React (App.tsx). */
export interface View3DPrefs {
  cameraPreset: View3DCameraPreset
  azimuth: number
  elevation: number
  clipPlaneEnabled: boolean
  clipPlaneDepth: number
  clipPlaneAzi: number
  clipPlaneElev: number
  orientCube: boolean
  illumination: number
  gradientOpacity: number
  renderOverlayBlend: number
  masksOnly3d: boolean
  ctOpacitySaved: number
}

/**
 * Presets de cámara 3D: azimut y elevación en grados.
 *
 * NOTA: estos valores son una tabla de PARTIDA. No se han podido verificar
 * empíricamente con el cubo de orientación ni con anatomía real en este
 * entorno (no hay navegador disponible). Deben confirmarse con un estudio
 * real rotando hasta que la cara del cubo coincida con la vista anatómica y
 * leyendo `scene.renderAzimuth` / `scene.renderElevation`, en convención
 * neurológica y radiológica (tecla R de F5). Documentar la tabla final en
 * PLAN §7 y en este comentario.
 */
export const CAMERA_PRESETS: Record<Exclude<View3DCameraPreset, 'Personalizado'>, [number, number]> = {
  Anterior: [0, 0],
  Posterior: [180, 0],
  Izquierda: [-90, 0],
  Derecha: [90, 0],
  Superior: [0, 90],
}

/** Valor por defecto de `setClipPlane` para desactivar el recorte (>. 2.0). */
const CLIP_PLANE_OFF_DEPTH = 2.5

/** Preferencias 3D por defecto. */
export const DEFAULT_VIEW_3D: View3DPrefs = {
  cameraPreset: 'Anterior',
  azimuth: CAMERA_PRESETS.Anterior[0],
  elevation: CAMERA_PRESETS.Anterior[1],
  clipPlaneEnabled: false,
  clipPlaneDepth: 0,
  clipPlaneAzi: 0,
  clipPlaneElev: 0,
  orientCube: true, // activado por defecto en 3D
  illumination: 0.6, // valor de partida; ajustar con estudios reales
  gradientOpacity: 0.4, // valor de partida; ajustar con estudios reales
  renderOverlayBlend: 0.5, // mezcla CT + overlays en 3D
  masksOnly3d: false,
  ctOpacitySaved: 1,
}

/**
 * Hook que encapsula una única instancia de NiiVue.
 *
 * Responsabilidades:
 * - Crear la instancia, adjuntarla a un canvas e inicializar WebGL2.
 * - Cargar los volúmenes de un estudio (CT base + máscaras disponibles).
 * - Cambiar el modo de vista SIN recargar volúmenes.
 * - Leer la posición del crosshair (mm, vóxel, HU, nombre de capa).
 * - Liberar los volúmenes al cambiar de estudio y al desmontar (StrictMode).
 *
 * Reglas de ciclo de vida (regla 08 + AGENTS.md):
 * - La instancia de NiiVue se crea UNA sola vez por canvas y se guarda en
 *   un useRef. No se usa hasta que attachToCanvas + init hayan terminado
 *   (await a ensureInitialized).
 * - clearVolumes() solo vacía los volúmenes (no destruye la instancia ni
 *   el canvas), para que al cambiar de estudio se liberen los volúmenes
 *   previos antes de cargar los nuevos sin invalidar la instancia.
 * - La destrucción real de la instancia (anular nvRef/canvasRef) solo
 *   ocurre en el cleanup del effect de este hook, al desmontar el
 *   componente (StrictMode: tras el doble montaje queda UNA sola
 *   instancia válida attachada al canvas actual).
 * - Cualquier carga espera a la inicialización; solo el último estudio
 *   solicitado termina pintándose (latestStudyRef descarta cargas
 *   obsoletas).
 */
export function useNiivue() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const nvRef = useRef<Niivue | null>(null)
  const readyRef = useRef(false)
  const webgl2Ref = useRef<boolean>(detectWebGL2())
  const latestStudyRef = useRef<string | null>(null)
  // Token incremental: cada llamada a loadStudy obtiene un token único. Las cargas
  // obsoletas (estudio cambiado mientras se descargaba) se descartan sin tocar el
  // estado del estudio vigente.
  const loadStudyTokenRef = useRef(0)
  // Cola de cargas: `loadVolumes` no es reentrante (muta volúmenes y
  // texturas GL), así que las cargas se encadenan en serie.
  const loadPromiseRef = useRef<Promise<void>>(Promise.resolve())

  // Firmas de los últimos ajustes visuales aplicados. Evitan repetir trabajo
  // justo después de cargar un estudio, cuando el efecto de sincronización
  // vuelve a pedir los mismos valores.
  const lastVisualKeysRef = useRef<AppliedVisualKeys | null>(null)

  // Promesa de la inicialización en curso (attachToCanvas + init).
  const initPromiseRef = useRef<Promise<void> | null>(null)
  // Instancia inicializada y canvas al que está ligada. `ready` indica que
  // hay volúmenes pintados; `initialized` solo que attachToCanvas + init
  // terminaron. Son cosas distintas: un fallo de red deja ready=false pero
  // la instancia sigue siendo válida para reintentar.
  const initializedRef = useRef(false)
  const attachedCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [location, setLocation] = useState<CrosshairLocation | null>(null)

  /**
   * Lleva el crosshair a una posición en mm de mundo (F6: «Centrar en lesión»).
   *
   * Secuencia y por qué (verificado en el código de NiiVue 0.47.0):
   * - `mm2frac(mm, 0, true)` usa el affine real (`matRAS`), el mismo sistema
   *   con el que `createOnLocationChange` calcula los mm que se muestran. Sin
   *   `force=true` se usaría `frac2mmOrtho` (rotación a cero) y en volúmenes
   *   oblicuos el cruce caería en otro vóxel.
   * - `scene.crosshairPos` es el estado vivo del crosshair (`get scene()`), así
   *   que basta asignarlo; `createOnLocationChange()` refresca la lectura y
   *   `drawScene()` repinta 2D/MPR/3D. No se recargan volúmenes.
   * - Sin volúmenes cargados, `mm2frac` caería a `sceneExtentsMinMax` y daría
   *   una fracción incorrecta, así que se sale sin tocar nada.
   */
  const centerOnLesion = useCallback((mm: [number, number, number]) => {
    const nv = nvRef.current
    if (!nv || nv.volumes.length === 0) return false
    if (!mm.every((value) => Number.isFinite(value))) return false
    const frac = nv.mm2frac(mm, 0, true)
    // Margen de seguridad ante errores de coma flotante en el borde.
    for (let axis = 0; axis < 3; axis++) {
      frac[axis] = Math.min(1, Math.max(0, frac[axis]))
    }
    nv.scene.crosshairPos = frac
    nv.createOnLocationChange()
    nv.drawScene()
    return true
  }, [])

  /** Vacia todos los volúmenes de la instancia actual sin destruir el canvas ni la instancia. */
  const clearVolumes = useCallback(() => {
    const nv = nvRef.current
    if (!nv) return
    // Vaciar de atrás hacia adelante para no invalidar índices.
    while (nv.volumes.length > 0) {
      nv.removeVolumeByIndex(nv.volumes.length - 1)
    }
    readyRef.current = false
    lastVisualKeysRef.current = null
    setReady(false)
    setLocation(null)
  }, [])

  /** Libera todo lo ligado a NiiVue (solo en cleanup del effect / desmontaje). */
  const destroyInstance = useCallback(() => {
    clearVolumes()
    nvRef.current = null
    attachedCanvasRef.current = null
    initializedRef.current = false
    initPromiseRef.current = null
    // No existe destroy()/dispose() en la API pública de NiiVue 0.47.0.
    // Soltar las referencias para que el GC pueda recuperar WebGL resources.
    // No se toca canvasRef: el ref del canvas lo gestiona React.
  }, [clearVolumes])

  /** Expresión regular de color hex válido (#rrggbb). */
  const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

  /**
   * Valida el campo color de una capa de tipo máscara.
   * Lanza un error explícito que indica qué capa y qué campo son inválidos.
   */
  const validarColorMask = useCallback(
    (color: string | null, layerKey: string, layerLabel: string): string => {
      if (!color) {
        throw new Error(
          `Capa '${layerKey}' (${layerLabel}): campo 'color' es obligatorio para capas de tipo máscara.`,
        )
      }
      if (!HEX_COLOR_RE.test(color)) {
        throw new Error(
          `Capa '${layerKey}' (${layerLabel}): campo 'color' inválido: '${color}'. Se espera formato #rrggbb.`,
        )
      }
      return color
    },
    [],
  )

  /** Construye las opciones de carga para cada capa del estudio. */
  const buildVolumeOptions = useCallback(
    (layers: LayerInfo[]) => {
      const ctLayer = layers.find((l) => l.kind === 'base')
      const ctUrl = ctLayer?.url ?? null

      const opts: VolumeOptions[] = []

      if (ctUrl) {
        // Capa base: escala de grises + ventana pulmonar. Se pasa name con extensión
        // .nii.gz para que NiiVue.getFileExt() no falle al leer la extensión.
        opts.push({
          url: ctUrl,
          name: 'ct.nii.gz',
          colormap: 'gray',
          opacity: DEFAULT_OPACITY.ct,
          cal_min: CT_CAL_MIN,
          cal_max: CT_CAL_MAX,
          trustCalMinMax: true,
          ignoreZeroVoxels: false,
          colorbarVisible: false,
        })
      }

      for (const layer of layers) {
        if (layer.kind !== 'mask') continue
        if (!layer.url) continue
        // Validar color antes de construir el colormap: falla explícito si es inválido.
        validarColorMask(layer.color, layer.key, layer.label)
        const opacity = defaultOpacity(layer.key)
        opts.push({
          url: layer.url,
          // name con extensión para que NiiVue.getFileExt() obtenga una extensión válida.
          name: `${layer.key}.nii.gz`,
          colormap: `ls_${layer.key}`,
          opacity,
          trustCalMinMax: false,
          ignoreZeroVoxels: true,
          colorbarVisible: false,
        })
      }

      return { ctUrl, opts }
    },
    [validarColorMask],
  )

  /**
   * Aplica visibilidad, opacidad, color de máscara y ventana de la CT sobre
   * los volúmenes YA cargados (regla 11: sin peticiones ni recargas).
   *
   * Localiza cada volumen por su `name` (`<key>.nii.gz`), nunca por su
   * índice en el array. Si solo cambian las máscaras, rehornea la textura de
   * overlays y no toca la CT; si cambia la CT (ventana u opacidad) hace un
   * `updateGLVolume()` completo. Si los ajustes no han cambiado desde la
   * última aplicación no hace nada.
   */
  const applyVisualSettings = useCallback(
    (
      layers: LayerInfo[],
      settings: Record<string, LayerVisualSettings>,
      ctWindow: CtWindow,
    ) => {
      const nv = nvRef.current
      if (!nv || nv.volumes.length === 0) return

      const desired = computeVisualKeys(layers, settings, ctWindow)
      const previous = lastVisualKeysRef.current
      const baseChanged = previous?.base !== desired.base
      const masksChanged = previous?.masks !== desired.masks
      if (!baseChanged && !masksChanged) return

      const { calMin, calMax } = windowToRange(ctWindow)

      try {
        for (const layer of layers) {
          const vol = nv.volumes.find((v) => v.name === `${layer.key}.nii.gz`)
          if (!vol) continue

          const s = settings[layer.key]
          if (layer.kind === 'base') {
            if (!baseChanged) continue
            vol.opacity =
              s?.visible === false ? 0 : (s?.opacity ?? defaultOpacity(layer.key))
            // NiiVue lee cal_min/cal_max al reconstruir la textura de la CT.
            vol.cal_min = calMin
            vol.cal_max = calMax
            continue
          }

          if (layer.kind !== 'mask' || !masksChanged) continue

          // Ocultar = opacidad 0 sobre el volumen ya cargado (NiiVue no
          // expone `visible` para NVImage en 0.47.0). Se aplica también al
          // render 3D, que compone los overlays en una textura RGBA.
          vol.opacity =
            s?.visible === false ? 0 : (s?.opacity ?? defaultOpacity(layer.key))

          const hex = s?.color ?? layer.color
          if (hex) {
            validarColorMask(hex, layer.key, layer.label)
            const colormapKey = `ls_${layer.key}_${hex.slice(1)}`
            nv.addColormap(colormapKey, makeSingleColorColormap(hex))
            vol.setColormap(colormapKey)
          }
        }

        if (baseChanged) {
          nv.updateGLVolume()
        } else {
          rebakeOverlays(nv)
        }
        lastVisualKeysRef.current = desired
      } catch (err) {
        // Nunca propagar rutas ni cabeceras al cliente: solo el objeto real
        // de error en consola.
        console.error('[niivue] no se pudieron aplicar los ajustes de capas:', err)
      }
    },
    [validarColorMask],
  )

  /**
   * Garantiza que exista una instancia NiiVue inicializada (attachToCanvas +
   * init resueltos) attachada al canvas actual. La crea si es necesario.
   * Devuelve la instancia lista para usar.
   */
  const ensureInitialized = useCallback(async (): Promise<Niivue> => {
    const c = canvasRef.current
    if (!c) {
      const msg = 'Canvas no disponible para inicializar el visor.'
      setError(msg)
      throw new Error(msg)
    }

    // La instancia solo se reutiliza si está inicializada y sigue ligada al
    // canvas que hay en el DOM. Si el canvas se reemplazó (p. ej. al
    // remontarse el visor), se sueltan las referencias de la anterior y se
    // crea una nueva sobre el canvas actual.
    if (nvRef.current && attachedCanvasRef.current !== c) {
      nvRef.current = null
      initializedRef.current = false
      readyRef.current = false
      initPromiseRef.current = null
      lastVisualKeysRef.current = null
    }

    const nv = nvRef.current
    if (nv && initializedRef.current) return nv

    // Si ya hay una inicialización en curso, esperar a que termine.
    if (initPromiseRef.current) {
      await initPromiseRef.current
      const nv2 = nvRef.current
      if (!nv2 || !initializedRef.current) {
        throw new Error(errorMsgRef.current ?? 'Error inicializando el visor.')
      }
      return nv2
    }

    // Crear nueva instancia.
    const newNv = new Niivue({
      crosshairColor: [1, 0, 0, 1], // crosshair rojo
      isRadiologicalConvention: false, // convención neurológica por defecto
      isCornerOrientationText: true, // letras de orientación visibles
      // En modo RENDER el crosshair solo se dibuja con esta opción activa
      // (`show3Dcrosshair` vale false por defecto en 0.47.0). F6 lo necesita
      // para que «Centrar en lesión» se vea también en 3D.
      show3Dcrosshair: true,
      backColor: [0.039, 0.047, 0.078, 1], // #0a0c14 (fondo del visor)
      // Se desactiva el hotkey `V` de NiiVue para que el cambio de vista sea
      // siempre gestionado por React (useHotkeys) y nunca discrepe del
      // selector de vista. `C` (plano de corte) se deja como está (F7).
      viewModeHotKey: '',
    })
    nvRef.current = newNv

    const initPromise = new Promise<void>((resolve, reject) => {
      newNv.attachToCanvas(c, true)
        .then(() => newNv.init())
        .then(() => {
          // Callback de posición del crosshair.
          newNv.onLocationChange = (loc: unknown) => {
            const l = loc as NiiVueLocation
            if (!l || !l.values) return

            // Valor HU del volumen base (CT) bajo el cursor.
            const ctValue = l.values.find(
              (v) => volumeLayerKey(v.name) === 'ct',
            )
            const hu = ctValue ? ctValue.value : null

            // Capa de máscara bajo el cursor: la primera cuyo valor no sea 0,
            // con prioridad para la lesión (F6: el cruce sobre tejido dañado
            // debe leerse como «lesion», no como la primera máscara cargada).
            const masks = l.values.filter((v: NiiVueLocationValue) => {
              const key = volumeLayerKey(v.name)
              return key !== null && key !== 'ct'
            })
            const activeMask =
              masks.find(
                (v: NiiVueLocationValue) =>
                  volumeLayerKey(v.name) === 'lesion' && v.value !== 0,
              ) ?? masks.find((v: NiiVueLocationValue) => v.value !== 0)
            const layerName = activeMask
              ? volumeLayerKey(activeMask.name)
              : null

            setLocation({
              mm: [l.mm[0], l.mm[1], l.mm[2]],
              // `l.vox` sigue la convención de NiiVue (`frac2vox`: índice en
              // espacio RAS, con los ejes que NiiVue invierte al cargar). En
              // estos estudios sale espejado en x/y frente al índice nativo de
              // nibabel; la posición fiable es `mm` (ver HANDOFF §4).
              vox: [l.vox[0], l.vox[1], l.vox[2]],
              hu,
              layerName,
            })
          }
          readyRef.current = true
          initializedRef.current = true
          attachedCanvasRef.current = c
          setReady(true)
          setError(null)
          resolve()
        })
        .catch((err) => {
          readyRef.current = false
          initializedRef.current = false
          attachedCanvasRef.current = null
          nvRef.current = null
          initPromiseRef.current = null
          setReady(false)
          const msg = 'No se pudo inicializar el visor NiiVue.'
          console.error('[niivue] NiiVue init failed:', err)
          errorMsgRef.current = msg
          setError(msg)
          reject(new Error(msg))
        })
    })
    initPromiseRef.current = initPromise

    await initPromise
    const nv3 = nvRef.current
    if (!nv3 || !initializedRef.current) {
      throw new Error(errorMsgRef.current ?? 'Error inicializando el visor.')
    }
    return nv3
  }, [canvasRef])

  // Ref mutable para leer el último mensaje de error sin depender del
  // cierre del useCallback (evita stale closure en ensureInitialized).
  const errorMsgRef = useRef<string | null>(null)

  /**
   * Carga (o recarga) los volúmenes de un estudio.
   *
   * Las cargas se serializan: `loadVolumes` muta `volumes` y las texturas GL,
   * así que dos cargas concurrentes (cambio rápido de estudio) podían dejar
   * volúmenes de dos estudios mezclados. Además, una carga obsoleta que aún
   * no había empezado se descarta sin descargar nada.
   */
  const loadStudy = useCallback(
    async (
      studyId: string,
      layers: LayerInfo[],
      visuals?: {
        settings: Record<string, LayerVisualSettings>
        ctWindow: CtWindow
      },
    ) => {
      const myToken = ++loadStudyTokenRef.current
      latestStudyRef.current = studyId

      const run = (async () => {
        // Esperar a la carga anterior (si la hay) antes de tocar NiiVue.
        await loadPromiseRef.current.catch(() => {})
        if (loadStudyTokenRef.current !== myToken) return

        let nv: Niivue
        try {
          nv = await ensureInitialized()
        } catch (err) {
          // ensureInitialized ya seteó el error descriptivo en el estado.
          console.error('[niivue] loadStudy: inicialización falló:', err)
          return
        }
        if (loadStudyTokenRef.current !== myToken) return

        // Liberar los volúmenes del estudio anterior antes de cargar los nuevos.
        clearVolumes()

        setError(null)
        try {
          // buildVolumeOptions valida los colores de las máscaras; si falla,
          // se captura aquí con un mensaje explícito de capa y campo.
          const { ctUrl, opts } = buildVolumeOptions(layers)

          if (!ctUrl) {
            setError(null)
            setReady(false)
            return
          }

          // Registrar los colormaps ANTES de loadVolumes: NiiVue resuelve el
          // nombre del colormap al construir cada volumen y avisa si no existe.
          // El color ya está validado por buildVolumeOptions (no es null aquí).
          for (const layer of layers) {
            if (layer.kind !== 'mask') continue
            if (!layer.url) continue
            nv.addColormap(`ls_${layer.key}`, makeSingleColorColormap(layer.color!))
          }

          await nv.loadVolumes(opts)

          // Si llegó un estudio más reciente, descartar sin tocar el estado.
          // Al estar serializado, la siguiente carga vaciará estos volúmenes
          // antes de añadir los suyos.
          if (loadStudyTokenRef.current !== myToken) return

          // `loadVolumes` ya deja aplicados el color y la opacidad indicados en
          // las opciones; esta firma representa ese estado recién horneado.
          lastVisualKeysRef.current = loadedVisualKeys(layers)

          // Aplicar los ajustes vigentes antes de retirar la superposición de
          // carga: al cambiar de estudio se conservan visibilidad, opacidad,
          // color y ventana sin que se vea un fotograma con los valores por
          // defecto. Si coinciden con los de carga no se rehace nada.
          if (visuals) {
            applyVisualSettings(layers, visuals.settings, visuals.ctWindow)
          }

          readyRef.current = true
          setReady(true)
        } catch (err) {
          if (loadStudyTokenRef.current !== myToken) return
          const isNetwork =
            err instanceof Error && /failed to fetch|404|network/i.test(err.message)
          const msg = isNetwork
            ? 'No se pudo descargar el archivo NIfTI.'
            : err instanceof Error
              ? err.message
              : 'Error cargando el estudio.'
          console.error('[niivue] loadVolumes failed:', err)
          errorMsgRef.current = msg
          setError(msg)
          setReady(false)
        }
      })()

      loadPromiseRef.current = run.catch(() => {})
      await run
    },
    [applyVisualSettings, buildVolumeOptions, clearVolumes, ensureInitialized],
  )

  /** Cambia el modo de vista sin recargar volúmenes. */
  const setViewMode = useCallback((mode: ViewMode) => {
    const nv = nvRef.current
    if (!nv) return
    nv.setSliceType(VIEW_MODE_TO_SLICE_TYPE[mode])
  }, [])

  useEffect(() => {
    // La instancia se inicializa de forma perezosa al cargar el primer
    // estudio (loadStudy → ensureInitialized). Este efecto solo libera los
    // volúmenes y las referencias al desmontar. No se inicializa aquí para
    // no chocar con el doble montaje de StrictMode ni con el remontaje del
    // canvas.
    return () => {
      destroyInstance()
    }
  }, [destroyInstance])

  /** Cambia la convención radiológica/neurológica y redibuja. */
  const setRadiologicalConvention = useCallback((v: boolean) => {
    const nv = nvRef.current
    if (nv) {
      nv.setRadiologicalConvention(v)
      nv.drawScene()
    }
  }, [])

  /** Lee la convención actual de NiiVue. */
  const getRadiologicalConvention = useCallback((): boolean => {
    const nv = nvRef.current
    return nv ? nv.getRadiologicalConvention() : false
  }, [])

  /** Lee el estado actual de cámara y clip plane de NiiVue. */
  const read3dState = useCallback((): {
    azimuth: number
    elevation: number
    clipPlane: number[] | null
  } => {
    const nv = nvRef.current
    if (!nv) return { azimuth: 0, elevation: 0, clipPlane: null }
    const scene = nv.scene
    return {
      azimuth: scene.renderAzimuth,
      elevation: scene.renderElevation,
      clipPlane: scene.clipPlane ? [...scene.clipPlane] : null,
    }
  }, [])

  /**
   * Aplica las preferencias 3D a la instancia viva de NiiVue (regla 11: sin
   * recargar volúmenes).
   *
   * - Cámara: `setRenderAzimuthElevation(azimuth, elevation)`.
   * - Cubo de orientación: `opts.isOrientCube`.
   * - Plano de corte: `setClipPlane([depth, azimuth, elevation])`. Si el
   *   recorte está desactivado se usa una profundidad > 2.0 (lo desactiva
   *   según el .d.ts).
   * - Calidad: `setVolumeRenderIllumination(illumination)` y
   *   `setGradientOpacity(gradientOpacity, renderSilhouette)`.
   * - Mezcla CT + overlays: `opts.renderOverlayBlend`.
   * - «Solo segmentaciones en 3D»: opacidad de la CT a 0 solo en modo 3D
   *   puro (RENDER); se guarda la opacidad previa para restaurarla al salir.
   */
  const apply3d = useCallback(
    (prefs: View3DPrefs): void => {
      const nv = nvRef.current
      if (!nv) return

      // Cámara 3D.
      nv.setRenderAzimuthElevation(prefs.azimuth, prefs.elevation)

      // Cubo de orientación.
      nv.opts.isOrientCube = prefs.orientCube

      // Plano de corte.
      if (prefs.clipPlaneEnabled) {
        nv.setClipPlane([prefs.clipPlaneDepth, prefs.clipPlaneAzi, prefs.clipPlaneElev])
      } else {
        nv.setClipPlane([CLIP_PLANE_OFF_DEPTH, 0, 0])
      }

      // Calidad de render (iluminación y opacidad por gradiente son async).
      void nv.setVolumeRenderIllumination(prefs.illumination)
      void nv.setGradientOpacity(prefs.gradientOpacity, 0)

      // Mezcla de overlays en 3D.
      nv.opts.renderOverlayBlend = prefs.renderOverlayBlend

      nv.drawScene()
    },
    [],
  )

  /**
   * Registra listeners para sincronizar los cambios hechos con el ratón
   * (arrastrar en 3D, mover plano de corte) con el estado React. Devuelve una
   * función de desuscripción.
   */
  const on3dChange = useCallback(
    (cb: (state: { azimuth: number; elevation: number; clipPlane: number[] | null }) => void) => {
      const nv = nvRef.current
      if (!nv) return () => {}

      const onAzimuthElevation = (event: CustomEvent) => {
        const d = event.detail as { azimuth: number; elevation: number }
        cb({ azimuth: d.azimuth, elevation: d.elevation, clipPlane: null })
      }
      const onClipPlane = (event: CustomEvent) => {
        const d = event.detail as { clipPlane: number[] }
        cb({ azimuth: 0, elevation: 0, clipPlane: d.clipPlane })
      }

      nv.addEventListener('azimuthElevationChange', onAzimuthElevation)
      nv.addEventListener('clipPlaneChange', onClipPlane)

      return () => {
        nv.removeEventListener('azimuthElevationChange', onAzimuthElevation)
        nv.removeEventListener('clipPlaneChange', onClipPlane)
      }
    },
    [],
  )

  return {
    canvasRef,
    nv: nvRef.current,
    ready,
    error,
    webgl2: webgl2Ref.current,
    location,
    loadStudy,
    applyVisualSettings,
    setViewMode,
    setRadiologicalConvention,
    getRadiologicalConvention,
    centerOnLesion,
    clearVolumes,
    destroyInstance,
    apply3d,
    read3dState,
    on3dChange,
  }
}
