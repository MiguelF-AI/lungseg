import { useEffect, useState } from 'react'

import LayerPanel from './LayerPanel'
import MetricsCard from './MetricsCard'
import StudyPicker from './StudyPicker'
import type { Metrics, StudyDetail } from '../api/types'
import type { CtWindow, LayerVisualSettings } from '../layers'
import {
  type View3DCameraPreset,
  type View3DPrefs,
  type ViewMode,
} from '../hooks/useNiivue'

/** Rango de profundidad del plano de clip (según el .d.ts de NiiVue). */
const CLIP_PLANE_MIN = 0
const CLIP_PLANE_MAX = 1.73

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
  radiological,
  onToggleHelp,
  /** Modo de vista actual (para mostrar la sección 3D solo en 3D/Multi). */
  viewMode,
  /** Preferencias de vista 3D. */
  view3d,
  /** Preset de cámara. */
  onCameraPreset,
  /** Alternar plano de corte. */
  onClipPlaneToggle,
  /** Cambiar profundidad del plano de corte. */
  onClipPlaneDepthChange,
  /** Alinear plano de corte con la cámara. */
  onClipPlaneAlign,
  /** Alternar cubo de orientación. */
  onOrientCubeToggle,
  /** Cambiar iluminación 3D. */
  onIlluminationChange,
  /** Cambiar opacidad por gradiente 3D. */
  onGradientOpacityChange,
  /** Cambiar mezcla de overlays 3D. */
  onRenderOverlayBlendChange,
  /** Alternar «solo segmentaciones en 3D». */
  onMasksOnly3dToggle,
  /** Restablecer vista 3D. */
  onReset3d,
  /** Descarga del ZIP de máscaras (F8). */
  onDownloadExport,
  /** Estado de la descarga, ya filtrado por estudio en App. */
  exportPhase,
  /** Mensaje legible cuando la descarga falla. */
  exportMessage,
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
  /** Convención radiológica actual (para el indicador visual). */
  radiological?: boolean
  /** Modo de vista actual. */
  viewMode: ViewMode
  /** Preferencias de vista 3D. */
  view3d: View3DPrefs
  onCameraPreset: (preset: Exclude<View3DCameraPreset, 'Personalizado'>) => void
  onClipPlaneToggle: () => void
  onClipPlaneDepthChange: (depth: number) => void
  onClipPlaneAlign: () => void
  onOrientCubeToggle: () => void
  onIlluminationChange: (value: number) => void
  onGradientOpacityChange: (value: number) => void
  onRenderOverlayBlendChange: (value: number) => void
  onMasksOnly3dToggle: () => void
  onReset3d: () => void
  /** Abre el modal de ayuda de atajos. */
  onToggleHelp: () => void
  onDownloadExport: () => void
  exportPhase: 'idle' | 'preparing' | 'success' | 'error'
  exportMessage: string | null
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

  // Número de máscaras disponibles: se deriva en el render (regla 14), nunca
  // se copia a estado con un useEffect. Cuenta solo capas kind: 'mask', no el
  // LEEME del ZIP.
  const maskCount = study?.layers.filter((l) => l.kind === 'mask').length ?? 0
  const exportDisabled =
    studyLoading || maskCount === 0 || exportPhase === 'preparing'
  const exportHint = studyLoading
    ? 'Cargando el estudio…'
    : maskCount === 0
      ? 'Este estudio no tiene máscaras para exportar.'
      : null
  const exportLabel =
    exportPhase === 'preparing'
      ? 'Preparando…'
      : exportPhase === 'error'
        ? 'Reintentar descarga'
        : `Descargar todo (${maskCount})`

  // Contador de FPS solo para desarrollo ((import.meta as any).env.DEV). Se activa con
  // window.__lungsegFps (botón de la sección 3D o consola).
  const [fps, setFps] = useState(0)
  useEffect(() => {
    if ((import.meta as any).env.DEV && (window as any).__lungsegFps) {
      let frameCount = 0
      let lastTime = performance.now()
      const tick = () => {
        frameCount++
        const now = performance.now()
        if (now - lastTime >= 1000) {
          setFps(Math.round((frameCount * 1000) / (now - lastTime)))
          frameCount = 0
          lastTime = now
        }
        if ((window as any).__lungsegFps) {
          requestAnimationFrame(tick)
        }
      }
      requestAnimationFrame(tick)
    }
    return () => {
      // El bucle se detiene al cambiar window.__lungsegFps a false.
    }
  }, [(import.meta as any).env.DEV, (window as any).__lungsegFps])

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

        {/* Indicador de convención y botón de atajos. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
            padding: '6px 10px',
            background: 'var(--ls-surface-elev)',
            border: '1px solid var(--ls-border)',
            borderRadius: 'var(--ls-radius)',
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: radiological ? 'var(--ls-accent)' : 'var(--ls-text-muted)',
            }}
          >
            {radiological ? 'Radiológica' : 'Neurológica'}
          </span>
          <button
            type="button"
            className="ls-focusable"
            aria-label="Atajos de teclado"
            onClick={onToggleHelp}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              border: '1px solid var(--ls-border)',
              borderRadius: 'var(--ls-radius)',
              background: 'transparent',
              color: 'var(--ls-text)',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            ⌨
          </button>
        </div>

        <button
          type="button"
          className="ls-focusable"
          disabled={exportDisabled}
          aria-busy={exportPhase === 'preparing'}
          aria-label={
            exportPhase === 'error'
              ? 'Reintentar descarga del ZIP de máscaras'
              : `Descargar todo (${maskCount} máscaras)`
          }
          aria-describedby={exportHint ? 'ls-export-hint' : undefined}
          title={`ZIP con ${maskCount} máscaras NIfTI y un LEEME`}
          onClick={onDownloadExport}
          style={{
            width: '100%',
            padding: '10px',
            border: exportDisabled
              ? '1px solid var(--ls-disabled-text)'
              : '1px solid var(--ls-accent)',
            borderRadius: 'var(--ls-radius)',
            background: exportDisabled
              ? 'var(--ls-disabled-bg)'
              : 'var(--ls-accent)',
            color: exportDisabled ? 'var(--ls-disabled-text)' : '#ffffff',
            fontSize: 13,
            fontWeight: 500,
            cursor: exportDisabled ? 'not-allowed' : 'pointer',
            outline: 'none',
          }}
        >
          {exportLabel}
        </button>
        {exportHint && (
          <p
            id="ls-export-hint"
            style={{
              fontSize: 11,
              lineHeight: 1.5,
              color: 'var(--ls-text-muted)',
              margin: '6px 0 0',
            }}
          >
            {exportHint}
          </p>
        )}
        {exportPhase === 'success' && (
          <p
            style={{
              fontSize: 11,
              lineHeight: 1.5,
              color: 'var(--ls-text-muted)',
              margin: '6px 0 0',
            }}
          >
            Descarga lista: {study?.id ?? ''}_masks.zip
          </p>
        )}
        {exportPhase === 'error' && (
          <p
            style={{
              fontSize: 11,
              lineHeight: 1.5,
              color: 'var(--ls-error)',
              margin: '6px 0 0',
            }}
          >
            No se pudo generar el ZIP: {exportMessage ?? 'Inténtalo de nuevo.'}
          </p>
        )}
      </div>

      {/* Vista 3D (solo en modo 3D o Multi). */} {/*
      */ (viewMode === '3D' || viewMode === 'Multi') && (
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--ls-border)',
          }}
        >
          <div
            style={{
              fontSize: 12,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--ls-text-muted)',
              marginBottom: 8,
            }}
          >
            Vista 3D
          </div>

          {/* Presets de cámara. */}
          <div
            style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              marginBottom: 10,
            }}
          >
            {(['Anterior', 'Posterior', 'Izquierda', 'Derecha', 'Superior'] as const).map(
              (preset) => {
                const active = view3d.cameraPreset === preset
                return (
                  <button
                    key={preset}
                    type="button"
                    className="ls-focusable"
                    aria-label={`Vista ${preset}`}
                    aria-pressed={active}
                    onClick={() => onCameraPreset(preset)}
                    style={{
                      padding: '6px 8px',
                      fontSize: 12,
                      fontWeight: 500,
                      borderRadius: 'var(--ls-radius)',
                      border: active
                        ? '1px solid var(--ls-accent)'
                        : '1px solid var(--ls-border)',
                      background: active ? 'var(--ls-accent)' : 'var(--ls-surface-elev)',
                      color: active ? '#ffffff' : 'var(--ls-text)',
                      cursor: 'pointer',
                      outline: 'none',
                    }}
                  >
                    {preset}
                  </button>
                )
              },
            )}
          </div>

          {/* Cubo de orientación. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 10,
            }}
          >
            <button
              type="button"
              className="ls-focusable"
              aria-label={view3d.orientCube ? 'Ocultar cubo de orientación' : 'Mostrar cubo de orientación'}
              aria-pressed={view3d.orientCube}
              onClick={onOrientCubeToggle}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                border: '1px solid var(--ls-border)',
                borderRadius: 'var(--ls-radius)',
                background: view3d.orientCube ? 'var(--ls-accent)' : 'transparent',
                color: view3d.orientCube ? '#ffffff' : 'var(--ls-text)',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              ◈
            </button>
            <span style={{ fontSize: 12.5, color: 'var(--ls-text)' }}>
              Cubo de orientación
            </span>
          </div>

          {/* Plano de corte. */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <button
                type="button"
                className="ls-focusable"
                aria-label={
                  view3d.clipPlaneEnabled
                    ? 'Desactivar plano de corte'
                    : 'Activar plano de corte'
                }
                aria-pressed={view3d.clipPlaneEnabled}
                onClick={onClipPlaneToggle}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 28,
                  height: 28,
                  border: '1px solid var(--ls-border)',
                  borderRadius: 'var(--ls-radius)',
                  background: view3d.clipPlaneEnabled ? 'var(--ls-accent)' : 'transparent',
                  color: view3d.clipPlaneEnabled ? '#ffffff' : 'var(--ls-text)',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                ▭
              </button>
              <span style={{ fontSize: 12.5, color: 'var(--ls-text)' }}>
                Plano de corte
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <label
                style={{ fontSize: 11.5, color: 'var(--ls-text-muted)', width: 70 }}
                htmlFor="ls-clip-plane-depth"
              >
                Profundidad
              </label>
              <input
                id="ls-clip-plane-depth"
                type="range"
                min={CLIP_PLANE_MIN}
                max={CLIP_PLANE_MAX}
                step="0.01"
                value={view3d.clipPlaneDepth}
                onChange={(e) =>
                  onClipPlaneDepthChange(parseFloat(e.target.value))
                }
                disabled={!view3d.clipPlaneEnabled}
                aria-label="Profundidad del plano de corte"
                style={{
                  flex: 1,
                  height: 6,
                  accentColor: 'var(--ls-accent)',
                  cursor: view3d.clipPlaneEnabled ? 'pointer' : 'not-allowed',
                  opacity: view3d.clipPlaneEnabled ? 1 : 0.5,
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--ls-text-muted)',
                  minWidth: 40,
                }}
              >
                {view3d.clipPlaneDepth.toFixed(2)}
              </span>
            </div>
            <button
              type="button"
              className="ls-focusable"
              aria-label="Alinear plano de corte con la cámara"
              onClick={onClipPlaneAlign}
              disabled={!view3d.clipPlaneEnabled}
              style={{
                width: '100%',
                padding: '6px',
                fontSize: 12,
                borderRadius: 'var(--ls-radius)',
                border: '1px solid var(--ls-border)',
                background: view3d.clipPlaneEnabled ? 'var(--ls-surface-elev)' : 'var(--ls-disabled-bg)',
                color: view3d.clipPlaneEnabled ? 'var(--ls-text)' : 'var(--ls-disabled-text)',
                cursor: view3d.clipPlaneEnabled ? 'pointer' : 'not-allowed',
                outline: 'none',
              }}
            >
              Alinear con la cámara
            </button>
          </div>

          {/* Calidad de render. */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <label
                style={{ fontSize: 11.5, color: 'var(--ls-text-muted)' }}
              >
                Iluminación 3D
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={view3d.illumination}
                onChange={(e) => onIlluminationChange(parseFloat(e.target.value))}
                aria-label="Iluminación 3D"
                style={{
                  width: '100%',
                  height: 6,
                  accentColor: 'var(--ls-accent)',
                  cursor: 'pointer',
                }}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 10.5,
                  color: 'var(--ls-text-muted)',
                }}
              >
                <span>0</span>
                <span>{view3d.illumination.toFixed(2)}</span>
                <span>1</span>
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <label
                style={{ fontSize: 11.5, color: 'var(--ls-text-muted)' }}
              >
                Opacidad por gradiente
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={view3d.gradientOpacity}
                onChange={(e) => onGradientOpacityChange(parseFloat(e.target.value))}
                aria-label="Opacidad por gradiente 3D"
                style={{
                  width: '100%',
                  height: 6,
                  accentColor: 'var(--ls-accent)',
                  cursor: 'pointer',
                }}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 10.5,
                  color: 'var(--ls-text-muted)',
                }}
              >
                <span>0</span>
                <span>{view3d.gradientOpacity.toFixed(2)}</span>
                <span>1</span>
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <label
                style={{ fontSize: 11.5, color: 'var(--ls-text-muted)' }}
              >
                Mezcla CT + overlays
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={view3d.renderOverlayBlend}
                onChange={(e) => onRenderOverlayBlendChange(parseFloat(e.target.value))}
                aria-label="Mezcla CT + overlays 3D"
                style={{
                  width: '100%',
                  height: 6,
                  accentColor: 'var(--ls-accent)',
                  cursor: 'pointer',
                }}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 10.5,
                  color: 'var(--ls-text-muted)',
                }}
              >
                <span>0</span>
                <span>{view3d.renderOverlayBlend.toFixed(2)}</span>
                <span>1</span>
              </div>
            </div>
          </div>

          {/* Solo segmentaciones en 3D. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 10,
            }}
          >
            <button
              type="button"
              className="ls-focusable"
              aria-label={
                view3d.masksOnly3d
                  ? 'Desactivar solo segmentaciones en 3D'
                  : 'Activar solo segmentaciones en 3D'
              }
              aria-pressed={view3d.masksOnly3d}
              onClick={onMasksOnly3dToggle}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                border: '1px solid var(--ls-border)',
                borderRadius: 'var(--ls-radius)',
                background: view3d.masksOnly3d ? 'var(--ls-accent)' : 'transparent',
                color: view3d.masksOnly3d ? '#ffffff' : 'var(--ls-text)',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              ▭
            </button>
            <span style={{ fontSize: 12.5, color: 'var(--ls-text)' }}>
              Solo segmentaciones en 3D
            </span>
          </div>

          {/* Restablecer 3D. */}
          <button
            type="button"
            className="ls-focusable"
            aria-label="Restablecer vista 3D"
            onClick={onReset3d}
            style={{
              width: '100%',
              padding: '8px',
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 'var(--ls-radius)',
              border: '1px solid var(--ls-accent)',
              background: 'transparent',
              color: 'var(--ls-accent)',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            Restablecer 3D
          </button>
        </div>
      )}

      {/* FPS (solo desarrollo). */}
      {(import.meta as any).env.DEV && (
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--ls-border)',
          }}
        >
          <div
            style={{
              fontSize: 12,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--ls-text-muted)',
              marginBottom: 8,
            }}
          >
            FPS (dev)
          </div>
          <button
            type="button"
            className="ls-focusable"
            aria-label="Activar contador de FPS (solo desarrollo)"
            onClick={() => {
              ;(window as any).__lungsegFps =
                !(window as any).__lungsegFps
            }}
            style={{
              width: '100%',
              padding: '8px',
              fontSize: 12,
              borderRadius: 'var(--ls-radius)',
              border: '1px solid var(--ls-accent)',
              background: 'transparent',
              color: 'var(--ls-accent)',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {(window as any).__lungsegFps ? 'Desactivar' : 'Activar'} FPS
          </button>
          <div id="ls-fps-counter" style={{ fontSize: 11, color: 'var(--ls-text-muted)', marginTop: 4 }}>
            {fps} fps
          </div>
        </div>
      )}

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
