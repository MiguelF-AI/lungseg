/**
 * Mueve el índice de estudio por `delta`, respetando los límites de la lista.
 * Misma lógica para los botones ◀ ▶ y para los atajos [ ] , . (no se
 * duplica código).
 */
export function moveStudyIndex(
  studies: readonly { id: string }[],
  currentIndex: number,
  delta: number,
): number {
  if (studies.length === 0) return 0
  const next = currentIndex + delta
  if (next < 0) return 0
  if (next >= studies.length) return studies.length - 1
  return next
}
