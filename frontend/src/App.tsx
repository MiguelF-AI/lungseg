import Sidebar from './components/Sidebar'
import ViewerToolbar from './components/ViewerToolbar'

export default function App() {
  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        background: 'var(--ls-bg)',
      }}
    >
      <Sidebar />

      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        {/* Visor (placeholder hasta F3) */}
        <div
          style={{
            flex: 1,
            background: 'var(--ls-bg)',
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              color: 'var(--ls-text-muted)',
              fontSize: 15,
              textAlign: 'center',
            }}
          >
            Visor NiiVue — F3
          </div>
        </div>

        {/* Selector de vista inferior */}
        <ViewerToolbar />
      </main>
    </div>
  )
}
