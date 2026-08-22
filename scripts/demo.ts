// Standalone demo of the waiting-time experience — no dsh host needed.
// Simulates a long task and drips topic-relevant crumbs until it "finishes".
//
//   node --experimental-strip-types scripts/demo.ts
//   node --experimental-strip-types scripts/demo.ts --topic "git rebase" --mode quiz
//   node --experimental-strip-types scripts/demo.ts --source auto --mock-model
//   node --experimental-strip-types scripts/demo.ts --source model --mock-model
//
// --source pool|model|auto  choose the crumb source (default pool)
// --mock-model              supply a fake side model, since there's no real one
//                           here; shows the ✨ generated path and auto fallback

import { seedFromText } from '../src/topic.ts'
import { autoSource, modelSource, poolSource, type CrumbSource, type ModelCaller } from '../src/source.ts'

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const flag = (name: string) => process.argv.includes(`--${name}`)

const topic = arg('topic', 'git commit refactor typescript')
const mode = arg('mode', 'fact') === 'quiz' ? 'quiz' : 'fact'
const sourceKind = arg('source', 'pool')
const taskMs = Number(arg('task', '9000'))
const intervalMs = Number(arg('interval', '2500'))
const minTaskMs = Number(arg('min', '2000'))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// A stand-in side model. Real hosts supply this; here it fabricates a plausible
// contextual line ~60% of the time and "fails" otherwise, to show auto's fallback.
const mockCaller: ModelCaller = async (prompt) => {
  if (Math.random() < 0.4) return '' // simulate an unavailable / empty response
  const t = /related to: (.+?)\./.exec(prompt)?.[1] ?? 'this'
  if (/Q:/.test(prompt)) return `Q: What's a surprising detail about ${t}?\nA: More than you'd expect.`
  return `Here in the world of ${t}, a small surprising-but-true detail would appear.`
}

const pool = poolSource()
const model = modelSource(flag('mock-model') ? mockCaller : null)
const source: CrumbSource =
  sourceKind === 'model' ? model : sourceKind === 'auto' ? autoSource(model, pool) : pool

const tags = seedFromText(topic)
const seen: string[] = []

console.log(`\n⏳ working on: "${topic}"  (${(taskMs / 1000).toFixed(0)}s simulated task)`)
console.log(`   source: ${source.name}   seeded tags: [${tags.join(', ') || 'none — any topic'}]\n`)

let elapsed = 0
await sleep(minTaskMs)
elapsed += minTaskMs

while (elapsed < taskMs) {
  const c = await source.generate({ topic, seedTags: tags, mode, excludeIds: seen })
  if (c) {
    if (c.id) seen.push(c.id)
    console.log(`   ${c.text}${c.verified ? '' : '   (unverified)'}`)
    if (c.reveal) {
      await sleep(Math.min(4000, intervalMs))
      elapsed += Math.min(4000, intervalMs)
      console.log(`   ${c.reveal}\n`)
    } else {
      console.log('')
    }
  }
  await sleep(intervalMs)
  elapsed += intervalMs
}

console.log('✅ task done — crumbs cleared.\n')
