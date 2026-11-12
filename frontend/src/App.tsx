import { useCallback, useEffect, useMemo, useState } from 'react'

import { useStudy } from './hooks/useStudy'
import { useStudies } from './hooks/useStudies'
import NiiViewer from './components/NiiViewer'
import Sidebar from './components/Sidebar'
import ErrorBoundary from './components/ErrorBoundary'
import ViewerToolbar from './components/ViewerToolbar'
import type { ViewMode } from './hooks/useNiivue'

export default function App() {
  const [userSelectedId, setUserSelectedId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('Multi')

  const { studies } = useStudies()
  const { study, refetch: loadStudy } = useStudy()

  // El estudio seleccionado se deriva durante el render: el elegido por el
  // usuario, o el primero de la lista, o null si no hay lista todavía.
  // No hay useEffect que copie listas o props a estado (evita bucles).
  const selectedStudyId = useMemo(
    () => userSelectedId ?? studies[0]?.id ?? null,
    [userSelectedId, studies],
  )

  const handleStudySelect = useCallback((id: string) => {
    setUserSelectedId(id)
  }, [])

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
        selectedStudyId={selectedStudyId}
        onStudySelect={handleStudySelect}
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
          <NiiViewer study={study} viewMode={viewMode} />
        </ErrorBoundary>

        {/* Selector de vista inferior. */}
        <ViewerToolbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      </main>
    </div>
  )
}
