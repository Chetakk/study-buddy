export type Status = 'not_started' | 'in_progress' | 'done';
export type ItemKind = 'video' | 'problem' | 'article';

// Details for items of kind 'problem' (empty for videos).
export interface ProblemMeta {
  difficulty?: '' | 'easy' | 'medium' | 'hard';
  concept?: string;
  challenge?: boolean;
  homework?: boolean;
  links?: { label: string; url: string }[];
  words?: number; // articles
}
export type Segment = [number, number];

export interface SourceStats {
  id: number;
  groupId: number;
  kind: string;
  title: string;
  channel: string;
  url: string;
  total: number;
  done: number;
  durationS: number;
  watchedS: number;
}

export interface Group {
  id: number;
  name: string;
  color: string;
  onToday: boolean;
  goalMin: number;
  total: number;
  done: number;
  durationS: number;
  watchedS: number;
  sources: SourceStats[];
}

export interface QueueItem {
  id: number;
  kind: ItemKind;
  url: string;
  meta: ProblemMeta;
  title: string;
  durationS: number;
  thumbnail: string;
  sourceId: number;
  sourceTitle: string;
  watchedS: number;
  positionS: number;
  status: Status;
}

export interface ResumeItem {
  id: number;
  title: string;
  durationS: number;
  thumbnail: string;
  position: number;
  sourceId: number;
  sourceTitle: string;
  sourceTotal: number;
  groupId: number;
  groupName: string;
  groupColor: string;
  segments: Segment[];
  watchedS: number;
  positionS: number;
  status: Status;
  next: { id: number; title: string; durationS: number; thumbnail: string } | null;
}

export type TodayGroup = Group & { upNext: QueueItem[]; studiedToday: boolean; todayS: number; finishedAt: string | null };

export interface GroupSource extends SourceStats {
  next: QueueItem | null;
  lastAt: string | null;
  items?: ListItem[]; // problem patterns only
}

export interface GroupDetail extends Omit<Group, 'sources'> {
  sources: GroupSource[];
  upNext: QueueItem[];
  paceS: number;
}

export interface Today {
  groups: TodayGroup[];
  allGroups: { id: number; name: string; color: string; onToday: boolean }[];
  resume: ResumeItem | null;
  studiedTodayS: number;
  avgDailyS: number;
  streak: number;
  longestStreak: number;
}

export interface Sidebar {
  groups: { id: number; name: string; color: string; done: number; total: number }[];
  streak: number;
}

export interface SearchHit {
  kind: 'Group' | 'Playlist' | 'Pattern' | 'Reading list' | 'Video' | 'Problem' | 'Article' | 'Note';
  title: string;
  sub: string;
  color: string;
  href: string;
}

export interface ListItem {
  id: number;
  kind: ItemKind;
  url: string;
  meta: ProblemMeta;
  title: string;
  durationS: number;
  thumbnail: string;
  position: number;
  watchedS: number;
  status: Status;
  skipped: boolean;
  rewatchedAt: string | null;
}

export interface SourceDetail extends SourceStats {
  group: { id: number; name: string; color: string };
  items: ListItem[];
  paceS: number;
}

export interface Progress {
  segments: Segment[];
  watchedS: number;
  positionS: number;
  status: Status;
  completedAt: string | null;
  rewatchedAt: string | null;
}

export interface Note {
  id: number;
  atS: number;
  body: string;
  createdAt: string;
}

export interface ItemDetail {
  id: number;
  kind: string;
  externalId: string;
  title: string;
  durationS: number;
  thumbnail: string;
  position: number;
  sourceId: number;
  sourceTitle: string;
  groupId: number;
  groupName: string;
  groupColor: string;
  progress: Progress;
  notes: Note[];
  playlist: ListItem[];
}

export interface Stats {
  groups: Group[];
  days: { day: string; seconds: number }[];
  week: { day: string; groupId: number; seconds: number }[];
  totalStudiedS: number;
  streak: number;
}

export interface NoteHit extends Note {
  itemId: number;
  itemTitle: string;
  thumbnail: string;
  sourceTitle: string;
  groupName: string;
  groupColor: string;
}

export type Pile = 'pending' | 'new' | 'learning' | 'review' | 'mastered' | 'struggling';

export interface Card {
  id: number;
  groupId: number;
  groupName: string;
  groupColor: string;
  itemId: number | null;
  itemTitle: string | null;
  itemKind: ItemKind | null;
  itemUrl: string | null;
  sourceId: number | null;
  sourceTitle: string | null;
  atS: number | null;
  kind: 'basic' | 'problem';
  front: string;
  back: string;
  origin: 'manual' | 'problem' | 'ai';
  pile: Pile;
  state: string;
  due: string;
  reps: number;
  lapses: number;
  stabilityDays: number;
  problem: { difficulty: string; concept: string; links: { label: string; url: string }[] } | null;
  createdAt: string;
}

// Milliseconds until the card comes back for each rating (1 Again … 4 Easy).
export type QueueCard = Card & { intervals: Record<1 | 2 | 3 | 4, number> };

export interface CardSummary {
  total: number;
  piles: Record<Pile, number>;
  due: number;
  dueReviews: number;
  newToday: number;
  nextDue: string | null;
  reviewedToday: number;
}
