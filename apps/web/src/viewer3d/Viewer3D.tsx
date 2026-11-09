import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PointerLockControls } from "@react-three/drei";
import {
  clampOpening,
  wallDir,
  wallLength,
  wallPieces,
  type Opening,
  type Room,
  type Wall,
} from "@romslig/shared";
import { useScenario, useStore } from "../store.ts";
import { ROOM_COLORS } from "../theme.ts";

type CameraMode = "orbit" | "walk";

export function Viewer3D() {
  const scenario = useScenario();
  const [mode, setMode] = useState<CameraMode>("orbit");
  const [cutHeight, setCutHeight] = useState<number | null>(null);
  const [showLoadBearing, setShowLoadBearing] = useState(true);

  const bounds = useMemo(() => {
    const pts = scenario?.walls.flatMap((w) => [w.a, w.b]) ?? [];
    if (!pts.length) return { cx: 5, cy: 4, size: 12 };
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, size: Math.max(maxX - minX, maxY - minY, 4) };
  }, [scenario?.walls]);

  if (!scenario) return null;
  return (
    <div className="viewer3d">
      <Canvas shadows camera={{ fov: 50, near: 0.05, far: 500, position: [bounds.cx + bounds.size * 0.6, bounds.size * 0.9, bounds.cy + bounds.size * 0.9] }}>
        <color attach="background" args={["#e8edf3"]} />
        <hemisphereLight args={["#ffffff", "#b9a88f", 0.9]} />
        <directionalLight
          position={[bounds.cx + 8, 14, bounds.cy + 5]}
          intensity={1.6}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-bounds.size}
          shadow-camera-right={bounds.size}
          shadow-camera-top={bounds.size}
          shadow-camera-bottom={-bounds.size}
        />
        <mesh rotation-x={-Math.PI / 2} position={[bounds.cx, -0.01, bounds.cy]} receiveShadow>
          <planeGeometry args={[bounds.size * 4, bounds.size * 4]} />
          <meshStandardMaterial color="#d7dde5" />
        </mesh>
        {scenario.rooms.map((r) => (
          <Floor key={r.id} room={r} />
        ))}
        {scenario.walls.map((w) => (
          <WallMesh key={w.id} wall={w} openings={scenario.openings} cutHeight={cutHeight} showLoadBearing={showLoadBearing} />
        ))}
        {scenario.openings
          .filter((o) => o.kind === "window")
          .map((o) => {
            const w = scenario.walls.find((x) => x.id === o.wallId);
            return w ? <Glass key={o.id} wall={w} o={o} cutHeight={cutHeight} /> : null;
          })}
        {mode === "orbit" ? (
          <>
            <OrbitControls makeDefault target={[bounds.cx, 0, bounds.cy]} maxPolarAngle={Math.PI / 2 - 0.02} />
            <FitCamera bounds={bounds} />
          </>
        ) : (
          <Walk start={[bounds.cx, bounds.cy]} onExit={() => setMode("orbit")} />
        )}
      </Canvas>
      <div className="viewer3d-overlay">
        <button className={mode === "orbit" ? "active" : ""} onClick={() => setMode("orbit")}>Fugleperspektiv</button>
        <button className={mode === "walk" ? "active" : ""} onClick={() => setMode("walk")} title="WASD for å gå, mus for å se. Esc avslutter.">Gå rundt</button>
        <button className={cutHeight ? "active" : ""} onClick={() => setCutHeight(cutHeight ? null : 1.1)} title="Kutt veggene i 1,1 m høyde">Lave vegger</button>
        <button className={showLoadBearing ? "active" : ""} onClick={() => setShowLoadBearing(!showLoadBearing)} title="Marker vegger merket som bærende">Bærevegger</button>
      </div>
      {mode === "walk" && <div className="walk-hint">Klikk i 3D-vinduet for å styre. WASD = gå, mus = se, Esc = avslutt</div>}
    </div>
  );
}

function Floor({ room }: { room: Room }) {
  const geom = useMemo(() => {
    if (room.polygon.length < 3) return null;
    // Shape lives in XY; rotating -90° around X maps (x, -y) → (x, 0, y)
    const shape = new THREE.Shape(room.polygon.map((p) => new THREE.Vector2(p.x, -p.y)));
    return new THREE.ShapeGeometry(shape);
  }, [room.polygon]);
  const selected = useStore((s) => s.selection?.id === room.id);
  const select = useStore((s) => s.select);
  if (!geom) return null;
  return (
    <mesh
      geometry={geom}
      rotation-x={-Math.PI / 2}
      position-y={0.001}
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        select({ kind: "room", id: room.id });
      }}
    >
      <meshStandardMaterial color={selected ? "#93c5fd" : ROOM_COLORS[room.type]} side={THREE.DoubleSide} />
    </mesh>
  );
}

function WallMesh({ wall, openings, cutHeight, showLoadBearing }: { wall: Wall; openings: Opening[]; cutHeight: number | null; showLoadBearing: boolean }) {
  const selected = useStore((s) => s.selection?.id === wall.id);
  const select = useStore((s) => s.select);
  const L = wallLength(wall);
  const d = wallDir(wall);
  const angle = -Math.atan2(d.y, d.x);
  const ext = wall.thickness / 2; // extend wall ends so corners close
  const color = selected ? "#3b82f6" : showLoadBearing && wall.loadBearing === "yes" ? "#c08b80" : wall.exterior ? "#e7e2da" : "#f5f3ef";
  const pieces = wallPieces(wall, openings)
    .map((p) => (cutHeight ? { ...p, z1: Math.min(p.z1, cutHeight) } : p))
    .filter((p) => p.z1 - p.z0 > 1e-3);
  return (
    <group
      position={[wall.a.x, 0, wall.a.y]}
      rotation-y={angle}
      onClick={(e) => {
        e.stopPropagation();
        select({ kind: "wall", id: wall.id });
      }}
    >
      {pieces.map((p, i) => {
        const s0 = p.s0 <= 1e-6 ? -ext : p.s0;
        const s1 = p.s1 >= L - 1e-6 ? L + ext : p.s1;
        return (
          <mesh key={i} position={[(s0 + s1) / 2, (p.z0 + p.z1) / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[s1 - s0, p.z1 - p.z0, wall.thickness]} />
            <meshStandardMaterial color={color} />
          </mesh>
        );
      })}
    </group>
  );
}

function Glass({ wall, o, cutHeight }: { wall: Wall; o: Opening; cutHeight: number | null }) {
  const { start, end } = clampOpening(o, wall);
  const d = wallDir(wall);
  const top = Math.min(o.sill + o.height, cutHeight ?? Infinity);
  if (top <= o.sill) return null;
  return (
    <group position={[wall.a.x, 0, wall.a.y]} rotation-y={-Math.atan2(d.y, d.x)}>
      <mesh position={[(start + end) / 2, (o.sill + top) / 2, 0]}>
        <boxGeometry args={[end - start, top - o.sill, 0.02]} />
        <meshStandardMaterial color="#9fd3f0" transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

function Walk({ start, onExit }: { start: [number, number]; onExit(): void }) {
  const { camera } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  useEffect(() => {
    camera.position.set(start[0], 1.6, start[1]);
    const down = (e: KeyboardEvent) => (keys.current[e.code] = true);
    const up = (e: KeyboardEvent) => (keys.current[e.code] = false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [camera, start]);
  useFrame((_, dt) => {
    const k = keys.current;
    const speed = (k.ShiftLeft ? 3 : 1.4) * dt;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
    if (k.KeyW || k.ArrowUp) camera.position.addScaledVector(fwd, speed);
    if (k.KeyS || k.ArrowDown) camera.position.addScaledVector(fwd, -speed);
    if (k.KeyD || k.ArrowRight) camera.position.addScaledVector(right, speed);
    if (k.KeyA || k.ArrowLeft) camera.position.addScaledVector(right, -speed);
    camera.position.y = 1.6;
  });
  return <PointerLockControls makeDefault onUnlock={onExit} />;
}

/** Re-frames the camera when the model's extent changes noticeably (e.g. after digitizing). */
function FitCamera({ bounds }: { bounds: { cx: number; cy: number; size: number } }) {
  const { camera } = useThree();
  const last = useRef<typeof bounds | null>(null);
  useEffect(() => {
    const l = last.current;
    const changed = !l || Math.abs(l.size - bounds.size) > 1 || Math.hypot(l.cx - bounds.cx, l.cy - bounds.cy) > 1;
    if (!changed) return;
    last.current = bounds;
    camera.position.set(bounds.cx + bounds.size * 0.6, bounds.size * 0.9, bounds.cy + bounds.size * 0.9);
    camera.lookAt(bounds.cx, 0, bounds.cy);
  }, [bounds, camera]);
  return null;
}
