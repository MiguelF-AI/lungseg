export function MetricsCard({
  className = '',
}: {
  className?: string
}) {
  // Datos simulados (esqueleto F1). Se reemplaza por datos reales en F2/F6.
  const metrics = {
    lungRight: '2.1 L',
    lungLeft: '1.8 L',
    lungTotal: '3.9 L',
    lesion: '0.12 L',
    lesionPct: '3.1 %',
  }

  return (
    <section
      className={className}
      style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--ls-border)',
      }}
    >
      <div style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ls-text-muted)', marginBottom: 10 }}>
        Métricas
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
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ls-text)' }}>{metrics.lungRight}</div>
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
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ls-text)' }}>{metrics.lungLeft}</div>
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
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ls-layer-lesion)' }}>{metrics.lesion}</div>
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
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ls-text)' }}>{metrics.lesionPct}</div>
        </div>
      </div>
    </section>
  )
}

export default MetricsCard
