import { useCallback, useEffect, useRef, useState } from 'react'

export interface HelpDialogProps {
  open: boolean
  onClose: () => void
}

const SHORTCUTS: { key: string; alias: string; label: string }[] = [
  { key: '1', alias: '', label: 'Vista multiplanar' },
  { key: '2', alias: '', label: 'Axial' },
  { key: '3', alias: '', label: 'Coronal' },
  { key: '4', alias: '', label: 'Sagital' },
  { key: '5', alias: '', label: '3D' },
  { key: 'G', alias: '', label: 'Centrar en la lesión' },
  { key: 'E', alias: '', label: 'Mostrar/ocultar lesión' },
  { key: 'P', alias: '', label: 'Mostrar/ocultar pulmones' },
  { key: 'R', alias: '', label: 'Convención radiológica' },
  { key: 'C', alias: '', label: 'Plano de corte (activar/desactivar)' },
  { key: '[', alias: ',', label: 'Estudio anterior' },
  { key: ']', alias: '.', label: 'Estudio siguiente' },
  { key: '?', alias: '', label: 'Ayuda' },
]

/**
 * Modal de ayuda accesible: role="dialog", aria-modal, foco atrapado dentro,
 * Esc y clic fuera cierran, y al cerrar el foco vuelve al elemento que lo
 * abrió. Textos en español.
 */
export function HelpDialog({
  open,
  onClose,
}: HelpDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [previousFocus, setPreviousFocus] = useState<HTMLElement | null>(null)

  const close = useCallback(() => {
    onClose()
    if (previousFocus) {
      previousFocus.focus()
    }
  }, [onClose, previousFocus])

  // Capturar el elemento que tenía el foco al abrir el diálogo.
  useEffect(() => {
    if (!open) return
    setPreviousFocus(document.activeElement as HTMLElement | null)
  }, [open])

  // Clic fuera del diálogo lo cierra.
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        close()
      }
    },
    [close],
  )

  // Esc lo cierra.
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, close])

  if (!open) return null

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Atajos de teclado"
      onClick={handleClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.6)',
      }}
    >
      {/* Sentinela de foco antes del contenido (trampa de tab). */}
      <button
        tabIndex={0}
        onFocus={() => {
          const last = dialogRef.current?.querySelector(
            '[data-focus-last]',
          )
          if (last) (last as HTMLElement).focus()
        }}
        style={{ position: 'absolute', opacity: 0, border: 'none', padding: 0 }}
      />

      <div
        style={{
          background: 'var(--ls-surface)',
          border: '1px solid var(--ls-border)',
          borderRadius: 'var(--ls-radius)',
          padding: '24px 28px',
          minWidth: 420,
          color: 'var(--ls-text)',
          outline: 'none',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          style={{
            margin: '0 0 16px',
            fontSize: 17,
            fontWeight: 700,
            color: 'var(--ls-text)',
          }}
        >
          Atajos de teclado
        </h2>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
          }}
        >
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr
                key={s.key}
                style={{ borderBottom: '1px solid var(--ls-border)' }}
              >
                <td
                  style={{
                    padding: '6px 4px',
                    color: 'var(--ls-accent)',
                    fontFamily: 'ui-monospace, monospace',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.key}{s.alias ? ` (${s.alias})` : ''}
                </td>
                <td
                  style={{
                    padding: '6px 4px',
                    color: 'var(--ls-text-muted)',
                  }}
                >
                  {s.label}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p
          style={{
            marginTop: 16,
            fontSize: 11.5,
            color: 'var(--ls-text-muted)',
          }}
        >
          Los atajos no funcionan al escribir en campos de texto. Pulsa
          <strong>Esc</strong> para cerrar esta ayuda.
        </p>
      </div>

      {/* Sentinela de foco después del contenido (trampa de tab). */}
      <button
        tabIndex={0}
        data-focus-last
        onFocus={() => {
          const first = dialogRef.current?.querySelector(
            'button:not([data-focus-last])',
          )
          if (first) (first as HTMLElement).focus()
        }}
        style={{ position: 'absolute', opacity: 0, border: 'none', padding: 0 }}
      />
    </div>
  )
}

export default HelpDialog
