// Real-runtime integration: load dsh-crumbs against the ACTUAL DeepSeek Harness
// libraries (cordis + dsh-tools + dsh-system-prompt), not a fake ctx. Skips when
// the peer deps aren't installed, so the offline unit suite still runs anywhere.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms))

// Only run when the real harness libraries resolve.
let runtime: any = null
try {
  const [{ Context }, { ToolRegistry }, { SystemPrompt }] = await Promise.all([
    import('@deepseek-ai/cordis'),
    import('@deepseek-ai/dsh-tools'),
    import('@deepseek-ai/dsh-system-prompt'),
  ])
  runtime = { Context, ToolRegistry, SystemPrompt }
} catch {
  runtime = null
}

test('dsh-crumbs loads and runs on the real cordis + dsh-tools runtime', { skip: !runtime }, async () => {
  const { Context, ToolRegistry, SystemPrompt } = runtime

  const dir = mkdtempSync(join(tmpdir(), 'crumbs-dsh-'))
  mkdirSync(join(dir, '.dsh'), { recursive: true })
  writeFileSync(
    join(dir, '.dsh', 'crumbs.config.json'),
    JSON.stringify({ source: 'pool', minTaskMs: 20, intervalMs: 1000, longTools: ['bash'] }),
  )

  const ctx: any = new Context()
  ctx.plugin(SystemPrompt)
  ctx.plugin(ToolRegistry)
  await tick(50)
  assert.equal(typeof ctx.tools, 'object', 'ToolRegistry service is up')

  // Capture the tool the plugin registers on the real registry.
  let crumbDef: any = null
  const realRegister = ctx.tools.register.bind(ctx.tools)
  ctx.tools.register = (def: any) => {
    if (def?.name === 'crumb') crumbDef = def
    return realRegister(def)
  }

  // Mock dsh-llm surface: real model-source code over a fake stream.
  ctx.llm = {
    listProviders: () => [{ id: 'mock' }],
    listModels: async () => [{ id: 'mock-reasoner' }, { id: 'mock-chat' }],
    async *stream(opts: any) {
      ctx.__lastModel = opts.model
      yield { type: 'text-delta', index: 0, text: 'Octopuses have three hearts.' }
      yield { type: 'finish', reason: 'stop' }
    },
  }

  // 1. install the plugin the real way (inject:['tools'] + apply).
  const plugin = await import('../src/index.ts')
  ctx.plugin(plugin)
  await tick(50)
  assert.ok(crumbDef, 'plugin registered the `crumb` tool (schema passed the real defineTool validator)')

  // 2. invoke the tool.
  const execCtx = { agent: { session: { header: { cwd: dir } } } }
  const fact = await crumbDef.execute({}, execCtx)
  assert.ok(typeof fact?.text === 'string' && fact.text.length > 0, 'fact crumb has text')
  assert.equal(typeof fact?.verified, 'boolean', 'fact has boolean verified')
  const quiz = await crumbDef.execute({ mode: 'quiz' }, execCtx)
  assert.ok(quiz?.text && quiz?.reveal, 'quiz crumb has a question and a hidden answer')

  const renderFn = crumbDef.output?.render ?? crumbDef.render
  const rendered = renderFn?.({}, fact)
  assert.ok(Array.isArray(rendered) && rendered[0]?.type === 'text', 'output.render() returns a text block')

  // 3. long-task hook on the real event bus (captured via a logger exporter).
  const logged: string[] = []
  ctx.logger.exporter({
    export(msg: any) {
      if (msg?.name === 'dsh-crumbs') logged.push(String(msg.args?.[0] ?? ''))
    },
  })
  const exec = { name: 'bash', arguments: { command: 'git status' }, agent: { session: { header: { cwd: dir } } } }
  await ctx.waterfall('tools/pre-execute', exec, async () => {})
  await tick(150)
  assert.ok(logged.length >= 1, 'hook dripped a crumb via the real event bus')
  const atReturn = logged.length
  await ctx.waterfall('tools/post-execute', exec, null, async () => {})
  await tick(1200)
  assert.equal(logged.length, atReturn, 'hook stopped dripping once the task returned')

  // 4. model source through the mock llm, with the cheap-model preference.
  writeFileSync(join(dir, '.dsh', 'crumbs.config.json'), JSON.stringify({ source: 'model' }))
  const model = await crumbDef.execute({ topic: 'ocean' }, execCtx)
  assert.equal(model?.verified, false, 'model crumb is marked unverified')
  assert.match(model?.text ?? '', /octopus/i, 'model crumb came from the mock stream')
  assert.equal(ctx.__lastModel, 'mock-chat', 'preferModel picked the cheap model over the reasoner')
})
