import * as THREE from 'three';

// The landing scene renders through an ACES filmic ToneMapping pass (see
// App.tsx), which reshapes every color — it crushes darks and rolls off
// brights. These helpers work backwards from a color you want to *see*
// to the value that has to go in so it comes out that way.

// ACES filmic as three.js implements it, reduced to a single channel: both
// of its color matrices have rows summing to ~1, so a gray stays gray.
function acesFilmic(x: number) {
  const v = x / 0.6;
  return Math.min(1, Math.max(0, (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081)));
}

/** The linear value that ACES-tone-maps back onto `goal` (linear), by bisection. */
export function inverseAcesFilmic(goal: number) {
  let lo = 0;
  let hi = 64;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (acesFilmic(mid) < goal) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** A color that lands exactly on `hex` on screen after the ToneMapping pass. */
export function preToneMapped(hex: string) {
  const target = new THREE.Color(hex); // linear components
  return new THREE.Color(inverseAcesFilmic(target.r), inverseAcesFilmic(target.g), inverseAcesFilmic(target.b));
}
