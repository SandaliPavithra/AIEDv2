import { Suspense, useRef } from 'react';
import { Canvas } from '@react-three/fiber'
import { Environment } from '@react-three/drei';
import ThemeToggle from './components/ThemeToggle';
import { KingModel } from './components/KingModel';
import { SpiralGlass } from './components/SpiralGlass';

const TITLE_TEXT = 'Artificial Intelligence in Education for Evaluation and Generation';

export default function App() {
  const titleRef = useRef<HTMLHeadingElement>(null);

  return (

    <div style={{ position: 'relative', zIndex: 0, minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', transition: 'background 0.35s ease' }}>
      {/* Pulled out of the flex flow with position:absolute (same pattern
          ShaderBackground used to fill the screen) so it always fills the
          full-screen container. Without this it's a normal-flow flex sibling
          of <main> in the (default) row-direction flex container, and R3F
          measures that squeezed shared-row size to set the canvas
          resolution/camera — which is what caused the "auto-cropped" look. */}
      <Canvas shadows style={{ position: 'absolute', inset: 0 }}>
        <ambientLight intensity={0.3} />
        <directionalLight position={[3, 4, 3]} intensity={1.2} castShadow />
        {/* Moved toward the camera (+z) rather than scaled up, so the piece
            reads bigger via perspective without changing its proportions. */}
        <group scale={0.6} position={[0, 0, 2]}>
          <Suspense fallback={null}>
            {/* Sibling of KingModel, not a child of its rotating groups, so
                the coil stays fixed in place while the piece spins inside it. */}
            <KingModel />
            <SpiralGlass />
          </Suspense>
        </group>
        <Environment preset="studio" />
      </Canvas>
      <div style={{ position: 'fixed', top: 16, right: 16 }}>
        <ThemeToggle />
      </div>
      <main style={{ textAlign: 'center', padding: '0 32px', maxWidth: 1400 }}>
        <h1 ref={titleRef} className="landing-title" style={{ marginBottom: 48 }}>
          {TITLE_TEXT}
        </h1>
      </main>
    </div>
  );
}
