// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ProjectSummary } from '@romslig/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectList } from './ProjectList.tsx'

const saveFile = vi.hoisted(() => vi.fn())
vi.mock('../download.ts', () => ({ saveFile }))

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const failure = (error: string, status = 500) => json({ error }, status)

const kitchen = { id: 'p_1', name: 'Kjøkken', updatedAt: '2026-11-01T10:00:00Z' } as ProjectSummary
const bath = { id: 'p_2', name: 'Bad', updatedAt: '2026-11-02T10:00:00Z' } as ProjectSummary

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

/** Answers fetch by "METHOD url"; the list is answered from `projects` unless a route overrides it. */
function stubApi(routes: Record<string, Handler>, projects: () => ProjectSummary[] = () => [kitchen, bath]) {
  const fetchMock = vi.fn((url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${url}`
    const route = routes[key] ?? (key === 'GET /api/projects' ? () => json(projects()) : undefined)
    return Promise.resolve(route ? route(url, init) : failure(`no route for ${key}`, 404))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const calls = (fetchMock: ReturnType<typeof stubApi>, method: string) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === method)

/** The list item of a project, found by its name link. */
function rowOf(name: string) {
  const item = screen.getAllByRole('listitem').find((li) => within(li).queryByRole('link', { name }))
  if (!item) throw new Error(`no row for ${name}`)
  return item
}

const openRename = (name: string) => fireEvent.click(within(rowOf(name)).getByRole('button', { name: 'Gi nytt navn' }))

describe('ProjectList', () => {
  beforeEach(() => {
    window.location.hash = ''
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    saveFile.mockReset()
  })

  it('lists the projects with links', async () => {
    stubApi({})
    render(<ProjectList />)
    expect(screen.getByText('Laster…')).toBeInTheDocument()

    expect(await screen.findByRole('link', { name: 'Kjøkken' })).toHaveAttribute('href', '#/p/p_1')
    expect(screen.getByRole('link', { name: 'Bad' })).toHaveAttribute('href', '#/p/p_2')
  })

  it('says when there are no projects', async () => {
    stubApi({}, () => [])
    render(<ProjectList />)
    expect(await screen.findByText('Ingen prosjekter ennå.')).toBeInTheDocument()
  })

  it('says when the projects cannot be listed', async () => {
    stubApi({ 'GET /api/projects': () => failure('database nede') })
    render(<ProjectList />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Kunne ikke hente prosjektene: database nede')
    expect(screen.queryByText('Laster…')).not.toBeInTheDocument()
  })

  it('creates a project with the default name and opens it', async () => {
    const fetchMock = stubApi({ 'POST /api/projects': () => json({ id: 'p_9', name: 'Min leilighet' }) })
    render(<ProjectList />)
    await screen.findByRole('link', { name: 'Kjøkken' })

    fireEvent.click(screen.getByRole('button', { name: 'Opprett prosjekt' }))

    await waitFor(() => expect(window.location.hash).toBe('#/p/p_9'))
    const body = calls(fetchMock, 'POST')[0]![1]!.body as FormData
    expect(body.get('name')).toBe('Min leilighet')
    expect(body.has('image')).toBe(false)
  })

  it('shows why a project could not be created', async () => {
    stubApi({ 'POST /api/projects': () => failure('Navnet er for langt.', 400) })
    render(<ProjectList />)

    fireEvent.change(screen.getByLabelText('Navn'), { target: { value: 'Hytta' } })
    fireEvent.change(screen.getByLabelText('Plantegning (JPG/PNG)'), { target: { files: [] } })
    fireEvent.click(screen.getByRole('button', { name: 'Opprett prosjekt' }))

    expect(await screen.findByText('Navnet er for langt.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Opprett prosjekt' })).toBeEnabled()
  })

  it('leaves the rename form on Avbryt, on Escape, and on an unchanged name without a request', async () => {
    const fetchMock = stubApi({})
    render(<ProjectList />)
    await screen.findByRole('link', { name: 'Kjøkken' })

    openRename('Kjøkken')
    fireEvent.click(screen.getByRole('button', { name: 'Avbryt' }))
    expect(screen.queryByLabelText('Nytt navn')).not.toBeInTheDocument()

    openRename('Kjøkken')
    fireEvent.keyDown(screen.getByLabelText('Nytt navn'), { key: 'Escape' })
    expect(screen.queryByLabelText('Nytt navn')).not.toBeInTheDocument()

    openRename('Kjøkken')
    const field = screen.getByLabelText('Nytt navn')
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: 'Lagre' })).toBeDisabled()
    fireEvent.submit(field)
    expect(screen.getByLabelText('Nytt navn')).toBeInTheDocument()

    fireEvent.change(field, { target: { value: 'Kjøkken' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lagre' }))
    await waitFor(() => expect(screen.queryByLabelText('Nytt navn')).not.toBeInTheDocument())
    expect(calls(fetchMock, 'PATCH')).toHaveLength(0)
  })

  it('renames a project', async () => {
    let projects = [kitchen, bath]
    stubApi(
      {
        'PATCH /api/projects/p_1': (_url, init) => {
          const { name } = JSON.parse(init.body as string) as { name: string }
          projects = [{ ...kitchen, name }, bath]
          return json(projects[0])
        },
      },
      () => projects,
    )
    render(<ProjectList />)
    await screen.findByRole('link', { name: 'Kjøkken' })

    openRename('Kjøkken')
    fireEvent.change(screen.getByLabelText('Nytt navn'), { target: { value: ' Nytt kjøkken ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lagre' }))

    expect(await screen.findByRole('link', { name: 'Nytt kjøkken' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Nytt navn')).not.toBeInTheDocument()
  })

  it('keeps the rename form open and says why when the rename fails', async () => {
    stubApi({ 'PATCH /api/projects/p_1': () => failure('Ugyldig navn.', 400) })
    render(<ProjectList />)
    await screen.findByRole('link', { name: 'Kjøkken' })

    openRename('Kjøkken')
    fireEvent.change(screen.getByLabelText('Nytt navn'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lagre' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Kunne ikke gi nytt navn til «Kjøkken»: Ugyldig navn.')
    expect(screen.getByLabelText('Nytt navn')).toBeInTheDocument()
  })

  it('copies a project and shows the fresh list', async () => {
    let projects = [kitchen]
    stubApi(
      {
        'POST /api/projects/p_1/copy': () => {
          projects = [kitchen, { ...kitchen, id: 'p_3', name: 'Kjøkken (kopi)' }]
          return json(projects[1])
        },
      },
      () => projects,
    )
    render(<ProjectList />)
    await screen.findByRole('link', { name: 'Kjøkken' })

    fireEvent.click(within(rowOf('Kjøkken')).getByRole('button', { name: 'Kopier' }))

    expect(await screen.findByRole('link', { name: 'Kjøkken (kopi)' })).toBeInTheDocument()
  })

  it('deletes a project only when confirmed', async () => {
    let projects = [kitchen, bath]
    const fetchMock = stubApi(
      {
        'DELETE /api/projects/p_2': () => {
          projects = [kitchen]
          return new Response(null, { status: 204 })
        },
      },
      () => projects,
    )
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    render(<ProjectList />)
    await screen.findByRole('link', { name: 'Bad' })

    fireEvent.click(within(rowOf('Bad')).getByRole('button', { name: 'Slett' }))
    expect(confirm).toHaveBeenCalledWith('Slette «Bad»?')
    expect(calls(fetchMock, 'DELETE')).toHaveLength(0)

    confirm.mockReturnValue(true)
    fireEvent.click(within(rowOf('Bad')).getByRole('button', { name: 'Slett' }))
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Bad' })).not.toBeInTheDocument())
  })

  it('exports a project as a file', async () => {
    stubApi({ 'GET /api/projects/p_1/export': () => json({ format: 'romslig', project: { name: 'Kjøkken' } }) })
    render(<ProjectList />)
    await screen.findByRole('link', { name: 'Kjøkken' })

    fireEvent.click(within(rowOf('Kjøkken')).getByRole('button', { name: 'Eksporter' }))

    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    const [name, blob] = saveFile.mock.calls[0] as [string, Blob]
    expect(name).toMatch(/\.json$/)
    expect(JSON.parse(await blob.text())).toEqual({ format: 'romslig', project: { name: 'Kjøkken' } })
  })

  it('keeps the message about a failed action when the list then fails too', async () => {
    let listFails = false
    stubApi({
      'GET /api/projects/p_1/export': () => {
        listFails = true
        return failure('Fant ikke prosjektet.', 404)
      },
      'GET /api/projects': () => (listFails ? failure('borte') : json([kitchen])),
    })
    render(<ProjectList />)
    await screen.findByRole('link', { name: 'Kjøkken' })

    fireEvent.click(within(rowOf('Kjøkken')).getByRole('button', { name: 'Eksporter' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Kunne ikke eksportere «Kjøkken»: Fant ikke prosjektet.')
  })

  it('imports a project from a file', async () => {
    let projects = [kitchen]
    const fetchMock = stubApi(
      {
        'POST /api/projects/import': () => {
          projects = [kitchen, bath]
          return json(bath)
        },
      },
      () => projects,
    )
    render(<ProjectList />)
    await screen.findByRole('link', { name: 'Kjøkken' })
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Importer fra fil' }))
    expect(click).toHaveBeenCalled()

    const file = new File(['{}'], 'bad.json', { type: 'application/json' })
    fireEvent.change(screen.getByLabelText('Fil å importere'), { target: { files: [file] } })

    expect(await screen.findByRole('link', { name: 'Bad' })).toBeInTheDocument()
    const body = calls(fetchMock, 'POST')[0]![1]!.body as FormData
    expect(body.get('file')).toBeInstanceOf(File)

    // No file chosen: nothing happens
    fireEvent.change(screen.getByLabelText('Fil å importere'), { target: { files: [] } })
    expect(calls(fetchMock, 'POST')).toHaveLength(1)
  })

  it('says why an import failed', async () => {
    stubApi({ 'POST /api/projects/import': () => failure('Filen er ikke et Romslig-prosjekt.', 400) })
    render(<ProjectList />)
    await screen.findByRole('link', { name: 'Kjøkken' })

    const file = new File(['x'], 'notes.json', { type: 'application/json' })
    fireEvent.change(screen.getByLabelText('Fil å importere'), { target: { files: [file] } })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Kunne ikke importere «notes.json»: Filen er ikke et Romslig-prosjekt.',
    )
  })
})
