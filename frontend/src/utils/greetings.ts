// Random, time-of-day-flavored dashboard greetings. Deliberately not
// motivational-poster generic — see markdown/PROGRESS_LOG.md Day 3 notes
// on wanting something that reads as authentic rather than cliche.

const GENERAL = [
  "Wanna improve?",
  "Fun part about learning is to make mistakes",
  "Sometimes I don't even know the difference between effect and affect",
  "Cook or get cooked",
  "Evaluation isn't enough if you aren't going to use it",
  "Stuck? Ask Evaluation for advice",
  "Don't trust me? Then trust the sources in Recommendation",
  "What are your plans? Then let's set some goals!",
];

interface TimeBracket {
  startHour: number; // inclusive, 24h
  endHour: number; // exclusive, 24h
  messages: string[];
}

const BRACKETS: TimeBracket[] = [
  {
    startHour: 6,
    endHour: 12,
    messages: ["Aren't you an early bird"],
  },
  {
    startHour: 12,
    endHour: 15,
    messages: [
      "Afternoon's are cool too ig",
      "Nothing better than a quiz, a lunch and a good evaluation",
    ],
  },
  {
    startHour: 15,
    endHour: 17,
    messages: [
      "Hope you enjoyed your evening, wanna start?",
      "Evenings are pretty chill",
      "No need to panic, you still have time",
      "Seems like you had a good day",
      "Start now and sleep better",
    ],
  },
  {
    startHour: 17,
    endHour: 21,
    messages: [
      "One last time!",
      "We can make it through the night!",
      "Go to bed in time okay?",
    ],
  },
  {
    startHour: 21,
    endHour: 24,
    messages: [
      "Personally, I rather watch a show",
      "Dedicated? I love that but remember to sleep okay",
      "Late night thoughts? I am not GPT",
      "Hmm? A bit too late, but I understand deadlines",
      "One more push and that's it",
    ],
  },
  {
    // Extended to 6 to close the 5am-6am gap in the original brackets.
    startHour: 0,
    endHour: 6,
    messages: [
      "I also need a break you know?",
      "It's okay to procrastinate and say I'll do it tomorrow",
      "A bit too early, just go to sleep",
      "I love you but sleep",
      "Okay, I get it. We got a tough guy here",
      "I am not really a learning platform. I am an evaluating platform. So you don't need me in this hour",
      "8 hours of sleep, at least minimum",
      "A cozy bed is better at this hour",
    ],
  },
];

export function getRandomGreeting(now: Date = new Date()): string {
  const hour = now.getHours();
  const bracket = BRACKETS.find((b) => hour >= b.startHour && hour < b.endHour);
  const pool = [...GENERAL, ...(bracket?.messages ?? [])];
  return pool[Math.floor(Math.random() * pool.length)];
}
