// Topic seeding: turn whatever the agent is busy with (a prompt, a command, a
// file path) into a small set of crumb tags, so the fun fact you see while you
// wait tends to relate to what you're waiting on. Pure keyword→tag matching —
// no model call, no network. Unknown input yields [] (any crumb is fair game).

export interface TagRule {
  tag: string
  patterns: RegExp[]
}

// Order matters only for readability; scoring in crumbs.rank is set-based.
export const TAG_RULES: TagRule[] = [
  {
    tag: 'coding',
    patterns: [
      /\b(git|npm|yarn|pnpm|node|deno|bun)\b/i,
      /\b(function|const|async|await|import|export|class|interface)\b/i,
      /\b(bug|debug|refactor|compile|build|lint|test|typescript|python|rust|java|golang|regex)\b/i,
      /\.(ts|tsx|js|jsx|py|rs|go|java|rb|c|cpp|h|sh|json|yml|yaml|md)\b/i,
    ],
  },
  {
    tag: 'construction',
    patterns: [
      /\b(concrete|rebar|cement|masonry|formwork|slab|footing|foundation|pour|curing)\b/i,
      /\b(GB\s?50010|DIN\s?\d|EN\s?199\d|eurocode|ACI|AISC)\b/i,
      // CJK has no \w word boundaries, so \b would never match here — match bare.
      /(混凝土|钢筋|规范|图集|保护层|梁|柱|基础|施工)/,
    ],
  },
  {
    tag: 'structural',
    patterns: [
      /\b(beam|column|truss|load|tension|compression|moment|shear|buckling|span|damper|seismic|wind\s?load)\b/i,
      /\b(bridge|dome|arch|cantilever|prestress)\b/i,
    ],
  },
  {
    tag: 'materials',
    patterns: [/\b(steel|timber|glass|alloy|corrosion|fatigue|composite|aggregate|thermal\s?expansion)\b/i],
  },
  {
    tag: 'engineering',
    patterns: [/\b(engineer|mechanical|hydraulic|structural|geotechnical|HVAC|tolerance)\b/i],
  },
  {
    tag: 'science',
    patterns: [/\b(physics|chemistry|reaction|molecule|energy|radiation|temperature|density)\b/i],
  },
  {
    tag: 'space',
    patterns: [/\b(planet|orbit|astronom|satellite|rocket|nasa|galaxy|venus|mars)\b/i],
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
