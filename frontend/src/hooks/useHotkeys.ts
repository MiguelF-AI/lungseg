import { useCallback, useEffect, useRef } from 'react'

import type { ViewMode } from './useNiivue'

export type HotkeyAction =
  | { kind: 'view'; mode: ViewMode; announce?: string }
  | { kind: 'centerLesion'; announce?: string }
  | { kind: 'toggleLesion'; announce?: string }
  | { kind: 'toggleLungs'; announce?: string }
  | { kind: 'toggleRadiological'; announce?: string }
  | { kind: 'prevStudy'; announce?: string }
  | { kind: 'nextStudy'; announce?: string }
  | { kind: 'toggleClipPlane'; announce?: string }
  | { kind: 'toggleHelp' }
  | { kind: 'closeHelp' }

/** Elementos que son campos de texto: ahí no se disparan atajos. */
const TEXT_FIELDS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * Función pura: decide qué acción corresponde a una tecla.
 * No toca el DOM: se puede probar pasando un objeto parecido a KeyboardEvent.
 *
 * Reglas:
 *  - Ignora Ctrl/Meta/Alt salvo AltGraph (así AltGr+[ ] funcionan).
 *  - Compara e.key en minúsculas (mayúsculas bloqueadas no lo rompen).
 *  - `?` se detecta con e.key === '?'.
 *  - Con el modal de ayuda abierto solo actúan Esc y `?`.
 */
export function resolveHotkey(
  e: KeyboardEvent,
  helpOpen: boolean,
): HotkeyAction | null {
  const key = e.key.toLowerCase()

  const target = e.target as HTMLElement | null
  if (
    target &&
    (TEXT_FIELDS.has(target.tagName) || target.isContentEditable === true)
  ) {
    return null
  }

  // No romper atajos del navegador/OS con modificadores, salvo AltGraph.
  if (
    (e.ctrlKey || e.metaKey || e.altKey) &&
    !e.getModifierState('AltGraph')
  ) {
    return null
  }

  // Evitar repeticiones al mantener pulsada la tecla.
  if (e.repeat) {
    return null
  }

  // Con el modal de ayuda abierto solo actúan Esc y `?`.
  if (helpOpen) {
    if (key === 'escape') return { kind: 'closeHelp' }
    if (key === '?') return { kind: 'toggleHelp' }
    return null
  }

  // `?` abre la ayuda (detectado por key, no por code: en teclados
  // latinoamericanos Shift+"-" es físicamente Shift+Slash).
  if (key === '?') return { kind: 'toggleHelp' }

  // 1 Multi · 2 Axial · 3 Coronal · 4 Sagital · 5 3D
  if (key >= '1' && key <= '5') {
    const MODES: ViewMode[] = ['Multi', 'Axial', 'Coronal', 'Sagital', '3D']
    const mode = MODES[Number(key) - 1]
    return { kind: 'view', mode, announce: `Vista: ${mode}` }
  }

  // G: centrar en lesión
  if (key === 'g') return { kind: 'centerLesion' }

  // E: mostrar/ocultar lesión · P: mostrar/ocultar pulmones
  if (key === 'e') return { kind: 'toggleLesion' }
  if (key === 'p') return { kind: 'toggleLungs' }

  // R: convención radiológica
  if (key === 'r') return { kind: 'toggleRadiological' }

  // C: plano de corte (activar/desactivar)
  if (key === 'c') return { kind: 'toggleClipPlane' }

  // Estudio anterior/siguiente: [ ] , .
  if (key === '[' || key === ',') return { kind: 'prevStudy' }
  if (key === ']' || key === '.') return { kind: 'nextStudy' }

  return null
}

export interface UseHotkeysOptions {
  onViewModeChange: (mode: ViewMode) => void
  onCenterLesion: () => void
  onToggleLesion: () => void
  onToggleLungs: () => void
  onToggleRadiological: () => void
  onToggleClipPlane: () => void
  onPrevStudy: () => void
  onNextStudy: () => void
  onToggleHelp: () => void
  onCloseHelp: () => void
  /** Último estado para decidir si una acción puede ejecutarse. */
  helpOpen: boolean
  canCenterLesion: boolean
  clipPlaneEnabled: boolean
  lesionVisible: boolean
  lungsVisible: boolean
  studyIndex: number
  studyCount: number
  onAnnounce: (message: string) => void
}

/**
 * Registra los atajos de teclado UNA sola vez (no en cada render).
 * Listener en `window` en fase de CAPTURA: para las teclas que manejamos hace
 * preventDefault + stopPropagation, así el listener del canvas de NiiVue
 * nunca las ve. Tragas Shift+Slash para evitar el alert de NiiVue.
 */
export function useHotkeys(opts: UseHotkeysOptions): void {
  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  }, [opts])

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      // NiiVue lanza un alert() con la versión en Shift+Slash: lo tragamos.
      if (e.code === 'Slash' && e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        return
      }

      const action = resolveHotkey(e, optsRef.current.helpOpen)
      if (!action) return

      // Solo prevenimos/propagamos para teclas que realmente manejamos.
      e.preventDefault()
      e.stopPropagation()

      const o = optsRef.current

      switch (action.kind) {
        case 'view':
          o.onViewModeChange(action.mode)
          o.onAnnounce(action.announce ?? `Vista: ${action.mode}`)
          break
        case 'centerLesion':
          if (!o.canCenterLesion) {
            o.onAnnounce(
              'Este estudio no tiene lesión segmentada o el visor no está listo.',
            )
            return
          }
          o.onCenterLesion()
          o.onAnnounce('Centrando en la lesión.')
          break
        case 'toggleLesion':
          o.onToggleLesion()
          o.onAnnounce(
            o.lesionVisible ? 'Lesión oculta' : 'Lesión mostrada',
          )
          break
        case 'toggleLungs':
          o.onToggleLungs()
          o.onAnnounce(
            o.lungsVisible ? 'Pulmones ocultos' : 'Pulmones mostrados',
          )
          break
        case 'toggleRadiological':
          o.onToggleRadiological()
          break
        case 'toggleClipPlane':
          o.onToggleClipPlane()
          o.onAnnounce(
            o.clipPlaneEnabled ? 'Plano de corte activado' : 'Plano de corte desactivado',
          )
          break
        case 'prevStudy':
          o.onPrevStudy()
          o.onAnnounce(`Estudio ${o.studyIndex} de ${o.studyCount}`)
          break
        case 'nextStudy':
          o.onNextStudy()
          o.onAnnounce(`Estudio ${o.studyIndex} de ${o.studyCount}`)
          break
        case 'toggleHelp':
          o.onToggleHelp()
          break
        case 'closeHelp':
          o.onCloseHelp()
          break
      }
    },
    [],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKey, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleKey, { capture: true })
    }
  }, [handleKey])
}
