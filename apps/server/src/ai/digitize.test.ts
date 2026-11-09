import { describe, expect, it } from "vitest";
import { emptyScenario, polygonArea, type Project } from "@romslig/shared";
import { toSuggestion } from "./digitize.ts";

const sc = emptyScenario();
const project = (calibrated: boolean, pxPerMeter = 100): Project => ({
  id: "p_test", name: "t", planImage: { file: "plan.png", width: 1120, height: 860 },
  calibration: { pxPerMeter, calibrated }, ceilingHeight: 2.4, northAngle: 0,
  scenarios: [sc], activeScenarioId: sc.id, createdAt: "", updatedAt: "",
});

// Simulated Claude output for the synthetic plan (100 px/m, origin 60 px), shown at full size (f = 1),
// with a few pixels of sloppiness so cleanup has something to do.
const out = {
  walls: [
    { x1: 60, y1: 60, x2: 1060, y2: 62, thickness_px: 25, exterior: true },
    { x1: 1058, y1: 60, x2: 1060, y2: 760, thickness_px: 25, exterior: true },
    { x1: 1060, y1: 760, x2: 62, y2: 758, thickness_px: 25, exterior: true },
    { x1: 60, y1: 760, x2: 60, y2: 63, thickness_px: 25, exterior: true },
    { x1: 660, y1: 66, x2: 661, y2: 755, thickness_px: 15, exterior: false }, // gaps at both ends
    { x1: 664, y1: 410, x2: 1057, y2: 411, thickness_px: 10, exterior: false },
  ],
  openings: [
    { kind: "window" as const, x1: 210, y1: 60, x2: 360, y2: 60 },
    { kind: "door" as const, x1: 660, y1: 210, x2: 660, y2: 300 },
    { kind: "door" as const, x1: 300, y1: 300, x2: 390, y2: 300 }, // in mid-air
  ],
  rooms: [
    { name: "Stue", type: "stue" as const, stated_area_m2: 33, label_x: 300, label_y: 300 },
    { name: "Sov 1", type: "soverom" as const, stated_area_m2: 13.2, label_x: 850, label_y: 200 },
    { name: "Sov 2", type: "soverom" as const, stated_area_m2: 12.4, label_x: 850, label_y: 600 },
  ],
  dimensions: [{ x1: 60, y1: 795, x2: 1060, y2: 795, meters: 10 }],
  notes: "",
};

describe("toSuggestion", () => {
  it("derives scale from dimension lines, closes gaps and finds rooms", () => {
    const s = toSuggestion(out, project(false, 74.7), 1);
    expect(s.scaleSource).toBe("dimensions");
    expect(s.pxPerMeter).toBeCloseTo(100, 0);
    expect(s.rooms.map((r) => r.name).sort()).toEqual(["Sov 1", "Sov 2", "Stue"]);
    const stue = s.rooms.find((r) => r.name === "Stue")!;
    expect(polygonArea(stue.polygon)).toBeCloseTo(5.8 * 6.75, 0);
    expect(s.openings).toHaveLength(2);
    expect(s.warnings.some((w) => w.includes("dør"))).toBe(true);
    expect(s.walls.find((w) => w.exterior)!.loadBearing).toBe("yes");
  });

  it("uses the project calibration when present and accounts for image downscaling", () => {
    const half = { ...out, walls: out.walls.map((w) => ({ ...w, x1: w.x1 / 2, y1: w.y1 / 2, x2: w.x2 / 2, y2: w.y2 / 2, thickness_px: w.thickness_px / 2 })), rooms: out.rooms.map((r) => ({ ...r, label_x: r.label_x / 2, label_y: r.label_y / 2 })), openings: [], dimensions: [] };
    const s = toSuggestion(half, project(true, 100), 0.5);
    expect(s.scaleSource).toBe("calibration");
    expect(s.rooms).toHaveLength(3);
    expect(s.walls[0]!.thickness).toBeCloseTo(0.25, 2);
  });

  it("falls back to stated room areas when there is no scale", () => {
    const s = toSuggestion({ ...out, dimensions: [] }, project(false, 50), 1);
    expect(s.scaleSource).toBe("areas");
    const sov2 = s.rooms.find((r) => r.name === "Sov 2")!;
    expect(polygonArea(sov2.polygon)).toBeCloseTo(12.4, 0);
  });
});
