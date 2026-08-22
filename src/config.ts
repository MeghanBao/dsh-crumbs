// Config for the waiting-time behavior. Everything here has a safe default;
// the whole feature is opt-out and never affects the agent's task or result.
//
// Opt-out / tuning precedence:
//   - env `DSH_CRUMBS_DISABLE=1` turns the long-task hook off entirely;
//   - `.dsh/crumbs.config.json` overrides per repo.
// The `crumb` tool and `/crumb` command still work even when the hook is off.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type CrumbSourceKind = 'pool' | 'model' | 'auto'

export interface CrumbsConfig {
  /** Surface crumbs automatically while a long tool call runs. */
  autoSurface: boolean
  /** A task must be expected/observed to run at least this long (ms) to qualify. */
  minTaskMs: number
  /** Gap between crumbs while one task keeps running (ms). */
  intervalMs: number
  /** Default render mode for auto-surfaced crumbs. */
  mode: 'fact' | 'quiz'
  /** Tool names whose calls are treated as potentially long-running. */
  longTools: string[]
  /**
   * Where crumbs come from:
   *   pool  — only the curated, verified pool.
   *   model — only a side-model generation (falls back to null if unavailable).
   *   auto  — side model when available, else the pool (default).
   */
  source: CrumbSourceKind
}

export const DEFAULT_CONFIG: CrumbsConfig = {
  autoSurface: true,
  minTaskMs: 8000,
  intervalMs: 12000,
  mode: 'fact',
  longTools: ['bash', 'shell', 'exec', 'run'],
  source: 'auto',
}

export const CONFIG_REL = join('.dsh', 'crumbs.config.json')

/** True when the env disables auto-surfacing entirely. Pure. */
export function isDisabledByEnv(env: Record<string, string | undefined>): boolean {
  const v = env.DSH_CRUMBS_DISABLE
  return v === '1' || v === 'true' || v === 'yes'
}

/** Merge untrusted JSON onto the defaults, ignoring wrong-typed fields. Pure. */
export function mergeConfig(raw: unknown): CrumbsConfig {
  const r = (raw ?? {}) as Record<string, unknown>
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d)
  return {
    autoSurface: typeof r.autoSurface === 'boolean' ? r.autoSurface : DEFAULT_CONFIG.autoSurface,
    minTaskMs: num(r.minTaskMs, DEFAULT_CONFIG.minTaskMs),
    intervalMs: Math.max(1000, num(r.intervalMs, DEFAULT_CONFIG.intervalMs)),
    mode: r.mode === 'quiz' ? 'quiz' : 'fact',
    longTools:
      Array.isArray(r.longTools) && r.longTools.every((x) => typeof x === 'string')
        ? (r.longTools as string[])
        : DEFAULT_CONFIG.longTools,
    source: r.source === 'pool' || r.source === 'model' ? r.source : DEFAULT_CONFIG.source,
  }
}

/** Load `<root>/.dsh/crumbs.config.json`, falling back to defaults. */
export async function loadConfig(root: string): Promise<CrumbsConfig> {
  try {
    return mergeConfig(JSON.parse(await readFile(join(root, CONFIG_REL), 'utf8')))
  } catch {
    return DEFAULT_CONFIG
  }
}
