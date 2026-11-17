import type { LayerInfo } from './api/types'

/**
 * Estado visible de una capa del visor.
 *
 * Es la única fuente de verdad que comparten el panel de capas y NiiVue:
 * - `visible`: ojo del panel (se aplica como opacidad 0 en el volumen ya cargado).
 * - `opacity`: 0–1, se aplica al volumen sin recargarlo.
 * - `color`: color de la máscara (solo capas `mask`); `null` para la CT.
 */
export interface LayerVisualSettings {
  visible: boolean
  opacity: number
  color: string | null
}

/** Ventana de la CT en unidades Hounsfield (nivel y ancho). */
export interface CtWindow {
  level: number
  width: number
}

/** Opacidad inicial por capa (PLAN §7). */
export const DEFAULT_OPACITY: Record<string, number> = {
  ct: 1,
  lung_right: 0.25,
  lung_left: 0.25,
  lesion: 0.8,
}

/** Ventana pulmonar por defecto: −650 / 1500 HU → cal_min −1400, cal_max 100. */
export const DEFAULT_CT_WINDOW: CtWindow = { level: -650, width: 1500 }

/** Presets de ventana de la CT (HU). */
export const CT_WINDOW_PRESETS: ReadonlyArray<{
  id: string
  label: string
  level: number
  width: number
}> = [
  { id: 'lung', label: 'Pulmón', level: -650, width: 1500 },
  { id: 'mediastinum', label: 'Mediastino', level: 40, width: 400 },
  { id: 'bone', label: 'Hueso', level: 400, width: 1800 },
]

/**
 * Ajustes por defecto de una capa a partir del contrato §6.
 * Se derivan durante el render; nunca se copian props a estado con un efecto.
 */
export function defaultLayerSettings(layer: LayerInfo): LayerVisualSettings {
  return {
    visible: true,
    opacity: DEFAULT_OPACITY[layer.key] ?? 1,
    color: layer.kind === 'mask' ? layer.color : null,
  }
}

/** Convierte nivel/ancho (HU) a cal_min/cal_max de NiiVue. */
export function windowToRange(window: CtWindow): { calMin: number; calMax: number } {
  return {
    calMin: window.level - window.width / 2,
    calMax: window.level + window.width / 2,
  }
}

/** Texto legible de la ventana actual, p. ej. «Nivel −650 · ancho 1500 HU». */
export function formatCtWindow(window: CtWindow): string {
  return `Nivel ${window.level} · ancho ${window.width} HU`
}
