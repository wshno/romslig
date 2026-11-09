import { useEffect, useState } from 'react'
import { ProjectList } from './ui/ProjectList.tsx'
import { Editor } from './ui/Editor.tsx'
import { SiteFooter } from './ui/SiteFooter.tsx'

/** Minimal hash routing: #/ = project list, #/p/<id> = editor. */
function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

export function App() {
  const hash = useHashRoute()
  const m = hash.match(/^#\/p\/([\w-]+)/)
  return (
    <>
      {m ? <Editor key={m[1]} projectId={m[1]!} /> : <ProjectList />}
      <SiteFooter />
    </>
  )
}
