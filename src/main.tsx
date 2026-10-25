import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { JmriClient, resolveBase } from './jmri/client.ts'
import { ClientContext, KEYS, load, ToastHost } from './state.tsx'

const client = new JmriClient(resolveBase(load<string | null>(KEYS.server, null)))
client.start()
for (const req of load(KEYS.throttles, [])) client.acquireThrottle(req)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClientContext.Provider value={client}>
      <ToastHost>
        <App />
      </ToastHost>
    </ClientContext.Provider>
  </StrictMode>,
)
