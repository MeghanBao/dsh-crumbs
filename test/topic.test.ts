import { test } from 'node:test'
import assert from 'node:assert/strict'
import { seedFromText } from '../src/topic.ts'

test('empty / nullish input yields no tags', () => {
  assert.deepEqual(seedFromText(''), [])
  assert.deepEqual(seedFromText(undefined), [])
  assert.deepEqual(seedFromText(null), [])
})

test('coding cues map to coding', () => {
  assert.ok(seedFromText('git commit -m "fix"').includes('coding'))
  assert.ok(seedFromText('refactor the async function in auth.ts').includes('coding'))
  assert.ok(seedFromText('npm run build').includes('coding'))
})

test('construction cues map to construction, incl. Chinese and standards', () => {
  assert.ok(seedFromText('pour the concrete slab and check the rebar').includes('construction'))
  assert.ok(seedFromText('GB50010 保护层最小厚度').includes('construction'))
  assert.ok(seedFromText('混凝土梁配筋').includes('construction'))
})

test('structural cues map to structural', () => {
  const t = seedFromText('the beam is in tension under this load')
  assert.ok(t.includes('structural'))
})

test('a mixed sentence can yield multiple tags, each once', () => {
  const t = seedFromText('compile the analysis for the steel beam bridge')
  assert.ok(t.includes('coding')) // compile
  assert.ok(t.includes('structural')) // beam, bridge
  assert.ok(t.includes('materials')) // steel
  // no duplicates
  assert.equal(new Set(t).size, t.length)
})

test('unrelated text yields no tags (any crumb is fair game)', () => {
  assert.deepEqual(seedFromText('hello there, how are you today'), [])
})

test('handles very long input without blowing up', () => {
  const big = 'concrete '.repeat(5000)
  const t = seedFromText(big)
  assert.ok(t.includes('construction'))
})
