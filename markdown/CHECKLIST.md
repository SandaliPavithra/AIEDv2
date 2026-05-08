# Frakture Frontend — Build Checklist

## Design & Planning
- [ ] Create proper UI/UX designs in Figma before building new sections
- [ ] Reconsider and finalise the colour theme (current: black, dark purple, violet, iris — may need refinement)
- [ ] Define the full page structure / sitemap

## Homepage (`App.tsx`)

### Hero Section ✅
- [x] Liquid WebGL animated background (`LiquidBackground.tsx`)
- [x] Navbar with scroll-triggered dark background (`rgba(0,0,0,0.35)`)
- [x] FRAKTURE hero title
- [x] "Get started?" button with `mix-blend-difference` mask effect
- [x] "Watch Demo" button
- [x] Floating badges (Active Lessons, Global Students)
- [x] Custom cursor — white circle with `mix-blend-difference`, arrow/hand SVG icons inside
- [x] OS cursor hidden globally (`cursor: none !important`)

### "What is Frakture?" Scroll Section ✅
- [x] Scroll-linked title that shrinks, moves, and aligns with body text
- [x] Black background that fades in on enter and fades out on exit
- [x] Body paragraph fades in after background is fully black
- [x] Title fades in after background is fully black
- [x] Title left-aligned with body paragraph text

### Bento Grid / Dashboard Preview Section (needs expansion)
- [x] "Adaptive Learning Paths" wide card
- [x] "Supersonic Mentorship" card
- [x] "Global Campus" card
- [x] "Join the next wave of innovators" card with avatars
- [ ] Add more cards / components that explain the platform deeper
- [ ] Add a proper features breakdown section
- [ ] Add a social proof / testimonials section
- [ ] Add a pricing / CTA section

## New Sections to Build
- [ ] **Features deep-dive** — detailed breakdown of AI-powered tools, mentor access, global community
- [ ] **How it works** — step-by-step onboarding flow
- [ ] **Testimonials / Social proof** — student quotes, stats
- [ ] **Pricing** — plan tiers with CTA
- [ ] **Footer** — expand with links, socials, legal

## Technical Debt / Polish
- [ ] Mobile responsiveness pass across all sections
- [ ] Accessibility audit (focus states, screen reader support)
- [ ] Performance audit (WebGL background on low-end devices)
- [ ] SEO meta tags in `index.html`
- [ ] Favicon
