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

---

## Day 5 — 2026-07-13

**Built:**
- Gave the very first screen visitors see (before logging in) a fully animated, colourful moving background behind the main heading, instead of a plain flat colour.
- Made the heading text automatically switch between solid black and solid white, moment by moment, so it always stays readable against whatever colour is moving behind it right then — a hard on/off switch, not a soft blend.
- Made that entire animated background (and the readable-text trick riding on top of it) automatically flip to a light/dark-swapped version when the light/dark mode switch is toggled, instead of always looking the same no matter the setting.
- Made the heading bigger and bolder, switched it to the same font used everywhere else in the app, put it in capitals, removed one word ("Recommendation") from the sentence, and gave the page more room so it wraps across fewer, wider lines.

**Problems hit:**
- The first version of the animated background used a CSS shortcut that, it turned out, wasn't actually visible in the browser at all — a subtle mistake in how the layers were stacked meant the plain background colour was quietly painting over the animation and hiding it completely.
- After fixing that, the animation itself wasn't moving — a second CSS feature used to animate it isn't actually supported the way it looked like it should be, in the browser being used to test.
- The "readable text over a moving background" effect first came out as a soft rainbow-ish blend instead of a clean black-or-white switch — traced to a hard limit in what CSS itself is capable of here, not a tuning problem, no amount of adjusting the settings could have fixed it.
- After moving that effect to a more capable animation technique (the kind normally used for 3D graphics/games) to fix the above, resizing the browser window could leave the heading rendered as two overlapping, misaligned copies of itself until the page was fully reloaded — traced to two different parts of the page each reacting to a resize independently, slightly out of step with each other.

**Fixed:**
- Rebuilt the animated background so it actually renders in the browser being used to test, instead of being invisible.
- Replaced the non-moving background technique with one that actually animates.
- Rebuilt the "stay readable against anything behind it" effect using the same animation engine that draws the moving background itself, instead of layering separate visual tricks on top of each other — now a true hard black/white switch, no in-between colours.
- Fixed the resizing bug by having the one part of the page that draws the heading measure its own size directly, at the exact moment it redraws, instead of two separate parts of the page each keeping their own out-of-sync copy of that measurement.
- Confirmed the light/dark switch now flips the animated background along with everything else on the page, instead of the background always looking the same regardless of the switch.

---

## Day 6 — 2026-07-16

**Built:**
- Two new scoring measurements, added to the existing grading system: whether an answer rambles on longer than it needs to, and whether it looks like it was copied word-for-word from the source material rather than written in the student's own words. Both computed instantly with no AI involved, so they cost nothing extra to run.
- Extended the existing per-topic progress tracking to also average these two new measurements over time, alongside everything it already tracked.
- Built the actual "Evaluation" tab for the first time — a chat-style page where you can ask questions about your own results and get a real, grounded answer back, instead of just seeing raw numbers.

**Problems hit:**
- The backend refused to start at all at the beginning of the day — traced to two different, unrelated pieces of installed software on this machine quietly disagreeing about which version of a shared underlying library to use, so the actual application code was never the problem.
- The very first version of the evaluation chat gave a shallow, misleading answer: it treated a multiple-choice question's score as if it proved deep understanding, sitting right next to genuinely graded written answers, and made the two look directly comparable when they aren't. It also never looked at the hesitation/timing/distraction data at all, despite that being the whole reason that data gets collected in the first place.
- Asked to go deeper, the second version was better but still just described the numbers back rather than genuinely reasoning about them — and it ended by telling the student to go figure out what changed, instead of actually figuring it out itself.
- The AI also didn't have access to the actual wording of each question, so it had no way to tell whether the student is naturally better at simple recall-style questions versus ones that require connecting several ideas together.

**Fixed:**
- Found and corrected the exact mismatched library versions causing the startup crash.
- Rebuilt the evaluation chat so it clearly separates multiple-choice correctness (a fact) from genuinely graded written answers (a judgement), and never treats them as equally meaningful evidence of understanding.
- Gave the chat access to the actual hesitation/timing/distraction data for the first time, so it can now speak to focus and pacing, not just scores.
- Gave the chat the real wording of each question, so it can reason about what *kind* of thinking a question demanded, not just tally up numbers.
- Rewrote its instructions so it has to commit to an actual explanation and specific, concrete next steps, instead of handing the diagnosis back to the student.
- Went through this markdown-file cleanup pass and fixed several facts that had drifted out of date since earlier in the project — leftover mentions of a free AI service that was actually swapped back to a paid one over a week ago, a couple of dependencies the code no longer actually uses, and a route list that hadn't been updated as new pages were added.

---

## Day 7 — 2026-07-19

**Built:**
- Ahead of the final presentation: fixed the evaluation chat so long conversations no longer push the send button off the bottom of the screen — the message list now scrolls on its own inside a fixed-size window, the way any normal chat app works.
- Made the chat's replies actually render properly — bold text and bullet points used to show up as literal asterisks and dashes; now they display formatted, like real text.
- Gave the evaluation chat the ability to show actual charts, not just written answers — ask it to compare your scores or show a trend, and it now draws a real chart alongside its explanation, built only from your real, already-computed numbers.

**Problems hit:**
- The first version of the chart feature technically worked but was too shy about actually using it — asked a question comparing four different scores across several dates, and it still just wrote a paragraph instead of drawing anything.

**Fixed:**
- Rewrote its instructions to stop treating a chart as optional whenever there's more than one number worth comparing — it was told plainly to default to showing one instead of talking around it.

**Where things stand:** backend is stable and considered done for the presentation. Remaining work is frontend polish only, with the presentation later today — enough runway left to make UI adjustments without touching anything that already works.

**Where things stand:** this closes out the initial research/demo build of the project. Everything from here on is about turning what already works into an actual production-ready application, rather than proving the core ideas out for the first time.
