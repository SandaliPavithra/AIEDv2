import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { NeonBillboards } from './NeonBillboards';
import { FoilCrown } from './FoilCrown';

const MODEL_URL = '/models/king-chess.glb';

const BASE_Y_ROTATION = Math.PI / 4; // 45° facing turn
const ROLL_Z_ROTATION = -Math.PI / 12; // 15° lean, "/"
const DRAG_SENSITIVITY = 0.008; // radians of turn per pixel dragged horizontally, while actively dragging
const RELEASE_VELOCITY_PER_PIXEL = 0.02; // rad/s of coast speed per pixel of net drag distance
const FRICTION = 4; // rad/s² — constant deceleration applied to the coast until it settles at the idle spin
const IDLE_SPIN_SPEED = 0.25; // rad/s — slow resting turn (~25s per revolution) when nobody is dragging
const PROFILE_BINS = 200; // height slices for the radius profile below
// Automotive paint is two layers: a metallic base coat with a soft sheen,
// under a thick, near-mirror clear coat. The clear coat carries the crisp
// showroom reflections; the base coat keeps it reading as deep paint
// rather than chrome or plastic.
const PAINT_BASE_ROUGHNESS = 0.4;
const PAINT_BASE_METALNESS = 0.6;
const PAINT_CLEARCOAT = 1;
const PAINT_CLEARCOAT_ROUGHNESS = 0.03;
const PAINT_ENV_MAP_INTENSITY = 1.2;

/**
 * Renders the imported king chess piece (public/models/king-chess.glb).
 *
 * The glb's own origin (wherever the export set it — typically the base of
 * the piece, not its visual center) isn't a usable spin axis: rotating
 * around it swings the piece's body around that off-center point, which
 * reads as orbiting rather than spinning in place. So the model is
 * re-centered once, in its own local space, onto a wrapping "pivot"
 * group's origin — rotating that pivot is then a true rotation on a fixed
 * vertical axis through the piece's own center, like Earth turning on its
 * axis, not a circling motion around some other point.
 *
 * Click-and-drag anywhere on the canvas spins the piece around that axis;
 * only horizontal movement does anything. Releasing mid-drag lets it coast:
 * the further the net drag distance, the faster it's still turning at
 * release, and a constant "friction" deceleration brings it back to a slow
 * idle spin — it does not spring back to any particular pose, it just
 * resumes turning gently from wherever the coast runs out. Grabbing it
 * again (even mid-coast) cancels the coast and hands control straight back
 * to the drag.
 */
export function KingModel() {
  const { scene } = useGLTF(MODEL_URL);
  const { gl } = useThree();
  const pivotRef = useRef<THREE.Group>(null);
  const drag = useRef({ dragging: false, lastX: 0, startX: 0 });
  const velocity = useRef(IDLE_SPIN_SPEED); // rad/s, only relevant while not dragging (the coast / idle spin)

  useMemo(() => {
    // scene is cached/shared per URL, so guard against subtracting the
    // center more than once (e.g. React StrictMode's double-invoke).
    if (scene.userData.centered) return;
    const center = new THREE.Box3().setFromObject(scene).getCenter(new THREE.Vector3());
    scene.position.sub(center);
    scene.userData.centered = true;
  }, [scene]);

  // The piece's size in its own local space, for sizing the billboards.
  // Measured relative to the scene root rather than with setFromObject,
  // whose world-space box would also pick up the parent groups' scale/lean
  // once the (cached, shared) scene is already mounted, e.g. after HMR.
  const pieceSize = useMemo(() => {
    scene.updateMatrixWorld(true);
    const toSceneLocal = scene.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const meshToScene = new THREE.Matrix4().multiplyMatrices(toSceneLocal, mesh.matrixWorld);
      box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(meshToScene));
    });
    return box.getSize(new THREE.Vector3());
  }, [scene]);

  // How far the piece actually reaches from its spin axis at each height,
  // so things placed around it, like the ring light, can fit its real
  // silhouette: the cross is much narrower than the base, which pieceSize
  // alone can't tell. Built per triangle, not per vertex: the model is low
  // poly, so a long straight section only has vertices at its two ends and
  // most slices would contain none. Each triangle marks every slice it
  // spans with its widest vertex (a slight overestimate on slanted faces,
  // which only errs toward more clearance).
  const radiusBetween = useMemo(() => {
    const bins = new Float32Array(PROFILE_BINS);
    const bottom = -pieceSize.y / 2;
    scene.updateMatrixWorld(true);
    // Pivot space = the scene's own (centering) transform on top of scene-local.
    const toPivot = new THREE.Matrix4().multiplyMatrices(scene.matrix, scene.matrixWorld.clone().invert());
    const toBin = (y: number) =>
      Math.min(PROFILE_BINS - 1, Math.max(0, Math.floor(((y - bottom) / pieceSize.y) * PROFILE_BINS)));
    const v = new THREE.Vector3();
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const meshToPivot = new THREE.Matrix4().multiplyMatrices(toPivot, mesh.matrixWorld);
      const position = mesh.geometry.attributes.position;
      const ys = new Float32Array(position.count);
      const radii = new Float32Array(position.count);
      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(meshToPivot);
        ys[i] = v.y;
        radii[i] = Math.hypot(v.x, v.z);
      }
      const index = mesh.geometry.index;
      const triangleCount = (index ? index.count : position.count) / 3;
      for (let t = 0; t < triangleCount; t++) {
        const [a, b, c] = [0, 1, 2].map((k) => (index ? index.getX(t * 3 + k) : t * 3 + k));
        const r = Math.max(radii[a], radii[b], radii[c]);
        const lo = toBin(Math.min(ys[a], ys[b], ys[c]));
        const hi = toBin(Math.max(ys[a], ys[b], ys[c]));
        for (let bin = lo; bin <= hi; bin++) bins[bin] = Math.max(bins[bin], r);
      }
    });
    return (y0: number, y1: number) => {
      let r = 0;
      for (let i = toBin(Math.min(y0, y1)); i <= toBin(Math.max(y0, y1)); i++) r = Math.max(r, bins[i]);
      return r;
    };
  }, [scene, pieceSize]);

  // Give every material a glossy car-paint finish. The glb ships plain
  // standard materials, which have no clear coat, so each is swapped for a
  // MeshPhysicalMaterial that keeps its textures and its original color.
  // Already-converted materials are just re-tuned, which keeps this
  // idempotent on the shared scene.
  useMemo(() => {
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;

      const toPaint = (material: THREE.Material) => {
        let paint: THREE.MeshPhysicalMaterial;
        if ((material as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
          paint = material as THREE.MeshPhysicalMaterial;
        } else {
          const original = material as THREE.MeshStandardMaterial;
          paint = new THREE.MeshPhysicalMaterial({
            color: original.color?.getHex() ?? 0xffffff,
            map: original.map ?? null,
            normalMap: original.normalMap ?? null,
            aoMap: original.aoMap ?? null,
          });
          original.dispose();
        }
        paint.roughness = PAINT_BASE_ROUGHNESS;
        paint.metalness = PAINT_BASE_METALNESS;
        paint.clearcoat = PAINT_CLEARCOAT;
        paint.clearcoatRoughness = PAINT_CLEARCOAT_ROUGHNESS;
        paint.envMapIntensity = PAINT_ENV_MAP_INTENSITY;
        return paint;
      };

      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(toPaint) : toPaint(mesh.material);
    });
  }, [scene]);

  useEffect(() => {
    const el = gl.domElement;

    const onPointerDown = (e: PointerEvent) => {
      drag.current.dragging = true;
      drag.current.lastX = e.clientX;
      drag.current.startX = e.clientX;
      velocity.current = 0; // grabbing it cancels any coast in progress
      el.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!drag.current.dragging || !pivotRef.current) return;
      const deltaX = e.clientX - drag.current.lastX;
      drag.current.lastX = e.clientX;
      pivotRef.current.rotation.y += deltaX * DRAG_SENSITIVITY;
    };

    const onPointerUp = (e: PointerEvent) => {
      drag.current.dragging = false;
      // Net distance for the whole gesture (not just the last move event)
      // sets the coast's starting speed — a small nudge barely coasts, a
      // long drag keeps spinning for a while.
      const netDistance = drag.current.lastX - drag.current.startX;
      velocity.current = netDistance * RELEASE_VELOCITY_PER_PIXEL;
      el.releasePointerCapture(e.pointerId);
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
    };
  }, [gl]);

  // The coast: while not actively dragging, keep spinning at the last
  // release velocity and pull it toward the slow idle spin at a constant
  // rate (friction) each frame, then hold there — so the piece is never
  // fully still, it just settles back into its gentle resting turn.
  useFrame((_, delta) => {
    if (drag.current.dragging || !pivotRef.current) return;

    const decel = FRICTION * delta;
    const diff = IDLE_SPIN_SPEED - velocity.current;
    if (Math.abs(diff) <= decel) {
      velocity.current = IDLE_SPIN_SPEED;
    } else {
      velocity.current += Math.sign(diff) * decel;
    }
    pivotRef.current.rotation.y += velocity.current * delta;
  });

  return (
    <group rotation={[0, 0, ROLL_Z_ROTATION]}>
      <group ref={pivotRef} rotation={[0, BASE_Y_ROTATION, 0]}>
        <primitive object={scene} />
      </group>
      {/* Inside the lean group so the rings tilt with the piece, but
          outside the pivot so they orbit independently of its spin/drag. */}
      <NeonBillboards pieceSize={pieceSize} radiusBetween={radiusBetween} />
      <FoilCrown pieceSize={pieceSize} />
    </group>
  );
}

// Kick off the fetch as soon as this module loads rather than waiting for
// first render, so the Suspense fallback resolves sooner.
useGLTF.preload(MODEL_URL);
