import { z } from 'zod'

// Imported first by main.tsx, so it runs before any module that parses with Zod at import time.
// Zod 4 probes `new Function('')` on the first parse to decide whether to compile fast parsers. Our
// CSP (script-src 'self', no 'unsafe-eval') blocks that, and every page load would report a CSP
// violation (and, enforced, quietly fall back anyway). Skip the probe: parse without codegen.
z.config({ jitless: true })
