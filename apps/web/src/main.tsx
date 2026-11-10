import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { z } from 'zod'
import { App } from './App.tsx'
import './styles.css'

// Zod 4 probes `new Function('')` on the first parse to decide whether to compile fast parsers. Our
// CSP (script-src 'self', no 'unsafe-eval') blocks that, and every page load would report a CSP
// violation (and, enforced, quietly fall back anyway). Skip the probe: parse without codegen.
z.config({ jitless: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
