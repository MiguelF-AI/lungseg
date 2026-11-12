import { useCallback, useEffect, useRef, useState } from 'react'
import { Niivue, SLICE_TYPE, type NiiVueLocation, type NiiVueLocationValue, NVImageFromUrlOptions } from '@niivue/niivue'

/** Tipo de las opciones de carga de volumen (NVImageFromUrlOptions es una factory, no un type). */
type VolumeOptions = ReturnType<typeof NVImageFromUrlOptions>

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
const LAYER_OPACITY: Record<string, number> = {
  lung_right: 0.25,
  lung_left: 0.25,
  lesion: 0.8,
}

/** Ventana pulmonar de la CT (PLAN §7: -1400 a 100 HU). */
const CT_CAL_MIN = -1400
const CT_CAL_MAX = 100

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

  // Promesa de la inicialización en curso (attachToCanvas + init).
  const initPromiseRef = useRef<Promise<void> | null>(null)

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [location, setLocation] = useState<CrosshairLocation | null>(null)

  /** Vacia todos los volúmenes de la instancia actual sin destruir el canvas ni la instancia. */
  const clearVolumes = useCallback(() => {
    const nv = nvRef.current
    if (!nv) return
    // Vaciar de atrás hacia adelante para no invalidar índices.
    while (nv.volumes.length > 0) {
      nv.removeVolumeByIndex(nv.volumes.length - 1)
    }
    readyRef.current = false
    setReady(false)
    setLocation(null)
  }, [])

  /** Libera todo lo ligado a NiiVue (solo en cleanup del effect / desmontaje). */
  const destroyInstance = useCallback(() => {
    clearVolumes()
    nvRef.current = null
    canvasRef.current = null
    // No existe destroy()/dispose() en la API pública de NiiVue 0.47.0.
    // Soltar las referencias para que el GC pueda recuperar WebGL resources.
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
    (
      layers: {
        key: string
        label: string
        kind: string
        color: string | null
        url: string | null
      }[],
    ) => {
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
          opacity: 1,
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
        const opacity = LAYER_OPACITY[layer.key] ?? 0.5
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
   * Garantiza que exista una instancia NiiVue inicializada (attachToCanvas +
   * init resueltos) attachada al canvas actual. La crea si es necesario.
   * Devuelve la instancia lista para usar.
   */
  const ensureInitialized = useCallback(async (): Promise<Niivue> => {
    const nv = nvRef.current
    if (nv && readyRef.current) return nv

    const c = canvasRef.current
    if (!c) {
      const msg = 'Canvas no disponible para inicializar el visor.'
      setError(msg)
      throw new Error(msg)
    }

    // Si ya hay una inicialización en curso, esperar a que termine.
    if (initPromiseRef.current) {
      await initPromiseRef.current
      const nv2 = nvRef.current
      if (!nv2 || !readyRef.current) {
        throw new Error(errorMsgRef.current ?? 'Error inicializando el visor.')
      }
      return nv2
    }

    // Crear nueva instancia.
    const newNv = new Niivue({
      crosshairColor: [1, 0, 0, 1], // crosshair rojo
      isRadiologicalConvention: false, // convención neurológica por defecto
      isCornerOrientationText: true, // letras de orientación visibles
      backColor: [0.039, 0.047, 0.078, 1], // #0a0c14 (fondo del visor)
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

            // Valor HU del primer volumen (CT) bajo el cursor.
            const ctValue = l.values.find((v) => v.id === 'ct' || v.name === 'ct')
            const hu = ctValue ? ctValue.value : null

            // Nombre de la capa de máscara bajo el cursor (si no es CT).
            const maskValue = l.values.find(
              (v: NiiVueLocationValue) => (v.id || v.name) && (v.id || v.name) !== 'ct',
            )
            const layerName = maskValue ? (maskValue.name || maskValue.id || null) : null

            setLocation({
              mm: [l.mm[0], l.mm[1], l.mm[2]],
              vox: [l.vox[0], l.vox[1], l.vox[2]],
              hu,
              layerName,
            })
          }
          readyRef.current = true
          setReady(true)
          setError(null)
          resolve()
        })
        .catch((err) => {
          readyRef.current = false
          setReady(false)
          const msg = 'No se pudo inicializar el visor NiiVue.'
          console.error('[niivue] NiiVue init failed:', err)
          setError(msg)
          reject(new Error(msg))
        })
    })
    initPromiseRef.current = initPromise

    await initPromise
    const nv3 = nvRef.current
    if (!nv3 || !readyRef.current) {
      throw new Error(errorMsgRef.current ?? 'Error inicializando el visor.')
    }
    return nv3
  }, [canvasRef])

  // Ref mutable para leer el último mensaje de error sin depender del
  // cierre del useCallback (evita stale closure en ensureInitialized).
  const errorMsgRef = useRef<string | null>(null)

  /**
   * Carga (o recarga) los volúmenes de un estudio.
   * Descarta cargas obsoletas si el estudio cambió mientras se carga.
   */
  const loadStudy = useCallback(
    async (
      studyId: string,
      layers: {
        key: string
        label: string
        kind: string
        color: string | null
        url: string | null
      }[],
    ) => {
      const myToken = ++loadStudyTokenRef.current
      latestStudyRef.current = studyId

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

        // Si llegó un estudio más reciente mientras cargábamos, descartar sin tocar el vigente.
        if (loadStudyTokenRef.current !== myToken) return

        // Reaplicar por id: el name de cada volumen es `${layer.key}.nii.gz`
        // (ver buildVolumeOptions). La opacidad la controla el volumen.
        for (const layer of layers) {
          if (layer.kind !== 'mask') continue
          if (!layer.url) continue
          const vol = nv.volumes.find((v) => v.name === `${layer.key}.nii.gz`)
          if (vol) {
            nv.setColormap(vol.id, `ls_${layer.key}`)
          }
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
    },
    [buildVolumeOptions, clearVolumes, ensureInitialized],
  )

  /** Cambia el modo de vista sin recargar volúmenes. */
  const setViewMode = useCallback((mode: ViewMode) => {
    const nv = nvRef.current
    if (!nv) return
    nv.setSliceType(VIEW_MODE_TO_SLICE_TYPE[mode])
  }, [])

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return

    // Inicializar la instancia una sola vez por canvas. El efecto depende
    // de `canvasRef` (objeto estable) y de `destroyInstance`, así que corre
    // una vez por montaje; StrictMode no la recrea prematuramente.
    void ensureInitialized()

    return () => {
      destroyInstance()
    }
  }, [ensureInitialized, destroyInstance])

  return {
    canvasRef,
    nv: nvRef.current,
    ready,
    error,
    webgl2: webgl2Ref.current,
    location,
    loadStudy,
    setViewMode,
    clearVolumes,
    destroyInstance,
  }
}
