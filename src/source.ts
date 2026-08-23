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
  /** Recently shown crumb texts the model should not repeat or paraphrase. */
  avoidTexts?: string[]
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

/**
 * A prompt clause listing recently shown crumbs so the model steers clear of
 * them. Keeps the last few (a long list wastes tokens). Empty when there's
 * nothing to avoid. Pure.
 */
export function avoidClause(avoid?: string[]): string {
  const list = (avoid ?? []).map((t) => t.trim()).filter(Boolean).slice(-8)
  if (!list.length) return ''
  return (
    ` Do NOT repeat or closely paraphrase any of these recently shown facts:\n` +
    `${list.map((t) => `- ${t}`).join('\n')}\n`
  )
}

/** Prompt for a stated fact. Pure. */
export function buildFactPrompt(opts: GenerateOpts): string {
  return `Give ONE short, true, surprising fact related to: ${topicPhrase(opts)}.${avoidClause(opts.avoidTexts)} Reply with just the fact, no preamble.`
}

/** Prompt for an ask-first quiz. Pure. */
export function buildQuizPrompt(opts: GenerateOpts): string {
  return (
    `Give ONE short trivia question (with its true answer) related to: ${topicPhrase(opts)}.${avoidClause(opts.avoidTexts)}\n` +
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
 * Probe the context for a usable side-model call. The native path is the dsh
 * `LlmRuntime` at `ctx.llm` (a streaming `stream(GenerateOptions)` API); a few
 * generic shapes are tried after it for other/hypothetical hosts. Returns null
 * if none is found — in which case the plugin runs pool-only. Never throws.
 */
export function resolveModelCaller(ctx: any): ModelCaller | null {
  try {
    // Native: @deepseek-ai/dsh-llm — ctx.llm.stream(GenerateOptions): AsyncIterable<StreamChunk>
    if (ctx?.llm && typeof ctx.llm.stream === 'function') {
      return makeLlmRuntimeCaller(ctx.llm)
    }
    // Generic shape A: ctx.model.generate({ prompt, system }) -> { text } | string
    const gen = ctx?.model?.generate ?? ctx?.ai?.generate
    if (typeof gen === 'function') {
      const self = ctx?.model ?? ctx?.ai
      return async (prompt, system) => normalizeText(await gen.call(self, { prompt, system }))
    }
    // Generic shape B: ctx.model.complete(prompt) / ctx.llm.complete(prompt) -> string
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

// A crumb is throwaway entertainment, so bias model choice toward small/fast
// models and away from expensive reasoning or large ones. The host exposes no
// pricing, so this is a name/id heuristic — good enough to avoid burning a
// flagship model on trivia. Ties keep the endpoint's own (preferred) order.
const CHEAP_HINTS = [/mini/i, /flash/i, /lite/i, /small/i, /nano/i, /tiny/i, /haiku/i, /\bchat\b/i, /\b([1-9]|1[0-6])b\b/i]
const PRICEY_HINTS = [/reason/i, /think/i, /opus/i, /\bpro\b/i, /ultra/i, /\b(2[0-9]|[3-9][0-9]|[1-9][0-9]{2,})b\b/i]

/** Choose the cheapest-looking model id from a discovered list. Pure. */
export function preferModel(ids: readonly string[]): string | undefined {
  if (ids.length === 0) return undefined
  const score = (id: string) => {
    let s = 0
    if (CHEAP_HINTS.some((re) => re.test(id))) s -= 1
    if (PRICEY_HINTS.some((re) => re.test(id))) s += 1
    return s
  }
  // Lowest score wins; strict `<` keeps the earliest (endpoint-preferred) on ties.
  return ids.reduce((best, id) => (score(id) < score(best) ? id : best), ids[0])
}

/** Mint a one-off user MessageId. Branded compile-time; a plain unique string at runtime. */
function mintMessageId(): any {
  return `crumb-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Wrap the dsh LlmRuntime as a simple text ModelCaller. Discovers a provider +
 * model once (first available) and caches it, builds a one-shot user message,
 * and folds the streamed `text-delta` chunks into a string. Yields '' on any
 * shortfall (no provider/model, empty stream) so the source falls back cleanly.
 */
function makeLlmRuntimeCaller(llm: any): ModelCaller {
  let route: { provider: string; model: string } | null = null

  const ensureRoute = async (): Promise<{ provider: string; model: string } | null> => {
    if (route) return route
    const providers: any[] = (typeof llm.listProviders === 'function' ? llm.listProviders() : []) ?? []
    for (const p of providers) {
      const provider = typeof p === 'string' ? p : p?.id ?? p?.provider
      if (typeof provider !== 'string') continue
      try {
        const models: any[] = (typeof llm.listModels === 'function' ? await llm.listModels(provider) : []) ?? []
        const ids = models
          .map((m) => (typeof m === 'string' ? m : m?.id))
          .filter((id): id is string => typeof id === 'string')
        const model = preferModel(ids)
        if (model) {
          route = { provider, model }
          return route
        }
      } catch {
        /* try the next provider */
      }
    }
    return null
  }

  return async (prompt, system) => {
    const r = await ensureRoute()
    if (!r) return ''
    const options = {
      provider: r.provider,
      model: r.model,
      system,
      temperature: 0.9,
      maxTokens: 120,
      messages: [
        { id: mintMessageId(), role: 'user', content: [{ type: 'text', text: prompt }], source: { kind: 'user' } },
      ],
    }
    let out = ''
    for await (const chunk of llm.stream(options)) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
      else if (chunk?.type === 'finish') break
    }
    return out
  }
}

function normalizeText(res: unknown): string {
  if (typeof res === 'string') return res
  const r = res as Record<string, unknown> | null
  if (r && typeof r.text === 'string') return r.text
  if (r && typeof r.content === 'string') return r.content
  return ''
}
