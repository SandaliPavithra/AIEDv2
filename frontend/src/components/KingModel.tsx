import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useTheme } from '../contexts/ThemeContext';

const MODEL_URL = '/models/king-chess.glb';

const BASE_Y_ROTATION = Math.PI / 4; // 45° facing turn
const ROLL_Z_ROTATION = -Math.PI / 12; // 15° lean, "/"
const DRAG_SENSITIVITY = 0.008; // radians of turn per pixel dragged horizontally, while actively dragging
const RELEASE_VELOCITY_PER_PIXEL = 0.02; // rad/s of coast speed per pixel of net drag distance
const FRICTION = 4; // rad/s² — constant deceleration applied to the coast until it hits zero
const MATTE_ROUGHNESS = 0.9; // near-1 = diffuse, no glossy highlight, like unlacquered wood
const MATTE_METALNESS = 0; // wood isn't metallic
const MATTE_ENV_MAP_INTENSITY = 0.35; // dampen mirror-like environment reflections

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
 * release, and a constant "friction" deceleration brings it back to rest —
 * it does not spring back to any particular pose, it just stops wherever
 * the coast runs out. Grabbing it again (even mid-coast) cancels the coast
 * and hands control straight back to the drag.
 */
export function KingModel() {
  const { scene } = useGLTF(MODEL_URL);
  const { gl } = useThree();
  const { isDark } = useTheme();
  const pivotRef = useRef<THREE.Group>(null);
  const drag = useRef({ dragging: false, lastX: 0, startX: 0 });
  const velocity = useRef(0); // rad/s, only relevant while not dragging (the coast)

  // Recolor every material black in light mode (for contrast against the
  // light background), restoring each one's real color in dark mode. The
  // original is captured once per material so toggling back and forth never
  // loses it.
  useEffect(() => {
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        const standardMaterial = material as THREE.MeshStandardMaterial;
        if (!standardMaterial.color) return;

        if (standardMaterial.userData.originalColorHex === undefined) {
          standardMaterial.userData.originalColorHex = standardMaterial.color.getHex();
        }
        standardMaterial.color.setHex(isDark ? standardMaterial.userData.originalColorHex : 0x000000);
      });
    });
  }, [scene, isDark]);

  useMemo(() => {
    // scene is cached/shared per URL, so guard against subtracting the
    // center more than once (e.g. React StrictMode's double-invoke).
    if (scene.userData.centered) return;
    const center = new THREE.Box3().setFromObject(scene).getCenter(new THREE.Vector3());
    scene.position.sub(center);
    scene.userData.centered = true;
  }, [scene]);

  // Give every material a matte, wooden finish — just the surface
  // properties (roughness/metalness/reflection strength), color untouched
  // so the light/dark recolor above still applies on top of this.
  useMemo(() => {
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        const standardMaterial = material as THREE.MeshStandardMaterial;
        if (standardMaterial.roughness === undefined) return;

        standardMaterial.roughness = MATTE_ROUGHNESS;
        standardMaterial.metalness = MATTE_METALNESS;
        standardMaterial.envMapIntensity = MATTE_ENV_MAP_INTENSITY;
      });
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
  // release velocity and bleed it off at a constant rate (friction) each
  // frame until it hits exactly zero, then stop for good.
  useFrame((_, delta) => {
    if (drag.current.dragging || velocity.current === 0 || !pivotRef.current) return;

    const decel = FRICTION * delta;
    if (Math.abs(velocity.current) <= decel) {
      velocity.current = 0;
    } else {
      velocity.current -= Math.sign(velocity.current) * decel;
    }
    pivotRef.current.rotation.y += velocity.current * delta;
  });

  return (
    <group rotation={[0, 0, ROLL_Z_ROTATION]}>
      <group ref={pivotRef} rotation={[0, BASE_Y_ROTATION, 0]}>
        <primitive object={scene} />
      </group>
    </group>
  );
}

// Kick off the fetch as soon as this module loads rather than waiting for
// first render, so the Suspense fallback resolves sooner.
useGLTF.preload(MODEL_URL);
