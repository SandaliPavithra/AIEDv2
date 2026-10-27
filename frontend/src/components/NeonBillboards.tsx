import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { Select } from '@react-three/postprocessing';

// Cyberpunk 2077 neon: hot magenta, cyan, yellow.
const PALETTE = ['#ff2a6d', '#05d9e8', '#f9f002'];

// Ring heights are fractions of the piece's height measured from its
// center (+0.5 = top of the cross); radii are fractions of the piece's
// widest half-width (the base), so everything scales with the model.
// heightRatio is each ring's panel height as a fraction of piece height.
const RINGS = [
  { y: 0.36, radiusScale: 0.75, heightRatio: 0.07, speed: -0.45, panelCount: 5, paletteOffset: 0 }, // around the head
  { y: -0.06, radiusScale: 0.9, heightRatio: 0.14, speed: 0.3, panelCount: 6, paletteOffset: 1 }, // around the piece's middle
];
const PANEL_FILL = 0.9; // fraction of each ring slot a panel covers; the rest is the gap between panels
const LED_PITCH_RATIO = 0.007; // diode spacing relative to piece height; same on every ring, so taller panels get more rows, not bigger diodes

// Photos (resized copies in public/billboards) shown on each ring's panels,
// in order, indexed like RINGS; any panels beyond a ring's list keep an
// abstract pattern.
const RING_IMAGE_URLS = [
  [6, 7, 8, 9, 10].map((n) => `/billboards/cp2077-${n}.jpg`), // head ring
  [1, 2, 3, 4, 5].map((n) => `/billboards/cp2077-${n}.jpg`), // middle ring
];
const ALL_IMAGE_URLS = RING_IMAGE_URLS.flat();

// Thin LED ring lights just off the photo strips' edges: above and below
// the middle strip, and above and below the head strip (the one above it
// sits around the cross). Like the panels, they're wrapped in <Select
// enabled> so App.tsx's SelectiveBloom makes them glow; their colors are
// pushed past 1 so the glow is strong. Sizes relative to piece height.
const RING_LIGHTS = [
  { strip: 0, side: 1, color: PALETTE[1] }, // above the head strip, around the cross (blue)
  { strip: 0, side: -1, color: PALETTE[0] }, // below the head strip (pink)
  { strip: 1, side: 1, color: PALETTE[2] }, // above the middle strip (yellow)
  { strip: 1, side: -1, color: PALETTE[1] }, // below the middle strip (blue)
];
const RING_LIGHT_INTENSITY = 4; // HDR multiplier on the color; breathes ±25% around this
const RING_LIGHT_GAP_RATIO = 0.035; // space off the strip's edge; much less and, seen at an angle, the strip's wall hides the (narrower) ring
// Each ring fits the piece's real silhouette at its own height (e.g. the
// narrow cross, not the strip's radius): the widest point of the piece
// within this band on the ring's far side from its strip, plus a
// clearance gap.
const RING_LIGHT_FIT_BAND_RATIO = 0.03;
const RING_LIGHT_CLEARANCE_RATIO = 0.035;
const RING_LIGHT_TUBE_RATIO = 0.004; // thickness

// Each panel also casts real colored light (in its palette color) onto the
// king, riding along with its ring, so the glossy paint picks up moving
// neon reflections. Strength is roughly the illuminance at the piece's
// surface, comparable to the scene's key light (1.2).
const PANEL_LIGHT_STRENGTH = 0.8;
const KING_GROUP_SCALE = 0.6; // App.tsx's group scale: light falloff is in world units, geometry here is local
const IMAGE_LED_DENSITY = 3; // image panels use this many times finer diodes, or a photo would be ~20 dots tall

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A dark panel covered in a dot-matrix of diodes. Which diodes are lit is
// one of three abstract patterns (uMode), or, with uUseImage, a photo
// sampled once per diode with boosted saturation so it reads as neon. Both
// get a global flicker and an occasional glitch where a horizontal band
// slips sideways for a moment.
// The near-black opaque backing keeps it readable on the light page bg too,
// where an additive/screen glow would just wash out toward white.
const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec2 uCells;
  uniform float uMode;
  uniform float uSeed;
  uniform sampler2D uImage;
  uniform float uUseImage;
  uniform vec2 uImageCells;
  uniform vec2 uImageUvScale; // center-crops the photo to the panel's aspect ("cover")
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv;

    float glitchTick = floor(uTime * 6.0 + uSeed);
    float band = floor(uv.y * 6.0);
    if (hash(vec2(glitchTick, band)) > 0.93) {
      uv.x += (hash(vec2(band, glitchTick)) - 0.5) * 0.15;
    }

    float flicker = 0.85 + 0.15 * hash(vec2(floor(uTime * 24.0), uSeed));
    vec3 lit;
    vec3 unlit;

    if (uUseImage > 0.5) {
      vec2 grid = uv * uImageCells;
      vec2 id = floor(grid);
      vec2 sampleUv = 0.5 + ((id + 0.5) / uImageCells - 0.5) * uImageUvScale;
      vec3 photo = texture2D(uImage, sampleUv).rgb;
      float luma = dot(photo, vec3(0.2126, 0.7152, 0.0722));
      photo = max(mix(vec3(luma), photo, 1.6), 0.0); // saturation boost
      // Gaps between diodes stay partly lit so the photo is still legible.
      float diode = smoothstep(0.5, 0.3, length(fract(grid) - 0.5));
      lit = photo * mix(0.35, 1.0, diode) * flicker * 1.4;
      unlit = vec3(0.0);
    } else {
      vec2 grid = uv * uCells;
      vec2 id = floor(grid);
      float diode = smoothstep(0.42, 0.22, length(fract(grid) - 0.5));

      float on;
      if (uMode < 0.5) {
        // scrolling diagonal stripes
        on = step(0.55, fract((id.x + id.y * 1.5) / 12.0 - uTime * 0.6));
      } else if (uMode < 1.5) {
        // equalizer bars
        float level = 0.5 + 0.5 * sin(id.x * 0.7 + uTime * 3.0 + uSeed) * sin(id.x * 0.23 - uTime * 1.7);
        on = step(id.y / uCells.y, level);
      } else {
        // sweeping scan beam plus random sparkle
        float beam = smoothstep(4.0, 0.0, abs(id.x - mod(uTime * 20.0 + uSeed * 10.0, uCells.x)));
        float sparkle = step(0.92, hash(id + floor(uTime * 10.0)));
        on = max(beam, sparkle);
      }

      lit = uColor * on * diode * flicker * 2.5; // above 1 so the lit diodes glow strongly
      unlit = uColor * 0.08 * diode; // dark diodes stay faintly visible, like a real LED board
    }

    // Fully opaque: the light-mode scene bg is stored brighter than 1 (see
    // preToneMapped in App.tsx), so even a little see-through turns milky.
    gl_FragColor = vec4(vec3(0.02, 0.02, 0.04) + lit + unlit, 1.0);
    #include <colorspace_fragment>
  }
`;

interface Panel {
  geometry: THREE.CylinderGeometry;
  material: THREE.ShaderMaterial;
  light: { position: THREE.Vector3; color: string; intensity: number };
}

function buildRing(
  ring: (typeof RINGS)[number],
  ringIndex: number,
  pieceSize: THREE.Vector3,
  images: THREE.Texture[],
): Panel[] {
  const halfWidth = Math.max(pieceSize.x, pieceSize.z) / 2;
  const radius = halfWidth * ring.radiusScale;
  const height = pieceSize.y * ring.heightRatio;
  const pitch = pieceSize.y * LED_PITCH_RATIO;
  const rows = Math.round(height / pitch);
  const slot = (Math.PI * 2) / ring.panelCount;
  const thetaLength = slot * PANEL_FILL;
  const cols = Math.round((radius * thetaLength) / pitch);

  return Array.from({ length: ring.panelCount }, (_, i) => {
    const paletteIndex = (i + ring.paletteOffset) % PALETTE.length;
    const image = images[i];
    const photo = image?.image as HTMLImageElement | undefined;
    const imageAspect = photo ? photo.width / photo.height : 1;
    const panelAspect = (radius * thetaLength) / height;
    // Cylinder geometry places theta at (sin θ, cos θ); light sits at the
    // panel's angular middle, on its inner face, shining at the piece.
    const midTheta = i * slot + thetaLength / 2;
    const lightRadius = radius * 0.95;
    const surfaceDistance = (radius - halfWidth * 0.35) * KING_GROUP_SCALE; // rough gap to the piece's surface, world units
    return {
      light: {
        position: new THREE.Vector3(Math.sin(midTheta) * lightRadius, 0, Math.cos(midTheta) * lightRadius),
        color: PALETTE[paletteIndex],
        intensity: PANEL_LIGHT_STRENGTH * surfaceDistance * surfaceDistance,
      },
      geometry: new THREE.CylinderGeometry(radius, radius, height, 48, 1, true, i * slot, thetaLength),
      material: new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(PALETTE[paletteIndex]) },
          uCells: { value: new THREE.Vector2(cols, rows) },
          uMode: { value: paletteIndex },
          uSeed: { value: ringIndex * 3 + i },
          uImage: { value: image ?? null },
          uUseImage: { value: image ? 1 : 0 },
          uImageCells: { value: new THREE.Vector2(cols, rows).multiplyScalar(IMAGE_LED_DENSITY) },
          uImageUvScale: {
            value:
              imageAspect > panelAspect
                ? new THREE.Vector2(panelAspect / imageAspect, 1)
                : new THREE.Vector2(1, imageAspect / panelAspect),
          },
        },
      }),
    };
  });
}

/**
 * Curved LED billboards orbiting the king, Cyberpunk 2077 style. Rendered inside
 * KingModel's lean (roll) group but outside its spinning pivot, so the
 * rings tilt with the piece yet orbit on their own speeds, independent of
 * the piece's own spin and drag.
 */
export function NeonBillboards({
  pieceSize,
  radiusBetween,
}: {
  pieceSize: THREE.Vector3;
  /** Widest the piece reaches from its spin axis between two local heights. */
  radiusBetween: (y0: number, y1: number) => number;
}) {
  const images = useTexture(ALL_IMAGE_URLS, (textures) => {
    textures.forEach((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
    });
  });
  const rings = useMemo(
    () =>
      RINGS.map((ring, i) => {
        const start = RING_IMAGE_URLS.slice(0, i).flat().length;
        return buildRing(ring, i, pieceSize, images.slice(start, start + (RING_IMAGE_URLS[i]?.length ?? 0)));
      }),
    [pieceSize, images],
  );
  const ringRefs = useRef<(THREE.Group | null)[]>([]);

  const ringLights = useMemo(() => {
    const tube = pieceSize.y * RING_LIGHT_TUBE_RATIO;
    const band = pieceSize.y * RING_LIGHT_FIT_BAND_RATIO;
    return RING_LIGHTS.map(({ strip, side, color }) => {
      const ring = RINGS[strip];
      const y = pieceSize.y * (ring.y + side * (ring.heightRatio / 2 + RING_LIGHT_GAP_RATIO));
      // Fit band extends away from the strip: upward above it, downward below.
      const fitted = side > 0 ? radiusBetween(y - tube, y + band) : radiusBetween(y - band, y + tube);
      const radius = fitted + pieceSize.y * RING_LIGHT_CLEARANCE_RATIO;
      return {
        y,
        color,
        geometry: new THREE.TorusGeometry(radius, tube, 10, 160).rotateX(Math.PI / 2),
        material: new THREE.MeshBasicMaterial({ toneMapped: false }),
      };
    });
  }, [pieceSize, radiusBetween]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    rings.forEach((panels, i) => {
      const group = ringRefs.current[i];
      if (group) group.rotation.y += RINGS[i].speed * delta;
      panels.forEach((panel) => {
        panel.material.uniforms.uTime.value = t;
      });
    });
    // Slow breathing glow, each ring a little out of step with the others.
    ringLights.forEach((ringLight, i) => {
      ringLight.material.color.set(ringLight.color).multiplyScalar(RING_LIGHT_INTENSITY * (1 + 0.25 * Math.sin(t * 2 + i * 1.7)));
    });
  });

  return (
    <>
      {rings.map((panels, i) => (
        <group
          key={i}
          ref={(el) => {
            ringRefs.current[i] = el;
          }}
          position={[0, RINGS[i].y * pieceSize.y, 0]}
        >
          {panels.map((panel, j) => (
            <group key={j}>
              <Select enabled>
                <mesh geometry={panel.geometry} material={panel.material} />
              </Select>
              <pointLight
                position={panel.light.position}
                color={panel.light.color}
                intensity={panel.light.intensity}
                decay={2}
              />
            </group>
          ))}
        </group>
      ))}
      <Select enabled>
        {ringLights.map((ringLight, k) => (
          <mesh key={k} position={[0, ringLight.y, 0]} geometry={ringLight.geometry} material={ringLight.material} />
        ))}
      </Select>
    </>
  );
}

useTexture.preload(ALL_IMAGE_URLS);
