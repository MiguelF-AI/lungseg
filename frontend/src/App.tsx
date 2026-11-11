import { useCallback, useEffect, useState } from 'react'

import { useStudy } from './hooks/useStudy'
import NiiViewer from './components/NiiViewer'
import Sidebar from './components/Sidebar'
import ViewerToolbar from './components/ViewerToolbar'
import type { ViewMode } from './hooks/useNiivue'

export default function App() {
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('Multi')

  const { study, refetch: loadStudy } = useStudy()

  const handleStudySelect = useCallback((id: string) => {
    setSelectedStudyId(id)
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
        {/* Visor NiiVue (F3). */}
        <NiiViewer study={study} viewMode={viewMode} />

        {/* Selector de vista inferior. */}
        <ViewerToolbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      </main>
    </div>
  )
}
