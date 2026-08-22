// Where a crumb comes from. Two sources, plus a hybrid:
//
//   poolSource   — the curated, fact-checked pool in data/crumbs.json (verified).
//   modelSource  — a best-effort SIDE model that generates a crumb on the fly,
//                  ideally about the very thing you're waiting on (unverified).
//   autoSource   — try the model; fall back to the pool if it's unavailable.
//
// The model is deliberately a *side* call: it never runs in, or writes to, the
// main agent's context. If no model surface is available (offline, air-gapped,
// no endpoint), autoSource quietly degrades to the pool, so the plugin always
// works. Model crumbs are marked `verified: false` — they're entertainment.

import { loadPool, pick, render } from './crumbs.ts'

export interface CrumbSuggestion {
  id?: string
  tags?: string[]
  text: string // display-ready, already carries its icon
  reveal?: string // display-ready answer, quiz mode only
  verified: boolean
}

export interface GenerateOpts {
  topic?: string
  seedTags: string[]
  mode: 'fact' | 'quiz'
  excludeIds?: Iterable<string>
}

export interface CrumbSource {
  name: string
  generate(opts: GenerateOpts): Promise<CrumbSuggestion | null>
}

// ---------------------------------------------------------------------------
// Pool source (verified)
// ---------------------------------------------------------------------------

export function poolSource(): CrumbSource {
  return {
    name: 'pool',
    async generate(opts) {
      const pool = await loadPool()
      const crumb = pick(pool.crumbs, { tags: opts.seedTags, excludeIds: opts.excludeIds })
      if (!crumb) return null
      const r = render(crumb, opts.mode)
      return { id: crumb.id, tags: crumb.tags, text: r.text, reveal: r.reveal, verified: true }
    },
  }
}

// ---------------------------------------------------------------------------
// Model source (unverified, best-effort)
// ---------------------------------------------------------------------------

/** A minimal side-model call. Returns the model's raw text. */
export type ModelCaller = (prompt: string, system?: string) => Promise<string>

const SYSTEM =
  'You supply one small, genuinely TRUE, surprising fact to entertain someone during a short wait. ' +
  'Be accurate and specific; never invent numbers, dates, or names you are unsure of. Keep it to 1-2 sentences.'

/** Build the topic phrase a crumb should relate to. Pure. */
export function topicPhrase(opts: GenerateOpts): string {
  if (opts.topic && opts.topic.trim()) return opts.topic.trim()
  if (opts.seedTags.length) return opts.seedTags.join(', ')
  return 'anything interesting'
}

/** Prompt for a stated fact. Pure. */
export function buildFactPrompt(opts: GenerateOpts): string {
  return `Give ONE short, true, surprising fact related to: ${topicPhrase(opts)}. Reply with just the fact, no preamble.`
}

/** Prompt for an ask-first quiz. Pure. */
export function buildQuizPrompt(opts: GenerateOpts): string {
  return (
    `Give ONE short trivia question (with its true answer) related to: ${topicPhrase(opts)}.\n` +
    `Reply on exactly two lines:\nQ: <question>\nA: <answer>`
  )
}

/** Clean a raw fact string: strip preamble/quotes, cap length. Pure. */
export function parseFact(raw: string): string | null {
  let s = (raw ?? '').trim()
  if (!s) return null
  // Drop a leading "Fact:" / "Sure! " style preamble on the first line.
  s = s.replace(/^\s*(fact|did you know|here'?s (a|one)|sure[!,.]?)\s*[:\-—]?\s*/i, '')
  s = s.replace(/^["'“”]+|["'“”]+$/g, '').trim()
  if (s.length < 12) return null
  return s.length > 400 ? `${s.slice(0, 399)}…` : s
}

/** Parse a two-line Q/A quiz reply. Pure. */
export function parseQuiz(raw: string): { q: string; a: string } | null {
  const text = raw ?? ''
  const q = /(^|\n)\s*Q\s*[:\-]\s*(.+)/i.exec(text)?.[2]?.trim()
  const a = /(^|\n)\s*A\s*[:\-]\s*(.+)/i.exec(text)?.[2]?.trim()
  if (!q || !a) return null
  return { q: q.replace(/["'“”]+$/g, '').trim(), a: a.replace(/["'“”]+$/g, '').trim() }
}

/**
 * A source backed by a side model. If `call` is null (no model surface), it
 * yields null so autoSource can fall back. Any error also yields null — a crumb
 * is never worth surfacing an exception.
 */
export function modelSource(call: ModelCaller | null): CrumbSource {
  return {
    name: 'model',
    async generate(opts) {
      if (!call) return null
      try {
        if (opts.mode === 'quiz') {
          const parsed = parseQuiz(await call(buildQuizPrompt(opts), SYSTEM))
          if (!parsed) return null
          return { text: `✨ ${parsed.q}`, reveal: `✅ ${parsed.a}`, verified: false }
        }
        const fact = parseFact(await call(buildFactPrompt(opts), SYSTEM))
        if (!fact) return null
        return { text: `✨ ${fact}`, verified: false }
      } catch {
        return null
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Auto (hybrid): model first, pool as the safety net
// ---------------------------------------------------------------------------

export function autoSource(primary: CrumbSource, fallback: CrumbSource): CrumbSource {
  return {
    name: 'auto',
    async generate(opts) {
      const first = await primary.generate(opts)
      if (first) return first
      return fallback.generate(opts)
    },
  }
}

// ---------------------------------------------------------------------------
// Discover a side-model caller from the dsh host, best-effort.
// ---------------------------------------------------------------------------

/**
 * Probe the context for a usable side-model call. dsh hosts differ, so try the
 * likely shapes and normalize to a `ModelCaller`. Returns null if none is found
 * — in which case the plugin runs pool-only, exactly as before. Never throws.
 */
export function resolveModelCaller(ctx: any): ModelCaller | null {
  try {
    // Shape 1: ctx.model.generate({ prompt, system }) -> { text } | string
    const gen = ctx?.model?.generate ?? ctx?.llm?.generate ?? ctx?.ai?.generate
    if (typeof gen === 'function') {
      const self = ctx?.model ?? ctx?.llm ?? ctx?.ai
      return async (prompt, system) => normalizeText(await gen.call(self, { prompt, system }))
    }
    // Shape 2: ctx.model.complete(prompt) -> string
    const cmp = ctx?.model?.complete ?? ctx?.llm?.complete
    if (typeof cmp === 'function') {
      const self = ctx?.model ?? ctx?.llm
      return async (prompt) => normalizeText(await cmp.call(self, prompt))
    }
  } catch {
    /* fall through to null */
  }
  return null
}

function normalizeText(res: unknown): string {
  if (typeof res === 'string') return res
  const r = res as Record<string, unknown> | null
  if (r && typeof r.text === 'string') return r.text
  if (r && typeof r.content === 'string') return r.content
  return ''
}
