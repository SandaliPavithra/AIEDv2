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

## Day 3 — 2026-07-08

**Built:**
- Made quiz generation faster by working on several textbook sections at once instead of one at a time — cut generation time roughly in half.
- Fixed a generated multiple-choice question that referenced "the examples provided" when the student never actually saw any examples — questions now have to make sense entirely on their own, without assuming the reader has the source material in front of them.
- Made the app give up early on a quiz session that's clearly not going to work, instead of wasting time grinding through dozens of doomed attempts one by one.
- Replaced the app's dark/light mode switch with a proper physical-looking toggle, and cleaned up how it works under the hood — previously three different pages each had their own separate, copy-pasted version of the light/dark logic; now there's one shared version everywhere, including the login and sign-up pages, which never had a working toggle before at all.

**Problems hit:**
- Quiz generation kept timing out for users even when it was moments away from succeeding — traced to the app's own patience running out a few seconds before the AI actually finished.
- Google's free AI service turned out to have been cut down industry-wide to about 20 questions a day, total — not something specific to this app, and far too little for day-to-day testing, let alone real use.
- Discovered the project actually had two separate, tangled copies of its own history on this computer — one real, with everything ever built, and one empty accidental duplicate sitting right on top of it. Working in the wrong one could have silently thrown work away without any warning.
- The first version of the new toggle overlapped with existing buttons in the page header — only visible on pages that actually have a header, which the initial testing missed.

**Fixed / changed:**
- Bought a small amount of personal AI credit and moved question generation, answer evaluation, and the goal-setting chatbot off Google's free service entirely, onto a paid AI service (Claude) that has no daily cutoff — cheap enough for regular use that it should be a non-issue going forward.
- Removed the leftover, empty duplicate project history so there's now exactly one place all future work gets saved.
- Saved and backed up everything built so far — the whole app, as it stands today, is now safely stored online rather than existing only on this one computer.
- Repositioned and shrank the new toggle so it sits cleanly next to existing buttons instead of overlapping them, and changed it so the indicator lights up white for light mode and stays dark/unlit for dark mode, matching how it's actually meant to read.

**Picking back up after 5PM — rebuilt the login page and dashboard from wireframes:**
- Redesigned the login page to match a hand-drawn mockup: bold "SIGN IN" heading with a subtle drop shadow, a cleaner layout for the email/password fields, and a smooth animated underline that appears under whichever field you're typing into. Added a show/hide toggle on the password field so you can check what you typed instead of guessing.
- Built a glowing, multi-colour "frosted glass" effect for the Log In button — went through a few rounds of adjustment based on feedback until the colour only shows faintly around the edges, like RGB lighting placed behind a TV, rather than washing over the whole button.
- Rebuilt the dashboard so that logging in shows a random, timed greeting instead of a generic "Welcome back" — the message changes depending on the time of day and is written to sound like an actual person, not a motivational poster. It now rotates automatically every 10–15 seconds with a smooth fade between messages.
- Added a profile icon in the top corner with a simple dropdown ("View account", "Sign out"), styled to blend into the page instead of standing out as its own box.
- Replaced the plain "Start a quiz" / "Upload a book" buttons on the dashboard with a set of six interactive cards — Quizzes, Sources, Upload Books, Evaluation, Recommendations, and Goals — each with a one-line description of what it's for, and a glowing spotlight effect that follows the cursor. Three of the six (Evaluation, Recommendations, Goals) are clearly marked "Coming soon" since those pages don't exist yet — real doors, just not open yet, rather than pretending they lead somewhere.

**Problems hit (evening session):**
- The very first version of the login/dashboard underline and glow effects had a few small visual bugs caught only by actually clicking around: the animated underline stretched under the label text as well as the input, placeholder text was accidentally italic, and the static baseline line was cut off right before the show/hide password icon instead of running underneath it.
- The button glow effect went through a few visibly-wrong stages before landing right — first too plain, then a rainbow ring that looked good but the button face itself still looked out of place, then a frosted-glass version where the colour was too strong and centered instead of sitting subtly at the edges.
- The cursor-tracking spotlight on the new dashboard cards was initially too wide for the card size — it washed over almost the entire card instead of reading as a focused spotlight that follows the mouse.

**Fixed:**
- All of the above were caught by actually testing the pages live (not just reading the code) and corrected in the same session — underline scope, italics, baseline line, button glow colour/strength, and spotlight size all adjusted based on what it actually looked like on screen.

---

## Day 4 — 2026-07-09

**Built:**
- Redesigned the quiz-generation setup page to match a hand-drawn wireframe: a proper header (reused from the dashboard instead of a one-off copy), topic selection that lets you pick more than one topic at once (shown as removable pill chips), and difficulty/question-type dropdowns styled to match the rest of the app.
- Added support for generating a quiz that pulls from multiple topics at once — previously a quiz session could only ever be about one topic; the database and the question-generation logic were both changed to support several topics per quiz.
- Built a proper "session expired" screen from a wireframe, replacing a plain error message.
- Replaced the loading spinner shown during quiz generation (which, it turned out, had never actually animated) with a colourful six-dot spinner plus a rotating status message ("Digging through the chapters…", "Drafting questions…", etc.), so it doesn't feel like the app has frozen while the AI works.
- Fully redesigned the quiz-taking screen to match another wireframe: no more boxes-within-boxes, a distinct look per question type (multiple choice, short answer, long answer), and a dedicated panel beside the question that lights up once you submit an answer, showing a score and the AI's actual written feedback.
- Actually wired up the answer-evaluation AI for the first time — the code existed already, but nothing in the app had ever called it. Multiple-choice answers now get instant rule-based right/wrong scoring plus an AI-written explanation of why each wrong option is wrong; short and long answers get genuinely graded by AI against the source material.

**Problems hit:**
- The first version of the new quiz-generation page had a text-wrapping bug on the topic field, and the "Generate Quiz" button was on the wrong side of the page.
- Generating a quiz turned out to be completely broken — every single question-generation attempt failed, due to a technical quirk in how the AI service validates the response format it's asked to follow.
- Right after fixing that, a second, unrelated failure showed up in the same AI call — the AI service doesn't allow two particular settings to be specified together for this model.
- The new quiz-taking page's loading spinner looked washed-out and barely visible in light mode — the colour effect it used only reads properly on a dark background.
- The first attempt at making the evaluation panel bigger accidentally made the whole page taller than the screen, forcing a scrollbar — took a couple of passes to get the sizing right without needing to scroll.
- Chased down a report of "some quiz answers aren't being saved" — turned out not to be a real bug. Those were quiz attempts where question generation itself had stalled or failed, so the student never actually got the chance to answer anything for those specific sessions.
- Once the grading AI was switched on for the first time, it also failed immediately — the same "can't specify these two settings together" issue as before, but a stricter version of it on the model used for grading.
- Then discovered the separate "fact-checking" AI (which flags when the grading AI might be making things up) had never actually been given real credentials, so it crashed every single evaluation until that was made optional instead of a hard requirement.
- Saw a scary-looking crash in the browser console partway through testing ("React has detected a change in the order of Hooks") — turned out to be a leftover glitch from the page refreshing itself mid-edit, not a real bug; a normal refresh cleared it.

**Fixed:**
- Rewrote the broken part of the AI response format so question generation works again.
- Removed the conflicting setting from both the question-generation and answer-grading AI calls.
- Gave the loading spinner its own solid-colour look for light mode instead of reusing the dark-mode-only colour effect.
- Rebalanced the quiz-taking page's spacing so the evaluation panel now stretches down to match the question card's height without pushing anything off-screen.
- Made the fact-checking AI optional — if it's not configured, or if it fails for any reason, grading still goes through instead of the whole feature breaking.
- Added the AI explanation for wrong multiple-choice answers, so instead of just "here's the correct answer," students now get a short explanation of why each option they didn't pick was right or wrong.

**Picking back up at 5PM.**
