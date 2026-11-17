import { useCallback, useEffect, useMemo, useState } from 'react'

import { useStudy } from './hooks/useStudy'
import { useStudies } from './hooks/useStudies'
import NiiViewer from './components/NiiViewer'
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

  // El estudio seleccionado se deriva durante el render: el elegido por el
  // usuario, o el primero de la lista, o null si no hay lista todavía.
  // No hay useEffect que copie listas o props a estado (evita bucles).
  const selectedStudyId = useMemo(
    () => userSelectedId ?? studies[0]?.id ?? null,
    [userSelectedId, studies],
  )

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

  // Al cambiar de estudio, cargar su detalle (GET /api/studies/{id}).
  useEffect(() => {
    if (!selectedStudyId) return
    void loadStudy(selectedStudyId)
  }, [selectedStudyId, loadStudy])

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
            study={study}
            viewMode={viewMode}
            layerSettings={layerSettings}
            ctWindow={ctWindow}
          />
        </ErrorBoundary>

        {/* Selector de vista inferior. */}
        <ViewerToolbar viewMode={viewMode} onViewModeChange={setViewMode} />
      </main>
    </div>
  )
}
