import { useState } from 'react'

export interface SimLayer {
  key: string
  label: string
  color: string
  kind: 'base' | 'mask'
}

const SIM_LAYERS: SimLayer[] = [
  { key: 'ct', label: 'Tomografía', color: 'var(--ls-layer-ct)', kind: 'base' },
  { key: 'lung_right', label: 'Pulmón derecho', color: '#4169e1', kind: 'mask' },
  { key: 'lung_left', label: 'Pulmón izquierdo', color: '#3cb371', kind: 'mask' },
  { key: 'lesion', label: 'Tejido dañado', color: '#ff2a2a', kind: 'mask' },
]

// Opacidad por defecto por capa (esqueleto F1).
const DEFAULT_OPACITY: Record<string, number> = {
  ct: 1,
  lung_right: 0.25,
  lung_left: 0.25,
  lesion: 0.8,
}

export function LayerPanel({
  className = '',
}: {
  className?: string
}) {
  const [visible, setVisible] = useState<Record<string, boolean>>(
    SIM_LAYERS.reduce((acc, l) => ({ ...acc, [l.key]: true }), {})
  )
  const [opacity, setOpacity] = useState<Record<string, number>>({ ...DEFAULT_OPACITY })
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    SIM_LAYERS.reduce((acc, l) => ({ ...acc, [l.key]: false }), {})
  )

  const toggleVisibility = (key: string) => {
    setVisible((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const setOpacityFor = (key: string, value: number) => {
    setOpacity((prev) => ({ ...prev, [key]: value }))
  }

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
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
        Capas
      </div>
      {SIM_LAYERS.map((layer) => (
        <div key={layer.key} style={{ marginBottom: 12 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 6,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
              }}
              onClick={() => toggleVisibility(layer.key)}
              role="checkbox"
              aria-checked={visible[layer.key]}
              aria-label={`Visibilidad ${layer.label}`}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  toggleVisibility(layer.key)
                }
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 14,
                  height: 14,
                  borderRadius: '3px',
                  background: layer.color,
                  border: '1px solid rgba(255,255,255,0.35)',
                }}
              />
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: visible[layer.key] ? 'var(--ls-text)' : 'var(--ls-disabled-text)',
                }}
              >
                {layer.label}
              </span>
            </div>
            <button
              type="button"
              aria-label={visible[layer.key] ? `Ocultar ${layer.label}` : `Mostrar ${layer.label}`}
              onClick={() => toggleVisibility(layer.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 26,
                height: 26,
                border: '1px solid var(--ls-border)',
                borderRadius: 'var(--ls-radius)',
                background: 'transparent',
                color: visible[layer.key] ? 'var(--ls-text)' : 'var(--ls-disabled-text)',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {visible[layer.key] ? '👁' : '🙈'}
            </button>
          </div>
          {expanded[layer.key] && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'var(--ls-surface-elev)',
                border: '1px solid var(--ls-border)',
                borderRadius: 'var(--ls-radius)',
                padding: '8px 10px',
              }}
            >
              <span style={{ fontSize: 11, color: 'var(--ls-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 52 }}>
                Opacidad
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={opacity[layer.key]}
                onChange={(e) => setOpacityFor(layer.key, parseFloat(e.target.value))}
                style={{
                  flex: 1,
                  accentColor: 'var(--ls-accent)',
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--ls-text-muted)', minWidth: 32, textAlign: 'right' }}>
                {(opacity[layer.key] * 100).toFixed(0)}%
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => toggleExpanded(layer.key)}
            aria-label={expanded[layer.key] ? `Contraer controles de ${layer.label}` : `Expandir controles de ${layer.label}`}
            style={{
              marginTop: 4,
              padding: '2px 8px',
              fontSize: 11,
              border: 'none',
              background: 'transparent',
              color: 'var(--ls-accent)',
              cursor: 'pointer',
              borderRadius: 'var(--ls-radius)',
              outline: 'none',
            }}
          >
            {expanded[layer.key] ? '▲ contraer' : '▼ opacity'}
          </button>
        </div>
      ))}
      {SIM_LAYERS[0].kind === 'base' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginTop: 8,
            paddingTop: 8,
            borderTop: '1px solid var(--ls-border)',
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--ls-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 52 }}>
            Ventana (pulmón)
          </span>
          <span style={{ fontSize: 11, color: 'var(--ls-text-muted)' }}>
            Nivel −650 · ancho 1500 HU
          </span>
        </div>
      )}
    </section>
  )
}

export default LayerPanel
