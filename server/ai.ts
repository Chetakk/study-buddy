// Pluggable AI for drafting flashcards. Off by default; everything else in the app works without it.
// Only free options: a local Ollama model, or Gemini's free tier. Pick one with environment variables:
//   STUDY_BUDDY_AI=ollama   (OLLAMA_URL, default http://127.0.0.1:11434; OLLAMA_MODEL, default llama3.2)
//   STUDY_BUDDY_AI=gemini   (GEMINI_API_KEY required; GEMINI_MODEL, default gemini-2.5-flash)

export interface DraftCard {
  front: string;
  back: string;
  atS: number | null;
}

export interface AIProvider {
  name: string;
  model: string;
  ready: boolean;
  complete(prompt: string): Promise<string>;
}

const MAX_INPUT_CHARS = 24_000;
const MAX_CARDS = 15;

function ollama(): AIProvider {
  const url = (process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
  const model = process.env.OLLAMA_MODEL ?? 'llama3.2';
  return {
    name: 'ollama',
    model,
    ready: true,
    async complete(prompt) {
      let res: Response;
      try {
        res = await fetch(`${url}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, stream: false, format: 'json', messages: [{ role: 'user', content: prompt }] }),
          signal: AbortSignal.timeout(180_000),
        });
      } catch {
        throw new Error(`Can't reach Ollama at ${url}. Is it running? (ollama serve)`);
      }
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(data.error ? `Ollama: ${data.error}` : `Ollama returned ${res.status}`);
      return data.message?.content ?? '';
    },
  };
}

function gemini(): AIProvider {
  const key = process.env.GEMINI_API_KEY ?? '';
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
  return {
    name: 'gemini',
    model,
    ready: Boolean(key),
    async complete(prompt) {
      if (!key) throw new Error('Set GEMINI_API_KEY to use Gemini');
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(`Gemini: ${data.error?.message ?? res.status}`);
      return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
    },
  };
}

const off: AIProvider = {
  name: 'none',
  model: '',
  ready: false,
  async complete() {
    throw new Error('No AI provider is set up. See "AI (optional)" in the README.');
  },
};

export function provider(): AIProvider {
  const name = (process.env.STUDY_BUDDY_AI ?? '').toLowerCase();
  return name === 'ollama' ? ollama() : name === 'gemini' ? gemini() : off;
}

export function cardPrompt(title: string, text: string): string {
  return `You write flashcards for active recall. Below is material from the video "${title}": a transcript and/or the learner's notes, with [m:ss] times.

Write up to ${MAX_CARDS} flashcards that test the important ideas: definitions, why something works, how steps connect, and common mistakes. Skip trivia, greetings and sponsor segments.
- front: one clear question that can be answered from memory, without "according to the video".
- back: a short, complete answer (1–3 sentences).
- at: the [m:ss] time where the answer is explained, as given in the text.

Reply with JSON only, in this shape: {"cards":[{"front":"...","back":"...","at":"4:05"}]}

Material:
${text.slice(0, MAX_INPUT_CHARS)}`;
}

// "1:02:03" or "4:05" or 245 -> seconds
function toSeconds(at: unknown): number | null {
  if (typeof at === 'number' && Number.isFinite(at)) return Math.max(0, at);
  const m = String(at ?? '').trim().replace(/^\[|\]$/g, '').match(/^(\d+)(?::(\d{1,2}))?(?::(\d{1,2}))?$/);
  if (!m) return null;
  const parts = m.slice(1).filter((x) => x !== undefined).map(Number);
  return parts.reduce((a, p) => a * 60 + p, 0);
}

// Pulls the cards out of a model's reply, tolerating code fences and stray text around the JSON.
export function parseDrafts(reply: string): DraftCard[] {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error("The AI's reply had no cards in it");
  let data: any;
  try {
    data = JSON.parse(reply.slice(start, end + 1));
  } catch {
    throw new Error("The AI's reply wasn't valid JSON");
  }
  const list = Array.isArray(data) ? data : Array.isArray(data.cards) ? data.cards : [];
  return list
    .map((c: any) => ({
      front: String(c?.front ?? c?.question ?? '').trim().slice(0, 500),
      back: String(c?.back ?? c?.answer ?? '').trim().slice(0, 1500),
      atS: toSeconds(c?.at ?? c?.time),
    }))
    .filter((c: DraftCard) => c.front && c.back)
    .slice(0, MAX_CARDS);
}

// A transcript copied from YouTube's "Show transcript" panel puts each time on its own line;
// this joins them as "[m:ss] text" so the model can cite times.
export function tidyTranscript(raw: string): string {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\d{1,2}(:\d{2}){1,2}$/.test(lines[i]) && lines[i + 1] && !/^\d{1,2}(:\d{2}){1,2}$/.test(lines[i + 1])) {
      out.push(`[${lines[i]}] ${lines[++i]}`);
    } else out.push(lines[i]);
  }
  return out.join('\n');
}
