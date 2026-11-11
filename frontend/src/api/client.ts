/**
 * Cliente de la API de LungSeg.
 *
 * - Usa rutas relativas `/api/...` que pasan por el proxy de Vite
 *   (vite.config.ts: `/api → http://localhost:8000`).
 * - Nunca hardcodea rutas absolutas ni URLs del servidor.
 * - `ApiError` expone el status HTTP y el mensaje (sin rutas absolutas
 *   del servidor, regla 04 de AGENTS.md).
 */

import type { Metrics, StudyDetail, StudySummary } from './types'

export class ApiError extends Error {
  readonly status: number
  readonly message: string

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.message = message
  }
}

const API_PREFIX = '/api'

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_PREFIX}${path}`, {
    headers: { Accept: 'application/json' },
  })

  if (!res.ok) {
    let detail: string | unknown
    try {
      const body = await res.json()
      detail = body?.detail ?? body
    } catch {
      detail = res.statusText
    }
    const message =
      typeof detail === 'string' ? detail : String(detail ?? res.statusText)
    throw new ApiError(res.status, message)
  }

  return (await res.json()) as T
}

/**
 * Lista de estudios (GET /api/studies).
 */
export async function getStudies(): Promise<StudySummary[]> {
  return fetchJson<StudySummary[]>('/studies')
}

/**
 * Detalle de un estudio (GET /api/studies/{id}).
 */
export async function getStudy(id: string): Promise<StudyDetail> {
  return fetchJson<StudyDetail>(`/studies/${encodeURIComponent(id)}`)
}

/**
 * Métricas de un estudio (GET /api/studies/{id}/metrics).
 *
 * NOTA (ticket F2): este endpoint todavía NO existe (es el ticket B3).
 * Se define el tipo, la función y el hook, pero NO se llama desde la UI
 * hasta que B3 lo implemente. La MetricsCard sigue con datos simulados.
 */
export async function getMetrics(id: string): Promise<Metrics> {
  return fetchJson<Metrics>(`/studies/${encodeURIComponent(id)}/metrics`)
}
