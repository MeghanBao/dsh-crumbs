# Changelog

## 0.1.0 — initial

First working version.

- **`crumb` tool** — returns one small, true, fact-checked crumb, optionally seeded by a `topic`, in `fact` or `quiz` mode. Recent crumbs are avoided so repeats vary.
- **`/crumb` command** — user-invocable, on-demand crumb.
- **Long-task hook** — while a long-running tool call (default: shell-like tools past `minTaskMs`) is in flight, drips topic-relevant crumbs into the notification surface every `intervalMs`, then stops and clears when the task returns. Best-effort and non-blocking: it never touches the agent's context or the tool result.
- **Curated pool** — 36 tagged crumbs across coding, construction, structural, materials, science, space, and history in [`data/crumbs.json`](./data/crumbs.json).
- **Topic seeding** — pure keyword→tag matching (EN + zh construction terms), no model call, no network.
- **Config** — `DSH_CRUMBS_DISABLE` env kill-switch; per-repo `.dsh/crumbs.config.json` for timing, mode, and which tools count as long.
- **Tests** — 24 unit tests covering pool parsing, ranking, selection, topic seeding, and config merging. Standalone `scripts/demo.ts` to preview the experience.
