import { useEffect, useState } from 'react'

import { useStudy } from '../hooks/useStudy'
import type { LayerInfo } from '../api/types'

export interface LayerPanelProps {
  className?: string
  studyId: string | null
}

/**
 * Panel de capas con datos reales de GET /api/studies/{id}.
 *
 * Muestra solo las capas que el estudio tiene (p. ej. un estudio sin lesión
 * no muestra la fila "Tejido dañado"). Cada fila: punto de color, nombre,
 * ojo (visibilidad) y slider de opacidad al expandir.
 *
 * Estados obligatorios: carga (esqueleto) y error (mensaje + Reintentar).
 */
export function LayerPanel({
  className = '',
  studyId,
}: LayerPanelProps) {
  const { study, loading, error, refetch } = useStudy()
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const [opacity, setOpacity] = useState<Record<string, number>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // (Opcional) reintentar cuando falla la carga del estudio.
  const handleRetry = () => {
    if (studyId) {
      void refetch(studyId)
    }
  }

  const layers: LayerInfo[] = study?.layers ?? []

  // Inicializar visibilidad/opacidad de las capas disponibles.
  useEffect(() => {
    const nextVisible: Record<string, boolean> = {}
    const nextOpacity: Record<string, number> = {}
    const nextExpanded: Record<string, boolean> = {}
    const defaults: Record<string, number> = {
      ct: 1,
      lung_right: 0.25,
      lung_left: 0.25,
      lesion: 0.8,
    }
    for (const layer of layers) {
      nextVisible[layer.key] = true
      nextOpacity[layer.key] = defaults[layer.key] ?? 1
      nextExpanded[layer.key] = false
    }
    setVisible(nextVisible)
    setOpacity(nextOpacity)
    setExpanded(nextExpanded)
  }, [layers])

  const toggleVisibility = (key: string) => {
    setVisible((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const setOpacityFor = (key: string, value: number) => {
    setOpacity((prev) => ({ ...prev, [key]: value }))
  }

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  // Esqueleto de carga.
  if (loading) {
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
            fontSize: 12,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--ls-text-muted)',
            marginBottom: 10,
          }}
        >
          Capas
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 14,
                  height: 14,
                  borderRadius: '3px',
                  background: 'var(--ls-border)',
                  border: '1px solid rgba(255,255,255,0.35)',
                }}
              />
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--ls-disabled-text)',
                  background: 'var(--ls-border)',
                  borderRadius: 'var(--ls-radius)',
                  padding: '0 6px',
                }}
              >
                ‎ ‎ ‎ ‎ ‎
              </span>
            </div>
          </div>
        ))}
      </section>
    )
  }

  // Estado de error.
  if (error) {
    return (
      <section
        className={className}
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--ls-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: 12,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--ls-text-muted)',
            marginBottom: 10,
          }}
        >
          Capas
        </div>
        <div style={{ color: 'var(--ls-text)', fontSize: 13, maxWidth: 240 }}>
          No se pudieron cargar las capas del estudio.
        </div>
        <button
          type="button"
          onClick={handleRetry}
          disabled={!studyId}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 500,
            border: '1px solid var(--ls-accent)',
            borderRadius: 'var(--ls-radius)',
            background: 'transparent',
            color: 'var(--ls-accent)',
            cursor: !studyId ? 'not-allowed' : 'pointer',
            outline: 'none',
          }}
        >
          Reintentar
        </button>
      </section>
    )
  }

  // Si no hay estudio seleccionado, no mostrar capas.
  if (!studyId || layers.length === 0) {
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
            fontSize: 12,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--ls-text-muted)',
            marginBottom: 10,
          }}
        >
          Capas
        </div>
        <div style={{ color: 'var(--ls-text-muted)', fontSize: 13 }}>
          Selecciona un estudio para ver sus capas.
        </div>
      </section>
    )
  }

  // Capas reales.
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
          fontSize: 12,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--ls-text-muted)',
          marginBottom: 10,
        }}
      >
        Capas
      </div>
      {layers.map((layer) => (
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
                  background: layer.color ?? 'var(--ls-text-muted)',
                  border: '1px solid rgba(255,255,255,0.35)',
                }}
              />
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: visible[layer.key]
                    ? 'var(--ls-text)'
                    : 'var(--ls-disabled-text)',
                }}
              >
                {layer.label}
              </span>
            </div>
            <button
              type="button"
              aria-label={
                visible[layer.key] ? `Ocultar ${layer.label}` : `Mostrar ${layer.label}`
              }
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
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--ls-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  minWidth: 52,
                }}
              >
                Opacidad
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={opacity[layer.key] ?? 1}
                onChange={(e) => setOpacityFor(layer.key, parseFloat(e.target.value))}
                style={{
                  flex: 1,
                  accentColor: layer.color ?? 'var(--ls-accent)',
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--ls-text-muted)',
                  minWidth: 32,
                  textAlign: 'right',
                }}
              >
                {((opacity[layer.key] ?? 1) * 100).toFixed(0)}%
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => toggleExpanded(layer.key)}
            aria-label={
              expanded[layer.key]
                ? `Contraer controles de ${layer.label}`
                : `Expandir controles de ${layer.label}`
            }
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
      {layers.some((l) => l.kind === 'base') && (
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
          <span
            style={{
              fontSize: 11,
              color: 'var(--ls-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              minWidth: 52,
            }}
          >
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
