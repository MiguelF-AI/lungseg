export type ViewMode = 'Axial' | 'Coronal' | 'Sagital' | 'Multi' | '3D'

const VIEW_MODES: ViewMode[] = ['Axial', 'Coronal', 'Sagital', 'Multi', '3D']

export function ViewerToolbar({
  className = '',
  viewMode,
  onViewModeChange,
  viewerReady,
  onCaptureView,
}: {
  className?: string
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  /** Solo se puede capturar cuando el visor tiene volúmenes pintados. */
  viewerReady: boolean
  onCaptureView: () => void
}) {
  const handleSelect = (next: ViewMode) => {
    onViewModeChange(next)
  }

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        background: 'var(--ls-surface-elev)',
        borderTop: '1px solid var(--ls-border)',
      }}
      role="toolbar"
      aria-label="Selector de vista del visor"
    >
      {VIEW_MODES.map((m) => (
        <button
          key={m}
          type="button"
          className="ls-focusable"
          aria-pressed={viewMode === m}
          onClick={() => handleSelect(m)}
          style={{
            padding: '6px 10px',
            fontSize: 13,
            fontWeight: 500,
            borderRadius: 'var(--ls-radius)',
            border: 'none',
            background: viewMode === m ? 'var(--ls-accent)' : 'transparent',
            color: viewMode === m ? '#ffffff' : 'var(--ls-text-muted)',
            cursor: 'pointer',
            outline: 'none',
            boxShadow: viewMode === m ? '0 0 0 2px var(--ls-focus-ring)' : 'none',
          }}
        >
          {m}
        </button>
      ))}

      <span
        aria-hidden="true"
        style={{
          width: 1,
          height: 22,
          margin: '0 4px',
          background: 'var(--ls-border)',
        }}
      />

      <button
        type="button"
        className="ls-focusable"
        disabled={!viewerReady}
        aria-label="Capturar vista actual como PNG"
        title={
          viewerReady
            ? 'Guarda la vista actual como PNG'
            : 'Carga un estudio para capturar la vista'
        }
        onClick={onCaptureView}
        style={{
          padding: '6px 12px',
          fontSize: 13,
          fontWeight: 500,
          borderRadius: 'var(--ls-radius)',
          border: '1px solid var(--ls-accent)',
          background: viewerReady ? 'transparent' : 'var(--ls-disabled-bg)',
          color: viewerReady ? 'var(--ls-accent)' : 'var(--ls-disabled-text)',
          cursor: viewerReady ? 'pointer' : 'not-allowed',
          outline: 'none',
        }}
      >
        📷 Capturar vista
      </button>
    </div>
  )
}

export default ViewerToolbar
