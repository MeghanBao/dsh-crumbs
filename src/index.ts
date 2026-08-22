import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { loadPool, pick, render, type Crumb } from './crumbs.ts'
import { seedFromText } from './topic.ts'
import { isDisabledByEnv, loadConfig } from './config.ts'
import { crumbSkill } from './skill.ts'

// A dsh plugin = `name` + `apply(ctx)`.
export const name = 'dsh-crumbs'
export const inject = ['tools']

// Remember the last few crumb ids so back-to-back crumbs don't repeat. Small,
// process-local, and purely cosmetic — losing it costs nothing.
const RECENT_MAX = 8
const recent: string[] = []

function remember(id: string): void {
  recent.push(id)
  while (recent.length > RECENT_MAX) recent.shift()
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

/** Choose one crumb for a topic seed, avoiding recent repeats, and mark it seen. */
async function nextCrumb(topic?: string, mode: 'fact' | 'quiz' = 'fact') {
  const pool = await loadPool()
  const tags = seedFromText(topic)
  const crumb = pick(pool.crumbs, { tags, excludeIds: recent })
  if (!crumb) return null
  remember(crumb.id)
  return { crumb, ...render(crumb, mode) }
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
          const c = await nextCrumb(seedText, config.mode)
          if (c) notify(ctx, c.reveal ? `${c.text}\n${c.reveal}` : c.text)
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
        'Return one small, true fun fact ("crumb") to fill a waiting moment, optionally seeded by a topic so it relates to what the user is doing. This is entertainment for dead time — it does not affect the current task and should not be cited or built upon. Recent crumbs are avoided so repeated calls vary. Use `mode: "quiz"` to get an ask-first question plus its hidden answer.',
      parameters: {
        topic: {
          type: 'string',
          description: 'Optional topic hint (e.g. "concrete", "git", "space"). Omit for any topic.',
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
          },
        },
        render: (_args, v) => {
          const body = v.reveal ? `${v.text}\n${v.reveal}` : v.text
          return [{ type: 'text', text: body }]
        },
      },

      async execute(args) {
        const mode = args.mode === 'quiz' ? 'quiz' : 'fact'
        const result = await nextCrumb(args.topic, mode)
        if (!result) {
          return { id: '', tags: [], text: '(no crumbs available)', mode }
        }
        const { crumb, text, reveal } = result as { crumb: Crumb; text: string; reveal?: string }
        return { id: crumb.id, tags: crumb.tags, text, reveal, mode }
      },
    }),
  )
}
