import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  autoSource,
  buildFactPrompt,
  buildQuizPrompt,
  modelSource,
  parseFact,
  parseQuiz,
  poolSource,
  resolveModelCaller,
  topicPhrase,
  type CrumbSource,
  type ModelCaller,
} from '../src/source.ts'

// A fixed source, for testing the auto fallback logic in isolation.
function fixed(name: string, out: any): CrumbSource {
  return { name, generate: async () => out }
}

test('topicPhrase prefers topic, then tags, then a default', () => {
  assert.equal(topicPhrase({ topic: 'git', seedTags: ['coding'], mode: 'fact' }), 'git')
  assert.equal(topicPhrase({ topic: '  ', seedTags: ['space', 'math'], mode: 'fact' }), 'space, math')
  assert.equal(topicPhrase({ seedTags: [], mode: 'fact' }), 'anything interesting')
})

test('prompts mention the topic', () => {
  const opts = { topic: 'octopus', seedTags: [], mode: 'fact' as const }
  assert.match(buildFactPrompt(opts), /octopus/)
  assert.match(buildQuizPrompt(opts), /octopus/)
  assert.match(buildQuizPrompt(opts), /Q:/)
})

test('parseFact strips preamble, quotes, and caps length', () => {
  assert.equal(parseFact('Fact: Honey never spoils.'), 'Honey never spoils.')
  assert.equal(parseFact('  "Sharks are older than trees."  '), 'Sharks are older than trees.')
  assert.equal(parseFact('Sure! Bananas are berries.'), 'Bananas are berries.')
  assert.equal(parseFact('   '), null)
  assert.equal(parseFact('tiny'), null)
  assert.equal((parseFact('x'.repeat(500)) ?? '').length, 400)
})

test('parseQuiz extracts Q and A lines', () => {
  const p = parseQuiz('Q: What floats in water?\nA: Saturn')
  assert.deepEqual(p, { q: 'What floats in water?', a: 'Saturn' })
  assert.equal(parseQuiz('no q or a here'), null)
  assert.equal(parseQuiz('Q: only a question'), null)
})

test('modelSource(null) yields null so auto can fall back', async () => {
  const s = modelSource(null)
  assert.equal(await s.generate({ seedTags: [], mode: 'fact' }), null)
})

test('modelSource returns an unverified fact with a ✨ marker', async () => {
  const call: ModelCaller = async () => 'A neutron star spins hundreds of times per second.'
  const s = modelSource(call)
  const out = await s.generate({ seedTags: ['space'], mode: 'fact' })
  assert.ok(out)
  assert.equal(out!.verified, false)
  assert.match(out!.text, /^✨/)
})

test('modelSource quiz mode returns question + hidden answer', async () => {
  const call: ModelCaller = async () => 'Q: How many hearts has an octopus?\nA: Three'
  const out = await modelSource(call).generate({ seedTags: ['nature'], mode: 'quiz' })
  assert.ok(out)
  assert.match(out!.text, /^✨/)
  assert.match(out!.reveal ?? '', /Three/)
  assert.equal(out!.verified, false)
})

test('modelSource swallows a throwing caller and yields null', async () => {
  const call: ModelCaller = async () => {
    throw new Error('endpoint down')
  }
  assert.equal(await modelSource(call).generate({ seedTags: [], mode: 'fact' }), null)
})

test('autoSource uses primary when it produces, else the fallback', async () => {
  const primary = fixed('primary', { text: 'P', verified: false })
  const fallback = fixed('fallback', { text: 'F', verified: true })
  assert.equal((await autoSource(primary, fallback).generate({ seedTags: [], mode: 'fact' }))!.text, 'P')

  const emptyPrimary = fixed('primary', null)
  assert.equal((await autoSource(emptyPrimary, fallback).generate({ seedTags: [], mode: 'fact' }))!.text, 'F')
})

test('poolSource returns a verified crumb from the bundled pool', async () => {
  const out = await poolSource().generate({ seedTags: ['space'], mode: 'fact' })
  assert.ok(out)
  assert.equal(out!.verified, true)
  assert.ok(out!.id) // pool crumbs carry an id
})

test('resolveModelCaller drives the native dsh LlmRuntime stream', async () => {
  const captured: any = {}
  const ctx = {
    llm: {
      listProviders: () => [{ id: 'deepseek' }],
      listModels: async (p: string) => {
        captured.provider = p
        return [{ id: 'deepseek-chat' }]
      },
      async *stream(options: any) {
        captured.options = options
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'Honey never ' }
        yield { type: 'reasoning-delta', index: 0, text: 'IGNORE ME' }
        yield { type: 'text-delta', index: 0, text: 'spoils.' }
        yield { type: 'finish', reason: 'stop' }
      },
    },
  }
  const call = resolveModelCaller(ctx)
  assert.ok(call)
  assert.equal(await call!('Give a fact', 'be truthful'), 'Honey never spoils.')
  // it discovered and passed the route + built a proper user message
  assert.equal(captured.provider, 'deepseek')
  assert.equal(captured.options.provider, 'deepseek')
  assert.equal(captured.options.model, 'deepseek-chat')
  assert.equal(captured.options.system, 'be truthful')
  assert.equal(captured.options.messages[0].role, 'user')
  assert.equal(captured.options.messages[0].content[0].text, 'Give a fact')
})

test('native caller yields empty string when no provider/model is available', async () => {
  const ctx = {
    llm: {
      listProviders: () => [],
      async *stream() {
        /* never reached */
      },
    },
  }
  const call = resolveModelCaller(ctx)
  assert.ok(call) // stream exists, so a caller is returned
  assert.equal(await call!('x'), '') // ...but it can't resolve a route, so empty -> auto falls back
})

test('resolveModelCaller finds a generic generate() surface, normalizes {text}', async () => {
  const ctx = { model: { generate: async (_: any) => ({ text: 'hi from model' }) } }
  const call = resolveModelCaller(ctx)
  assert.ok(call)
  assert.equal(await call!('prompt', 'sys'), 'hi from model')
})

test('resolveModelCaller finds a complete() surface returning a string', async () => {
  const ctx = { llm: { complete: async (p: string) => `echo:${p}` } }
  const call = resolveModelCaller(ctx)
  assert.ok(call)
  assert.equal(await call!('x'), 'echo:x')
})

test('resolveModelCaller returns null when no surface exists', () => {
  assert.equal(resolveModelCaller({}), null)
  assert.equal(resolveModelCaller(null), null)
})
