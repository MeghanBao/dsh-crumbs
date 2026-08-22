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
const recent: string[] = []

function remember(id: string): void {
  recent.push(id)
  while (recent.length > RECENT_MAX) recent.shift()
}

// Sources are built once per plugin load; the model caller is discovered then.
let pool: CrumbSource
let model: CrumbSource

function sourceFor(config: CrumbsConfig): CrumbSource {
  if (config.source === 'pool') return pool
  if (config.source === 'model') return model
  return autoSource(model, pool) // auto: model first, pool as safety net
}

/** Pick one crumb via the configured source, avoiding recent repeats. */
async function nextCrumb(config: CrumbsConfig, topic?: string, mode: 'fact' | 'quiz' = 'fact') {
  const suggestion = await sourceFor(config).generate({
    topic,
    seedTags: seedFromText(topic),
    mode,
    excludeIds: recent,
  })
  if (!suggestion) return null
  if (suggestion.id) remember(suggestion.id)
  return suggestion
}

/**
 * Best-effort notifier: surface a crumb to the user without touching the agent's
 * context or the tool result. dsh hosts expose different surfaces; try the
 * likely ones and give up quietly if none exist. A crumb is never important
 * enough to throw.
 */
function notify(ctx: any, text: string): void {
  try {
    if (typeof ctx?.notify?.info === 'function') return void ctx.notify.info(text)
    if (typeof ctx?.ui?.notify === 'function') return void ctx.ui.notify({ level: 'info', text })
    if (typeof ctx?.logger?.info === 'function') return void ctx.logger.info(text)
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

function installLongTaskHook(ctx: any): void {
  if (isDisabledByEnv(process.env)) return

  const timers = new Map<unknown, ReturnType<typeof setTimeout>>()

  const clear = (key: unknown) => {
    const t = timers.get(key)
    if (t) {
      clearTimeout(t)
      timers.delete(key)
    }
  }

  ctx.on?.('tools/pre-execute', async (exec: any, next: any) => {
    try {
      const cwd = exec?.agent?.session?.header?.cwd ?? process.cwd()
      const config = await loadConfig(cwd)
      const toolName = String(exec?.name ?? '')
      if (config.autoSurface && config.longTools.includes(toolName)) {
        const key = exec ?? Symbol()
        // Seed the topic from the command/args of the task we're waiting on.
        const seedText = JSON.stringify(exec?.arguments ?? '')
        const drip = async () => {
          const c = await nextCrumb(config, seedText, config.mode)
          if (c) notify(ctx, display(c))
          // keep dripping until post-execute clears us
          timers.set(key, setTimeout(drip, config.intervalMs))
        }
        timers.set(key, setTimeout(drip, config.minTaskMs))
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
        render: (_args, v) => [{ type: 'text', text: v.reveal ? `${v.text}\n${v.reveal}` : v.text }],
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
