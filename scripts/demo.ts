// Standalone demo of the waiting-time experience — no dsh host needed.
// Simulates a long task and drips topic-relevant crumbs until it "finishes".
//
//   node --experimental-strip-types scripts/demo.ts
//   node --experimental-strip-types scripts/demo.ts --topic "git rebase" --mode quiz
//   node --experimental-strip-types scripts/demo.ts --task 6000 --interval 1500

import { loadPool, pick, render } from '../src/crumbs.ts'
import { seedFromText } from '../src/topic.ts'

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const topic = arg('topic', 'git commit refactor typescript')
const mode = arg('mode', 'fact') === 'quiz' ? 'quiz' : 'fact'
const taskMs = Number(arg('task', '9000'))
const intervalMs = Number(arg('interval', '2500'))
const minTaskMs = Number(arg('min', '2000'))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const pool = await loadPool()
const tags = seedFromText(topic)
const seen: string[] = []

console.log(`\n⏳ working on: "${topic}"  (${(taskMs / 1000).toFixed(0)}s simulated task)`)
console.log(`   seeded tags: [${tags.join(', ') || 'none — any topic'}]\n`)

let elapsed = 0
await sleep(minTaskMs)
elapsed += minTaskMs

while (elapsed < taskMs) {
  const crumb = pick(pool.crumbs, { tags, excludeIds: seen, rand: Math.random() })
  if (crumb) {
    seen.push(crumb.id)
    const r = render(crumb, mode as 'fact' | 'quiz')
    console.log(`   ${r.text}`)
    if (r.reveal) {
      await sleep(Math.min(4000, intervalMs))
      elapsed += Math.min(4000, intervalMs)
      console.log(`   ${r.reveal}\n`)
    } else {
      console.log('')
    }
  }
  await sleep(intervalMs)
  elapsed += intervalMs
}

console.log('✅ task done — crumbs cleared.\n')
