# dsh-crumbs

[English](./README.md) · [中文](./README.zh.md)

**Fill dead waiting time with one small true thing.** While a long task runs, `dsh-crumbs` surfaces a short, fact-checked "crumb" — topic-relevant to whatever you're waiting on — then gets out of the way the moment the task finishes.

It never touches the agent's context, never changes the task, and never appears in the result. It's for the human staring at a spinner, not for the model.

```
⏳ working on: "git rebase --onto main feature~3 feature"

   💡 Git was written by Linus Torvalds in a matter of days in 2005, after the
      tool Linux had been using pulled its free license.

✅ task done — crumbs cleared.
```

## Why this exists

Every tool for long-running agents optimizes the same thing: letting the agent run *unattended* — pause/resume, context compaction, status polling. But a lot of the time a human **is** watching: local runs, CLI sessions, non-technical users. That attended-but-idle stretch — attention still on, nothing to do — is a gap nobody fills. Loading-screen tips are static and unrelated; general trivia bots aren't tied to what you're doing. `dsh-crumbs` is the small, opinionated thing that fills exactly that gap.

## Install

```sh
dsh plugin add dsh-crumbs
```

## Three ways it shows up

1. **Automatically, while you wait.** When a long-running tool call (e.g. a shell command) runs past `minTaskMs`, crumbs drip into the notification surface every `intervalMs`, seeded by the command you're waiting on — a `git` command nudges toward coding facts, a `planet` one toward space. This path uses the same configured `source` as everything else, so by default each crumb is generated on the fly by the side model (see [Where crumbs come from](#where-crumbs-come-from)). They stop and clear when the task returns.
2. **`/crumb` command** — ask for one on demand: `/crumb`, `/crumb git`, `/crumb concrete`.
3. **`crumb` tool** — the model can call it directly; used by the command and available to any agent flow that wants a fact.

> **Where the auto crumb actually appears.** A standard cordis host exposes no "toast" API, so the automatic path surfaces each crumb through `ctx.logger` — i.e. as a host **log line**, not (yet) a card in the Web UI. A visible in-UI surface needs a small client asset like other notification plugins ship; that's the main piece of future work. The `/crumb` command and `crumb` tool return through the normal tool/skill channel and are unaffected.

## The `crumb` tool

| Param | Type | Notes |
|-------|------|-------|
| `topic` | string, optional | Topic hint (`"concrete"`, `"git"`, `"space"`). Omit for any topic. |
| `mode` | `"fact"` \| `"quiz"` | `fact` (default) states it; `quiz` asks first, then reveals the answer. |

Recent crumbs are avoided, so repeated calls vary.

## Configuration

Everything is opt-out with safe defaults.

- **Env:** `DSH_CRUMBS_DISABLE=1` turns off the automatic long-task surfacing entirely (the `/crumb` command and `crumb` tool still work).
- **Per repo:** `.dsh/crumbs.config.json`

```jsonc
{
  "autoSurface": true,   // drip crumbs during long tasks
  "minTaskMs": 8000,     // a task must run this long to qualify
  "intervalMs": 12000,   // gap between crumbs while it keeps running
  "mode": "fact",        // "fact" | "quiz"
  "source": "model",     // "pool" | "model" | "auto"  (see below)
  "longTools": ["bash", "shell", "exec", "run"]  // which tool calls count as "long"
}
```

## Where crumbs come from

| `source` | Behavior |
|----------|----------|
| `pool` | Only the curated, fact-checked pool. Zero cost, offline, always accurate. |
| `model` *(default)* | A **side model** generates a crumb on the fly — ideally about the very thing you're waiting on. If no model surface is available, *automatic* crumbs show nothing (use `auto` for an offline safety net); the `/crumb` command and `crumb` tool still fall back to the pool. |
| `auto` | Try the side model; if it's unavailable or returns nothing, fall back to the pool. |

Two things worth being explicit about:

- **The model is a *side* call.** It uses the harness LLM service (`ctx.llm.stream` from `@deepseek-ai/dsh-llm`) with a one-shot user message — it never runs in, or writes to, the main agent's context, so generating a crumb can't pollute or slow the task you're waiting on. If the host exposes no model surface (offline, air-gapped, no endpoint), the default `model` source shows nothing *automatically* — switch to `auto` and it silently degrades to the pool. Either way, an explicit `/crumb` / `crumb` call always falls back to the pool, so a user who asks is never left empty-handed.
- **Model crumbs are unverified.** They come back marked `verified: false` and rendered with a `✨` (pool crumbs use `💡` and are `verified: true`). Generated trivia can be confidently wrong — the plugin tells the model never to cite or build on a crumb, and you should treat `✨` ones as entertainment, not fact.

## The crumb pool

Crumbs live in [`data/crumbs.json`](./data/crumbs.json) — curated, fact-checked, and general-interest, not tied to any field. They're tagged across `coding`, `science`, `space`, `nature`, `history`, `geography`, `language`, `math`, `art`, `food`, and `body`. Each entry carries a stated `text` and a `quiz` form. Topic relevance is plain tag matching against keywords in the current task — no model call, no network.

Crumbs are entertainment, not a source of truth. They're accurate to the best of our checking, but the plugin explicitly tells the model not to cite or build on them.

## Try it without a host

```sh
node --experimental-strip-types scripts/demo.ts --topic "git rebase" --task 9000
node --experimental-strip-types scripts/demo.ts --topic "octopus" --mode quiz
node --experimental-strip-types scripts/demo.ts --source auto --mock-model   # see the ✨ generated path + pool fallback
```

## Development

```sh
npm test          # unit tests: pool parsing, ranking, topic seeding, config, sources
npm run demo      # see the waiting experience in your terminal
```

Layout:

```
src/crumbs.ts   pool load / rank / pick / render   (pure)
src/topic.ts    task text → topic tags             (pure)
src/source.ts   pool / model / auto crumb sources  (pure + best-effort caller)
src/config.ts   env + per-repo config              (pure)
src/skill.ts    /crumb command payload             (pure)
src/index.ts    plugin: crumb tool + long-task hook + skill wiring
data/crumbs.json  the curated pool
```

## License

MIT © MeghanBao
