import { useEffect, useState } from 'react'

function App() {
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((response) => response.json())
      .then((data) => setStatus(data.status))
      .catch((err) => setError(err.message))
  }, [])

  return (
    <div style={{ padding: '1rem', fontFamily: 'sans-serif' }}>
      <h1>LungSeg WebViewer</h1>
      {error ? (
        <p style={{ color: 'red' }}>Error: {error}</p>
      ) : (
        <p>Status: {status}</p>
      )}
    </div>
  )
}

export default App
