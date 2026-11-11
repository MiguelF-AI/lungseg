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

/** Colores de capa (PLAN §7, tokens.css). */
const LAYER_COLORS: Record<string, string> = {
  lung_right: '#4169e1',
  lung_left: '#3cb371',
  lesion: '#ff2a2a',
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
 * Colormap de un solo color para máscaras.
 * R/G/B constantes del color de la capa, A en el valor de opacidad,
 * I recorre de 0 a 1 para mapear la intensidad binaria (0/1).
 */
function makeSingleColorColormap(hex: string, alpha: number): SingleColorColormap {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return {
    R: [r],
    G: [g],
    B: [b],
    A: [alpha],
    I: [0, 1],
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
 * - Liberar la instancia al desmontar (StrictMode) y al cambiar de estudio.
 */
export function useNiivue() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const nvRef = useRef<Niivue | null>(null)
  const readyRef = useRef(false)
  const webgl2Ref = useRef(false)
  const latestStudyRef = useRef<string | null>(null)

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [location, setLocation] = useState<CrosshairLocation | null>(null)

  /** Limpia todos los volúmenes de la instancia actual sin destruir el canvas. */
  const clearVolumes = useCallback(() => {
    const nv = nvRef.current
    if (!nv) return
    // Vaciar de atrás hacia adelante para no invalidar índices.
    while (nv.volumes.length > 0) {
      nv.removeVolumeByIndex(nv.volumes.length - 1)
    }
    nvRef.current = null
    readyRef.current = false
    setReady(false)
    setLocation(null)
  }, [])

  /** Libera todo lo ligado a NiiVue (llamado en cleanup y cambio de estudio). */
  const cleanup = useCallback(() => {
    clearVolumes()
    // No existe destroy()/dispose() en la API pública de NiiVue 0.47.0.
    // Soltar la referencia al canvas para que el GC pueda recuperar WebGL resources.
    canvasRef.current = null
  }, [clearVolumes])

  /** Construye las opciones de carga para cada capa del estudio. */
  const buildVolumeOptions = useCallback(
    (layers: { key: string; label: string; color: string | null; url: string | null }[]) => {
      const ctLayer = layers.find((l) => l.key === 'ct')
      const ctUrl = ctLayer?.url ?? null

      const opts: VolumeOptions[] = []

      if (ctUrl) {
        opts.push({
          url: ctUrl,
          name: 'ct',
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
        if (layer.key === 'ct') continue
        if (!layer.url) continue
        const opacity = LAYER_OPACITY[layer.key] ?? 0.5
        opts.push({
          url: layer.url,
          name: layer.label,
          colormap: `ls_${layer.key}`,
          opacity,
          trustCalMinMax: false,
          ignoreZeroVoxels: true,
          colorbarVisible: false,
        })
      }

      return { ctUrl, opts }
    },
    [],
  )

  /**
   * Carga (o recarga) los volúmenes de un estudio.
   * Descarta cargas obsoletas si el estudio cambió mientras se carga.
   */
  const loadStudy = useCallback(
    async (
      studyId: string,
      layers: { key: string; label: string; color: string | null; url: string | null }[],
    ) => {
      latestStudyRef.current = studyId
      const nv = nvRef.current
      if (!nv) {
        setError('El visor no está inicializado.')
        return
      }

      clearVolumes()

      const { ctUrl, opts } = buildVolumeOptions(layers)

      if (!ctUrl) {
        setError(null)
        setReady(false)
        return
      }

      setError(null)
      try {
        await nv.loadVolumes(opts)

        // Si llegó un estudio más reciente mientras cargábamos, no pintar este.
        if (latestStudyRef.current !== studyId) {
          clearVolumes()
          return
        }

        // Registrar colormaps personalizados de un solo color para cada máscara.
        for (const layer of layers) {
          if (layer.key === 'ct') continue
          if (!layer.url) continue
          const vol = nv.volumes.find((v) => v.name === layer.label || v.url === layer.url)
          if (vol) {
            const color = layer.color ?? LAYER_COLORS[layer.key] ?? '#ffffff'
            const opacity = LAYER_OPACITY[layer.key] ?? 0.5
            const cmapKey = `ls_${layer.key}`
            nv.addColormap(cmapKey, makeSingleColorColormap(color, opacity))
            nv.setColormap(vol.id, cmapKey)
          }
        }

        readyRef.current = true
        setReady(true)
      } catch (err) {
        if (latestStudyRef.current !== studyId) return
        const msg = err instanceof Error ? err.message : 'Error cargando el estudio.'
        setError(msg)
        setReady(false)
      }
    },
    [buildVolumeOptions, clearVolumes],
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

    // Detectar WebGL2 antes de instanciar NiiVue.
    const gl2 = c.getContext('webgl2')
    if (!gl2) {
      webgl2Ref.current = false
      setError('WebGL2 no está disponible. Activa la aceleración por hardware en tu navegador.')
      setReady(false)
      return
    }
    webgl2Ref.current = true
    gl2.getExtension('WEBGL_lose_context')?.loseContext()

    const nv = new Niivue({
      crosshairColor: [1, 0, 0, 1], // crosshair rojo
      isRadiologicalConvention: false, // convención neurológica por defecto
      isCornerOrientationText: true, // letras de orientación visibles
      backColor: [0.039, 0.047, 0.078, 1], // #0a0c14 (fondo del visor)
    })

    nvRef.current = nv

    nv.attachToCanvas(c, true)
      .then(() => nv.init())
      .then(() => {
        // Callback de posición del crosshair.
        nv.onLocationChange = (loc: unknown) => {
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
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Error inicializando el visor.'
        setError(msg)
        setReady(false)
      })

    return () => {
      cleanup()
    }
  }, [cleanup])

  return {
    canvasRef,
    nv: nvRef.current,
    ready,
    error,
    webgl2: webgl2Ref.current,
    location,
    loadStudy,
    setViewMode,
    cleanup,
  }
}
