import type { Metrics } from '../api/types'

export interface MetricsCardProps {
  className?: string
  metrics: Metrics | null
  loading: boolean
  error: string | null
  /** Hay un estudio seleccionado (aunque sus métricas aún no hayan llegado). */
  hasStudy: boolean
  onRetry: () => void
}

const SECTION_STYLE = {
  padding: '12px 16px',
  borderBottom: '1px solid var(--ls-border)',
}

const TITLE_STYLE = {
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: 'var(--ls-text-muted)',
  margin: '0 0 10px',
}

const NOTE_STYLE = {
  fontSize: 11,
  lineHeight: 1.5,
  color: 'var(--ls-text-muted)',
  margin: '8px 0 0',
}

const CELL_STYLE = {
  background: 'var(--ls-surface-elev)',
  border: '1px solid var(--ls-border)',
  borderRadius: 'var(--ls-radius)',
  padding: '10px 12px',
}

const CELL_LABEL_STYLE = {
  fontSize: 11,
  color: 'var(--ls-text-muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  marginBottom: 4,
}

/** Valor ausente o `null` → «—». Un 0 real del backend sí se muestra como 0. */
function liters(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(2)} L`
    : '—'
}

function percent(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(1)} %`
    : '—'
}

function integer(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(Math.round(value))
    : '—'
}

/**
 * Tarjeta de métricas con los datos reales de GET /api/studies/{id}/metrics.
 *
 * Todos los valores vienen de la API: no hay cifras simuladas ni insignia
 * «datos de ejemplo». Los `null` (dato que el backend no tiene) se muestran
 * como «—», nunca como 0; un 0 del backend sí es un 0 (estudio sin lesión).
 *
 * El mensaje de error es fijo: el detalle del servidor no se muestra para no
 * filtrar rutas ni nombres de archivo (regla 04).
 */
export function MetricsCard({
  className = '',
  metrics,
  loading,
  error,
  hasStudy,
  onRetry,
}: MetricsCardProps) {
  const hasLesion = metrics !== null && metrics.lesion_components > 0
  const cells = [
    {
      label: 'Pulmón derecho',
      value: liters(metrics?.lung_right_l),
      color: 'var(--ls-text)',
      title: 'Volumen del pulmón derecho segmentado',
    },
    {
      label: 'Pulmón izquierdo',
      value: liters(metrics?.lung_left_l),
      color: 'var(--ls-text)',
      title: 'Volumen del pulmón izquierdo segmentado',
    },
    {
      label: 'Tejido dañado',
      value: liters(metrics?.lesion_l),
      color: 'var(--ls-layer-lesion)',
      title: 'Volumen de las opacidades segmentadas (máscara del modelo)',
    },
    {
      label: '% de lesión sobre pulmón',
      value: percent(metrics?.lesion_pct_of_lung),
      color: 'var(--ls-text)',
      title:
        '% de volumen de tejido dañado sobre el volumen pulmonar segmentado',
    },
  ]

  return (
    <section
      className={className}
      style={SECTION_STYLE}
      aria-labelledby="ls-metrics-title"
    >
      <h2 id="ls-metrics-title" style={TITLE_STYLE}>
        Métricas
      </h2>

      {error ? (
        <div
          role="alert"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: 13, color: 'var(--ls-text)', margin: 0 }}>
            No se pudieron cargar las métricas del estudio.
          </p>
          <button
            type="button"
            className="ls-focusable"
            onClick={onRetry}
            style={{
              padding: '6px 12px',
              fontSize: 12.5,
              fontWeight: 500,
              border: '1px solid var(--ls-accent)',
              borderRadius: 'var(--ls-radius)',
              background: 'transparent',
              color: 'var(--ls-text)',
              cursor: 'pointer',
            }}
          >
            Reintentar
          </button>
        </div>
      ) : loading ? (
        <div role="status" aria-live="polite">
          <p style={{ fontSize: 13, color: 'var(--ls-text)', margin: 0 }}>
            Calculando métricas…
          </p>
          <p style={{ ...NOTE_STYLE, marginTop: 4 }}>
            La primera vez puede tardar unos segundos.
          </p>
        </div>
      ) : !hasStudy ? (
        <p style={{ fontSize: 12.5, color: 'var(--ls-text-muted)', margin: 0 }}>
          Selecciona un estudio para ver sus métricas.
        </p>
      ) : (
        <>
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
              margin: 0,
            }}
          >
            {cells.map((cell) => (
              <div key={cell.label} title={cell.title} style={CELL_STYLE}>
                <dt style={CELL_LABEL_STYLE}>{cell.label}</dt>
                <dd
                  style={{
                    margin: 0,
                    fontSize: 15,
                    fontWeight: 600,
                    color: cell.color,
                  }}
                >
                  {cell.value}
                </dd>
              </div>
            ))}
          </dl>

          {hasLesion ? (
            <p
              style={{
                ...NOTE_STYLE,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                alignItems: 'baseline',
              }}
            >
              <span>Focos: {integer(metrics?.lesion_components)}</span>
              <span aria-hidden="true">·</span>
              <span>Derecho {percent(metrics?.lesion_by_lung_pct.right)}</span>
              <span aria-hidden="true">·</span>
              <span>Izquierdo {percent(metrics?.lesion_by_lung_pct.left)}</span>
            </p>
          ) : (
            <p style={{ ...NOTE_STYLE, color: 'var(--ls-text)' }}>
              Este estudio no tiene lesión segmentada.
            </p>
          )}

          <p style={NOTE_STYLE}>
            El % se calcula sobre el volumen pulmonar segmentado. Estimación de
            un modelo experimental.
          </p>
        </>
      )}
    </section>
  )
}

export default MetricsCard
