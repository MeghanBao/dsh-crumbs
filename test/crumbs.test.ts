import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePool, rank, pick, render, loadPool, defaultPoolPath, _resetCache, type Crumb } from '../src/crumbs.ts'

const sample: Crumb[] = [
  { id: 'a', tags: ['coding'], text: 'A' },
  { id: 'b', tags: ['coding', 'history'], text: 'B' },
  { id: 'c', tags: ['construction'], text: 'C' },
  { id: 'd', tags: ['science'], text: 'D', quiz: { q: 'Q?', a: 'A!' } },
]

test('parsePool drops malformed entries but keeps valid ones', () => {
  const p = parsePool({
    version: 2,
    crumbs: [
      { id: 'ok', text: 'fine', tags: ['x'] },
      { id: 'no-text' },
      { text: 'no-id' },
      { id: 'bad-tags', text: 't', tags: [1, 'y'] },
      'garbage',
    ],
  })
  assert.equal(p.version, 2)
  assert.deepEqual(p.crumbs.map((c) => c.id), ['ok', 'bad-tags'])
  assert.deepEqual(p.crumbs[1].tags, ['y']) // non-string tag dropped
})

test('parsePool tolerates empty / junk input', () => {
  assert.deepEqual(parsePool(null).crumbs, [])
  assert.deepEqual(parsePool({}).crumbs, [])
  assert.deepEqual(parsePool({ crumbs: 'nope' }).crumbs, [])
})

test('rank with no tags returns the pool unchanged (copy)', () => {
  const r = rank(sample, [])
  assert.deepEqual(r.map((c) => c.id), ['a', 'b', 'c', 'd'])
  assert.notEqual(r, sample) // new array
})

test('rank orders by number of matching tags, stable within a tier', () => {
  const r = rank(sample, ['coding', 'history'])
  assert.equal(r[0].id, 'b') // matches 2
  assert.equal(r[1].id, 'a') // matches 1
  // non-matching keep original relative order at the end
  assert.deepEqual(r.slice(2).map((c) => c.id), ['c', 'd'])
})

test('pick restricts to the top relevance tier for a seed', () => {
  // rand=0 -> first of the top tier. Top tier for ['coding'] is [a, b] (score 1),
  // but b also has history; both score 1 on ['coding'] so tier = [a, b].
  const chosen = pick(sample, { tags: ['coding'], rand: 0 })
  assert.ok(chosen && ['a', 'b'].includes(chosen.id))
  const chosenC = pick(sample, { tags: ['construction'], rand: 0 })
  assert.equal(chosenC?.id, 'c')
})

test('pick avoids excluded ids', () => {
  const chosen = pick(sample, { tags: ['coding'], excludeIds: ['a'], rand: 0 })
  assert.equal(chosen?.id, 'b')
})

test('pick relaxes exclusion rather than returning null when all excluded', () => {
  const chosen = pick(sample, { excludeIds: ['a', 'b', 'c', 'd'], rand: 0 })
  assert.ok(chosen) // still returns something
})

test('pick is deterministic given rand', () => {
  const p1 = pick(sample, { rand: 0.99 })
  const p2 = pick(sample, { rand: 0.99 })
  assert.equal(p1?.id, p2?.id)
})

test('pick returns null on empty pool', () => {
  assert.equal(pick([], {}), null)
})

test('render fact vs quiz', () => {
  const fact = render(sample[3], 'fact')
  assert.match(fact.text, /^💡/)
  assert.equal(fact.reveal, undefined)

  const quiz = render(sample[3], 'quiz')
  assert.match(quiz.text, /^🤔/)
  assert.match(quiz.reveal ?? '', /^✅/)
})

test('render falls back to fact when quiz requested but crumb has none', () => {
  const r = render(sample[0], 'quiz')
  assert.match(r.text, /^💡/)
  assert.equal(r.reveal, undefined)
})

test('the bundled pool loads, is non-trivial, and is well-formed', async () => {
  _resetCache()
  const pool = await loadPool(defaultPoolPath())
  assert.ok(pool.crumbs.length >= 30, `expected >=30 crumbs, got ${pool.crumbs.length}`)
  const ids = new Set<string>()
  for (const c of pool.crumbs) {
    assert.ok(c.id && !ids.has(c.id), `duplicate or missing id: ${c.id}`)
    ids.add(c.id)
    assert.ok(c.text.length > 20, `crumb ${c.id} text too short`)
    assert.ok(c.tags.length >= 1, `crumb ${c.id} has no tags`)
  }
})
