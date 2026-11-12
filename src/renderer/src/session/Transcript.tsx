import { CheckIcon, ChevronRightIcon, LoaderCircleIcon, XIcon } from 'lucide-react'
import { Streamdown } from 'streamdown'
import { StickToBottom } from 'use-stick-to-bottom'
import type { Item, ToolStatus, ToolView } from '../../../shared/agent'
import { cn } from '@/lib/utils'

export function Transcript({ items }: { items: Item[] }) {
  const children = new Map<string, Item[]>()
  const topLevel: Item[] = []
  for (const item of items) {
    const parentId = 'parentId' in item ? item.parentId : undefined
    if (parentId) children.set(parentId, [...(children.get(parentId) ?? []), item])
    else topLevel.push(item)
  }

  return (
    <StickToBottom className="relative min-h-0 flex-1 overflow-y-auto" initial="instant" resize="smooth">
      <StickToBottom.Content className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-6">
        {topLevel.map((item) => (
          <ItemView key={item.id} item={item} nested={children} />
        ))}
      </StickToBottom.Content>
    </StickToBottom>
  )
}

function ItemView({
  item,
  nested,
}: {
  item: Item
  nested: Map<string, Item[]>
}) {
  switch (item.kind) {
    case 'userMessage':
      return (
        <div className="bg-muted self-end rounded-lg px-3 py-2 whitespace-pre-wrap">{item.text}</div>
      )
    case 'agentMessage':
      return <Markdown text={item.text} />
    case 'reasoning':
      return item.text ? (
        <Disclosure summary={<span className="text-muted-foreground">Thinking</span>}>
          <div className="text-muted-foreground text-sm">
            <Markdown text={item.text} />
          </div>
        </Disclosure>
      ) : null
    case 'toolCall':
      return (
        <Disclosure
          summary={
            <>
              <StatusIcon status={item.status} />
              <span className="truncate font-mono text-[13px]">{item.title}</span>
            </>
          }
        >
          <ToolBody view={item.view} />
          {nested.get(item.id)?.map((child) => (
            <div key={child.id} className="border-l pl-3">
              <ItemView item={child} nested={nested} />
            </div>
          ))}
        </Disclosure>
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
        <Disclosure summary={<span className="text-muted-foreground">{item.label}</span>}>
          <Pre>{JSON.stringify(item.raw, null, 2)}</Pre>
        </Disclosure>
      )
  }
}

function Markdown({ text }: { text: string }) {
  return <Streamdown className="flex flex-col gap-3 leading-relaxed">{text}</Streamdown>
}

export function ToolBody({ view }: { view: ToolView }) {
  switch (view.type) {
    case 'command':
      return (
        <Pre>
          <span className="text-muted-foreground">$ </span>
          {view.command}
          {view.output && `\n\n${view.output}`}
        </Pre>
      )
    case 'fileChange':
      return (
        <div className="flex flex-col gap-2">
          {view.changes.map((change) => (
            <div key={change.path}>
              <div className="text-muted-foreground mb-1 font-mono text-xs">{change.path}</div>
              <Diff diff={change.diff} />
            </div>
          ))}
          {view.output && <Pre>{view.output}</Pre>}
        </div>
      )
    case 'generic':
      return (
        <div className="flex flex-col gap-2">
          <Pre>{JSON.stringify(view.input, null, 2)}</Pre>
          {view.output && <Pre>{view.output}</Pre>}
        </div>
      )
  }
}

function Diff({ diff }: { diff: string }) {
  return (
    <pre className="bg-muted/50 max-h-96 overflow-auto rounded-md py-2 font-mono text-xs">
      {diff.split('\n').map((line, index) => (
        <div
          // Lines can repeat, and the diff never reorders, so position is a stable key.
          key={index}
          className={cn(
            'px-3',
            line.startsWith('+') && 'bg-green-500/15',
            line.startsWith('-') && 'bg-red-500/15',
          )}
        >
          {line || ' '}
        </div>
      ))}
    </pre>
  )
}

function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre className="bg-muted/50 max-h-96 overflow-auto rounded-md px-3 py-2 font-mono text-xs whitespace-pre-wrap">
      {children}
    </pre>
  )
}

function Disclosure({ summary, children }: { summary: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="hover:bg-accent/60 flex cursor-default list-none items-center gap-2 rounded-md px-1 py-0.5 text-sm [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="text-muted-foreground size-3.5 shrink-0 transition-transform group-open:rotate-90" />
        {summary}
      </summary>
      <div className="mt-2 ml-5 flex flex-col gap-2">{children}</div>
    </details>
  )
}

function StatusIcon({ status }: { status: ToolStatus }) {
  switch (status) {
    case 'running':
      return <LoaderCircleIcon className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
    case 'completed':
      return <CheckIcon className="size-3.5 shrink-0 text-green-600" />
    case 'failed':
      return <XIcon className="text-destructive size-3.5 shrink-0" />
  }
}
