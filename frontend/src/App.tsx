import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useStudy } from './hooks/useStudy'
import { useStudies } from './hooks/useStudies'
import { useMetrics } from './hooks/useMetrics'
import NiiViewer, { type NiiViewerHandle } from './components/NiiViewer'
import Sidebar from './components/Sidebar'
import ErrorBoundary from './components/ErrorBoundary'
import ViewerToolbar from './components/ViewerToolbar'
import type { ViewMode } from './hooks/useNiivue'
import {
  DEFAULT_CT_WINDOW,
  defaultLayerSettings,
  type CtWindow,
  type LayerVisualSettings,
} from './layers'

export default function App() {
  const [userSelectedId, setUserSelectedId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('Multi')

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
            onReadyChange={handleViewerReadyChange}
          />
        </ErrorBoundary>

        {/* Selector de vista inferior. */}
        <ViewerToolbar viewMode={viewMode} onViewModeChange={setViewMode} />
      </main>
    </div>
  )
}
