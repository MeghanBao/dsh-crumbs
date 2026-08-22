// Topic seeding: turn whatever the agent is busy with (a prompt, a command, a
// file path) into a small set of crumb tags, so the fun fact you see while you
// wait tends to relate to what you're waiting on. Pure keyword→tag matching —
// no model call, no network. Unknown input yields [] (any crumb is fair game).
//
// The pool is general-interest and not tied to any field; these rules just give
// a gentle nudge toward relevance when the task text mentions an obvious domain.

export interface TagRule {
  tag: string
  patterns: RegExp[]
}

// Order is cosmetic; scoring in crumbs.rank is set-based.
export const TAG_RULES: TagRule[] = [
  {
    tag: 'coding',
    patterns: [
      /\b(git|npm|yarn|pnpm|node|deno|bun|docker|kubernetes|sql)\b/i,
      /\b(function|const|async|await|import|export|class|interface|compile|build|lint|test|deploy|refactor|debug)\b/i,
      /\b(typescript|javascript|python|rust|java|golang|regex|api|server|database)\b/i,
      /\.(ts|tsx|js|jsx|py|rs|go|java|rb|c|cpp|h|sh|json|yml|yaml|md|sql)\b/i,
    ],
  },
  {
    tag: 'science',
    patterns: [/\b(physics|chemistry|reaction|molecule|atom|energy|radiation|temperature|density|experiment)\b/i],
  },
  {
    tag: 'space',
    patterns: [/\b(planet|orbit|astronom|satellite|rocket|nasa|galaxy|star|moon|mars|venus|saturn)\b/i],
  },
  {
    tag: 'nature',
    patterns: [/\b(animal|species|ocean|forest|plant|insect|bird|fish|evolution|dna|cell)\b/i],
  },
  {
    tag: 'history',
    patterns: [/\b(history|ancient|century|empire|war|medieval|dynasty|revolution|archaeolog)\b/i],
  },
  {
    tag: 'geography',
    patterns: [/\b(country|continent|ocean|mountain|river|map|timezone|border|climate|desert)\b/i],
  },
  {
    tag: 'language',
    patterns: [/\b(word|grammar|language|translat|etymolog|dictionary|linguistic|spelling|sentence)\b/i],
  },
  {
    tag: 'food',
    patterns: [/\b(food|cook|recipe|fruit|vegetable|kitchen|meal|ingredient|nutrition)\b/i],
  },
  {
    tag: 'math',
    patterns: [/\b(math|number|probability|algebra|geometry|statistics|equation|calculus|prime)\b/i],
  },
]

/**
 * Extract topic tags from arbitrary text. Returns each matching tag once, in the
 * order rules are defined. Bounded work; safe on empty/undefined input. Pure.
 */
export function seedFromText(text: string | undefined | null): string[] {
  if (!text) return []
  const hay = text.slice(0, 2000) // bound regex work on huge prompts
  const tags: string[] = []
  for (const rule of TAG_RULES) {
    if (rule.patterns.some((re) => re.test(hay))) tags.push(rule.tag)
  }
  return tags
}
