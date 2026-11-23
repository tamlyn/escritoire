import type { AgentKind, Item, SessionPointer } from '../shared/agent'
import { rewarmPrompt } from './agents/types'

const transcripts: Record<AgentKind, (id: string) => string> = {
  claude: (id) => `\`${id}.jsonl\` under \`~/.claude/projects/\``,
  codex: (id) => `the rollout ending \`${id}.jsonl\` under \`~/.codex/sessions/\``,
}

/**
 * Opens a new session with the gist of an old one: the user's messages and the
 * agent's final reply, which is far cheaper than resuming a session whose
 * prompt cache has expired. The user writes their next instruction after it.
 */
export function handoffPrompt(previous: SessionPointer, items: Item[]): string {
  const conversation = withoutRewarms(items)
  const messages = conversation.flatMap((item) => (item.kind === 'userMessage' ? [userMessage(item.text, item.images?.length ?? 0)] : []))
  // A subagent's reply has a parent, and isn't the agent's answer to the user.
  const reply = conversation.findLast((item): item is Extract<Item, { kind: 'agentMessage' }> => item.kind === 'agentMessage' && !item.parentId)
  const parts = [
    'This continues an earlier session, condensed to save context. Below are my messages from it, in order, then your final reply. '
      + 'The work they describe is already in the working tree, so check git and the files rather than assuming. '
      + `If you need more detail, the full transcript is ${transcripts[previous.agent](previous.agentSessionId)}.`,
    ...messages,
    ...(reply ? [`<your-final-reply>\n${reply.text}\n</your-final-reply>`] : []),
  ]
  return `${parts.join('\n\n')}\n\n---\n\n`
}

/** Turns sent only to keep the cache warm, up to the next message of the user's. */
function withoutRewarms(items: Item[]): Item[] {
  let rewarming = false
  return items.filter((item) => {
    if (item.kind === 'userMessage') rewarming = item.text === rewarmPrompt
    return !rewarming
  })
}

function userMessage(text: string, images: number): string {
  const note = images === 0 ? '' : `(${images === 1 ? 'An image' : `${images} images`} I attached ${images === 1 ? 'is' : 'are'} not included.)`
  return `<my-message>\n${[text, note].filter(Boolean).join('\n\n')}\n</my-message>`
}
