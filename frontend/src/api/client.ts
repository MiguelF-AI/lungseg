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
 * La primera llamada de un estudio puede tardar: el backend calcula las
 * métricas y las cachea (`storage/derived/{id}/metrics.json`). Las cifras
 * son estimaciones de un modelo experimental (no diagnóstico).
 */
export async function getMetrics(id: string): Promise<Metrics> {
  return fetchJson<Metrics>(`/studies/${encodeURIComponent(id)}/metrics`)
}

/**
 * Descarga el ZIP de máscaras de un estudio (F8, GET /export.zip).
 *
 * Se usa fetch + blob en vez de un enlace directo para poder mostrar estados
 * claros (preparando/éxito/error) y controlar el nombre del archivo sin salir
 * de la aplicación. El ZIP es pequeño: solo máscaras, nunca la CT.
 */
export async function downloadExport(id: string): Promise<void> {
  const res = await fetch(
    `${API_PREFIX}/studies/${encodeURIComponent(id)}/export.zip`,
    { headers: { Accept: 'application/zip' } },
  )

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

  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') ?? ''
  const match = disposition.match(/filename="([^"]+)"/)
  const filename = match?.[1] ?? `${id}_masks.zip`

  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    // Sin focus(): el foco del canvas de NiiVue no se toca.
    a.click()
    a.remove()
  } finally {
    // Liberar justo después de iniciar la descarga ( Firefox necesita el tick).
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
