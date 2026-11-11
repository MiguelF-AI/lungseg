import { useEffect, useState } from 'react'

import { useStudies } from '../hooks/useStudies'

export interface StudyPickerProps {
  className?: string
  onSelect?: (id: string) => void
}

/**
 * Selector de estudios con datos reales de GET /api/studies.
 *
 * Estados obligatorios:
 *  - carga: esqueleto (skeleton)
 *  - error: mensaje + botón "Reintentar" (sin rutas del servidor)
 *  - vacío: instrucciones para copiar archivos a Data/
 *
 * El id se abrevia a los 8 primeros caracteres. Los botones ◀ ▶ navegan
 * por la lista real y notifican el cambio mediante onSelect.
 */
export function StudyPicker({
  className = '',
  onSelect,
}: StudyPickerProps) {
  const { studies, loading, error, refetch } = useStudies()
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Si la lista cambia (refetch), ajustar el índice seleccionado.
  useEffect(() => {
    if (studies.length === 0) {
      setSelectedIndex(0)
    } else if (selectedIndex >= studies.length) {
      setSelectedIndex(studies.length - 1)
    }
  }, [studies.length, selectedIndex])

  const selectedStudy = studies[selectedIndex] ?? null
  const idAbbrev = selectedStudy ? selectedStudy.id.slice(0, 8) : '—'

  const handlePrev = () => {
    if (selectedIndex > 0) {
      const next = selectedIndex - 1
      setSelectedIndex(next)
      onSelect?.(studies[next].id)
    }
  }

  const handleNext = () => {
    if (selectedIndex < studies.length - 1) {
      const next = selectedIndex + 1
      setSelectedIndex(next)
      onSelect?.(studies[next].id)
    }
  }

  const handleRetry = () => {
    void refetch()
  }

  // Esqueleto de carga (sencillo, sin librerías extra).
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
            marginBottom: 8,
          }}
        >
          Estudio
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--ls-surface-elev)',
            border: '1px solid var(--ls-border)',
            borderRadius: 'var(--ls-radius)',
            padding: '4px 8px',
          }}
        >
          <button
            type="button"
            disabled
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              border: 'none',
              background: 'transparent',
              color: 'var(--ls-disabled-text)',
              cursor: 'not-allowed',
              borderRadius: 'var(--ls-radius)',
              outline: 'none',
            }}
          >
            ◀
          </button>
          <span
            style={{
              minWidth: 90,
              textAlign: 'center',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--ls-disabled-text)',
              background: 'var(--ls-border)',
              borderRadius: 'var(--ls-radius)',
              padding: '2px 6px',
            }}
          >
            ‎ ‎ ‎ ‎ ‎ ‎ ‎ ‎
          </span>
          <button
            type="button"
            disabled
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              border: 'none',
              background: 'transparent',
              color: 'var(--ls-disabled-text)',
              cursor: 'not-allowed',
              borderRadius: 'var(--ls-radius)',
              outline: 'none',
            }}
          >
            ▶
          </button>
        </div>
        <span style={{ color: 'var(--ls-text-muted)', fontSize: 13 }}>
          ‎ / ‎
        </span>
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
            marginBottom: 8,
          }}
        >
          Estudio
        </div>
        <div style={{ color: 'var(--ls-text)', fontSize: 13, maxWidth: 240 }}>
          No se pudieron cargar los estudios.
        </div>
        <button
          type="button"
          onClick={handleRetry}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 500,
            border: '1px solid var(--ls-accent)',
            borderRadius: 'var(--ls-radius)',
            background: 'transparent',
            color: 'var(--ls-accent)',
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          Reintentar
        </button>
      </section>
    )
  }

  // Estado vacío (sin estudios).
  if (studies.length === 0) {
    return (
      <section
        className={className}
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--ls-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
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
            marginBottom: 8,
          }}
        >
          Estudio
        </div>
        <div style={{ color: 'var(--ls-text-muted)', fontSize: 13, maxWidth: 260 }}>
          No hay estudios disponibles.
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--ls-text-muted)',
            maxWidth: 260,
            lineHeight: 1.5,
            textAlign: 'left',
          }}
        >
          Copia los archivos generados por el notebook a la carpeta
          <code style={{ color: 'var(--ls-text)' }}>Data/</code>:
          <br />
          <code style={{ color: 'var(--ls-text)' }}>{idAbbrev}_lung.nii</code> (y opcionalmente
          <code style={{ color: 'var(--ls-text)' }}>{idAbbrev}_cople_lesion.nii</code> y
          <code style={{ color: 'var(--ls-text)' }}>{idAbbrev}.nii</code>).
        </div>
      </section>
    )
  }

  // Estado exitoso: selector real.
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
          marginBottom: 8,
        }}
      >
        Estudio
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--ls-surface-elev)',
            border: '1px solid var(--ls-border)',
            borderRadius: 'var(--ls-radius)',
            padding: '4px 8px',
          }}
        >
          <button
            type="button"
            disabled={selectedIndex === 0}
            onClick={handlePrev}
            aria-label="Estudio anterior"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              border: 'none',
              background: 'transparent',
              color:
                selectedIndex === 0
                  ? 'var(--ls-disabled-text)'
                  : 'var(--ls-text)',
              cursor: selectedIndex === 0 ? 'not-allowed' : 'pointer',
              borderRadius: 'var(--ls-radius)',
              outline: 'none',
            }}
          >
            ◀
          </button>
          <span
            style={{
              minWidth: 90,
              textAlign: 'center',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--ls-text)',
            }}
            title={selectedStudy?.id}
          >
            {idAbbrev}
          </span>
          <button
            type="button"
            disabled={selectedIndex === studies.length - 1}
            onClick={handleNext}
            aria-label="Estudio siguiente"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              border: 'none',
              background: 'transparent',
              color:
                selectedIndex === studies.length - 1
                  ? 'var(--ls-disabled-text)'
                  : 'var(--ls-text)',
              cursor:
                selectedIndex === studies.length - 1 ? 'not-allowed' : 'pointer',
              borderRadius: 'var(--ls-radius)',
              outline: 'none',
            }}
          >
            ▶
          </button>
        </div>
        <span style={{ color: 'var(--ls-text-muted)', fontSize: 13 }}>
          {selectedIndex + 1} / {studies.length}
        </span>
      </div>
    </section>
  )
}

export default StudyPicker
