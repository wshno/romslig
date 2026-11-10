import type { RoomType } from '@romslig/shared'

export { ROOM_COLORS } from '@romslig/shared'

export const ROOM_LABELS: Record<RoomType, string> = {
  stue: 'Stue',
  kjøkken: 'Kjøkken',
  soverom: 'Soverom',
  bad: 'Bad',
  wc: 'WC',
  gang: 'Gang',
  entré: 'Entré',
  bod: 'Bod',
  vaskerom: 'Vaskerom',
  kontor: 'Kontor',
  balkong: 'Balkong',
  annet: 'Annet',
}

export const fmtM = (m: number) => `${m.toFixed(2).replace('.', ',')} m`
export const fmtM2 = (m2: number) => `${m2.toFixed(1).replace('.', ',')} m²`
