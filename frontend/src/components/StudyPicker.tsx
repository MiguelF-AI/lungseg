import { useCallback, useEffect, useMemo, useState } from 'react'

import { useStudies } from '../hooks/useStudies'
import { moveStudyIndex } from '../nav'

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
 * por la lista (filtrada si hay búsqueda) y notifican el cambio mediante
 * onSelect. Añade un buscador por id (subcadena, sin distinguir
 * mayúsculas) accesible con teclado: flechas eligen, Enter selecciona,
 * Esc limpia. Tecleando en el buscador no se dispara ningún atajo de
 * teclado global (useHotkeys ignora los campos de texto).
 */
export function StudyPicker({
  className = '',
  onSelect,
}: StudyPickerProps) {
  const { studies, loading, error, refetch } = useStudies()
  const [filter, setFilter] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Lista filtrada por id (subcadena, sin distinguir mayúsculas).
  const filtered = useMemo(
    () =>
      studies.filter((s) =>
        s.id.toLowerCase().includes(filter.toLowerCase()),
      ),
    [studies, filter],
  )

  // Ajustar el índice seleccionado cuando la lista filtrada cambia.
  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedIndex(0)
    } else if (selectedIndex >= filtered.length) {
      setSelectedIndex(filtered.length - 1)
    }
  }, [filtered.length, selectedIndex])

  const selectedStudy = filtered[selectedIndex] ?? null
  const idAbbrev = selectedStudy ? selectedStudy.id.slice(0, 8) : '—'

  const handleFilterChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFilter(e.target.value)
      setSelectedIndex(0)
    },
    [],
  )

  const handleFilterKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        setFilter('')
        setSelectedIndex(0)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (filtered.length === 0) return
        setSelectedIndex((prev) => (prev + 1) % filtered.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (filtered.length === 0) return
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const s = selectedStudy
        if (s) onSelect?.(s.id)
      }
    },
    [filtered.length, selectedStudy, onSelect],
  )

  const handlePrev = useCallback(() => {
    if (filtered.length === 0) return
    const next = moveStudyIndex(filtered, selectedIndex, -1)
    setSelectedIndex(next)
    onSelect?.(filtered[next].id)
  }, [filtered, selectedIndex, onSelect])

  const handleNext = useCallback(() => {
    if (filtered.length === 0) return
    const next = moveStudyIndex(filtered, selectedIndex, 1)
    setSelectedIndex(next)
    onSelect?.(filtered[next].id)
  }, [filtered, selectedIndex, onSelect])

  const handleRetry = useCallback(() => {
    void refetch()
  }, [refetch])

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

  // Estado exitoso: selector real con buscador por id.
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

      {/* Buscador por id (subcadena, sin distinguir mayúsculas). */}
      <div style={{ marginBottom: 8 }}>
        <input
          type="search"
          className="ls-focusable"
          value={filter}
          onChange={handleFilterChange}
          onKeyDown={handleFilterKeyDown}
          autoComplete="off"
          aria-label="Buscar estudio por id"
          placeholder="Buscar estudio…"
          style={{
            width: '100%',
            padding: '6px 10px',
            fontSize: 13,
            border: '1px solid var(--ls-border)',
            borderRadius: 'var(--ls-radius)',
            background: 'var(--ls-surface-elev)',
            color: 'var(--ls-text)',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
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
            disabled={filtered.length === 0 || selectedIndex === 0}
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
                filtered.length === 0 || selectedIndex === 0
                  ? 'var(--ls-disabled-text)'
                  : 'var(--ls-text)',
              cursor:
                filtered.length === 0 || selectedIndex === 0
                  ? 'not-allowed'
                  : 'pointer',
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
            disabled={
              filtered.length === 0 ||
              selectedIndex === filtered.length - 1
            }
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
                filtered.length === 0 ||
                selectedIndex === filtered.length - 1
                  ? 'var(--ls-disabled-text)'
                  : 'var(--ls-text)',
              cursor:
                filtered.length === 0 ||
                selectedIndex === filtered.length - 1
                  ? 'not-allowed'
                  : 'pointer',
              borderRadius: 'var(--ls-radius)',
              outline: 'none',
            }}
          >
            ▶
          </button>
        </div>
        <span style={{ color: 'var(--ls-text-muted)', fontSize: 13 }}>
          {filtered.length === 0 ? '—' : selectedIndex + 1} / {filtered.length}
        </span>
      </div>
    </section>
  )
}

export default StudyPicker
