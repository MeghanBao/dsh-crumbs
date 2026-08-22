// The `/crumb` user command, registered as a dsh skill (see
// @deepseek-ai/dsh-skill `ctx.skills.register`). Pure payload — the runtime
// wiring lives in ./index.ts. Human-invocable; the model already has the
// `crumb` tool directly.

export const CRUMB_SKILL_BODY = `# crumb

Serve one small, true fact to fill a moment — optionally on a topic.

The user may pass a topic hint, e.g. \`/crumb concrete\`, \`/crumb git\`, or nothing.

1. Call the \`crumb\` tool. Pass \`topic\` if the user named one; otherwise omit it.
2. Show the returned crumb as-is. It is entertainment, not a source of truth —
   do not build on it, cite it, or let it change the task you were doing.
3. If the user asks for another, call \`crumb\` again; recent ones are avoided.

Keep it to a single crumb unless asked. This should be a pleasant pause, not a lecture.
`

export interface CrumbSkill {
  name: string
  description: string
  whenToUse: string
  source: 'runtime'
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  content: string
}

/** The registration payload for the `/crumb` command. */
export function crumbSkill(): CrumbSkill {
  return {
    name: 'crumb',
    description: 'Show one small, true fun fact — optionally on a topic — to fill a waiting moment.',
    whenToUse: 'When the user wants a quick fun fact or something to read while a task runs.',
    source: 'runtime',
    invocation: { modelInvocable: false, userInvocable: true },
    content: CRUMB_SKILL_BODY,
  }
}
