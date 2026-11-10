import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '@romslig/shared'
import { Saver, type SaveState } from './saver.ts'

/** Only the fields the saver looks at; the rest of the project is the server's business. */
const project = (name: string, version = 1) => ({ id: 'p_1', name, version }) as Project

class HttpError extends Error {
  constructor(
    public status: number,
    message = `HTTP ${status}`,
  ) {
    super(message)
  }
}

/** A stand-in for the API: stores what it is given, and fails with whatever is queued in `failures`. */
function setup(options: { delay?: number; retryDelays?: number[]; leaveAttempts?: number } = {}) {
  const server = { stored: project('start'), saves: [] as { name: string; ifMatch: number }[] }
  const failures: unknown[] = []
  const states: SaveState[] = []
  const messages: (string | undefined)[] = []
  const open = { project: project('start') as Project | null }
  const save = vi.fn(async (p: Project, version: number) => {
    server.saves.push({ name: p.name, ifMatch: version })
    if (failures.length) throw failures.shift()
    if (version !== server.stored.version) throw new HttpError(409)
    server.stored = { ...p, version: version + 1 }
    return server.stored
  })
  const saver = new Saver({
    current: () => open.project,
    save,
    onState: (state, message) => {
      states.push(state)
      messages.push(message)
    },
    delay: options.delay ?? 600,
    retryDelays: options.retryDelays ?? [1000, 2000],
    leaveAttempts: options.leaveAttempts ?? 3,
  })
  saver.loaded(1)
  states.length = 0
  messages.length = 0
  const edit = (name: string) => {
    open.project = project(name)
    saver.changed()
  }
  return { saver, server, failures, states, messages, open, save, edit }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Saver', () => {
  it('saves once after a quiet moment, however many changes came before it', async () => {
    const t = setup()
    t.edit('a')
    await vi.advanceTimersByTimeAsync(500)
    t.edit('ab')
    await vi.advanceTimersByTimeAsync(500)
    expect(t.save).not.toHaveBeenCalled()
    expect(t.saver.unsaved).toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    expect(t.server.saves).toEqual([{ name: 'ab', ifMatch: 1 }])
    expect(t.states.at(-1)).toBe('saved')
    expect(t.saver.unsaved).toBe(false)
  })

  it('sends the next save with the version the previous one got back', async () => {
    const t = setup()
    t.edit('a')
    await vi.advanceTimersByTimeAsync(600)
    t.edit('b')
    await vi.advanceTimersByTimeAsync(600)
    expect(t.server.saves).toEqual([
      { name: 'a', ifMatch: 1 },
      { name: 'b', ifMatch: 2 },
    ])
  })

  it('never has two saves on their way at once', async () => {
    const t = setup()
    let release!: () => void
    t.save.mockImplementationOnce(
      (p, version) =>
        new Promise((resolve) => {
          t.server.saves.push({ name: p.name, ifMatch: version })
          release = () => {
            t.server.stored = { ...p, version: version + 1 }
            resolve(t.server.stored)
          }
        }),
    )
    t.edit('a')
    await vi.advanceTimersByTimeAsync(600)
    t.edit('b')
    await vi.advanceTimersByTimeAsync(600)
    // The first is still on its way: the second waits, and the label still says "saving"
    expect(t.server.saves).toHaveLength(1)
    expect(t.states.at(-1)).toBe('saving')
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.server.saves).toEqual([
      { name: 'a', ifMatch: 1 },
      { name: 'b', ifMatch: 2 },
    ])
    expect(t.states.at(-1)).toBe('saved')
  })

  it('flush saves at once', async () => {
    const t = setup()
    t.edit('a')
    await t.saver.flush()
    expect(t.server.stored.name).toBe('a')
    await vi.advanceTimersByTimeAsync(5000)
    expect(t.save).toHaveBeenCalledTimes(1)
  })

  it('flush does nothing when everything is saved', async () => {
    const t = setup()
    await t.saver.flush()
    expect(t.save).not.toHaveBeenCalled()
  })

  it('tries again with growing waits when the network is down, then saves', async () => {
    const t = setup()
    t.failures.push(new TypeError('Failed to fetch'), new HttpError(503), new HttpError(502))
    t.edit('a')
    await vi.advanceTimersByTimeAsync(600)
    expect(t.states.at(-1)).toBe('retrying')
    expect(t.messages.at(-1)).toBe('Failed to fetch')
    expect(t.saver.unsaved).toBe(true)
    await vi.advanceTimersByTimeAsync(999)
    expect(t.save).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(t.save).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2000)
    expect(t.save).toHaveBeenCalledTimes(3)
    // The last wait repeats
    await vi.advanceTimersByTimeAsync(2000)
    expect(t.save).toHaveBeenCalledTimes(4)
    expect(t.states.at(-1)).toBe('saved')
    expect(t.server.stored.name).toBe('a')
  })

  it('saves the newest project when it retries', async () => {
    const t = setup()
    t.failures.push(new HttpError(500))
    t.edit('a')
    await vi.advanceTimersByTimeAsync(600)
    t.edit('b')
    await vi.advanceTimersByTimeAsync(600)
    expect(t.server.stored.name).toBe('b')
    expect(t.states.at(-1)).toBe('saved')
  })

  it('does not retry by itself when the server refuses the save, but the next change tries again', async () => {
    const t = setup()
    t.failures.push(new HttpError(413, 'For stort'))
    t.edit('a')
    await vi.advanceTimersByTimeAsync(600)
    expect(t.states.at(-1)).toBe('error')
    expect(t.messages.at(-1)).toBe('For stort')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(t.save).toHaveBeenCalledTimes(1)
    expect(t.saver.unsaved).toBe(true)
    t.edit('b')
    await vi.advanceTimersByTimeAsync(600)
    expect(t.server.stored.name).toBe('b')
  })

  it('stops at a conflict until the user has chosen', async () => {
    const t = setup()
    t.server.stored = project('theirs', 5)
    t.edit('mine')
    await vi.advanceTimersByTimeAsync(600)
    expect(t.states.at(-1)).toBe('conflict')
    t.edit('mine too')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(t.save).toHaveBeenCalledTimes(1)
    expect(t.saver.unsaved).toBe(true)
  })

  it('overwrite saves our copy over the newer stored one', async () => {
    const t = setup()
    t.server.stored = project('theirs', 5)
    t.edit('mine')
    await vi.advanceTimersByTimeAsync(600)
    await t.saver.overwrite(5)
    expect(t.server.stored).toMatchObject({ name: 'mine', version: 6 })
    expect(t.states.at(-1)).toBe('saved')
  })

  it('loaded clears a conflict without saving anything', async () => {
    const t = setup()
    t.server.stored = project('theirs', 5)
    t.edit('mine')
    await vi.advanceTimersByTimeAsync(600)
    t.open.project = t.server.stored
    t.saver.loaded(5)
    expect(t.states.at(-1)).toBe('saved')
    expect(t.saver.unsaved).toBe(false)
    t.edit('theirs, edited')
    await vi.advanceTimersByTimeAsync(600)
    expect(t.server.stored).toMatchObject({ name: 'theirs, edited', version: 6 })
  })

  describe('leaving the editor', () => {
    it('saves a change that was still waiting, from the project as it was when leaving', async () => {
      const t = setup()
      t.edit('a')
      const left = t.saver.leave()
      // The next editor has replaced what the store holds
      t.open.project = null
      await left
      expect(t.server.saves).toEqual([{ name: 'a', ifMatch: 1 }])
      await vi.advanceTimersByTimeAsync(5000)
      expect(t.save).toHaveBeenCalledTimes(1)
    })

    it('waits for a save that is on its way and sends nothing more when that covered everything', async () => {
      const t = setup()
      t.edit('a')
      await vi.advanceTimersByTimeAsync(600)
      await t.saver.leave()
      expect(t.save).toHaveBeenCalledTimes(1)
    })

    it('does not save when nothing has changed', async () => {
      const t = setup()
      await t.saver.leave()
      expect(t.save).not.toHaveBeenCalled()
    })

    it('tries a few times, then gives up', async () => {
      const t = setup({ leaveAttempts: 3 })
      t.failures.push(new HttpError(503), new HttpError(503), new HttpError(503), new HttpError(503))
      t.edit('a')
      const left = t.saver.leave()
      await vi.advanceTimersByTimeAsync(10_000)
      await left
      expect(t.save).toHaveBeenCalledTimes(3)
    })

    it('gets through when the first attempt fails', async () => {
      const t = setup()
      t.failures.push(new TypeError('Failed to fetch'))
      t.edit('a')
      const left = t.saver.leave()
      await vi.advanceTimersByTimeAsync(1000)
      await left
      expect(t.server.stored.name).toBe('a')
    })

    it('reports nothing and ignores changes afterwards', async () => {
      const t = setup()
      t.edit('a')
      const seen = t.states.length
      await t.saver.leave()
      t.edit('b')
      await vi.advanceTimersByTimeAsync(5000)
      expect(t.states).toHaveLength(seen)
      expect(t.server.saves).toEqual([{ name: 'a', ifMatch: 1 }])
    })

    it('does not overwrite after a conflict', async () => {
      const t = setup()
      t.server.stored = project('theirs', 5)
      t.edit('mine')
      await vi.advanceTimersByTimeAsync(600)
      await t.saver.leave()
      expect(t.save).toHaveBeenCalledTimes(1)
      expect(t.server.stored.name).toBe('theirs')
    })
  })
})
