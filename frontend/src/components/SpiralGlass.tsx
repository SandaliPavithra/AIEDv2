import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';

const MODEL_URL = '/models/king-chess.glb';

const TURNS = 2.25; // loops from bottom to top
const RADIUS_MARGIN = 1.15; // coil radius = piece's own half-width * this, so it floats just outside the surface
const TUBE_RADIUS_RATIO = 0.025; // tube thickness relative to piece height — kept thin
const HEIGHT_COVERAGE = 0.85; // fraction of the piece's height the coil spans, so it doesn't cap the crown or base

/**
 * A thin frosted-glass coil that floats around the king piece — fixed in
 * place, independent of the piece's own drag-rotation. Reads the same
 * cached glb (via useGLTF's URL cache, no extra fetch) only to size itself
 * off the piece's real bounding box; it renders its own procedural tube
 * geometry rather than any part of the loaded model.
 */
export function SpiralGlass() {
  const { scene } = useGLTF(MODEL_URL);

  const geometry = useMemo(() => {
    const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
    const pieceRadius = Math.max(size.x, size.z) / 2;
    const coilRadius = pieceRadius * RADIUS_MARGIN;
    const coilHeight = size.y * HEIGHT_COVERAGE;
    const tubeRadius = size.y * TUBE_RADIUS_RATIO;

    const segments = 220;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = t * Math.PI * 2 * TURNS;
      const y = -coilHeight / 2 + t * coilHeight;
      points.push(new THREE.Vector3(Math.cos(angle) * coilRadius, y, Math.sin(angle) * coilRadius));
    }

    const curve = new THREE.CatmullRomCurve3(points);
    return new THREE.TubeGeometry(curve, segments, tubeRadius, 12, false);
  }, [scene]);

  return (
    <mesh geometry={geometry}>
      <meshPhysicalMaterial
        color="#ffffff"
        transmission={1}
        roughness={0.4}
        thickness={0.5}
        ior={1.4}
        attenuationColor="#eaf6ff"
        attenuationDistance={1}
      />
    </mesh>
  );
}
