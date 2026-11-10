import { useEffect, useState } from 'react'
import { ProjectList } from './ui/ProjectList.tsx'
import { Editor } from './ui/Editor.tsx'
import { PrintPage } from './ui/PrintPage.tsx'
import { SiteFooter } from './ui/SiteFooter.tsx'

/** Minimal hash routing: #/ = project list, #/p/<id> = editor, #/p/<id>/print = print page. */
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
  const m = hash.match(/^#\/p\/([\w-]+)(\/print$)?/)
  const id = m?.[1]
  const Page = m?.[2] ? PrintPage : Editor
  return (
    <>
      {id ? <Page key={id} projectId={id} /> : <ProjectList />}
      <SiteFooter />
    </>
  )
}
