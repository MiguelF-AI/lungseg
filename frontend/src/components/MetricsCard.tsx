import type { Metrics } from '../api/types'

export interface MetricsCardProps {
  className?: string
  metrics?: Metrics | null
}

/**
 * Tarjeta de métricas.
 *
 * Hasta F6 (ticket B3 + F6) no hay endpoint de métricas real, así que se
 * muestran datos simulados con una marca clara "datos de ejemplo" en
 * pantalla. Cuando se pasen métricas reales (useMetrics en F6), se usan
 * esas en su lugar.
 */
export function MetricsCard({
  className = '',
  metrics,
}: MetricsCardProps) {
  const simulated = metrics === null || metrics === undefined

  const m = simulated
    ? {
        lungRight: '2.1 L',
        lungLeft: '1.8 L',
        lungTotal: '3.9 L',
        lesion: '0.12 L',
        lesionPct: '3.1 %',
      }
    : {
        lungRight: `${metrics?.lung_right_l?.toFixed(2) ?? '—'} L`,
        lungLeft: `${metrics?.lung_left_l?.toFixed(2) ?? '—'} L`,
        lungTotal: `${metrics?.lung_total_l?.toFixed(2) ?? '—'} L`,
        lesion: `${metrics?.lesion_l?.toFixed(2) ?? '—'} L`,
        lesionPct: `${metrics?.lesion_pct_of_lung?.toFixed(2) ?? '—'} %`,
      }

  return (
    <section
      className={className}
      style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--ls-border)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--ls-text-muted)',
          marginBottom: 10,
        }}
      >
        Métricas
        {simulated && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.06em',
              padding: '1px 6px',
              borderRadius: 'var(--ls-radius)',
              background: 'rgba(108, 92, 231, 0.15)',
              color: 'var(--ls-accent)',
              border: '1px solid rgba(108, 92, 231, 0.35)',
              whiteSpace: 'nowrap',
            }}
          >
            datos de ejemplo
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div
          style={{
            background: 'var(--ls-surface-elev)',
            border: '1px solid var(--ls-border)',
            borderRadius: 'var(--ls-radius)',
            padding: '10px 12px',
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--ls-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Pulmón derecho
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ls-text)' }}>{m.lungRight}</div>
        </div>
        <div
          style={{
            background: 'var(--ls-surface-elev)',
            border: '1px solid var(--ls-border)',
            borderRadius: 'var(--ls-radius)',
            padding: '10px 12px',
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--ls-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Pulmón izquierdo
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ls-text)' }}>{m.lungLeft}</div>
        </div>
        <div
          style={{
            background: 'var(--ls-surface-elev)',
            border: '1px solid var(--ls-border)',
            borderRadius: 'var(--ls-radius)',
            padding: '10px 12px',
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--ls-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Lesión (tejido dañado)
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ls-layer-lesion)' }}>{m.lesion}</div>
        </div>
        <div
          style={{
            background: 'var(--ls-surface-elev)',
            border: '1px solid var(--ls-border)',
            borderRadius: 'var(--ls-radius)',
            padding: '10px 12px',
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--ls-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            % de lesión sobre pulmón
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ls-text)' }}>{m.lesionPct}</div>
        </div>
      </div>
    </section>
  )
}

export default MetricsCard
