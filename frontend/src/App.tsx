import { motion, useMotionValue, useSpring, useScroll, useTransform, AnimatePresence } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { 
  ArrowRight, 
  BookOpen, 
  Zap, 
  Globe, 
  Users, 
  Sparkles,
  Search,
  Menu,
  GraduationCap,
  PlayCircle
} from 'lucide-react';
import LiquidBackground from './components/LiquidBackground';

function WhatIsFraktureScroll({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"]
  });

  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001
  });

  const titleSize = useTransform(smoothProgress, [0, 0.4, 0.8], ["clamp(48px, 9vw, 128px)", "clamp(32px, 5vw, 64px)", "clamp(18px, 2vw, 24px)"]);
  const titleX = useTransform(smoothProgress, [0.3, 0.8], ["0%", "-25vw"]);
  const titleY = useTransform(smoothProgress, [0.3, 0.8], ["0%", "-42vh"]);
  const titleOpacity = useTransform(smoothProgress, [0, 0.1, 0.18, 0.7, 0.9], [0, 0, 1, 1, 0.5]);

  const bodySize = useTransform(smoothProgress, [0.1, 0.8], ["32px", "clamp(24px, 4vw, 64px)"]);
  const bodyOpacity = useTransform(smoothProgress, [0.3, 0.6], [0, 1]);
  const bodyTranslateY = useTransform(smoothProgress, [0.3, 0.8], ["60vh", "0vh"]);

  const bgOpacity = useTransform(smoothProgress, [0, 0.1, 0.9, 1], [0, 1, 1, 0]);

  return (
    <div className="relative w-full h-full flex items-center justify-center text-white overflow-hidden">
      <motion.div className="absolute inset-0 bg-black -z-10" style={{ opacity: bgOpacity }} />
      <motion.h2
        id="scroll-title"
        style={{ fontSize: titleSize, x: titleX, y: titleY, opacity: titleOpacity }}
        className="absolute font-bold tracking-tighter whitespace-nowrap z-20 pointer-events-none"
      >
        What is Frakture?
      </motion.h2>

      <motion.div
        id="scroll-body"
        style={{ fontSize: bodySize, opacity: bodyOpacity, y: bodyTranslateY }}
        className="max-w-5xl text-left font-semibold leading-[1.05] tracking-tight px-6 z-10"
      >
        Frakture is an AI-powered education platform built on the ethical use of artificial intelligence — designed not just to prepare you for exams, but to transform how you think, communicate, and perform academically.
      </motion.div>
    </div>
  );
}

export default function App() {
  const dashboardRef = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const [isClickable, setIsClickable] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const springConfig = { damping: 25, stiffness: 150 };
  const cursorX = useSpring(mouseX, springConfig);
  const cursorY = useSpring(mouseY, springConfig);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouseX.set(e.clientX - 159 / 2);
      mouseY.set(e.clientY - 159 / 2);
      const el = document.elementFromPoint(e.clientX, e.clientY);
      setIsClickable(!!el?.closest('a, button, [role="button"], input, select, textarea, label'));
    };
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('scroll', handleScroll);
    };
  }, [mouseX, mouseY]);

  return (
    <div className="relative min-h-screen font-sans selection:bg-white selection:text-purple-900 cursor-none">
      <LiquidBackground />

      {/* Opposite Color Mouse Cursor */}
      <motion.div
        id="custom-cursor"
        className="fixed top-0 left-0 w-[159px] h-[159px] bg-white rounded-full pointer-events-none z-[9999] mix-blend-difference flex items-center justify-center"
        style={{ x: cursorX, y: cursorY }}
      >
        <AnimatePresence mode="wait">
          <motion.img
            key={isClickable ? 'hand' : 'arrow'}
            src={isClickable ? '/mouse/icons8-pointer.svg' : '/mouse/icons8-pointer (1).svg'}
            className="w-10 h-10"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.12 }}
          />
        </AnimatePresence>
      </motion.div>

      {/* Navigation */}
      <nav
        id="navbar"
        className="fixed top-0 left-0 right-0 z-50 px-6 py-6 md:px-12 flex items-center justify-between transition-colors duration-300"
        style={{ backgroundColor: scrolled ? 'rgba(0,0,0,0.35)' : 'transparent' }}
      >
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-2"
        >
          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-between p-1">
            <div className="w-full h-full bg-black rounded-sm flex items-center justify-center">
              <span className="text-white text-[10px] font-bold">F</span>
            </div>
          </div>
          <span className="text-white font-bold tracking-tighter text-xl">FRAKTURE</span>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="hidden md:flex items-center gap-8 text-sm font-semibold text-white/70"
        >
          <a href="#" className="hover:text-white transition-colors">Courses</a>
          <a href="#" className="hover:text-white transition-colors">Mentors</a>
          <a href="#" className="hover:text-white transition-colors">Community</a>
          <a href="#" className="hover:text-white transition-colors">Pricing</a>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-4"
        >
          <button id="search-btn" className="p-2 text-white/70 hover:text-white transition-colors">
            <Search size={20} />
          </button>
          <button id="menu-btn" className="md:hidden p-2 text-white/70 hover:text-white transition-colors">
            <Menu size={20} />
          </button>
          <button id="login-btn" className="hidden md:block text-sm font-semibold hover:text-white/80">Log in</button>
          <button id="signup-btn" className="hidden md:block bg-white text-black px-5 py-2 rounded-full text-sm font-semibold hover:bg-white/90 transition-all active:scale-95">
            Sign up
          </button>
        </motion.div>
      </nav>

      {/* Hero Section */}
      <main className="relative pt-32 pb-20 px-6 md:px-12 max-w-7xl mx-auto flex flex-col items-center justify-center min-h-[90vh]">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="text-center"
        >
          <motion.h1 
            id="hero-title"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="text-[15vw] md:text-[12vw] font-bold leading-[0.8] tracking-tighter text-white mb-6 uppercase"
          >
            FRAKTURE
          </motion.h1>
          
          <motion.p 
            id="hero-subtitle"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="text-xl md:text-3xl font-semibold text-white/90 mb-12 tracking-tight"
          >
            Breaking the old way of learning!
          </motion.p>

          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.6 }}
            className="flex flex-col md:flex-row items-center gap-4"
          >
            {/* The special Gen Z see-through button */}
            <motion.button
              id="get-started-btn"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="relative bg-white px-12 py-5 rounded-full transition-all duration-300 isolate"
            >
              <span className="text-white font-semibold text-xl mix-blend-difference">
                Get started?
              </span>
            </motion.button>
            <button className="flex items-center gap-2 text-white font-semibold px-8 py-5 rounded-full border border-white/20 hover:bg-white/10 transition-all">
              <PlayCircle size={20} />
              Watch Demo
            </button>
          </motion.div>
        </motion.div>

        {/* Floating Badges */}
        <div className="absolute top-1/2 left-0 w-full h-0 md:block hidden pointer-events-none">
          <motion.div 
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="absolute -left-10 top-0 bg-white/10 backdrop-blur-md border border-white/20 p-4 rounded-2xl rotate-[-12deg]"
          >
            <BookOpen className="text-purple-400 mb-2" />
            <div className="text-[10px] uppercase font-bold text-white/50 tracking-widest">Active Lessons</div>
            <div className="text-xl font-bold">1.2k+</div>
          </motion.div>

          <motion.div 
            animate={{ y: [0, 10, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            className="absolute -right-10 bottom-0 bg-white/10 backdrop-blur-md border border-white/20 p-4 rounded-2xl rotate-[12deg]"
          >
            <Users className="text-purple-400 mb-2" />
            <div className="text-[10px] uppercase font-bold text-white/50 tracking-widest">Global Students</div>
            <div className="text-xl font-bold">50k+</div>
          </motion.div>
        </div>
      </main>

      {/* What is Frakture — Scroll-linked Section */}
      <section
        ref={dashboardRef}
        className="relative h-[250vh]"
      >
        <div className="sticky top-0 h-screen w-full flex items-center justify-center overflow-hidden">
          <WhatIsFraktureScroll containerRef={dashboardRef} />
        </div>
      </section>

      {/* Dashboard Preview Section */}
      <section id="dashboard-preview" className="px-6 md:px-12 py-24 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <motion.div 
            whileInView={{ opacity: 1, y: 0 }}
            initial={{ opacity: 0, y: 30 }}
            className="md:col-span-2 bg-white/5 backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-8 min-h-[400px] flex flex-col justify-between overflow-hidden relative group"
          >
             <div className="relative z-10">
               <h3 className="text-3xl font-bold mb-4 tracking-tight">Adaptive Learning Paths</h3>
               <p className="text-white/60 max-w-sm mb-8 leading-relaxed">
                 Our AI analyzes your progress in real-time to create a curriculum that's uniquely yours. No more generic modules.
               </p>
               <button className="flex items-center gap-2 group/btn text-sm font-bold bg-white/10 hover:bg-white text-white hover:text-black px-6 py-3 rounded-full transition-all">
                 Explore Path <ArrowRight size={16} className="group-hover/btn:translate-x-1 transition-transform" />
               </button>
             </div>
             <div className="absolute right-0 bottom-0 w-1/2 aspect-square bg-purple-500/20 blur-[100px] rounded-full group-hover:bg-purple-500/40 transition-all duration-700" />
             <div className="absolute -right-20 -bottom-20 w-80 h-80 border-t border-l border-white/10 rounded-full" />
             <div className="absolute -right-10 -bottom-10 w-60 h-60 border-t border-l border-white/10 rounded-full" />
          </motion.div>

          <motion.div 
            whileInView={{ opacity: 1, y: 0 }}
            initial={{ opacity: 0, y: 30 }}
            transition={{ delay: 0.1 }}
            className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-8 flex flex-col items-center justify-center text-center group"
          >
            <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <Zap className="text-white" size={32} />
            </div>
            <h3 className="text-2xl font-bold mb-2">Supersonic Mentorship</h3>
            <p className="text-white/60 text-sm">Direct access to industry leads through our instant bubble network.</p>
          </motion.div>

          <motion.div 
            whileInView={{ opacity: 1, y: 0 }}
            initial={{ opacity: 0, y: 30 }}
            transition={{ delay: 0.2 }}
            className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-8 flex flex-col items-center justify-center text-center group"
          >
            <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <Globe className="text-white" size={32} />
            </div>
            <h3 className="text-2xl font-bold mb-2">Global Campus</h3>
            <p className="text-white/60 text-sm">Connect with peers across 190 countries in our decentralized hubs.</p>
          </motion.div>

          <motion.div 
            whileInView={{ opacity: 1, y: 0 }}
            initial={{ opacity: 0, y: 30 }}
            transition={{ delay: 0.3 }}
            className="md:col-span-2 bg-gradient-to-br from-purple-600/40 to-transparent backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-10 flex flex-col md:flex-row gap-8 items-center justify-between"
          >
             <div className="flex-1">
               <div className="flex gap-1 mb-4">
                 {[1,2,3,4,5].map(i => <Sparkles key={i} size={14} className="text-purple-400" />)}
               </div>
               <h3 className="text-4xl font-bold mb-4 tracking-tighter leading-tight">Join the next wave of innovators.</h3>
               <p className="text-white/70">Education isn't just about absorbing; it's about fracturing the status quo.</p>
             </div>
             <div className="flex -space-x-4">
               {[1,2,3,4].map(i => (
                 <div key={i} className="w-14 h-14 rounded-full border-4 border-[#0a0a0a] bg-gradient-to-tr from-purple-500 to-indigo-500 flex items-center justify-center overflow-hidden">
                    <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${i + 10}`} alt="avatar" className="w-full h-full object-cover" />
                 </div>
               ))}
               <div className="w-14 h-14 rounded-full border-4 border-[#0a0a0a] bg-white text-black flex items-center justify-center font-bold text-xs">
                 +2k
               </div>
             </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 md:px-12 py-12 border-t border-white/10 text-center">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8 max-w-7xl mx-auto">
          <div className="flex items-center gap-2">
            <GraduationCap className="text-white" />
            <span className="font-bold tracking-tighter">FRAKTURE ACADEMY</span>
          </div>
          <div className="flex gap-8 text-sm font-medium text-white/50">
            <a href="#" className="hover:text-white">Privacy</a>
            <a href="#" className="hover:text-white">Terms</a>
            <a href="#" className="hover:text-white">Cookies</a>
          </div>
          <div className="text-xs text-white/30 uppercase tracking-[0.2em]">
            © 2026 FRAKTURE INC. ALL RIGHTS RESERVED.
          </div>
        </div>
      </footer>

      <style dangerouslySetInnerHTML={{ __html: `
        .mix-blend-screen {
          mix-blend-mode: screen;
        }
      `}} />
    </div>
  );
}
