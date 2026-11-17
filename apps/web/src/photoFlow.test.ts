import { afterEach, describe, expect, it, vi } from 'vitest'
import { endPhotoFlow, holdPhotoFlow, onPhotoFlow, photoFlowOpen, type PhotoFlowEvent } from './photoFlow.ts'

describe('photoFlow', () => {
  const releases: (() => void)[] = []
  afterEach(() => {
    releases.splice(0).forEach((r) => r())
  })

  it('is open while something holds it, and says so to its listeners', () => {
    const heard: PhotoFlowEvent[] = []
    const off = onPhotoFlow((e) => heard.push(e))
    expect(photoFlowOpen()).toBe(false)

    const release = holdPhotoFlow()
    expect(photoFlowOpen()).toBe(true)
    endPhotoFlow('placed')
    release()
    expect(photoFlowOpen()).toBe(false)
    expect(heard).toEqual(['open', 'placed', 'gone'])
    off()
  })

  it('is gone only when the last holder lets go, and a release counts once', () => {
    const listener = vi.fn()
    const off = onPhotoFlow(listener)
    const a = holdPhotoFlow()
    const b = holdPhotoFlow()
    a()
    a()
    expect(photoFlowOpen()).toBe(true)
    expect(listener).not.toHaveBeenCalledWith('gone')
    b()
    expect(photoFlowOpen()).toBe(false)
    expect(listener).toHaveBeenLastCalledWith('gone')
    off()
  })

  it('stops telling a listener that unsubscribed', () => {
    const listener = vi.fn()
    onPhotoFlow(listener)()
    releases.push(holdPhotoFlow())
    expect(listener).not.toHaveBeenCalled()
  })
})
