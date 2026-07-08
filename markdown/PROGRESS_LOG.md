# Progress Log

Plain-language, day-by-day record of what actually got done — kept so the research write-up has a real timeline to pull from instead of a made-up Gantt chart. No technical detail here; that's what `TECHNICAL_LOG.md` is for. Each entry: what we built, what broke, what we fixed.

---

## Day 1 — Foundations (through 2026-07-06)

**Built:**
- Set up the full database: 17 tables covering users, questions, answers, evaluations, recommendations, and progress tracking.
- Added encryption for sensitive student data (answers, goals, chat history) — encrypted at rest, only readable through controlled access.
- Built the login/signup flow, including Microsoft Entra ID (university-style single sign-on) support.
- Simplified the backend to talk to the database only through Supabase's own API, instead of also maintaining a separate direct database connection — one less thing to keep in sync.
- Switched question generation, answer evaluation, and the goal-setting chatbot from Claude (billed through a work account) to Google Gemini's free tier — removes any shared billing with the workplace for a personal project.
- Locked down database access permissions so nothing is readable except through the app itself.
- Built the first working dashboard: students can start a quiz, answer AI-generated questions, and the app quietly tracks behaviour (time taken, hesitation, answer changes) in the background for later use in grading.

**Problems hit along the way:**
- A confusing "Cannot GET /" error that turned out to be an unrelated old project using the same port on the same machine, not a real bug.
- Signup was broken — the endpoint the signup page needed didn't actually exist yet.
- A "CORS error" that was actually a masked database connection failure — the real error was being hidden by the browser's security warnings.

---

## Day 2 — 2026-07-07

**Built:**
- A page for uploading textbook PDFs, which automatically extracts the text, splits it into pieces, and prepares it for the AI to search through later.
- A live activity feed built into the app — like a small terminal you can pop open from any page — so we can watch exactly what the backend is doing in real time instead of guessing why something's slow or stuck.
- Rewrote how quiz questions get generated so the AI asks about the actual subject being studied, instead of trivia about the textbook's authors or publisher.

**Problems hit:**
- Google's free AI service for turning text into searchable data has a daily limit — a single textbook alone came close to using up an entire day's allowance.
- The question generator was quietly pulling from the same 5 chunks of a 1,249-chunk book, every single time, no matter how many quizzes were taken — meaning over 99% of the book was never actually being used to make questions.
- The backend would sometimes freeze completely (no response to anything, for anyone) while a book was being processed. Traced to two separate causes, both fixed.
- A "processing" status could get stuck forever if the backend was stopped mid-task, making the app lie about what was actually happening behind the scenes.
- Early quiz questions turned out to be trivia about the book's authors ("what job did the author hold at Google?") rather than questions about the subject itself.

**Fixed / changed:**
- Replaced the free-but-limited Google text-processing service with one that runs locally on this machine's own graphics card instead — no daily limit, and roughly 100x faster.
- Rewrote the AI's instructions for writing questions so it asks real, subject-focused questions ("what's the difference between X and Y") and skips over source material that isn't actual teaching content (like an "About the Author" page).
- Found and fixed both causes of the backend freezing.
- Made the app automatically notice and correct a stuck status every time it restarts, instead of leaving it stuck indefinitely.

---

## Day 3 — *(add when it happens)*
