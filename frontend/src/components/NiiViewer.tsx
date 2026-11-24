import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

import type { StudyDetail } from '../api/types'
import { useNiivue, type ViewMode, type View3DPrefs } from '../hooks/useNiivue'
import type { CtWindow, LayerVisualSettings } from '../layers'

/** Color de la insignia de capa en la lectura de posición (por clave de capa). */
const LAYER_BADGE_COLORS: Record<string, string> = {
  lesion: 'var(--ls-layer-lesion)',
  lung_right: '#4169e1',
  lung_left: '#3cb371',
}

/** Props del visor. */
export interface NiiViewerProps {
  study: StudyDetail | null
  viewMode: ViewMode
  layerSettings: Record<string, LayerVisualSettings>
  ctWindow: CtWindow
  /** Convención radiológica (true = radiológica, false = neurológica). */
  radiological?: boolean
  /** Preferencias de vista 3D (única fuente de verdad en App). */
  view3d: View3DPrefs
  /** Sincroniza cambios hechos con el ratón en NiiVue con el estado de App. */
  on3dChange?: (state: {
    azimuth: number
    elevation: number
    clipPlane: number[] | null
  }) => void
  /** Avisa de si el visor tiene volúmenes pintados (para habilitar acciones). */
  onReadyChange?: (ready: boolean) => void
}

/** Funciones que el visor expone al padre (sin desmontar ni remontar nada). */
export interface NiiViewerHandle {
  /** Lleva el crosshair a una posición en mm de mundo. `false` si no puede. */
  centerOnLesion: (mm: [number, number, number]) => boolean
  /** Cambia la convención radiológica/neurológica y redibuja. */
  setRadiologicalConvention: (v: boolean) => void
  /** Lee la convención actual de NiiVue. */
  getRadiologicalConvention: () => boolean
  /** Guarda la escena actual como PNG (sin cambiar la escena ni recargar volúmenes). */
  captureView: (filename: string) => Promise<boolean>
}

/**
 * Visor NiiVue para LungSeg.
 *
 * Recibe un StudyDetail (ya tipado en F2), el modo de vista actual y los
 * ajustes visuales de las capas (estado único en App). Monta una única
 * instancia de NiiVue sobre un único canvas, carga la CT base y las máscaras
 * disponibles del estudio, sincroniza visibilidad/opacidad/color/ventana con
 * los volúmenes ya cargados (sin recargarlos) y expone la lectura de posición
 * del crosshair en una esquina del visor.
 *
 * El canvas se renderiza SIEMPRE (mientras haya WebGL2): los estados de
 * "Selecciona un estudio", "sin tomografía", carga y error son superposiciones.
 * Así el canvas no se desmonta al cambiar de estudio y la instancia de NiiVue
 * sigue ligada al mismo elemento.
 *
 * Hacia el padre expone `centerOnLesion` por ref (botón «Centrar en lesión»)
 * y avisa de si hay volúmenes listos con `onReadyChange`; ninguno de los dos
 * remonta el canvas ni recarga volúmenes (regla 16).
 *
 * Casos de React gestionados:
 *  - StrictMode monta/desmonta dos veces en dev: la instancia NiiVue se
 *    crea una sola vez por canvas y se reutiliza.
 *  - Cambio rápido de estudio: solo el último estudio solicitado termina
 *    pintándose; se liberan los volúmenes del estudio anterior primero.
 *  - Estados visibles de carga y error con botón "Reintentar".
 *  - Estudio sin CT: aviso claro sin lanzar errores en consola.
 *  - WebGL2 no disponible: aviso con instrucciones en lugar de pantalla negra.
 */
export const NiiViewer = forwardRef<NiiViewerHandle, NiiViewerProps>(function NiiViewer(
  {
    study,
    viewMode,
    layerSettings,
    ctWindow,
    radiological,
    view3d,
    on3dChange: on3dChangeProp,
    onReadyChange,
  },
  ref,
) {
  const retryCountRef = useRef(0)
  const {
    canvasRef,
    ready,
    error,
    webgl2,
    location,
    nv,
    loadStudy,
    applyVisualSettings,
    setViewMode,
    setRadiologicalConvention,
    getRadiologicalConvention,
    captureView,
    centerOnLesion,
    applyCamera,
    applyClipPlane,
    applyQuality,
    consumeIgnoreCameraApply,
    consumeIgnoreClipApply,
    on3dChange: use3dChange,
  } = useNiivue()

  // El padre solo necesita la función, no la instancia de NiiVue.
  useImperativeHandle(
    ref,
    () => ({
      centerOnLesion,
      setRadiologicalConvention,
      getRadiologicalConvention,
      captureView,
    }),
    [centerOnLesion, setRadiologicalConvention, getRadiologicalConvention, captureView],
  )

  // Informar al padre de si hay volúmenes listos (sistema externo → padre).
  useEffect(() => {
    onReadyChange?.(ready)
  }, [ready, onReadyChange])

  const [retrying, setRetrying] = useState(false)

  const hasCt = study?.layers.some((l) => l.key === 'ct') ?? false

  // Últimos ajustes disponibles para la carga en curso: el efecto que carga
  // el estudio no debe depender de ellos (recargaría volúmenes al mover un
  // slider); solo se leen en el momento de cargar.
  const visualsRef = useRef({ settings: layerSettings, ctWindow })
  useEffect(() => {
    visualsRef.current = { settings: layerSettings, ctWindow }
  }, [layerSettings, ctWindow])

  /**
   * Reintentar: reejecuta la inicialización si la instancia se perdió y la
   * carga del estudio actual. loadStudy espera a ensureInitialized antes de
   * cargar volúmenes.
   */
  const retry = useCallback(() => {
    setRetrying(true)
    retryCountRef.current = (retryCountRef.current || 0) + 1
    if (study) {
      void loadStudy(study.id, study.layers, visualsRef.current)
    }
    setRetrying(false)
  }, [study, loadStudy])

  // Al cambiar de estudio, liberar los volúmenes del anterior y cargar el nuevo.
  // loadStudy internamente llama a clearVolumes() antes de cargar, así que no
  // hace falta destruir la instancia aquí.
  useEffect(() => {
    if (!study) {
      setRetrying(false)
      return
    }
    if (!hasCt) {
      // Estudio sin CT: no cargar volúmenes, solo mostrar aviso.
      return
    }
    void loadStudy(study.id, study.layers, visualsRef.current)
  }, [study, hasCt, loadStudy])

  // Sincronizar los ajustes de capas con NiiVue. Es un efecto hacia un
  // sistema externo (no copia props a estado): al mover un slider o pulsar
  // el ojo se modifican los volúmenes ya cargados, sin peticiones.
  useEffect(() => {
    if (!study || !ready) return
    applyVisualSettings(study.layers, layerSettings, ctWindow)
  }, [study, ready, layerSettings, ctWindow, applyVisualSettings])

  // Aplicar el modo de vista cuando cambie (sin recargar volúmenes).
  useEffect(() => {
    if (ready) {
      setViewMode(viewMode)
    }
  }, [ready, viewMode, setViewMode])

  // Aplicar la convención radiológica cuando cambie (sin recargar volúmenes).
  useEffect(() => {
    if (nv && ready) {
      setRadiologicalConvention(radiological ?? false)
      nv.drawScene()
    }
  }, [nv, ready, radiological, setRadiologicalConvention])

  // Cámara 3D: solo setRenderAzimuthElevation (barato). Se dispara cuando
  // cambia azimuth/elevation desde la UI (preset o slider custom). Cuando el
  // usuario arrastra con el ratón, on3dChange marca consumeIgnoreCameraApply
  // y el efecto salta la aplicación (NiiVue ya aplicó el cambio con el arrastre).
  useEffect(() => {
    if (!ready) return
    if (consumeIgnoreCameraApply()) return
    applyCamera(view3d.azimuth, view3d.elevation)
  }, [view3d.azimuth, view3d.elevation, ready, applyCamera, consumeIgnoreCameraApply])

  // Plano de corte al visor (regla 11: sin recargar volúmenes).
  useEffect(() => {
    if (!ready) return
    if (consumeIgnoreClipApply()) return
    applyClipPlane(view3d)
  }, [
    view3d.clipPlaneEnabled,
    view3d.clipPlaneDepth,
    view3d.clipPlaneAzi,
    view3d.clipPlaneElev,
    ready,
    applyClipPlane,
    consumeIgnoreClipApply,
  ])

  // Calidad de render 3D (iluminación, opacidad por gradiente, mezcla,
  // cubo): operaciones costosas (async), solo cuando cambian los sliders de
  // calidad, nunca en cada frame de arrastre de cámara (regla 11).
  useEffect(() => {
    if (!ready) return
    applyQuality(view3d)
  }, [
    view3d.illumination,
    view3d.gradientOpacity,
    view3d.renderOverlayBlend,
    view3d.orientCube,
    ready,
    applyQuality,
  ])

  // Sincronizar cambios hechos con el ratón en NiiVue (arrastrar cámara,
  // mover plano de corte) con el estado de App. Sistema externo → estado;
  // no es props → estado (regla 14).
  useEffect(() => {
    if (!nv || !on3dChangeProp) return
    const unsubscribe = use3dChange((state) => {
      on3dChangeProp(state)
    })
    return unsubscribe
  }, [nv, use3dChange, on3dChangeProp])

  if (!webgl2) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--ls-text)',
          background: 'var(--ls-bg)',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>
          WebGL2 no disponible
        </div>
        <p style={{ fontSize: 13, color: 'var(--ls-text-muted)', maxWidth: 420, lineHeight: 1.5 }}>
          Tu navegador o tarjeta gráfica no tiene WebGL2 activado. Para usar el
          visor, activa la «aceleración por hardware» en la configuración de
          Chrome/Edge y recarga la página.
        </p>
      </div>
    )
  }

  const overlay = (() => {
    if (!study) {
      return (
        <div style={{ fontSize: 15, color: 'var(--ls-text-muted)' }}>
          Selecciona un estudio
        </div>
      )
    }

    if (!hasCt) {
      return (
        <>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>
            Este estudio no tiene tomografía original
          </div>
          <p style={{ fontSize: 13, color: 'var(--ls-text-muted)', maxWidth: 420, lineHeight: 1.5 }}>
            Copia <code>{study.id}.nii</code> (o <code>{study.id}.nii.gz</code>) en
            la carpeta <code>Data/</code> y reinicia la API para activar el visor de cortes.
          </p>
        </>
      )
    }

    if (error) {
      return (
        <>
          <div style={{ fontSize: 15, fontWeight: 700, maxWidth: 420, lineHeight: 1.5 }}>
            No se pudo cargar el visor
          </div>
          <p style={{ fontSize: 13, color: 'var(--ls-text-muted)', maxWidth: 420, lineHeight: 1.5 }}>
            {error}
          </p>
          <button
            type="button"
            className="ls-focusable"
            disabled={retrying}
            onClick={retry}
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 500,
              border: '1px solid var(--ls-accent)',
              borderRadius: 'var(--ls-radius)',
              background: retrying ? 'var(--ls-surface-elev)' : 'var(--ls-accent)',
              color: '#ffffff',
              cursor: retrying ? 'not-allowed' : 'pointer',
            }}
          >
            {retrying ? 'Reintentando…' : 'Reintentar'}
          </button>
        </>
      )
    }

    if (!ready) {
      return <div style={{ fontSize: 13, color: 'var(--ls-text-muted)' }}>Cargando tomografía…</div>
    }

    return null
  })()

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'var(--ls-bg)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Canvas único de NiiVue: no se desmonta al cambiar de estudio. */}
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          background: '#0a0c14',
        }}
      />

      {overlay && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: 24,
            gap: 10,
            color: 'var(--ls-text)',
            background: 'var(--ls-bg)',
          }}
        >
          {overlay}
        </div>
      )}

      {/* Lectura de posición: esquina superior derecha del visor. */}
      {ready && location && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            pointerEvents: 'none',
            background: 'rgba(10, 12, 20, 0.75)',
            border: '1px solid var(--ls-border)',
            borderRadius: 'var(--ls-radius)',
            padding: '6px 10px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 12,
            color: 'var(--ls-text)',
            zIndex: 10,
            backdropFilter: 'blur(4px)',
          }}
        >
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <span style={{ color: 'var(--ls-text-muted)' }}>x</span>
            <span style={{ color: '#6c5ce7' }}>{location.mm[0].toFixed(1)} mm</span>
            <span style={{ color: 'var(--ls-text-muted)' }}>y</span>
            <span style={{ color: '#6c5ce7' }}>{location.mm[1].toFixed(1)} mm</span>
            <span style={{ color: 'var(--ls-text-muted)' }}>z</span>
            <span style={{ color: '#6c5ce7' }}>{location.mm[2].toFixed(1)} mm</span>
            {location.hu != null && (
              <>
                <span style={{ color: 'var(--ls-text-muted)' }}>·</span>
                <span style={{ color: 'var(--ls-text-muted)' }}>HU</span>
                <span style={{ color: '#ff2a2a' }}>{location.hu.toFixed(0)}</span>
              </>
            )}
            {location.layerName && (
              <>
                <span style={{ color: 'var(--ls-text-muted)' }}>·</span>
                <span style={{ color: 'var(--ls-text-muted)' }}>capa</span>
                <span
                  style={{
                    color:
                      LAYER_BADGE_COLORS[location.layerName] ??
                      'var(--ls-text)',
                    fontWeight: 600,
                  }}
                >
                  {location.layerName}
                </span>
              </>
            )}
          </div>
          <div style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ls-text-muted)' }}>
            {location.vox[0].toFixed(0)}, {location.vox[1].toFixed(0)}, {location.vox[2].toFixed(0)} vóxel
          </div>
        </div>
      )}
    </div>
  )
})

export default NiiViewer
