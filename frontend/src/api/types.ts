/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Espejo exacto del contrato de API (§6 de PLAN.md) y de
 * backend/lungseg_api/schemas.py.
 *
 * Reglas (regla 01 de AGENTS.md):
 *  - nombres de campo, nulabilidad y tipos idénticos al backend;
 *  - si hay discrepancia con schemas.py o PLAN §6, reportarla al humano
 *    y corregir el lado correcto (no arreglar en silencio).
 */

export interface LayerInfo {
  key: string
  label: string
  kind: string
  color: string | null
  url: string | null
}

export interface StudySummary {
  id: string
  layers: string[]
  lesion_pct: number | null
  lesion_l: number | null
}

export interface StudyDetail {
  id: string
  shape: number[] | null
  spacing_mm: number[] | null
  layers: LayerInfo[]
}

export interface Metrics {
  lung_right_l: number
  lung_left_l: number
  lung_total_l: number
  lesion_l: number
  lesion_pct_of_lung: number
  lesion_by_lung_pct: { right: number; left: number }
  lesion_components: number
  lesion_centroid_mm: number[] | null
}
