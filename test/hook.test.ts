import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, notify } from '../src/index.ts'
import { loadPool } from '../src/crumbs.ts'

// A fake cordis-ish ctx: captures event handlers and logger output. The real
// host exposes crumbs via ctx.logger (callable → named logger carrying .info),
// which is exactly what notify() targets.
function makeCtx() {
  const handlers = new Map<string, Function>()
  const logs: string[] = []
  const ctx: any = {
    tools: { register() {} },
    logger: (_name: string) => ({ info: (t: string) => logs.push(t), warn() {} }),
    on(event: string, fn: Function) {
      handlers.set(event, fn)
    },
  }
  return { ctx, handlers, logs }
}

function repoWithConfig(cfg: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'crumbs-'))
  mkdirSync(join(dir, '.dsh'), { recursive: true })
  writeFileSync(join(dir, '.dsh', 'crumbs.config.json'), JSON.stringify(cfg))
  return dir
}

function execFor(cwd: string) {
  return { name: 'bash', arguments: { command: 'git status' }, agent: { session: { header: { cwd } } } }
}

// Pool-backed so the loop is deterministic and needs no model surface. intervalMs
// is floored to 1000ms by mergeConfig, so we drive time with mock timers.
const CFG = { source: 'pool', minTaskMs: 10, intervalMs: 1000, longTools: ['bash'] }

// Flush the async body of a drip (nextCrumb's microtasks) between mock ticks.
// setTimeout is the only mocked API, so setImmediate is real.
const flush = () => new Promise((r) => setImmediate(r))

test('notify surfaces via the cordis named-logger and never throws', () => {
  const logs: string[] = []
  const ctx = { logger: (_: string) => ({ info: (t: string) => logs.push(t) }) }
  notify(ctx, 'hello crumb')
  assert.deepEqual(logs, ['hello crumb'])
  assert.doesNotThrow(() => notify({}, 'x')) // no surface: crumb just doesn't show
  assert.doesNotThrow(() => notify(null, 'x'))
})

test('explicit crumb tool falls back to the pool under source:model with no model surface', async () => {
  const dir = repoWithConfig({ source: 'model' }) // no ctx.llm -> model caller is null
  const handlers = new Map<string, Function>()
  let crumbDef: any = null
  const ctx: any = {
    tools: {
      register(def: any) {
        if (def?.name === 'crumb') crumbDef = def
      },
    },
    logger: (_: string) => ({ info() {}, warn() {} }),
    on(event: string, fn: Function) {
      handlers.set(event, fn)
    },
  }
  apply(ctx)
  assert.ok(crumbDef, 'crumb tool registered')

  const out = await crumbDef.execute({}, { agent: { session: { header: { cwd: dir } } } })
  // The auto hook would stay silent here, but an explicit request must still deliver.
  assert.notEqual(out.text, '(no crumbs available)')
  assert.equal(out.verified, true) // a curated pool crumb
  assert.ok(out.id, 'pool crumb carries an id')
})

test('long-task hook drips pool crumbs, distinct, capped at 5', async (t) => {
  await loadPool() // prewarm the cache so drip bodies resolve on microtasks only
  const dir = repoWithConfig(CFG)
  const { ctx, handlers, logs } = makeCtx()
  apply(ctx)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await handlers.get('tools/pre-execute')!(execFor(dir), () => {})
  for (let i = 0; i < 8; i++) {
    t.mock.timers.tick(1000) // fire the due drip (first at minTaskMs, then every intervalMs)
    await flush()
  }
  assert.equal(logs.length, 5, 'capped at MAX_CRUMBS_PER_TASK')
  assert.equal(new Set(logs).size, 5, 'no repeats within one task')
})

test('long-task hook stops the moment the task returns', async (t) => {
  await loadPool()
  const dir = repoWithConfig(CFG)
  const { ctx, handlers, logs } = makeCtx()
  apply(ctx)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const exec = execFor(dir)
  await handlers.get('tools/pre-execute')!(exec, () => {})
  t.mock.timers.tick(1000)
  await flush()
  t.mock.timers.tick(1000)
  await flush()
  const n = logs.length
  assert.ok(n >= 1, 'at least one crumb before the task returns')
  await handlers.get('tools/post-execute')!(exec, null, () => {})
  t.mock.timers.tick(5000)
  await flush()
  assert.equal(logs.length, n, 'no crumbs after post-execute clears the loop')
})

test('tasks shorter than minTaskMs surface nothing', async (t) => {
  await loadPool()
  const dir = repoWithConfig({ ...CFG, minTaskMs: 1000 })
  const { ctx, handlers, logs } = makeCtx()
  apply(ctx)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const exec = execFor(dir)
  await handlers.get('tools/pre-execute')!(exec, () => {})
  t.mock.timers.tick(500) // below minTaskMs — first crumb not due yet
  await flush()
  await handlers.get('tools/post-execute')!(exec, null, () => {})
  t.mock.timers.tick(5000)
  await flush()
  assert.equal(logs.length, 0)
})

test('non-long tools are ignored', async (t) => {
  await loadPool()
  const dir = repoWithConfig(CFG)
  const { ctx, handlers, logs } = makeCtx()
  apply(ctx)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await handlers.get('tools/pre-execute')!({ ...execFor(dir), name: 'read_file' }, () => {})
  t.mock.timers.tick(5000)
  await flush()
  assert.equal(logs.length, 0)
})
