import { CodeBlock } from '@/components/ai-elements/code-block'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { cn } from '@/lib/utils'
import type { Item, ToolView } from '../../../shared/agent'

export function Transcript({ items, working }: { items: Item[]; working: boolean }) {
  const children = new Map<string, Item[]>()
  const topLevel: Item[] = []
  for (const item of items) {
    const parentId = 'parentId' in item ? item.parentId : undefined
    if (parentId) children.set(parentId, [...(children.get(parentId) ?? []), item])
    else topLevel.push(item)
  }
  const last = items.at(-1)

  return (
    <Conversation className="min-h-0 select-text" initial="instant">
      <ConversationContent className="mx-auto max-w-3xl gap-4 px-4 py-6">
        {topLevel.map((item) => (
          <ItemView
            key={item.id}
            item={item}
            nested={children}
            streaming={working && item === last}
          />
        ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}

function ItemView({
  item,
  nested,
  streaming,
}: {
  item: Item
  nested: Map<string, Item[]>
  streaming: boolean
}) {
  switch (item.kind) {
    case 'userMessage':
      return (
        <Message from="user">
          <MessageContent className="whitespace-pre-wrap">{item.text}</MessageContent>
        </Message>
      )
    case 'agentMessage':
      return (
        <Message from="assistant">
          <MessageContent>
            <MessageResponse isAnimating={streaming}>{item.text}</MessageResponse>
          </MessageContent>
        </Message>
      )
    case 'reasoning':
      return (
        <Reasoning className="mb-0" isStreaming={streaming}>
          <ReasoningTrigger />
          <ReasoningContent>{item.text}</ReasoningContent>
        </Reasoning>
      )
    case 'toolCall':
      return (
        <Tool className="mb-0">
          <ToolHeader title={item.title} status={item.status} />
          <ToolContent>
            <ToolBody view={item.view} failed={item.status === 'failed'} />
            {nested.get(item.id)?.map((child) => (
              <ItemView key={child.id} item={child} nested={nested} streaming={false} />
            ))}
          </ToolContent>
        </Tool>
      )
    case 'notice':
      return (
        <div
          className={cn(
            'text-sm',
            item.level === 'error' ? 'text-destructive whitespace-pre-wrap' : 'text-muted-foreground',
          )}
        >
          {item.text}
        </div>
      )
    case 'unknown':
      return (
        <Tool className="mb-0">
          <ToolHeader title={item.label} status="completed" />
          <ToolContent>
            <ToolInput input={item.raw} />
          </ToolContent>
        </Tool>
      )
  }
}

export function ToolBody({ view, failed = false }: { view: ToolView; failed?: boolean }) {
  switch (view.type) {
    case 'command':
      return (
        <>
          <CodeBlock code={view.command} language="bash" />
          <ToolOutput output={view.output} isError={failed} />
        </>
      )
    case 'fileChange':
      return (
        <>
          {view.changes.map((change) => (
            <div key={change.path} className="space-y-2">
              <h4 className="text-muted-foreground font-mono text-xs">{change.path}</h4>
              <CodeBlock code={change.diff.replace(/\n$/, '')} language="diff" />
            </div>
          ))}
          <ToolOutput output={view.output} isError={failed} />
        </>
      )
    case 'generic':
      return (
        <>
          <ToolInput input={view.input} />
          <ToolOutput output={view.output} isError={failed} />
        </>
      )
  }
}
