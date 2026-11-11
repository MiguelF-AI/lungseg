import { useCallback, useState } from 'react'

import { getStudy } from '../api/client'
import type { StudyDetail } from '../api/types'

export interface UseStudyResult {
  study: StudyDetail | null
  loading: boolean
  error: string | null
  refetch: (id: string) => Promise<void>
}

/**
 * Hook que obtiene el detalle de un estudio (GET /api/studies/{id}).
 *
 * Al cambiar de `id` se descarta el estudio anterior y se resetea a
 * carga: la UI no muestra datos del estudio anterior mientras carga el
 * nuevo ni queda atascada si la petición falla (se guarda el error y se
 * permite reintentar).
 */
export function useStudy(): UseStudyResult {
  const [study, setStudy] = useState<StudyDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    setStudy(null)
    try {
      const data = await getStudy(id)
      setStudy(data)
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Error desconocido al cargar el estudio')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const refetch = useCallback((id: string) => {
    return load(id)
  }, [load])

  return { study, loading, error, refetch }
}
