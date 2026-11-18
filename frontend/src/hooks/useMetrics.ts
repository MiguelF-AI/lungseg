import { useCallback, useRef, useState } from 'react'

import { getMetrics } from '../api/client'
import type { Metrics } from '../api/types'

/**
 * Estado de las métricas de un estudio.
 *
 * El `studyId` es la clave del dato: la UI solo pinta lo que pertenece al
 * estudio pedido, así que al cambiar de estudio nunca se ven cifras del
 * anterior. Un token incremental descarta las respuestas que llegan tarde
 * (cambio rápido de estudio).
 */
export interface MetricsState {
  studyId: string | null
  metrics: Metrics | null
  loading: boolean
  error: string | null
}

export interface UseMetricsResult extends MetricsState {
  refetch: (id: string) => Promise<void>
}

/**
 * Hook que obtiene las métricas de un estudio (GET /api/studies/{id}/metrics).
 *
 * La primera llamada de un estudio puede tardar (el backend calcula las
 * métricas y las cachea), por eso `loading` se expone tal cual a la UI.
 * El mensaje de error no se muestra al usuario: la tarjeta usa un texto fijo
 * para no filtrar detalles del servidor (regla 04).
 */
export function useMetrics(): UseMetricsResult {
  const [state, setState] = useState<MetricsState>({
    studyId: null,
    metrics: null,
    loading: false,
    error: null,
  })
  const tokenRef = useRef(0)

  const load = useCallback(async (id: string) => {
    const token = ++tokenRef.current
    // El dato anterior desaparece ya en este render: se asocia al nuevo id y
    // queda en carga, nunca se mezclan estudios.
    setState({ studyId: id, metrics: null, loading: true, error: null })
    try {
      const data = await getMetrics(id)
      if (tokenRef.current !== token) return
      setState({ studyId: id, metrics: data, loading: false, error: null })
    } catch (err) {
      if (tokenRef.current !== token) return
      const message =
        err instanceof Error
          ? err.message
          : 'Error desconocido al cargar las métricas'
      setState({ studyId: id, metrics: null, loading: false, error: message })
    }
  }, [])

  const refetch = useCallback(
    (id: string) => {
      return load(id)
    },
    [load],
  )

  return { ...state, refetch }
}
