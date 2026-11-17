import { useState } from 'react'

import type { StudyDetail } from '../api/types'
import {
  CT_WINDOW_PRESETS,
  DEFAULT_CT_WINDOW,
  formatCtWindow,
  type CtWindow,
  type LayerVisualSettings,
} from '../layers'

export interface LayerPanelProps {
  className?: string
  study: StudyDetail | null
  loading: boolean
  error: string | null
  onRetry: () => void
  layerSettings: Record<string, LayerVisualSettings>
  onLayerChange: (key: string, patch: Partial<LayerVisualSettings>) => void
  ctWindow: CtWindow
  onCtWindowChange: (window: CtWindow) => void
}

const SECTION_TITLE_STYLE = {
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: 'var(--ls-text-muted)',
  marginBottom: 10,
}

const SECTION_STYLE = {
  padding: '12px 16px',
  borderBottom: '1px solid var(--ls-border)',
}

/**
 * Panel de capas con datos reales de GET /api/studies/{id}.
 *
 * La visibilidad, la opacidad y el color NO se guardan aquí: son props
 * (estado único en App) y se aplican sobre los volúmenes ya cargados en
 * NiiVue. Este componente solo guarda qué fila está expandida (estado de UI).
 */
export function LayerPanel({
  className = '',
  study,
  loading,
  error,
  onRetry,
  layerSettings,
  onLayerChange,
  ctWindow,
  onCtWindowChange,
}: LayerPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  // Esqueleto de carga.
  if (loading) {
    return (
      <section className={className} style={SECTION_STYLE}>
        <div style={SECTION_TITLE_STYLE}>Capas</div>
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
        style={{ ...SECTION_STYLE, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', textAlign: 'center' }}
      >
        <div style={SECTION_TITLE_STYLE}>Capas</div>
        <div style={{ color: 'var(--ls-text)', fontSize: 13, maxWidth: 240 }}>
          No se pudieron cargar las capas del estudio.
        </div>
        <button
          type="button"
          className="ls-focusable"
          onClick={onRetry}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 500,
            border: '1px solid var(--ls-accent)',
            borderRadius: 'var(--ls-radius)',
            background: 'transparent',
            color: 'var(--ls-accent)',
            cursor: 'pointer',
          }}
        >
          Reintentar
        </button>
      </section>
    )
  }

  // Sin estudio seleccionado.
  if (!study || study.layers.length === 0) {
    return (
      <section className={className} style={SECTION_STYLE}>
        <div style={SECTION_TITLE_STYLE}>Capas</div>
        <div style={{ color: 'var(--ls-text-muted)', fontSize: 13 }}>
          Selecciona un estudio para ver sus capas.
        </div>
      </section>
    )
  }

  const hasBaseLayer = study.layers.some((layer) => layer.kind === 'base')

  return (
    <section className={className} style={SECTION_STYLE}>
      <div style={SECTION_TITLE_STYLE}>Capas</div>

      {study.layers.map((layer) => {
        const settings = layerSettings[layer.key] ?? {
          visible: true,
          opacity: 1,
          color: layer.color,
        }
        const visible = settings.visible
        const opacity = settings.opacity
        const isExpanded = expanded[layer.key] ?? false
        const swatchColor = layer.color ?? '#8b90a8'

        return (
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-block',
                    width: 14,
                    height: 14,
                    borderRadius: '3px',
                    background: layer.kind === 'mask' ? settings.color ?? swatchColor : swatchColor,
                    border: '1px solid rgba(255,255,255,0.35)',
                  }}
                />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: visible ? 'var(--ls-text)' : 'var(--ls-disabled-text)',
                  }}
                >
                  {layer.label}
                </span>
              </div>
              <button
                type="button"
                className="ls-focusable"
                aria-label={visible ? `Ocultar ${layer.label}` : `Mostrar ${layer.label}`}
                aria-pressed={visible}
                onClick={() => onLayerChange(layer.key, { visible: !visible })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 26,
                  height: 26,
                  border: '1px solid var(--ls-border)',
                  borderRadius: 'var(--ls-radius)',
                  background: 'transparent',
                  color: visible ? 'var(--ls-text)' : 'var(--ls-disabled-text)',
                  cursor: 'pointer',
                }}
              >
                {visible ? '👁' : '🙈'}
              </button>
            </div>

            {isExpanded && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  background: 'var(--ls-surface-elev)',
                  border: '1px solid var(--ls-border)',
                  borderRadius: 'var(--ls-radius)',
                  padding: '8px 10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                    className="ls-focusable"
                    min="0"
                    max="1"
                    step="0.05"
                    value={opacity}
                    aria-label={`Opacidad de ${layer.label}`}
                    onChange={(e) =>
                      onLayerChange(layer.key, { opacity: parseFloat(e.target.value) })
                    }
                    style={{
                      flex: 1,
                      accentColor: layer.kind === 'mask' ? settings.color ?? swatchColor : 'var(--ls-accent)',
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
                    {(opacity * 100).toFixed(0)}%
                  </span>
                </div>

                {layer.kind === 'mask' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--ls-text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        minWidth: 52,
                      }}
                    >
                      Color
                    </span>
                    <input
                      type="color"
                      className="ls-focusable"
                      value={settings.color ?? layer.color ?? '#ffffff'}
                      aria-label={`Color de ${layer.label}`}
                      onChange={(e) => onLayerChange(layer.key, { color: e.target.value })}
                      style={{
                        width: 28,
                        height: 22,
                        padding: 0,
                        border: '1px solid var(--ls-border)',
                        borderRadius: '4px',
                        background: 'transparent',
                        cursor: 'pointer',
                      }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--ls-text-muted)' }}>
                      Tono de la máscara
                    </span>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              className="ls-focusable"
              aria-expanded={isExpanded}
              aria-label={
                isExpanded
                  ? `Contraer ajustes de ${layer.label}`
                  : `Expandir ajustes de ${layer.label}`
              }
              onClick={() => toggleExpanded(layer.key)}
              style={{
                marginTop: 4,
                padding: '2px 8px',
                fontSize: 11,
                border: 'none',
                background: 'transparent',
                color: 'var(--ls-accent)',
                cursor: 'pointer',
                borderRadius: 'var(--ls-radius)',
              }}
            >
              {isExpanded ? '▲ contraer' : '▼ Ajustes'}
            </button>
          </div>
        )
      })}

      {hasBaseLayer && (
        <div
          style={{
            marginTop: 8,
            paddingTop: 10,
            borderTop: '1px solid var(--ls-border)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: 'var(--ls-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Ventana de la CT
            </span>
            <span style={{ fontSize: 11, color: 'var(--ls-text-muted)', textAlign: 'right' }}>
              {formatCtWindow(ctWindow)}
            </span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {CT_WINDOW_PRESETS.map((preset) => {
              const active = ctWindow.level === preset.level && ctWindow.width === preset.width
              return (
                <button
                  key={preset.id}
                  type="button"
                  className="ls-focusable"
                  aria-pressed={active}
                  aria-label={`Ventana ${preset.label}: nivel ${preset.level}, ancho ${preset.width} HU`}
                  onClick={() =>
                    onCtWindowChange({ level: preset.level, width: preset.width })
                  }
                  style={{
                    padding: '4px 9px',
                    fontSize: 11.5,
                    fontWeight: active ? 600 : 500,
                    border: `1px solid ${active ? 'var(--ls-accent)' : 'var(--ls-border)'}`,
                    borderRadius: 999,
                    background: active ? 'rgba(108, 92, 231, 0.18)' : 'transparent',
                    color: active ? 'var(--ls-text)' : 'var(--ls-text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {preset.label}
                </button>
              )
            })}
            <button
              type="button"
              className="ls-focusable"
              aria-label={`Restablecer ventana pulmonar: nivel ${DEFAULT_CT_WINDOW.level}, ancho ${DEFAULT_CT_WINDOW.width} HU`}
              onClick={() => onCtWindowChange(DEFAULT_CT_WINDOW)}
              style={{
                padding: '4px 9px',
                fontSize: 11.5,
                fontWeight: 500,
                border: '1px dashed var(--ls-border)',
                borderRadius: 999,
                background: 'transparent',
                color: 'var(--ls-accent)',
                cursor: 'pointer',
              }}
            >
              Restablecer
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

export default LayerPanel
