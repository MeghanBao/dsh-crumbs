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

test('space cues map to space', () => {
  assert.ok(seedFromText('compute the orbit of the satellite around Mars').includes('space'))
})

test('science cues map to science', () => {
  assert.ok(seedFromText('the chemistry of this reaction releases energy').includes('science'))
})

test('nature cues map to nature', () => {
  assert.ok(seedFromText('sequence the animal DNA from the ocean species').includes('nature'))
})

test('food cues map to food', () => {
  assert.ok(seedFromText('write a recipe with three vegetable ingredients').includes('food'))
})

test('a mixed sentence can yield multiple tags, each once', () => {
  const t = seedFromText('compile the python model of the planet orbit')
  assert.ok(t.includes('coding')) // compile, python
  assert.ok(t.includes('space')) // planet, orbit
  assert.equal(new Set(t).size, t.length) // no duplicates
})

test('unrelated text yields no tags (any crumb is fair game)', () => {
  assert.deepEqual(seedFromText('hello there, how are you today'), [])
})

test('handles very long input without blowing up', () => {
  const big = 'orbit '.repeat(5000)
  const t = seedFromText(big)
  assert.ok(t.includes('space'))
})
