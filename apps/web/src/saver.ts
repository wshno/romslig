import type { Project } from '@romslig/shared'

/**
 * - `saved`: the server has everything.
 * - `saving`: a change is waiting to be sent, or is on its way.
 * - `retrying`: the last attempt failed in a way that may pass (network, 5xx); a new one is scheduled.
 * - `error`: the server refused the save; nothing more happens until the next change or `flush()`.
 * - `conflict`: someone else saved first (409); waits for `loaded()` or `overwrite()`.
 */
export type SaveState = 'saved' | 'saving' | 'retrying' | 'error' | 'conflict'

export interface SaverOptions {
  /** The project as it is right now, or null when none is open. */
  current(): Project | null
  /** Stores the project if the stored version is still `version`; answers with what was stored. */
  save(project: Project, version: number): Promise<Project>
  /** Called when the state changes. `message` says what went wrong for `retrying` and `error`. */
  onState(state: SaveState, message?: string): void
  /** Quiet time after the last change before it is sent, in ms. */
  delay?: number
  /** Waits between attempts after a failure that may pass, in ms. The last one repeats. */
  retryDelays?: number[]
  /** How many times to try when leaving the editor. */
  leaveAttempts?: number
}

const statusOf = (e: unknown): number | undefined => {
  const status = (e as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : undefined
}

/** No answer from our API at all (network, proxy), or an answer that says "try later". */
const mayPass = (e: unknown): boolean => {
  const status = statusOf(e)
  return status === undefined || status >= 500 || status === 408 || status === 429
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Autosave for one open project: waits for a quiet moment after a change, sends one save at a time
 * (two saves racing would look like a conflict with ourselves), tries again when the network or the
 * server fails, and does not drop a change that is still waiting when the editor is left.
 */
export class Saver {
  /** Server version the next save must match (If-Match). */
  private version = 0
  /** There are changes that no successful save has covered. */
  private dirty = false
  private sending = 0
  private conflicted = false
  private left = false
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private queue: Promise<void> = Promise.resolve()
  private readonly delay: number
  private readonly retryDelays: number[]
  private readonly leaveAttempts: number

  constructor(private readonly opts: SaverOptions) {
    this.delay = opts.delay ?? 600
    this.retryDelays = opts.retryDelays ?? [1000, 2000, 5000, 10_000, 30_000]
    this.leaveAttempts = opts.leaveAttempts ?? 3
  }

  /** True while there is a change the server has not confirmed. */
  get unsaved(): boolean {
    return this.dirty || this.sending > 0
  }

  /** The project was (re)loaded from the server at `version`: nothing is waiting to be saved. */
  loaded(version: number): void {
    this.cancelTimer()
    this.version = version
    this.dirty = false
    this.conflicted = false
    this.attempt = 0
    this.emit('saved')
  }

  /** The project changed: save it after a quiet moment. */
  changed(): void {
    if (this.left) return
    this.dirty = true
    if (this.conflicted) return
    this.attempt = 0
    this.emit('saving')
    this.schedule(this.delay)
  }

  /** Saves now what is not yet saved, without waiting for the quiet moment or the next retry. */
  flush(): Promise<void> {
    this.cancelTimer()
    this.queue = this.queue.then(() => this.send())
    return this.queue
  }

  /** After a conflict: save our copy over the stored one, which is at `version`. */
  overwrite(version: number): Promise<void> {
    this.version = version
    this.conflicted = false
    this.dirty = true
    this.emit('saving')
    return this.flush()
  }

  /**
   * The editor is closing. Saves what is not yet saved, in the background, from the project as it is
   * at this moment (the store will hold something else by the time the request is sent). Reports
   * nothing, since nobody is listening any more. Resolves when the save has succeeded or been given up.
   */
  leave(): Promise<void> {
    this.cancelTimer()
    this.left = true
    const project = this.opts.current()
    this.queue = this.queue.then(async () => {
      if (!project || !this.dirty || this.conflicted) return
      for (let attempt = 1; ; attempt++) {
        try {
          const stored = await this.opts.save(project, this.version)
          this.version = stored.version
          this.dirty = false
          return
        } catch (e) {
          if (!mayPass(e) || attempt >= this.leaveAttempts) return
          await new Promise((resolve) => setTimeout(resolve, this.retryDelay(attempt - 1)))
        }
      }
    })
    return this.queue
  }

  private async send(): Promise<void> {
    if (!this.dirty || this.conflicted || this.left) return
    const project = this.opts.current()
    if (!project) return
    this.dirty = false
    this.sending++
    try {
      const stored = await this.opts.save(project, this.version)
      this.version = stored.version
      this.attempt = 0
      // A change made while this one was on its way has its own save scheduled
      if (!this.dirty) this.emit('saved')
    } catch (e) {
      this.dirty = true
      if (statusOf(e) === 409) {
        this.conflicted = true
        this.cancelTimer()
        this.emit('conflict')
      } else if (mayPass(e)) {
        this.emit('retrying', messageOf(e))
        if (!this.timer) this.schedule(this.retryDelay(this.attempt++))
      } else {
        this.emit('error', messageOf(e))
      }
    } finally {
      this.sending--
    }
  }

  private retryDelay(attempt: number): number {
    return this.retryDelays[Math.min(attempt, this.retryDelays.length - 1)] ?? 1000
  }

  private schedule(ms: number): void {
    this.cancelTimer()
    if (this.left) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, ms)
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private emit(state: SaveState, message?: string): void {
    if (!this.left) this.opts.onState(state, message)
  }
}
