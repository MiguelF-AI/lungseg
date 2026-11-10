# PROGRESS — LungSeg WebViewer

Tablero de tickets y bitácora de checkpoints. Los tickets están definidos en [`PLAN.md`](PLAN.md) §8.

## 1. Tablero

Leyenda: ⬜ pendiente · 🟨 en curso · ✅ hecho · ⏸ bloqueado

| Fase | Ticket | Descripción | Depende de | Estado |
|------|--------|-------------|------------|--------|
| 0 | A0 | Scaffold (uv, FastAPI, Vite + React + TS + NiiVue) | — | ⬜ |
| 1 | B1 | Catálogo de estudios | A0 | ⬜ |
| 1 | B2 | Derivados y archivos (ETag/304) | B1 | ⬜ |
| 1 | B3 | Métricas | B2 | ⬜ |
| 1 | F1 | Shell y sistema de diseño | A0 | ⬜ |
| 1 | F2 | Cliente API tipado | F1, B1 | ⬜ |
| 1 | F3 | Componente `NiiViewer` | F2, B2 | ⬜ |
| 1 | F4 | Panel de capas | F3 | ⬜ |
| 1 | V0 | Verificación de alineación con casos reales | F4, B2 | ⬜ |
| 1 | F6 | Métricas y «Centrar en lesión» | F3, B3 | ⬜ |
| 1 | F5 | Selector de estudios y atajos | F3 | ⬜ |
| 1 | F7 | Pulido 3D | F3, F4 | ⬜ |
| 1 | F8 | Exportar (ZIP + captura) | F4, B2 | ⬜ |
| 2 | U1 | Subida de estudios (opcional) | B2, F4 | ⬜ |
| 2 | D1 | Dibujo y corrección (opcional) | U1 | ⬜ |
| 3 | I1 | Inferencia en CPU desde la web (opcional) | U1, B2 | ⬜ |
| 4 | Q1 | QA visual e2e (Playwright) | F6 | ⬜ |
| 4 | Q2 | Empaquetado Docker (opcional) | F8 | ⬜ |

## 2. Bitácora de checkpoints

Formato de cada entrada (la más reciente arriba):

```
### CP-NNN · AAAA-MM-DD · <ticket>
- Qué cambió:
- Cómo se verificó (comandos y/o revisión visual con qué caso):
- Desviaciones del plan y por qué:
- Pendiente / siguiente paso:
```

_(Sin checkpoints todavía.)_
