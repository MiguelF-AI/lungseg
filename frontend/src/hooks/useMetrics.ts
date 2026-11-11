import { useCallback, useState } from 'react'

import { getMetrics } from '../api/client'
import type { Metrics } from '../api/types'

export interface UseMetricsResult {
  metrics: Metrics | null
  loading: boolean
  error: string | null
  refetch: (id: string) => Promise<void>
}

/**
 * Hook que obtiene las métricas de un estudio (GET /api/studies/{id}/metrics).
 *
 * NOTA (ticket F2): este endpoint todavía NO existe (es el ticket B3).
 * El tipo, la función del cliente y el hook se definen aquí, pero NO se
 * llaman desde la UI hasta F6. La MetricsCard sigue con datos simulados.
 */
export function useMetrics(): UseMetricsResult {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await getMetrics(id)
      setMetrics(data)
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Error desconocido al cargar las métricas')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const refetch = useCallback((id: string) => {
    return load(id)
  }, [load])

  return { metrics, loading, error, refetch }
}
