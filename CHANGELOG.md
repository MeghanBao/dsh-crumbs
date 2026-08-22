# Changelog

## 0.2.0

- **Cross-domain pool.** Replaced the construction-heavy starter set with 46 general-interest, fact-checked crumbs spanning coding, science, space, nature, history, geography, language, math, art, food, and body. Topic seeding broadened to match.
- **`source: pool | model | auto` (default `auto`).** Crumbs can now come from the curated pool, from a **side model** that generates one on the fly (ideally about what you're waiting on), or from the hybrid: model first, pool as the safety net.
  - The model call is a *side* call — it never touches the main agent's context or result. If no model surface is available, `auto` degrades to the pool, so the plugin always works.
  - Generated crumbs are marked `verified: false` and rendered with `✨` (pool crumbs stay `💡`, `verified: true`).
- **New `src/source.ts`** with pure, tested prompt-building and response-parsing, plus `resolveModelCaller` — wired to the native harness LLM service (`ctx.llm.stream` from `@deepseek-ai/dsh-llm`): it discovers a provider/model, sends a one-shot user message, and folds the streamed `text-delta` chunks into text. Generic host shapes are tried as fallbacks. `@deepseek-ai/dsh-llm` is an optional peer dependency. 16 source tests; 42 tests total.

## 0.1.0 — initial

First working version.

- **`crumb` tool** — returns one small, true, fact-checked crumb, optionally seeded by a `topic`, in `fact` or `quiz` mode. Recent crumbs are avoided so repeats vary.
- **`/crumb` command** — user-invocable, on-demand crumb.
- **Long-task hook** — while a long-running tool call (default: shell-like tools past `minTaskMs`) is in flight, drips topic-relevant crumbs into the notification surface every `intervalMs`, then stops and clears when the task returns. Best-effort and non-blocking: it never touches the agent's context or the tool result.
- **Curated pool** — 36 tagged crumbs across coding, construction, structural, materials, science, space, and history in [`data/crumbs.json`](./data/crumbs.json).
- **Topic seeding** — pure keyword→tag matching (EN + zh construction terms), no model call, no network.
- **Config** — `DSH_CRUMBS_DISABLE` env kill-switch; per-repo `.dsh/crumbs.config.json` for timing, mode, and which tools count as long.
- **Tests** — 24 unit tests covering pool parsing, ranking, selection, topic seeding, and config merging. Standalone `scripts/demo.ts` to preview the experience.
