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

Sibling to [dsh-backstory](https://github.com/MeghanBao/dsh-backstory): that one gives code back its *why*; this one gives waiting back a little *meaning*.

## Install

```sh
dsh plugin add dsh-crumbs
```

## Three ways it shows up

1. **Automatically, while you wait.** When a long-running tool call (e.g. a shell command) runs past `minTaskMs`, crumbs drip into the notification surface every `intervalMs`, gently seeded by the command you're waiting on — a `git` command nudges toward coding facts, a `planet` one toward space. Otherwise you just get the full, cross-domain pool. They stop and clear when the task returns.
2. **`/crumb` command** — ask for one on demand: `/crumb`, `/crumb git`, `/crumb concrete`.
3. **`crumb` tool** — the model can call it directly; used by the command and available to any agent flow that wants a fact.

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
  "longTools": ["bash", "shell", "exec", "run"]  // which tool calls count as "long"
}
```

## The crumb pool

Crumbs live in [`data/crumbs.json`](./data/crumbs.json) — curated, fact-checked, and general-interest, not tied to any field. They're tagged across `coding`, `science`, `space`, `nature`, `history`, `geography`, `language`, `math`, `art`, `food`, and `body`. Each entry carries a stated `text` and a `quiz` form. Topic relevance is plain tag matching against keywords in the current task — no model call, no network.

Crumbs are entertainment, not a source of truth. They're accurate to the best of our checking, but the plugin explicitly tells the model not to cite or build on them.

## Try it without a host

```sh
node --experimental-strip-types scripts/demo.ts --topic "git rebase" --task 9000
node --experimental-strip-types scripts/demo.ts --topic "concrete slab rebar" --mode quiz
```

## Development

```sh
npm test          # 24 unit tests: pool parsing, ranking, topic seeding, config
npm run demo      # see the waiting experience in your terminal
```

Layout:

```
src/crumbs.ts   pool load / rank / pick / render   (pure)
src/topic.ts    task text → topic tags             (pure)
src/config.ts   env + per-repo config              (pure)
src/skill.ts    /crumb command payload             (pure)
src/index.ts    plugin: crumb tool + long-task hook + skill wiring
data/crumbs.json  the curated pool
```

## License

MIT © MeghanBao
