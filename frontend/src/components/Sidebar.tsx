import { useState } from 'react'

import LayerPanel from './LayerPanel'
import MetricsCard from './MetricsCard'
import StudyPicker from './StudyPicker'

export function Sidebar({
  className = '',
}: {
  className?: string
}) {
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null)

  return (
    <aside
      className={className}
      style={{
        width: 'var(--ls-sidebar-width)',
        height: '100vh',
        background: 'var(--ls-surface)',
        borderRight: '1px solid var(--ls-border)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        boxSizing: 'border-box',
      }}
    >
      {/* Marca */}
      <div
        style={{
          padding: '16px 18px',
          borderBottom: '1px solid var(--ls-border)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 6,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 34,
              height: 34,
              borderRadius: 'var(--ls-radius)',
              background: 'var(--ls-accent)',
              boxShadow: '0 0 0 2px rgba(108, 92, 231, 0.35)',
            }}
            aria-label="Icono de marca LungSeg"
          >
            🫁
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ls-text)' }}>
              LungSeg WebViewer
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ls-text-muted)' }}>
              Segmentación COVID-19 · TC de tórax
            </div>
          </div>
        </div>
      </div>

      {/* Estudio */}
      <StudyPicker onSelect={setSelectedStudyId} />

      {/* Capas */}
      <LayerPanel studyId={selectedStudyId} />

      {/* Métricas */}
      <MetricsCard metrics={null} />

      {/* Acciones */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--ls-border)' }}>
        <div style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ls-text-muted)', marginBottom: 8 }}>
          Acciones
        </div>
        <button
          type="button"
          disabled
          aria-label="Centrar en lesión (deshabilitado hasta F6)"
          style={{
            width: '100%',
            padding: '10px',
            marginBottom: 8,
            border: '1px solid var(--ls-disabled-text)',
            borderRadius: 'var(--ls-radius)',
            background: 'var(--ls-disabled-bg)',
            color: 'var(--ls-disabled-text)',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'not-allowed',
            outline: 'none',
          }}
        >
          Centrar en lesión
        </button>
        <button
          type="button"
          disabled
          aria-label="Descargar todo (deshabilitado hasta F8)"
          style={{
            width: '100%',
            padding: '10px',
            border: '1px solid var(--ls-accent)',
            borderRadius: 'var(--ls-radius)',
            background: 'var(--ls-disabled-bg)',
            color: 'var(--ls-disabled-text)',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'not-allowed',
            outline: 'none',
          }}
        >
          Descargar todo
        </button>
      </div>

      {/* Pie */}
      <div style={{ padding: '14px 16px', borderTop: '1px solid var(--ls-border)', marginTop: 'auto' }}>
        <p
          style={{
            fontSize: 11.5,
            color: 'var(--ls-text-muted)',
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          Uso académico, no es un dispositivo médico.
        </p>
      </div>
    </aside>
  )
}

export default Sidebar
