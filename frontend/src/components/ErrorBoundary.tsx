import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error: Error | null
}

/**
 * Error boundary que aísla el visor NiiVue.
 *
 * Si el visor lanza un error (fallo de WebGL2, carga de volumen, etc.),
 * se captura aquí y la sidebar sigue disponible. Se ofrece un botón para
 * reintentar el render del visor.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // No registrar cabeceras NIfTI ni rutas del servidor; solo el error de React.
    console.error('[LungSeg] Error capturado por ErrorBoundary:', error, errorInfo.componentStack)
  }

  handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      const fallback = this.props.fallback
      if (fallback) {
        return fallback(this.state.error, this.handleReset)
      }
      return (
        <div
          style={{
            padding: 16,
            color: 'var(--ls-text)',
            background: 'var(--ls-bg)',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
            El visor presentó un error
          </div>
          <p
            style={{
              fontSize: 13,
              color: 'var(--ls-text-muted)',
              maxWidth: 420,
              lineHeight: 1.5,
            }}
          >
            Se produjo un error al renderizar el visor. La sidebar sigue
            disponible.
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 500,
              marginTop: 10,
              border: '1px solid var(--ls-accent)',
              borderRadius: 'var(--ls-radius)',
              background: 'var(--ls-accent)',
              color: '#ffffff',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            Recargar visor
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary
