import { CodeBlock } from '@/components/ai-elements/code-block'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  toolCodeClassName,
} from '@/components/ai-elements/tool'
import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { BrainIcon, ChevronRightIcon, LoaderCircleIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ImageAttachment, Item, ToolView } from '../../../shared/agent'
import { fileLinkProps } from './FileLinks'

export function Transcript({ items, working }: { items: Item[]; working: boolean }) {
  const children = new Map<string, Item[]>()
  const topLevel: Item[] = []
  for (const item of items) {
    const parentId = 'parentId' in item ? item.parentId : undefined
    if (parentId) children.set(parentId, [...(children.get(parentId) ?? []), item])
    else topLevel.push(item)
  }
  const groups = groupActivity(topLevel)
  const lastGroup = groups.at(-1)
  const last = items.at(-1)

  return (
    <Conversation className="min-h-0 select-text" initial="instant">
      <ConversationContent className="mx-auto max-w-3xl gap-4 px-4 py-6">
        {groups.map((group) =>
          Array.isArray(group) ? (
            <Activity
              key={group[0]!.id}
              items={group}
              nested={children}
              live={working && group === lastGroup}
              streamingId={working ? last?.id : undefined}
            />
          ) : (
            <ItemView key={group.id} item={group} nested={children} streaming={working && group === last} />
          ),
        )}
        {working && !Array.isArray(lastGroup) && (
          <ActivityRow live>Working…</ActivityRow>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}

const isActivity = (item: Item) => item.kind === 'toolCall' || item.kind === 'reasoning'

/** Runs of tool calls and thinking collapse into one row between the messages. */
function groupActivity(items: Item[]): (Item | Item[])[] {
  const groups: (Item | Item[])[] = []
  for (const item of items) {
    const previous = groups.at(-1)
    if (!isActivity(item)) groups.push(item)
    else if (Array.isArray(previous)) previous.push(item)
    else groups.push([item])
  }
  return groups
}

/**
 * The turn's one working indicator lives on the latest run of activity, or on
 * a row of its own while the agent is between items.
 */
function Activity({
  items,
  nested,
  live,
  streamingId,
}: {
  items: Item[]
  nested: Map<string, Item[]>
  live: boolean
  streamingId: string | undefined
}) {
  return (
    <Collapsible className="group/activity">
      <CollapsibleTrigger className="w-full">
        <ActivityRow live={live} expandable>
          {live ? currentActivity(items) : summarise(items)}
        </ActivityRow>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 mb-2 ml-1.5 flex flex-col gap-0.5 border-l pl-4">
        {items.map((item) => (
          <ItemView key={item.id} item={item} nested={nested} streaming={item.id === streamingId} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

function ActivityRow({ live, expandable = false, children }: { live: boolean; expandable?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        'text-muted-foreground -mx-1 flex items-center gap-2 rounded px-1 py-0.5 text-left text-sm',
        expandable && 'hover:bg-muted/60 hover:text-foreground',
      )}
    >
      {live ? (
        <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
      ) : (
        <span className="flex size-3.5 shrink-0 items-center justify-center">
          <span className="size-1.5 rounded-full bg-current" />
        </span>
      )}
      <span className="min-w-0 truncate">{children}</span>
      {expandable && (
        <ChevronRightIcon className="ml-auto size-3.5 shrink-0 opacity-0 transition-transform group-hover/activity:opacity-100 group-data-[state=open]/activity:rotate-90 group-data-[state=open]/activity:opacity-100" />
      )}
    </div>
  )
}

function currentActivity(items: Item[]): string {
  const running = items.findLast((item) => item.kind === 'toolCall' && item.status === 'running')
  if (running?.kind === 'toolCall') return running.title
  return items.at(-1)?.kind === 'reasoning' ? 'Thinking…' : 'Working…'
}

function summarise(items: Item[]): string {
  let thought = false
  let commands = 0
  const files = new Set<string>()
  const tools = new Map<string, number>()
  for (const item of items) {
    if (item.kind === 'reasoning') thought = true
    if (item.kind !== 'toolCall') continue
    const { view } = item
    if (view.type === 'command') commands++
    else if (view.type === 'fileChange') view.changes.forEach((change) => files.add(change.path))
    else {
      // MCP tools arrive as mcp__server__tool.
      const name = view.name.split('__').at(-1)!
      tools.set(name, (tools.get(name) ?? 0) + 1)
    }
  }
  const parts = [
    thought && 'thought',
    commands && `ran ${plural(commands, 'command')}`,
    files.size && `edited ${plural(files.size, 'file')}`,
    ...[...tools].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)),
  ].filter(Boolean) as string[]
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

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
          <MessageContent className="wrap-anywhere whitespace-pre-wrap">
            {item.images && <Thumbnails images={item.images} />}
            {item.text}
          </MessageContent>
        </Message>
      )
    case 'agentMessage':
      return (
        <Message from="assistant">
          <MessageContent>
            <MessageResponse isAnimating={streaming} {...fileLinkProps}>
              {item.text}
            </MessageResponse>
          </MessageContent>
        </Message>
      )
    case 'reasoning':
      // Claude Code doesn't always ask for the thinking text, leaving nothing to expand.
      if (!item.text && !streaming) {
        return (
          <div className="text-muted-foreground flex items-center gap-2 py-0.5 text-sm">
            <BrainIcon className="size-3.5" /> Thought
          </div>
        )
      }
      return (
        <Reasoning className="mb-0" isStreaming={streaming} defaultOpen={false}>
          <ReasoningTrigger className="py-0.5 [&_svg]:size-3.5" />
          <ReasoningContent className="mt-1 mb-2 ml-1.5 border-l pl-4">{item.text}</ReasoningContent>
        </Reasoning>
      )
    case 'toolCall':
      return (
        <Tool>
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
        <Tool>
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
          <CodeBlock className={toolCodeClassName} code={view.command} language="bash" />
          <ToolOutput output={view.output} isError={failed} />
        </>
      )
    case 'fileChange':
      return (
        <>
          {view.changes.map((change) => (
            <div key={change.path} className="space-y-1">
              <h4 className="text-muted-foreground font-mono text-xs">{change.path}</h4>
              <CodeBlock className={toolCodeClassName} code={change.diff.replace(/\n$/, '')} language="diff" />
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

export function Thumbnails({ images }: { images: ImageAttachment[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {images.map((image, index) => (
        <img
          key={index}
          src={imageUrl(image)}
          alt=""
          className="max-h-32 max-w-48 rounded-md border object-contain"
        />
      ))}
    </div>
  )
}

export const imageUrl = (image: ImageAttachment) => `data:${image.mediaType};base64,${image.data}`
