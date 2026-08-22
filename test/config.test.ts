import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG, isDisabledByEnv, mergeConfig } from '../src/config.ts'

test('isDisabledByEnv recognizes the truthy forms', () => {
  assert.equal(isDisabledByEnv({ DSH_CRUMBS_DISABLE: '1' }), true)
  assert.equal(isDisabledByEnv({ DSH_CRUMBS_DISABLE: 'true' }), true)
  assert.equal(isDisabledByEnv({ DSH_CRUMBS_DISABLE: 'yes' }), true)
  assert.equal(isDisabledByEnv({ DSH_CRUMBS_DISABLE: '0' }), false)
  assert.equal(isDisabledByEnv({}), false)
})

test('mergeConfig returns defaults for empty / junk', () => {
  assert.deepEqual(mergeConfig(null), DEFAULT_CONFIG)
  assert.deepEqual(mergeConfig({}), DEFAULT_CONFIG)
  assert.deepEqual(mergeConfig('nope'), DEFAULT_CONFIG)
})

test('mergeConfig applies valid overrides', () => {
  const c = mergeConfig({ autoSurface: false, minTaskMs: 3000, mode: 'quiz', longTools: ['bash', 'my-tool'] })
  assert.equal(c.autoSurface, false)
  assert.equal(c.minTaskMs, 3000)
  assert.equal(c.mode, 'quiz')
  assert.deepEqual(c.longTools, ['bash', 'my-tool'])
})

test('mergeConfig ignores wrong-typed fields', () => {
  const c = mergeConfig({ autoSurface: 'yes', minTaskMs: -5, longTools: [1, 2], mode: 'bogus' })
  assert.equal(c.autoSurface, DEFAULT_CONFIG.autoSurface) // string ignored
  assert.equal(c.minTaskMs, DEFAULT_CONFIG.minTaskMs) // negative ignored
  assert.deepEqual(c.longTools, DEFAULT_CONFIG.longTools) // non-string array ignored
  assert.equal(c.mode, 'fact') // unknown mode falls back
})

test('intervalMs has a floor of 1000ms', () => {
  assert.equal(mergeConfig({ intervalMs: 10 }).intervalMs, 1000)
  assert.equal(mergeConfig({ intervalMs: 5000 }).intervalMs, 5000)
})
