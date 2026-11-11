import { useCallback, useState } from 'react'

import { getStudies } from '../api/client'
import type { StudySummary } from '../api/types'

export interface UseStudiesResult {
  studies: StudySummary[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

/**
 * Hook que lista los estudios (GET /api/studies).
 *
 * Estados obligatorios: carga, error (con reintentar) y vacío.
 */
export function useStudies(): UseStudiesResult {
  const [studies, setStudies] = useState<StudySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getStudies()
      setStudies(data)
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Error desconocido al cargar los estudios')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const refetch = useCallback(() => {
    return load()
  }, [load])

  return { studies, loading, error, refetch }
}
