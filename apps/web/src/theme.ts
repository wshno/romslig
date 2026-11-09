import type { RoomType } from "@romslig/shared";

export const ROOM_COLORS: Record<RoomType, string> = {
  stue: "#f4c27a",
  kjøkken: "#f29e6d",
  soverom: "#9db8e8",
  bad: "#7fd1d6",
  wc: "#9ad9cf",
  gang: "#d8cfc0",
  entré: "#cfc4b3",
  bod: "#bdb6aa",
  vaskerom: "#a8d5e2",
  kontor: "#b8d99a",
  balkong: "#c9e3b0",
  annet: "#d9d2e9",
};

export const ROOM_LABELS: Record<RoomType, string> = {
  stue: "Stue",
  kjøkken: "Kjøkken",
  soverom: "Soverom",
  bad: "Bad",
  wc: "WC",
  gang: "Gang",
  entré: "Entré",
  bod: "Bod",
  vaskerom: "Vaskerom",
  kontor: "Kontor",
  balkong: "Balkong",
  annet: "Annet",
};

export const fmtM = (m: number) => `${m.toFixed(2).replace(".", ",")} m`;
export const fmtM2 = (m2: number) => `${m2.toFixed(1).replace(".", ",")} m²`;
