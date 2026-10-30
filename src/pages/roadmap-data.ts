// The roadmap is plain data: edit this file to move things between columns.
export type Stage = 'done' | 'now' | 'next' | 'later';
export type Lane = 'core' | 'ml' | 'python' | 'leetcode';

export interface RoadItem {
  title: string;
  note: string;
  lane: Lane;
  stage: Stage;
  after?: string; // title of the item this builds on
  hold?: boolean; // blocked, waiting on a decision
}

export const STAGES: [Stage, string][] = [
  ['done', 'Done'],
  ['now', 'Now'],
  ['next', 'Next'],
  ['later', 'Later'],
];

export const LANES: [Lane, string, string][] = [
  ['core', 'Foundation', 'blue'],
  ['ml', 'Machine learning', 'violet'],
  ['python', 'Python', 'aqua'],
  ['leetcode', 'LeetCode', 'orange'],
];

export const ROADMAP: RoadItem[] = [
  // Foundation
  { lane: 'core', stage: 'done', title: 'Playlists, groups and progress', note: 'Unique seconds watched, per video, playlist and group' },
  { lane: 'core', stage: 'done', title: 'Flashcards with spaced repetition', note: 'FSRS, piles, review page, solve-again cards' },
  { lane: 'core', stage: 'done', title: 'Notes, articles and daily goals', note: 'Timestamped notes, reading lists, goals, suggestions' },
  { lane: 'core', stage: 'done', title: 'Installable app and extension', note: 'PWA, launcher, tracking on youtube.com' },
  { lane: 'core', stage: 'done', title: 'Cards drafted by AI', note: 'Free provider, pasted transcript, Pending review inbox' },
  { lane: 'core', stage: 'now', title: 'Daily planner', note: 'Turn goals and due cards into one ordered list for today' },
  { lane: 'core', stage: 'next', title: 'Target dates', note: 'Finish a group by a date and see the pace you need per day', after: 'Daily planner' },
  { lane: 'core', stage: 'next', title: 'Weekly review', note: 'One page: what you finished, what slipped, what to do next week', after: 'Daily planner' },
  { lane: 'core', stage: 'later', title: 'Backup and export', note: 'Download everything; export cards to Anki' },
  { lane: 'core', stage: 'later', title: 'Auto transcripts', note: 'Fetch YouTube transcripts for card drafting', hold: true },

  // Machine learning
  { lane: 'ml', stage: 'now', title: 'Cards from every lecture', note: 'Draft, approve and keep a few cards per video' },
  { lane: 'ml', stage: 'next', title: 'Concept map', note: 'Link notes and cards by topic: loss, gradients, overfitting', after: 'Cards from every lecture' },
  { lane: 'ml', stage: 'later', title: 'Paper reading list', note: 'Papers as articles with a short summary note each' },
  { lane: 'ml', stage: 'later', title: 'Small projects', note: 'One mini project per module, tracked like a playlist', after: 'Concept map' },

  // Python
  { lane: 'python', stage: 'next', title: 'Syntax and library cards', note: 'Short code-prompt cards with the answer hidden' },
  { lane: 'python', stage: 'later', title: 'Exercise log', note: 'Track practice problems and mini scripts you wrote', after: 'Syntax and library cards' },
  { lane: 'python', stage: 'later', title: 'Run code in a card', note: 'Try the answer in the card before you reveal it', after: 'Exercise log' },

  // LeetCode
  { lane: 'leetcode', stage: 'done', title: 'Problem sheets and patterns', note: 'Patterns and difficulty view, solve-again cards' },
  { lane: 'leetcode', stage: 'now', title: 'Weak-pattern focus', note: 'Surface the patterns you re-solve or fail most' },
  { lane: 'leetcode', stage: 'next', title: 'Timed practice', note: 'A timer per problem and your average per difficulty', after: 'Weak-pattern focus' },
  { lane: 'leetcode', stage: 'later', title: 'Mock rounds', note: 'Two or three random problems against the clock', after: 'Timed practice' },
];
