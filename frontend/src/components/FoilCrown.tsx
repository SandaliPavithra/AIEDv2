import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

const CROWN_SPIKES = 5;
const CROWN_RADIUS_SCALE = 0.45; // band radius relative to the piece's widest half-width
const BAND_HEIGHT_RATIO = 0.05; // solid band below the points, relative to piece height
const SPIKE_HEIGHT_RATIO = 0.07; // extra height of each point above the band
const FLARE = 0.12; // the band widens by this fraction toward the top, like a real crown
const TIP_BALL_RATIO = 0.13; // ball on each point, relative to the band radius
const RIM_TUBE_RATIO = 0.07; // rolled rim at the base, relative to the band radius
const CROWN_GAP_RATIO = 0.06; // float distance above the top of the cross
const CROWN_SPIN_SPEED = 0.4; // rad/s
const BOB_AMPLITUDE_RATIO = 0.01; // hover bob, relative to piece height

// Wrinkle octaves as [frequency, amplitude], both relative to the band
// radius: broad folds, mid creases, then fine crinkle. Combined with flat
// shading, every small facet catches the environment at its own angle,
// which is what reads as crumpled foil rather than smooth metal.
const WRINKLE_OCTAVES: [number, number][] = [
  [3, 0.05],
  [9, 0.02],
  [24, 0.008],
];

const SHEET_SEGMENTS_PER_SPIKE = 32; // even, so a vertex lands exactly on each point's tip
const SHEET_ROWS = 24;

function hash3(x: number, y: number, z: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

// Smooth 3D value noise in [0, 1). Driven purely by position, so vertices
// duplicated along UV seams get the same offset and the surface never tears.
function valueNoise(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fade = (t: number) => t * t * (3 - 2 * t);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const corner = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(corner(0, 0, 0), corner(1, 0, 0), u), lerp(corner(0, 1, 0), corner(1, 1, 0), u), v),
    lerp(lerp(corner(0, 0, 1), corner(1, 0, 1), u), lerp(corner(0, 1, 1), corner(1, 1, 1), u), v),
    w,
  );
}

function wrinkle(p: THREE.Vector3, scale: number) {
  let offset = 0;
  for (const [frequency, amplitude] of WRINKLE_OCTAVES) {
    const f = frequency / scale;
    offset += (valueNoise(p.x * f, p.y * f, p.z * f) - 0.5) * 2 * amplitude * scale;
  }
  return offset;
}

// Crumple any geometry by pushing each vertex along its normal.
function crumple(geometry: THREE.BufferGeometry, offset: THREE.Vector3, scale: number) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    n.fromBufferAttribute(normal, i);
    // Sample noise at the crown-space position, so separate parts don't
    // all wrinkle identically.
    const d = wrinkle(p.clone().add(offset), scale);
    position.setXYZ(i, p.x + n.x * d, p.y + n.y * d, p.z + n.z * d);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// The crown body: one thin sheet (foil has no thickness), a flared band
// whose top edge rises into CROWN_SPIKES sharp points.
function buildSheet(radius: number, bandHeight: number, spikeHeight: number) {
  const cols = CROWN_SPIKES * SHEET_SEGMENTS_PER_SPIKE;
  const positions: number[] = [];
  const indices: number[] = [];
  const p = new THREE.Vector3();

  for (let j = 0; j <= SHEET_ROWS; j++) {
    const v = j / SHEET_ROWS;
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const angle = u * Math.PI * 2;
      const t = (u * CROWN_SPIKES) % 1;
      const peak = 1 - Math.abs(2 * t - 1); // 0 between points, 1 at each tip
      const r = radius * (1 + FLARE * v);
      p.set(Math.cos(angle) * r, v * (bandHeight + spikeHeight * peak), Math.sin(angle) * r);
      // Radial push; computed from the angle so both copies of the seam column agree.
      const d = wrinkle(p, radius);
      positions.push(p.x + Math.cos(angle) * d, p.y, p.z + Math.sin(angle) * d);
    }
  }

  for (let j = 0; j < SHEET_ROWS; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + cols + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Receives the crown's group once it mounts, so App.tsx can give the crown
 * its own, much gentler bloom pass than the neon items get. A state setter
 * rather than a ref: the crown mounts later (inside Suspense), and the bloom
 * effect only re-reads its selection when the value it's given changes.
 */
export const CrownGlowContext = createContext<((crown: THREE.Object3D | null) => void) | null>(null);

/**
 * A real 3D crown, made to look like it was folded out of wrinkled
 * aluminium foil, floating above the king's cross. Rendered in
 * KingModel's lean group (so it tilts with the piece) but outside the
 * spinning pivot, turning and bobbing on its own.
 */
export function FoilCrown({ pieceSize }: { pieceSize: THREE.Vector3 }) {
  const groupRef = useRef<THREE.Group | null>(null);
  const registerGlow = useContext(CrownGlowContext);
  const setGroup = useCallback(
    (group: THREE.Group | null) => {
      groupRef.current = group;
      registerGlow?.(group);
    },
    [registerGlow],
  );

  const { sheet, tips, rim, material, baseY } = useMemo(() => {
    const radius = (Math.max(pieceSize.x, pieceSize.z) / 2) * CROWN_RADIUS_SCALE;
    const bandHeight = pieceSize.y * BAND_HEIGHT_RATIO;
    const spikeHeight = pieceSize.y * SPIKE_HEIGHT_RATIO;
    const tipRadius = radius * (1 + FLARE);

    const tipPositions = Array.from({ length: CROWN_SPIKES }, (_, i) => {
      const angle = ((i + 0.5) / CROWN_SPIKES) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * tipRadius, bandHeight + spikeHeight, Math.sin(angle) * tipRadius);
    });

    return {
      sheet: buildSheet(radius, bandHeight, spikeHeight),
      // Each tip ball is its own crumpled wad of foil.
      tips: tipPositions.map((position) => ({
        position,
        geometry: crumple(new THREE.IcosahedronGeometry(radius * TIP_BALL_RATIO, 3), position, radius),
      })),
      rim: crumple(
        new THREE.TorusGeometry(radius, radius * RIM_TUBE_RATIO, 12, 128).rotateX(Math.PI / 2),
        new THREE.Vector3(),
        radius,
      ),
      material: new THREE.MeshStandardMaterial({
        color: '#ffc61a', // gold-yellow foil; metalness 1 tints the reflections themselves
        metalness: 1,
        roughness: 0.28,
        flatShading: true,
        side: THREE.DoubleSide,
        envMapIntensity: 1.3,
      }),
      baseY: pieceSize.y * (0.5 + CROWN_GAP_RATIO),
    };
  }, [pieceSize]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += CROWN_SPIN_SPEED * delta;
    groupRef.current.position.y = baseY + Math.sin(state.clock.elapsedTime * 1.5) * pieceSize.y * BOB_AMPLITUDE_RATIO;
  });

  return (
    <group ref={setGroup} position={[0, baseY, 0]}>
      <mesh geometry={sheet} material={material} castShadow />
      <mesh geometry={rim} material={material} castShadow />
      {tips.map((tip, i) => (
        <mesh key={i} geometry={tip.geometry} material={material} position={tip.position} castShadow />
      ))}
    </group>
  );
}
