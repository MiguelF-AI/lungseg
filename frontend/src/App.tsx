import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useStudy } from './hooks/useStudy'
import { useStudies } from './hooks/useStudies'
import { useMetrics } from './hooks/useMetrics'
import { useHotkeys } from './hooks/useHotkeys'
import NiiViewer, { type NiiViewerHandle } from './components/NiiViewer'
import Sidebar from './components/Sidebar'
import ErrorBoundary from './components/ErrorBoundary'
import ViewerToolbar from './components/ViewerToolbar'
import HelpDialog from './components/HelpDialog'
import { moveStudyIndex } from './nav'
import {
  CAMERA_PRESETS,
  DEFAULT_VIEW_3D,
  type ViewMode,
  type View3DPrefs,
  type View3DCameraPreset,
} from './hooks/useNiivue'

/** Orden de los modos de vista (coincide con ViewerToolbar). */
const VIEW_MODES: ViewMode[] = ['Multi', 'Axial', 'Coronal', 'Sagital', '3D']
import {
  DEFAULT_CT_WINDOW,
  defaultLayerSettings,
  type CtWindow,
  type LayerVisualSettings,
} from './layers'

export default function App() {
  const [userSelectedId, setUserSelectedId] = useState<string | null>(null)
  // Vista elegida y convención radiológica: se recuerdan en localStorage con
  // validación (si no es válido: Multi y neurológica). Se aplican al arrancar
  // con initializers lazy → sin parpadeo visible.
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const raw = localStorage.getItem('lungseg.viewMode')
      if (raw == null) return 'Multi'
      const m = raw as ViewMode
      return VIEW_MODES.includes(m) ? m : 'Multi'
    } catch {
      return 'Multi'
    }
  })
  const [radiological, setRadiological] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('lungseg.radiological')
      if (raw == null) return false
      return raw === 'true'
    } catch {
      return false
    }
  })

  // Anuncio breve para la región aria-live (feedback de atajos).
  const [announce, setAnnounce] = useState('')
  const onAnnounce = useCallback((message: string) => {
    // Vaciar y volver a setear para forzar el anuncio de aria-live incluso si
    // el mensaje se repite.
    setAnnounce('')
    setTimeout(() => setAnnounce(message), 0)
  }, [])

  // Persistir la vista elegida y la convención en localStorage (sin romper si
  // el storage no está disponible).
  useEffect(() => {
    try {
      localStorage.setItem('lungseg.viewMode', viewMode)
    } catch {
      // storage no disponible: no romper nada.
    }
  }, [viewMode])

  // Única fuente de verdad de los ajustes de capas y de la ventana de la CT.
  // Solo se guardan los cambios del usuario; los valores por defecto se
  // derivan durante el render a partir de StudyDetail.layers (nunca se
  // copian props a estado con un useEffect). Como este estado no se reinicia
  // al cambiar de estudio, los ajustes se conservan y se reaplican a los
  // volúmenes nuevos.
  const [layerOverrides, setLayerOverrides] = useState<
    Record<string, Partial<LayerVisualSettings>>
  >({})
  const [ctWindow, setCtWindow] = useState<CtWindow>(DEFAULT_CT_WINDOW)

  // Preferencias de vista 3D: única fuente de verdad en React. Se conservan
  // al cambiar de estudio (como layerOverrides); la cámara vuelve a
  // «Anterior» aplicando el preset sobre el nuevo estudio sin recargar
  // volúmenes (regla 11).
  const [view3d, setView3d] = useState<View3DPrefs>(DEFAULT_VIEW_3D)

  const { studies } = useStudies()
  const {
    study,
    loading: studyLoading,
    error: studyError,
    refetch: loadStudy,
  } = useStudy()

  // Métricas del estudio y referencia al visor (botón «Centrar en lesión»).
  // Las cifras se derivan en el render y solo se muestran si pertenecen al
  // estudio seleccionado; el hook puede tener las de otro estudio mientras
  // llega la respuesta nueva. No hay efectos que copien props a estado.
  const {
    studyId: metricsStudyId,
    metrics: loadedMetrics,
    loading: metricsRequestLoading,
    error: metricsRequestError,
    refetch: refetchMetrics,
  } = useMetrics()
  const [viewerReady, setViewerReady] = useState(false)
  const viewerRef = useRef<NiiViewerHandle | null>(null)

  // El estudio seleccionado se deriva durante el render: el elegido por el
  // usuario, o el primero de la lista, o null si no hay lista todavía.
  // No hay useEffect que copie listas o props a estado (evita bucles).
  const selectedStudyId = useMemo(
    () => userSelectedId ?? studies[0]?.id ?? null,
    [userSelectedId, studies],
  )

  // Métricas visibles: solo las del estudio seleccionado. Mientras el hook
  // tiene el estudio anterior (o ninguna respuesta), la tarjeta está en carga
  // si hay estudio, así que nunca se mezclan cifras de dos estudios.
  const metricsAreCurrent =
    metricsStudyId !== null && metricsStudyId === selectedStudyId
  const metrics = metricsAreCurrent ? loadedMetrics : null
  const metricsLoading = metricsAreCurrent
    ? metricsRequestLoading
    : selectedStudyId !== null
  const metricsError = metricsAreCurrent ? metricsRequestError : null

  // Ajustes efectivos del estudio actual: defaults del contrato + cambios
  // del usuario. Se memoiza para que NiiViewer reciba una referencia estable
  // y su efecto de sincronización no se dispare en cada render.
  const layerSettings = useMemo(() => {
    const result: Record<string, LayerVisualSettings> = {}
    for (const layer of study?.layers ?? []) {
      result[layer.key] = {
        ...defaultLayerSettings(layer),
        ...layerOverrides[layer.key],
      }
    }
    return result
  }, [study, layerOverrides])

  const handleStudySelect = useCallback((id: string) => {
    setUserSelectedId(id)
  }, [])

  const handleLayerChange = useCallback(
    (key: string, patch: Partial<LayerVisualSettings>) => {
      setLayerOverrides((prev) => ({
        ...prev,
        [key]: { ...prev[key], ...patch },
      }))
    },
    [],
  )

  const handleCtWindowChange = useCallback((next: CtWindow) => {
    setCtWindow(next)
  }, [])

  // --- Preferencias 3D -----------------------------------------------------

  /** Aplica un preset de cámara y sale del modo «Personalizado». */
  const handleCameraPreset = useCallback((preset: Exclude<View3DCameraPreset, 'Personalizado'>) => {
    const [azimuth, elevation] = CAMERA_PRESETS[preset]
    setView3d((prev) => ({
      ...prev,
      cameraPreset: preset,
      azimuth,
      elevation,
    }))
  }, [])

  /** Marca la cámara como «Personalizado» cuando el usuario arrastra con el ratón. */
  const handleCameraCustom = useCallback((azimuth: number, elevation: number) => {
    setView3d((prev) => ({
      ...prev,
      cameraPreset: 'Personalizado',
      azimuth,
      elevation,
    }))
  }, [])

  const handleClipPlaneToggle = useCallback(() => {
    setView3d((prev) => ({ ...prev, clipPlaneEnabled: !prev.clipPlaneEnabled }))
  }, [])

  const handleClipPlaneDepthChange = useCallback((depth: number) => {
    setView3d((prev) => ({ ...prev, clipPlaneEnabled: true, clipPlaneDepth: depth }))
  }, [])

  const handleClipPlaneAlign = useCallback(() => {
    setView3d((prev) => ({
      ...prev,
      clipPlaneEnabled: true,
      clipPlaneAzi: prev.azimuth,
      clipPlaneElev: prev.elevation,
    }))
  }, [])

  const handleOrientCubeToggle = useCallback(() => {
    setView3d((prev) => ({ ...prev, orientCube: !prev.orientCube }))
  }, [])

  const handleIlluminationChange = useCallback((value: number) => {
    setView3d((prev) => ({ ...prev, illumination: value }))
  }, [])

  const handleGradientOpacityChange = useCallback((value: number) => {
    setView3d((prev) => ({ ...prev, gradientOpacity: value }))
  }, [])

  const handleRenderOverlayBlendChange = useCallback((value: number) => {
    setView3d((prev) => ({ ...prev, renderOverlayBlend: value }))
  }, [])

  const handleMasksOnly3dToggle = useCallback(() => {
    setView3d((prev) => ({ ...prev, masksOnly3d: !prev.masksOnly3d }))
  }, [])

  /** Restablece los valores por defecto de la vista 3D (cámara = Anterior). */
  const handleReset3d = useCallback(() => {
    setView3d(DEFAULT_VIEW_3D)
  }, [])

  const handleRetryStudy = useCallback(() => {
    if (selectedStudyId) {
      void loadStudy(selectedStudyId)
    }
  }, [selectedStudyId, loadStudy])

  const handleRetryMetrics = useCallback(() => {
    if (selectedStudyId) {
      void refetchMetrics(selectedStudyId)
    }
  }, [selectedStudyId, refetchMetrics])

  // «Centrar en lesión» usa `lesion_focus_mm` (punto garantizado dentro de la
  // lesión), no el centroide global, que puede caer fuera. El visor mueve el
  // crosshair de la instancia viva: no recarga volúmenes (regla 16).
  const handleCenterLesion = useCallback(() => {
    const focus = metrics?.lesion_focus_mm
    if (!focus || focus.length !== 3) return
    const [x, y, z] = focus
    if (![x, y, z].every((value) => Number.isFinite(value))) return
    viewerRef.current?.centerOnLesion([x, y, z])
  }, [metrics])

  // Alternar visibilidad de la capa de lesión (solo si existe).
  const handleToggleLesion = useCallback(() => {
    const exists = study?.layers.some((l) => l.key === 'lesion') ?? false
    if (!exists) return
    const visible = layerSettings.lesion?.visible ?? true
    handleLayerChange('lesion', { visible: !visible })
  }, [study, layerSettings, handleLayerChange])

  // Mostrar/ocultar ambos pulmones: si alguno está visible, oculta ambos;
  // si no, muestra ambos. Ignora si no existe ninguna capa de pulmón.
  const handleToggleLungs = useCallback(() => {
    const lungKeys = ['lung_right', 'lung_left']
    const exists = study?.layers.some((l) => lungKeys.includes(l.key)) ?? false
    if (!exists) return
    const rightVisible = layerSettings.lung_right?.visible ?? true
    const leftVisible = layerSettings.lung_left?.visible ?? true
    const next = !(rightVisible || leftVisible)
    handleLayerChange('lung_right', { visible: next })
    handleLayerChange('lung_left', { visible: next })
  }, [study, layerSettings, handleLayerChange])

  // Alternar convención radiológica y redibujar en la instancia viva.
  const handleToggleRadiological = useCallback(() => {
    const next = !radiological
    setRadiological(next)
    try {
      localStorage.setItem('lungseg.radiological', String(next))
    } catch {
      // storage no disponible: no romper nada.
    }
    viewerRef.current?.setRadiologicalConvention(next)
  }, [radiological, setRadiological])

  // Estudio anterior/siguiente con la misma lógica que ◀ ▶.
  const handlePrevStudy = useCallback(() => {
    if (!studies.length) return
    const current = studies.findIndex((s) => s.id === selectedStudyId)
    const next = moveStudyIndex(studies, current >= 0 ? current : 0, -1)
    setUserSelectedId(studies[next].id)
  }, [studies, selectedStudyId])

  const handleNextStudy = useCallback(() => {
    if (!studies.length) return
    const current = studies.findIndex((s) => s.id === selectedStudyId)
    const next = moveStudyIndex(studies, current >= 0 ? current : 0, 1)
    setUserSelectedId(studies[next].id)
  }, [studies, selectedStudyId])

  const currentStudyIdx = studies.findIndex((s) => s.id === selectedStudyId)
  const studyIndex = currentStudyIdx >= 0 ? currentStudyIdx + 1 : 1
  const studyCount = studies.length

  const handleViewerReadyChange = useCallback((ready: boolean) => {
    setViewerReady(ready)
  }, [])

  // Habilitado solo con lesión segmentada del estudio actual y visor listo
  // (con `study` cargado, para no mover el cruce del estudio anterior).
  const canCenterLesion =
    study !== null && metrics?.lesion_focus_mm != null && viewerReady

  // Al cambiar de estudio, cargar su detalle (GET /api/studies/{id}).
  useEffect(() => {
    if (!selectedStudyId) return
    void loadStudy(selectedStudyId)
  }, [selectedStudyId, loadStudy])

  // Al cambiar de estudio, pedir sus métricas (GET /api/studies/{id}/metrics).
  useEffect(() => {
    if (!selectedStudyId) return
    void refetchMetrics(selectedStudyId)
  }, [selectedStudyId, refetchMetrics])

  // Al cambiar de estudio, la cámara vuelve a «Anterior». Las demás
  // preferencias (corte, cubo, iluminación, …) se conservan (como F4).
  useEffect(() => {
    if (!selectedStudyId) return
    const [azimuth, elevation] = CAMERA_PRESETS.Anterior
    setView3d((prev) => ({
      ...prev,
      cameraPreset: 'Anterior',
      azimuth,
      elevation,
    }))
  }, [selectedStudyId])

  // Sincroniza cambios hechos con el ratón en NiiVue (arrastrar cámara,
  // mover plano de corte) con el estado React. Sistema externo → estado;
  // no es props → estado (regla 14).
  const handle3dChange = useCallback(
    (state: { azimuth: number; elevation: number; clipPlane: number[] | null }) => {
      const cp = state.clipPlane
      if (cp) {
        setView3d((prev) => ({
          ...prev,
          clipPlaneEnabled: true,
          clipPlaneDepth: cp[0],
          clipPlaneAzi: cp[1],
          clipPlaneElev: cp[2],
        }))
      } else {
        handleCameraCustom(state.azimuth, state.elevation)
      }
    },
    [handleCameraCustom],
  )

  // Estado del modal de ayuda.
  const [helpOpen, setHelpOpen] = useState(false)

  // Atajos de teclado: registrados UNA sola vez (no en cada render).
  useHotkeys({
    onViewModeChange: setViewMode,
    onCenterLesion: handleCenterLesion,
    onToggleLesion: handleToggleLesion,
    onToggleLungs: handleToggleLungs,
    onToggleRadiological: handleToggleRadiological,
    onToggleClipPlane: handleClipPlaneToggle,
    onPrevStudy: handlePrevStudy,
    onNextStudy: handleNextStudy,
    onToggleHelp: () => setHelpOpen(true),
    onCloseHelp: () => setHelpOpen(false),
    helpOpen,
    canCenterLesion,
    clipPlaneEnabled: view3d.clipPlaneEnabled,
    lesionVisible: !!layerSettings.lesion?.visible,
    lungsVisible:
      !!layerSettings.lung_right?.visible || !!layerSettings.lung_left?.visible,
    studyIndex,
    studyCount,
    onAnnounce,
  })

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        background: 'var(--ls-bg)',
      }}
    >
      <Sidebar
        onStudySelect={handleStudySelect}
        study={study}
        studyLoading={studyLoading}
        studyError={studyError}
        onRetryStudy={handleRetryStudy}
        layerSettings={layerSettings}
        onLayerChange={handleLayerChange}
        ctWindow={ctWindow}
        onCtWindowChange={handleCtWindowChange}
        metrics={metrics}
        metricsLoading={metricsLoading}
        metricsError={metricsError}
        onRetryMetrics={handleRetryMetrics}
        onCenterLesion={handleCenterLesion}
        canCenterLesion={canCenterLesion}
        onToggleHelp={() => setHelpOpen(true)}
        viewMode={viewMode}
        view3d={view3d}
        onCameraPreset={handleCameraPreset}
        onClipPlaneToggle={handleClipPlaneToggle}
        onClipPlaneDepthChange={handleClipPlaneDepthChange}
        onClipPlaneAlign={handleClipPlaneAlign}
        onOrientCubeToggle={handleOrientCubeToggle}
        onIlluminationChange={handleIlluminationChange}
        onGradientOpacityChange={handleGradientOpacityChange}
        onRenderOverlayBlendChange={handleRenderOverlayBlendChange}
        onMasksOnly3dToggle={handleMasksOnly3dToggle}
        onReset3d={handleReset3d}
      />

      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        {/* Visor NiiVue (F3), aislado por error boundary para no tumbar la sidebar. */}
        <ErrorBoundary>
          <NiiViewer
            ref={viewerRef}
            study={study}
            viewMode={viewMode}
            layerSettings={layerSettings}
            ctWindow={ctWindow}
            radiological={radiological}
            view3d={view3d}
            on3dChange={handle3dChange}
            onReadyChange={handleViewerReadyChange}
          />
        </ErrorBoundary>

        {/* Selector de vista inferior. */}
        <ViewerToolbar viewMode={viewMode} onViewModeChange={setViewMode} />
      </main>

      {/* Región aria-live para feedback breve de los atajos. */}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'absolute',
          left: -10000,
          width: 1,
          height: 1,
          overflow: 'hidden',
        }}
      >
        {announce}
      </div>

      {/* Modal de ayuda (? y botón «Atajos» de la sidebar). */}
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}
