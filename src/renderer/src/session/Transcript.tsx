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
import { BrainIcon } from 'lucide-react'
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
  const last = items.at(-1)
  const view = (item: Item) => (
    <ItemView key={item.id} item={item} nested={children} streaming={working && item === last} />
  )

  return (
    <Conversation className="min-h-0 select-text" initial="instant">
      <ConversationContent className="mx-auto max-w-3xl gap-4 px-4 py-6">
        {groupActivity(topLevel).map((group) =>
          Array.isArray(group) ? (
            <div key={group[0]!.id} className="flex flex-col gap-0.5">
              {group.map(view)}
            </div>
          ) : (
            view(group)
          ),
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}

const isActivity = (item: Item) => item.kind === 'toolCall' || item.kind === 'reasoning'

/** Runs of tool calls and thinking sit close together, between the messages. */
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
          <MessageContent className="whitespace-pre-wrap">
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
