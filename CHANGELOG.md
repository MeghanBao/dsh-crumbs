# Changelog

## Unreleased

- **Default `source` is now `model`** (was `auto`): out of the box, crumbs are generated on the fly by the side model rather than drawn from the curated pool. Note the tradeoff — with no model surface (offline/air-gapped) the default shows nothing; set `source: "auto"` for the old model-first-then-pool safety net, or `"pool"` for the offline curated set.
- **Long-task hook: safety cap + leak fix.** A single task now drips at most `MAX_CRUMBS_PER_TASK` (5) crumbs and self-terminates, so a task whose `post-execute` never fires (host error, aborted tool, or a mismatched exec object) can no longer drip crumbs forever. The drip loop only starts when there's a stable object key to clear it by.
- **Config: `source: "auto"` is now explicitly accepted** in `mergeConfig` instead of relying on it happening to equal the default.
- **Fixed a type hole** in the `crumb` tool's `render` (optional `text` could be `undefined`); `typecheck` now passes clean.
- **CI** — GitHub Actions runs `npm run typecheck` + `npm test` on Node 20 and 22.
- **Packaging** — `README.zh.md`, `CHANGELOG.md`, and `CONTRIBUTING.md` are now included in the npm tarball (the zh README link no longer 404s on npm).

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
