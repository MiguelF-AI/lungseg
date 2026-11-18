import LayerPanel from './LayerPanel'
import MetricsCard from './MetricsCard'
import StudyPicker from './StudyPicker'
import type { Metrics, StudyDetail } from '../api/types'
import type { CtWindow, LayerVisualSettings } from '../layers'

export function Sidebar({
  className = '',
  onStudySelect,
  study,
  studyLoading,
  studyError,
  onRetryStudy,
  layerSettings,
  onLayerChange,
  ctWindow,
  onCtWindowChange,
  metrics,
  metricsLoading,
  metricsError,
  onRetryMetrics,
  onCenterLesion,
  canCenterLesion,
}: {
  className?: string
  onStudySelect: (id: string) => void
  study: StudyDetail | null
  studyLoading: boolean
  studyError: string | null
  onRetryStudy: () => void
  layerSettings: Record<string, LayerVisualSettings>
  onLayerChange: (key: string, patch: Partial<LayerVisualSettings>) => void
  ctWindow: CtWindow
  onCtWindowChange: (window: CtWindow) => void
  metrics: Metrics | null
  metricsLoading: boolean
  metricsError: string | null
  onRetryMetrics: () => void
  onCenterLesion: () => void
  canCenterLesion: boolean
}) {
  const centerHint =
    study === null
      ? 'Selecciona un estudio para centrar en la lesión.'
      : metricsError
        ? 'No se pudieron cargar las métricas del estudio.'
        : metrics === null
          ? 'Cargando las métricas del estudio…'
          : metrics.lesion_components === 0
            ? 'Este estudio no tiene lesión segmentada.'
            : 'El visor aún no está listo.'

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
      <StudyPicker onSelect={onStudySelect} />

      {/* Capas: los ajustes viven en App y se conservan al cambiar de estudio. */}
      <LayerPanel
        study={study}
        loading={studyLoading}
        error={studyError}
        onRetry={onRetryStudy}
        layerSettings={layerSettings}
        onLayerChange={onLayerChange}
        ctWindow={ctWindow}
        onCtWindowChange={onCtWindowChange}
      />

      {/* Métricas */}
      <MetricsCard
        metrics={metrics}
        loading={metricsLoading}
        error={metricsError}
        hasStudy={study !== null}
        onRetry={onRetryMetrics}
      />

      {/* Acciones */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--ls-border)' }}>
        <div style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ls-text-muted)', marginBottom: 8 }}>
          Acciones
        </div>
        <button
          type="button"
          className="ls-focusable"
          disabled={!canCenterLesion}
          aria-label="Centrar en lesión"
          aria-describedby={
            canCenterLesion ? undefined : 'ls-center-lesion-hint'
          }
          onClick={onCenterLesion}
          style={{
            width: '100%',
            padding: '10px',
            marginBottom: 8,
            border: canCenterLesion
              ? '1px solid var(--ls-accent)'
              : '1px solid var(--ls-disabled-text)',
            borderRadius: 'var(--ls-radius)',
            background: canCenterLesion
              ? 'var(--ls-accent)'
              : 'var(--ls-disabled-bg)',
            color: canCenterLesion ? '#ffffff' : 'var(--ls-disabled-text)',
            fontSize: 13,
            fontWeight: 500,
            cursor: canCenterLesion ? 'pointer' : 'not-allowed',
            outline: 'none',
          }}
        >
          Centrar en lesión
        </button>
        {!canCenterLesion && (
          <p
            id="ls-center-lesion-hint"
            style={{
              fontSize: 11,
              lineHeight: 1.5,
              color: 'var(--ls-text-muted)',
              margin: '0 0 8px',
            }}
          >
            {centerHint}
          </p>
        )}
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
