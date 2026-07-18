import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { useTheme } from '../contexts/ThemeContext';

interface TitleLayout {
  rect: DOMRect;
  fontSize: number;
  fontWeight: string;
  fontFamily: string;
  lineHeight: number;
}

interface ShaderBackgroundProps {
  title: string;
  titleRef: RefObject<HTMLElement | null>;
}

const VERTEX_SHADER = `
attribute vec3 position;
varying vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float xScale;
uniform float yScale;
uniform float distortion;
uniform float invert;
uniform sampler2D textMask;
varying vec2 vUv;

void main() {
  vec2 p = (gl_FragCoord.xy * 2.0 - resolution) / min(resolution.x, resolution.y);

  float d = length(p) * distortion;

  float rx = p.x * (1.0 + d);
  float gx = p.x;
  float bx = p.x * (1.0 - d);

  float r = 0.05 / abs(p.y + sin((rx + time) * xScale) * yScale);
  float g = 0.05 / abs(p.y + sin((gx + time) * xScale) * yScale);
  float b = 0.05 / abs(p.y + sin((bx + time) * xScale) * yScale);

  vec3 waveColor = vec3(r, g, b);

  float luma = dot(waveColor, vec3(0.299, 0.587, 0.114));
  float inverted = step(luma, 0.5);

  float mask = texture2D(textMask, vUv).a;
  vec3 finalColor = mix(waveColor, vec3(inverted), mask);

  finalColor = mix(finalColor, 1.0 - finalColor, invert);

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

function measureLayout(el: HTMLElement | null): TitleLayout | null {
  if (!el) return null;
  const cs = window.getComputedStyle(el);
  return {
    rect: el.getBoundingClientRect(),
    fontSize: parseFloat(cs.fontSize),
    fontWeight: cs.fontWeight,
    fontFamily: cs.fontFamily,
    lineHeight: parseFloat(cs.lineHeight),
  };
}

function drawTextMask(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  text: string,
  layout: TitleLayout | null
) {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  if (!layout || layout.rect.width <= 0) return;

  const dpr = canvasWidth / window.innerWidth;
  const fontSizePx = layout.fontSize * dpr;
  const lineHeightPx = layout.lineHeight * dpr;

  ctx.font = `${layout.fontWeight} ${fontSizePx}px ${layout.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';

  const maxWidthPx = layout.rect.width * dpr;
  const words = text.toUpperCase().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(candidate).width > maxWidthPx) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  const centerX = (layout.rect.left + layout.rect.width / 2) * dpr;
  const blockTop = layout.rect.top * dpr;

  lines.forEach((line, i) => {
    ctx.fillText(line, centerX, blockTop + lineHeightPx * (i + 0.5));
  });
}

export default function ShaderBackground({ title, titleRef }: ShaderBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestTitleRef = useRef(title);
  latestTitleRef.current = title;
  const { isDark } = useTheme();
  const invertUniformRef = useRef<{ value: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    const maskCtx = maskCanvas.getContext('2d');
    const textTexture = new THREE.CanvasTexture(maskCanvas);
    textTexture.minFilter = THREE.LinearFilter;
    textTexture.generateMipmaps = false;

    const uniforms = {
      resolution: { value: new THREE.Vector2(canvas.width, canvas.height) },
      time: { value: 0 },
      xScale: { value: 1.0 },
      yScale: { value: 0.5 },
      distortion: { value: 0.05 },
      invert: { value: isDark ? 0 : 1 },
      textMask: { value: textTexture },
    };
    invertUniformRef.current = uniforms.invert;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([
          -1, -1, 0,
           1, -1, 0,
          -1,  1, 0,
           1, -1, 0,
          -1,  1, 0,
           1,  1, 0,
        ]),
        3
      )
    );

    const material = new THREE.RawShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // Re-measures the real <h1> and resizes the canvas in one synchronous
    // pass so the mask can never be drawn against a stale layout.
    const redraw = () => {
      if (!maskCtx) return;
      if (maskCanvas.width !== canvas.width || maskCanvas.height !== canvas.height) {
        maskCanvas.width = canvas.width;
        maskCanvas.height = canvas.height;
      }
      const layout = measureLayout(titleRef.current);
      drawTextMask(maskCtx, maskCanvas.width, maskCanvas.height, latestTitleRef.current, layout);
      textTexture.needsUpdate = true;
    };

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      uniforms.resolution.value.set(canvas.width, canvas.height);
      redraw();
    };
    window.addEventListener('resize', handleResize);

    const resizeObserver = new ResizeObserver(redraw);
    if (titleRef.current) resizeObserver.observe(titleRef.current);

    redraw();
    document.fonts.ready.then(redraw);

    let rafId = 0;
    const animate = () => {
      uniforms.time.value += 0.01;
      renderer.render(scene, camera);
      rafId = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      window.cancelAnimationFrame(rafId);
      textTexture.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [titleRef]);

  useEffect(() => {
    if (invertUniformRef.current) {
      invertUniformRef.current.value = isDark ? 0 : 1;
    }
  }, [isDark]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none' }}
    />
  );
}
