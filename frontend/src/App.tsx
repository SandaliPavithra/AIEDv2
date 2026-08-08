import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber'
import { useNavigate } from 'react-router-dom';
import {Mesh} from 'three';
import ThemeToggle from './components/ThemeToggle';
import ShaderBackground from './components/ShaderBackground';

const TITLE_TEXT = 'Artificial Intelligence in Education for Evaluation and Generation';

{/** Props for the 3D cube or else Typescript won't understand since lack of annotation*/}
type CubeProps ={
  position: [number, number, number];
  size: [number, number, number];
  color: string;
}

{/*With annotation, Typescript finally understands the parameters */}
const Cube = ({ position, size, color}: CubeProps) => {
    const ref = useRef<Mesh>(null)
  useFrame((state, delta) => {
   if (ref.current) {
     ref.current.rotation.x += delta
   }
  })
  return (
    <mesh position={position} ref={ref}>
      <boxGeometry args={size}/>
      <meshStandardMaterial color={color}/>
    </mesh>
  );
}

export default function App() {
  const navigate = useNavigate();
  const titleRef = useRef<HTMLHeadingElement>(null);

  return (
    
    <div style={{ position: 'relative', zIndex: 0, minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', transition: 'background 0.35s ease' }}>
      <ShaderBackground title={TITLE_TEXT} titleRef={titleRef} />
      <Canvas>
        <directionalLight position={[0,0,2]} intensity={0.5}/>
        <ambientLight intensity={0.1} />
          {/* <group position={[0, -1, 0  ]}> 
            < Cube position={[1, 0, 0]} size={[1, 1, 1]} color={"blue"} />
            < Cube position={[-1, 2, 0]} size={[1, 1, 1]} color={"red"} />
            < Cube position={[1, 2, 0]} size={[1, 1, 1]} color={"red"} />
            < Cube position={[-1, 0, 0]} size={[1, 1, 1]} color={"blue"} />
          </group> */}
          <Cube position={[0, 0, 0]} size={[1, 1, 1]} color={"blue"} />
      </Canvas>
      <div style={{ position: 'fixed', top: 16, right: 16 }}>
        <ThemeToggle />
      </div>
      <main style={{ textAlign: 'center', padding: '0 32px', maxWidth: 1400 }}>
        <h1 ref={titleRef} className="landing-title" style={{ marginBottom: 48 }}>
          {TITLE_TEXT}
        </h1>
        <button
          onClick={() => navigate('/login')}
          style={{ background: 'var(--text)', color: 'var(--bg)', border: 'none', borderRadius: 9999, padding: '14px 40px', fontWeight: 600, fontSize: 16, cursor: 'pointer' }}
        >
          Log in
        </button>
      </main>
    </div>
  );
}
