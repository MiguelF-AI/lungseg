export type ViewMode = 'Axial' | 'Coronal' | 'Sagital' | 'Multi' | '3D'

const VIEW_MODES: ViewMode[] = ['Axial', 'Coronal', 'Sagital', 'Multi', '3D']

export function ViewerToolbar({
  className = '',
  viewMode,
  onViewModeChange,
}: {
  className?: string
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
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
    </div>
  )
}

export default ViewerToolbar
