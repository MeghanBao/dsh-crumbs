import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { seedFromText } from './topic.ts'
import { isDisabledByEnv, loadConfig, type CrumbsConfig } from './config.ts'
import { crumbSkill } from './skill.ts'
import {
  autoSource,
  modelSource,
  poolSource,
  resolveModelCaller,
  type CrumbSource,
  type CrumbSuggestion,
} from './source.ts'

// A dsh plugin = `name` + `apply(ctx)`.
export const name = 'dsh-crumbs'
export const inject = ['tools']

// Remember the last few crumb ids so back-to-back crumbs don't repeat. Small,
// process-local, and purely cosmetic — losing it costs nothing. Model crumbs
// have no id and are simply not tracked.
const RECENT_MAX = 8
const recent: string[] = [] // pool crumb ids
const recentText: string[] = [] // recent crumb texts (icon-stripped), for model dedup

function remember(id: string): void {
  recent.push(id)
  while (recent.length > RECENT_MAX) recent.shift()
}

function rememberText(text: string): void {
  recentText.push(text)
  while (recentText.length > RECENT_MAX) recentText.shift()
}

/** A crumb's text with its leading icon/whitespace removed. */
function coreText(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+/u, '').trim()
}

/** True when `core` matches something we've shown recently (case/space-insensitive). */
function isRepeat(core: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ')
  const n = norm(core)
  return recentText.some((t) => norm(t) === n)
}

// How many times to re-ask a generative source for a non-repeat before giving up.
const GENERATE_TRIES = 3

// Sources are built once per plugin load; the model caller is discovered then.
let pool: CrumbSource
let model: CrumbSource

function sourceFor(config: CrumbsConfig): CrumbSource {
  if (config.source === 'pool') return pool
  if (config.source === 'model') return model
  return autoSource(model, pool) // auto: model first, pool as safety net
}

/**
 * Pick one crumb via the configured source, avoiding recent repeats. Pool crumbs
 * are de-duplicated by id; model crumbs have no id, so recent texts are both fed
 * to the model (to steer it away) and used to reject and re-ask on a near-repeat.
 */
async function nextCrumb(config: CrumbsConfig, topic?: string, mode: 'fact' | 'quiz' = 'fact') {
  const source = sourceFor(config)
  const seedTags = seedFromText(topic)
  for (let i = 0; i < GENERATE_TRIES; i++) {
    const suggestion = await source.generate({ topic, seedTags, mode, excludeIds: recent, avoidTexts: recentText })
    if (!suggestion) return null
    const core = coreText(suggestion.text)
    if (suggestion.id) {
      // Pool crumb: already de-duplicated by excludeIds; accept and record.
      remember(suggestion.id)
      rememberText(core)
      return suggestion
    }
    // Model crumb: skip a near-repeat and ask again.
    if (isRepeat(core)) continue
    rememberText(core)
    return suggestion
  }
  return null
}

/**
 * Best-effort notifier: surface a crumb to the user without touching the agent's
 * context or the tool result. A crumb is never important enough to throw.
 *
 * The only surface a standard cordis host actually exposes is `ctx.logger`
 * (callable for a named logger, and itself carrying the severity methods) — so
 * on a plain host a crumb lands as a *log line*, not a visible UI toast. A truly
 * visible surface (a Web UI card) needs a client asset, like other notification
 * plugins ship; that's tracked as future work in the README. We prefer a named
 * logger, fall back to the default logger, and finally probe a hypothetical
 * direct notification API for hosts that add one.
 */
export function notify(ctx: any, text: string): void {
  try {
    const logger = ctx?.logger
    if (typeof logger === 'function') return void logger('dsh-crumbs').info(text)
    if (typeof logger?.info === 'function') return void logger.info(text)
    if (typeof ctx?.notify?.info === 'function') return void ctx.notify.info(text)
  } catch {
    /* no surface available — the crumb just doesn't show */
  }
}

function display(s: CrumbSuggestion): string {
  return s.reveal ? `${s.text}\n${s.reveal}` : s.text
}

// ---------------------------------------------------------------------------
// Long-task hook: while a long-running tool call is in flight, drip crumbs.
// ---------------------------------------------------------------------------

// A safety cap: even if a task's post-execute never fires (host error, aborted
// tool, or a mismatched exec object), a single task can never drip more than
// this many crumbs. The loop self-terminates at the cap.
const MAX_CRUMBS_PER_TASK = 5

function installLongTaskHook(ctx: any): void {
  if (isDisabledByEnv(process.env)) return

  // Keyed by the exec object so post-execute can find and clear the loop. We
  // only ever start a loop when we have a real object key (see below).
  const timers = new Map<object, ReturnType<typeof setTimeout>>()

  const clear = (key: unknown) => {
    if (!key || typeof key !== 'object') return
    const t = timers.get(key as object)
    if (t) {
      clearTimeout(t)
      timers.delete(key as object)
    }
  }

  ctx.on?.('tools/pre-execute', async (exec: any, next: any) => {
    try {
      // A stable object key is what lets post-execute stop this loop. Without
      // one we can't guarantee cleanup, so we don't start dripping at all.
      if (exec && typeof exec === 'object') {
        const cwd = exec?.agent?.session?.header?.cwd ?? process.cwd()
        const config = await loadConfig(cwd)
        const toolName = String(exec?.name ?? '')
        if (config.autoSurface && config.longTools.includes(toolName)) {
          const key: object = exec
          // Seed the topic from the command/args of the task we're waiting on.
          const seedText = JSON.stringify(exec?.arguments ?? '')
          let shown = 0
          const drip = async () => {
            const c = await nextCrumb(config, seedText, config.mode)
            // The task may have returned (post-execute cleared us) while we were
            // generating — model calls take seconds. If so, don't surface a late
            // crumb or reschedule: the loop is dead the moment its key is gone.
            if (!timers.has(key)) return
            if (c) notify(ctx, display(c))
            // Stop at the cap even if post-execute never clears us.
            if (++shown >= MAX_CRUMBS_PER_TASK) return void clear(key)
            timers.set(key, setTimeout(drip, config.intervalMs))
          }
          timers.set(key, setTimeout(drip, config.minTaskMs))
        }
      }
    } catch {
      /* auto-surface is best-effort; never disturb the task */
    }
    return next()
  })

  ctx.on?.('tools/post-execute', async (exec: any, _result: any, next: any) => {
    clear(exec)
    return next()
  })
}

// ---------------------------------------------------------------------------

export function apply(ctx: Context) {
  // Build sources once; discover a side-model caller from the host (may be null,
  // in which case model/auto degrade to the pool).
  pool = poolSource()
  model = modelSource(resolveModelCaller(ctx as any))

  // Register the `/crumb` command when the skills service is present; optional.
  const registerSkill = (c: any) => c?.skills?.register?.(crumbSkill())
  try {
    if (typeof (ctx as any).inject === 'function') (ctx as any).inject(['skills'], registerSkill)
    else registerSkill(ctx)
  } catch {
    /* skills service absent — the tool still works */
  }

  installLongTaskHook(ctx as any)

  ctx.tools.register(
    defineTool({
      name: 'crumb',
      description:
        'Return one small fun fact ("crumb") to fill a waiting moment, optionally seeded by a topic so it relates to what the user is doing. This is entertainment for dead time — it does not affect the current task and should not be cited or built upon. `verified: true` means it came from the curated pool; `verified: false` means a side model generated it (treat as unchecked). Recent crumbs are avoided so repeated calls vary. Use `mode: "quiz"` to get an ask-first question plus its hidden answer.',
      parameters: {
        topic: {
          type: 'string',
          description: 'Optional topic hint (e.g. "space", "git", "food"). Omit for any topic.',
        },
        mode: {
          type: 'string',
          enum: ['fact', 'quiz'],
          description: 'fact = a stated fact (default); quiz = a question with a separate answer.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            text: { type: 'string' },
            reveal: { type: 'string' },
            mode: { type: 'string' },
            verified: { type: 'boolean' },
          },
        },
        render: (_args, v) => {
          const text = v.text ?? ''
          return [{ type: 'text', text: v.reveal ? `${text}\n${v.reveal}` : text }]
        },
      },

      async execute(args, exec) {
        const mode = args.mode === 'quiz' ? 'quiz' : 'fact'
        const cwd = (exec as any)?.agent?.session?.header?.cwd ?? process.cwd()
        const config = await loadConfig(cwd)
        const result = await nextCrumb(config, args.topic, mode)
        if (!result) {
          return { id: '', tags: [], text: '(no crumbs available)', mode, verified: true }
        }
        return {
          id: result.id ?? '',
          tags: result.tags ?? [],
          text: result.text,
          reveal: result.reveal,
          mode,
          verified: result.verified,
        }
      },
    }),
  )
}
