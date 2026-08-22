# Contributing

Thanks for helping! The most useful contribution is usually **a good crumb**.

## Adding a crumb

Add an entry to [`data/crumbs.json`](./data/crumbs.json):

```json
{
  "id": "short-kebab-id",
  "tags": ["coding"],
  "text": "One or two sentences. A small, surprising, TRUE thing.",
  "quiz": {
    "q": "The same fact posed as a question.",
    "a": "The answer, revealed after a beat."
  }
}
```

Rules:

- **It must be true.** Crumbs are checkable claims. If it's a myth, a 'commonly said', or a debated result, either leave it out or say so in the text ("often claimed", "still debated"). Several entries do this deliberately.
- **`id` is unique and stable** — it's used to avoid immediate repeats. `npm test` fails on duplicates.
- **At least one tag** from the existing set (`coding`, `science`, `space`, `nature`, `history`, `geography`, `language`, `math`, `art`, `food`, `body`). Keep the pool general-interest, not tied to any one field. New tags are fine — add a matching rule in `src/topic.ts` so tasks can seed them.
- **`quiz` is optional** but nice; keep the question self-contained and the answer short.
- Keep it short. A crumb is a pause, not a paragraph.

Then:

```sh
npm test      # validates the pool (unique ids, non-empty text, ≥1 tag) + all logic
npm run demo  # eyeball it
```

## Code changes

The logic in `src/crumbs.ts`, `src/topic.ts`, and `src/config.ts` is pure and unit-tested — please keep it that way and add a test with any change. `src/index.ts` holds the dsh wiring (tool, command, hook); its side effects are all best-effort and must never throw into the agent's task.
