import { useState } from 'react'

const STUDY_COUNT = 27
const STUDY_INDEX = 2 // 0-based: muestra "3 / 27"

export function StudyPicker({
  className = '',
  onPrev,
  onNext,
}: {
  className?: string
  onPrev?: () => void
  onNext?: () => void
}) {
  const [index, setIndex] = useState(STUDY_INDEX)

  const idAbbrev = `study-${String(index + 1).padStart(2, '0')}`

  const handlePrev = () => {
    if (index > 0) {
      setIndex(index - 1)
      onPrev?.()
    }
  }

  const handleNext = () => {
    if (index < STUDY_COUNT - 1) {
      setIndex(index + 1)
      onNext?.()
    }
  }

  return (
    <section
      className={className}
      style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--ls-border)',
      }}
    >
      <div style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ls-text-muted)', marginBottom: 8 }}>
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
            disabled={index === 0}
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
              color: index === 0 ? 'var(--ls-disabled-text)' : 'var(--ls-text)',
              cursor: index === 0 ? 'not-allowed' : 'pointer',
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
          >
            {idAbbrev}
          </span>
          <button
            type="button"
            disabled={index === STUDY_COUNT - 1}
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
              color: index === STUDY_COUNT - 1 ? 'var(--ls-disabled-text)' : 'var(--ls-text)',
              cursor: index === STUDY_COUNT - 1 ? 'not-allowed' : 'pointer',
              borderRadius: 'var(--ls-radius)',
              outline: 'none',
            }}
          >
            ▶
          </button>
        </div>
        <span style={{ color: 'var(--ls-text-muted)', fontSize: 13 }}>
          {index + 1} / {STUDY_COUNT}
        </span>
      </div>
    </section>
  )
}

export default StudyPicker
