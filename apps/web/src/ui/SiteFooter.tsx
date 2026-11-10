import { useEffect, useState } from 'react'
import { loadConfig, useAi } from '../ai/client.ts'

interface Build {
  version: string | null
  sha: string | null
}

const WEB: Build = {
  version: import.meta.env.VITE_APP_VERSION || null,
  sha: import.meta.env.VITE_GIT_SHA || null,
}

/** "0.2.0 · 1a2b3c4", or "dev" for a local build without version info. */
function versionLine(b: Build | undefined): string {
  const parts = [b?.version, b?.sha?.slice(0, 7)].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'dev'
}

/** Web and API versions, so it's clear what is running (and whether both halves match). */
export function SiteFooter() {
  const api = useAi((s) => s.config?.build)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    loadConfig().catch(() => setFailed(true))
  }, [])
  let apiLine = '…'
  if (api) apiLine = versionLine(api)
  else if (failed) apiLine = 'utilgjengelig'
  const mismatch = Boolean(api?.version && WEB.version && api.version !== WEB.version)
  return (
    <footer className="site-footer">
      <span title={WEB.sha ?? undefined}>web {versionLine(WEB)}</span>
      <span title={api?.sha ?? undefined} className={mismatch ? 'mismatch' : undefined}>
        api {apiLine}
        {mismatch && ' (ulik versjon – last siden på nytt)'}
      </span>
    </footer>
  )
}
