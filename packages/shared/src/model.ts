import { z } from "zod";

/** All coordinates and lengths are in meters, in plan space (x right, y down). */
export const Vec2 = z.object({ x: z.number(), y: z.number() });
export type Vec2 = z.infer<typeof Vec2>;

export const LoadBearing = z.enum(["unknown", "yes", "no"]);
export type LoadBearing = z.infer<typeof LoadBearing>;

export const Wall = z.object({
  id: z.string(),
  a: Vec2,
  b: Vec2,
  thickness: z.number().positive(),
  height: z.number().positive(),
  loadBearing: LoadBearing.default("unknown"),
  exterior: z.boolean().default(false),
});
export type Wall = z.infer<typeof Wall>;

export const OpeningKind = z.enum(["door", "window", "opening"]);
export type OpeningKind = z.infer<typeof OpeningKind>;

export const Opening = z.object({
  id: z.string(),
  wallId: z.string(),
  kind: OpeningKind,
  /** Distance from wall.a to the opening's center, along the wall. */
  offset: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  sill: z.number().min(0),
});
export type Opening = z.infer<typeof Opening>;

export const ROOM_TYPES = [
  "stue",
  "kjøkken",
  "soverom",
  "bad",
  "wc",
  "gang",
  "entré",
  "bod",
  "vaskerom",
  "kontor",
  "balkong",
  "annet",
] as const;
export const RoomType = z.enum(ROOM_TYPES);
export type RoomType = z.infer<typeof RoomType>;

export const Room = z.object({
  id: z.string(),
  name: z.string(),
  type: RoomType,
  polygon: z.array(Vec2),
  /** Area printed on the floor plan (m²), used to validate the digitized geometry. */
  statedArea: z.number().nullable().default(null),
});
export type Room = z.infer<typeof Room>;

export const FurnitureItem = z.object({
  id: z.string(),
  catalogId: z.string(),
  x: z.number(),
  y: z.number(),
  rotation: z.number(),
  roomId: z.string().nullable().default(null),
});
export type FurnitureItem = z.infer<typeof FurnitureItem>;

export const Note = z.object({
  id: z.string(),
  roomId: z.string().nullable(),
  text: z.string(),
  author: z.enum(["user", "ai"]),
  createdAt: z.string(),
});
export type Note = z.infer<typeof Note>;

export const Scenario = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable().default(null),
  walls: z.array(Wall).default([]),
  openings: z.array(Opening).default([]),
  rooms: z.array(Room).default([]),
  furniture: z.array(FurnitureItem).default([]),
  notes: z.array(Note).default([]),
});
export type Scenario = z.infer<typeof Scenario>;

export const Calibration = z.object({
  /** Image pixels per meter. */
  pxPerMeter: z.number().positive(),
  calibrated: z.boolean(),
});
export type Calibration = z.infer<typeof Calibration>;

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  planImage: z.object({ file: z.string(), width: z.number(), height: z.number() }).nullable(),
  calibration: Calibration,
  ceilingHeight: z.number().positive().default(2.4),
  /** Degrees clockwise from plan "up" to true north. */
  northAngle: z.number().default(0),
  scenarios: z.array(Scenario).min(1),
  activeScenarioId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof Project>;

export const ProjectSummary = Project.pick({ id: true, name: true, updatedAt: true, createdAt: true });
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const DEFAULTS = {
  wallHeight: 2.4,
  interiorWallThickness: 0.1,
  exteriorWallThickness: 0.25,
  door: { width: 0.9, height: 2.1, sill: 0 },
  window: { width: 1.2, height: 1.2, sill: 0.9 },
  opening: { width: 1.2, height: 2.1, sill: 0 },
} as const;

export function newId(prefix = ""): string {
  return prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

export function emptyScenario(name = "Eksisterende"): Scenario {
  return { id: newId("sc_"), name, parentId: null, walls: [], openings: [], rooms: [], furniture: [], notes: [] };
}

/** Result of AI digitization: a proposal the user reviews before it replaces the scenario geometry. */
export interface DigitizeSuggestion {
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  /** Original-image pixels per meter used for the conversion. */
  pxPerMeter: number;
  scaleSource: "calibration" | "dimensions" | "areas" | "none";
  notes: string;
  warnings: string[];
}
