import { Suspense, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber'
import { Environment } from '@react-three/drei';
import { EffectComposer, Selection, SelectiveBloom, ToneMapping, selectionContext } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { KingModel } from './components/KingModel';
import { preToneMapped } from './lib/toneMapping';
import { CrownGlowContext } from './components/FoilCrown';

// Mirrors --bg in index.css. The scene paints its own opaque background
// (instead of letting the page's CSS bg show through a transparent canvas)
// because bloom can only spread glow onto pixels the canvas actually draws:
// over transparent pixels the glow's alpha stays 0 and it vanishes.
const SCENE_BG = '#0a0a0a';

// Moved toward the camera (+z) rather than scaled up, so the piece reads
// bigger via perspective without changing its proportions.
const KING_POSITION = new THREE.Vector3(0, 0, 1);

const TITLE_TEXT = 'Artificial Intelligence in Education for Evaluation and Generation';

export default function App() {
  const titleRef = useRef<HTMLHeadingElement>(null);
  // SelectiveBloom warns without at least one light; the neon materials are
  // unlit so any light will do, and it doesn't change their look.
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const [crown, setCrown] = useState<THREE.Object3D | null>(null);
  // A bloom selection only lights up the exact objects it's given, not
  // their children, so hand it the crown's meshes rather than its group.
  const crownMeshes = useMemo(() => {
    const meshes: THREE.Object3D[] = [];
    crown?.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) meshes.push(object);
    });
    return meshes;
  }, [crown]);
  const sceneBg = useMemo(() => preToneMapped(SCENE_BG), []);

  return (

    <div style={{ position: 'relative', zIndex: 0, minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', transition: 'background 0.35s ease' }}>
      {/* Pulled out of the flex flow with position:absolute (same pattern
          ShaderBackground used to fill the screen) so it always fills the
          full-screen container. Without this it's a normal-flow flex sibling
          of <main> in the (default) row-direction flex container, and R3F
          measures that squeezed shared-row size to set the canvas
          resolution/camera — which is what caused the "auto-cropped" look. */}
      <Canvas shadows style={{ position: 'absolute', inset: 0 }}>
        <Selection>
          <ambientLight ref={ambientRef} intensity={0.3} />
          <directionalLight position={[3, 4, 3]} intensity={1.2} castShadow />
          <group scale={0.6} position={KING_POSITION}>
            <Suspense fallback={null}>
              <CrownGlowContext.Provider value={setCrown}>
                <KingModel />
              </CrownGlowContext.Provider>
            </Suspense>
          </group>
          <Environment preset="studio" />
          <color attach="background" args={[sceneBg]} />
          {/* Selective: only objects wrapped in <Select enabled> (the neon
              billboards and ring light) glow. The crown gets its own,
              separate pass below so its glow can stay slight: sharing one
              pass, its HDR foil glints bloomed as hard as the neon. A plain
              threshold Bloom also caught the king's glossy highlights.
              Rendering through the composer bypasses the renderer's own tone
              mapping, so it's re-applied as the last pass. */}
          <EffectComposer>
            <SelectiveBloom
              lights={[ambientRef]}
              mipmapBlur
              ignoreBackground
              luminanceThreshold={0}
              intensity={1.6}
              radius={0.8}
            />
            {/* Null selection context so this pass uses its own `selection`
                prop instead of the neon <Selection> above, on its own layer
                so the two passes' selections don't mix. */}
            <selectionContext.Provider value={null}>
              <SelectiveBloom
                selection={crownMeshes}
                selectionLayer={11}
                lights={[ambientRef]}
                mipmapBlur
                ignoreBackground
                luminanceThreshold={0}
                intensity={0.4} // slight: a soft halo, not a second light source
                radius={0.6}
              />
            </selectionContext.Provider>
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        </Selection>
      </Canvas>
      <main style={{ textAlign: 'center', padding: '0 32px', maxWidth: 1400 }}>
        <h1 ref={titleRef} className="landing-title" style={{ marginBottom: 48 }}>
          {TITLE_TEXT}
        </h1>
      </main>
    </div>
  );
}
