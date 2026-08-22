// The crumb pool + selection. Pure and dependency-free so it can be unit-tested
// and reused by both the tool and the long-task hook. A "crumb" is one small
// true thing shown to fill dead waiting time; it never touches the agent's
// context or its result.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export interface Quiz {
  q: string
  a: string
}

export interface Crumb {
  id: string
  tags: string[]
  text: string
  quiz?: Quiz
}

export interface CrumbPool {
  version: number
  crumbs: Crumb[]
}

/** Default pool path: ../data/crumbs.json relative to this module. */
export function defaultPoolPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'crumbs.json')
}

/** Validate/normalize untrusted JSON into a CrumbPool. Drops malformed entries. Pure. */
export function parsePool(raw: unknown): CrumbPool {
  const r = (raw ?? {}) as Record<string, unknown>
  const version = typeof r.version === 'number' ? r.version : 1
  const list = Array.isArray(r.crumbs) ? r.crumbs : []
  const crumbs: Crumb[] = []
  for (const item of list) {
    const c = item as Record<string, unknown>
    if (typeof c?.id !== 'string' || typeof c?.text !== 'string') continue
    const tags = Array.isArray(c.tags) ? c.tags.filter((t): t is string => typeof t === 'string') : []
    let quiz: Quiz | undefined
    const q = c.quiz as Record<string, unknown> | undefined
    if (q && typeof q.q === 'string' && typeof q.a === 'string') quiz = { q: q.q, a: q.a }
    crumbs.push({ id: c.id, tags, text: c.text, quiz })
  }
  return { version, crumbs }
}

let cached: CrumbPool | null = null

/** Load and cache the bundled pool. Async, but only hits disk once per process. */
export async function loadPool(path = defaultPoolPath()): Promise<CrumbPool> {
  if (cached) return cached
  cached = parsePool(JSON.parse(await readFile(path, 'utf8')))
  return cached
}

/** Reset the module cache. Test-only. */
export function _resetCache(): void {
  cached = null
}

/**
 * Rank crumbs by relevance to `tags` (a topic seed). A crumb with any matching
 * tag scores by how many match; ties and the no-seed case fall back to the full
 * pool. Returns a new array, most-relevant first, untouched order within a tier.
 * Pure.
 */
export function rank(crumbs: Crumb[], tags: string[]): Crumb[] {
  if (tags.length === 0) return crumbs.slice()
  const want = new Set(tags)
  const scored = crumbs.map((c, i) => ({
    c,
    i,
    score: c.tags.reduce((n, t) => (want.has(t) ? n + 1 : n), 0),
  }))
  // Keep original order as the tiebreaker so selection is deterministic given a seed.
  scored.sort((a, b) => b.score - a.score || a.i - b.i)
  return scored.map((s) => s.c)
}

/**
 * Pick one crumb. Prefers the highest-relevance tier for `tags`, then picks
 * within that tier using `rand` (0..1). `excludeIds` avoids immediate repeats.
 * Deterministic given the same `rand`. Pure.
 */
export function pick(
  crumbs: Crumb[],
  opts: { tags?: string[]; excludeIds?: Iterable<string>; rand?: number } = {},
): Crumb | null {
  const exclude = new Set(opts.excludeIds ?? [])
  let pool = rank(crumbs, opts.tags ?? []).filter((c) => !exclude.has(c.id))
  if (pool.length === 0) {
    // Everything excluded (or none): relax the exclusion rather than return nothing.
    pool = rank(crumbs, opts.tags ?? [])
  }
  if (pool.length === 0) return null

  // Restrict to the top relevance tier when a seed produced any match.
  if ((opts.tags ?? []).length > 0) {
    const want = new Set(opts.tags)
    const topScore = pool[0].tags.reduce((n, t) => (want.has(t) ? n + 1 : n), 0)
    if (topScore > 0) {
      pool = pool.filter((c) => c.tags.reduce((n, t) => (want.has(t) ? n + 1 : n), 0) === topScore)
    }
  }

  const r = clamp01(opts.rand ?? Math.random())
  const idx = Math.min(pool.length - 1, Math.floor(r * pool.length))
  return pool[idx]
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/** Render a crumb for display. `quiz` mode shows the question and hides the answer. */
export function render(crumb: Crumb, mode: 'fact' | 'quiz' = 'fact'): { text: string; reveal?: string } {
  if (mode === 'quiz' && crumb.quiz) {
    return { text: `🤔 ${crumb.quiz.q}`, reveal: `✅ ${crumb.quiz.a}` }
  }
  return { text: `💡 ${crumb.text}` }
}
