import { ArrowUpIcon, FileIcon, SlashIcon, SquareIcon, XIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { ImageAttachment, SessionPointer, SessionSettings, SettingChoices, SlashCommand } from '../../../shared/agent'
import { baseName, parentPath } from '../../../shared/files'
import { api, flushers } from '../api'
import { useIsCompact } from '../phone/compact'
import { imageFiles, toAttachment } from './images'
import { fuzzyFinder } from '../fuzzy'
import { activeCommand, activeMention, insertMention, type Mention } from './mentions'
import { nextPermissionMode } from './SessionControls'
import { imageUrl } from './Transcript'

const draftSaveDelayMs = 500
const mentionLimit = 8

export function Composer({
  projectId,
  pointer,
  initialDraft,
  working,
  autoFocus,
  settings,
  choices,
  children,
}: {
  projectId: string
  pointer: SessionPointer
  initialDraft: string
  working: boolean
  autoFocus: boolean
  settings: SessionSettings
  choices: SettingChoices | null
  /** Shown along the bottom of the composer. */
  children?: React.ReactNode
}) {
  const [text, setText] = useState(initialDraft)
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [attachErrors, setAttachErrors] = useState<string[]>([])
  const [mention, setMention] = useState<Completion | null>(null)
  const [files, setFiles] = useState<string[] | null>(null)
  const [commands, setCommands] = useState<SlashCommand[] | null>(null)
  const [selected, setSelected] = useState(0)
  /** The user moved the selection, so Enter means that option. */
  const [picked, setPicked] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const compact = useIsCompact()
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const draft = useRef(text)
  draft.current = text
  // Only edits made here are saved, so reconnecting can't overwrite a draft typed on another client.
  const draftEdited = useRef(false)
  const saveDraft = useCallback(async () => {
    clearTimeout(saveTimer.current)
    if (!draftEdited.current) return
    draftEdited.current = false
    try {
      await api.saveDraft(pointer, draft.current)
    } catch (error) {
      draftEdited.current = true
      console.error(error)
    }
  }, [pointer.agentSessionId])
  useEffect(() => {
    flushers.add(saveDraft)
    return () => { flushers.delete(saveDraft) }
  }, [saveDraft])

  const findFiles = useMemo(
    () => (files ? fuzzyFinder(files, { path: (path) => path, limit: mentionLimit }) : null),
    [files],
  )
  const findCommands = useMemo(
    () => (commands ? fuzzyFinder(commands, { path: (command) => command.name, limit: Infinity }) : null),
    [commands],
  )
  const matches = useMemo((): Option[] => {
    if (mention?.kind === 'file' && findFiles) {
      return findFiles(mention.query).map(({ item: path }) => ({
        key: path,
        word: `@${path}`,
        label: baseName(path),
        detail: parentPath(path),
      }))
    }
    if (mention?.kind === 'command' && findCommands) {
      return findCommands(mention.query).map(({ item: command }) => ({
        key: command.name,
        word: `/${command.name}`,
        label: `/${command.name}`,
        hint: command.argumentHint,
        detail: command.description,
      }))
    }
    return []
  }, [findFiles, findCommands, mention?.kind, mention?.query])
  const canSend = text.trim() !== '' || images.length > 0

  function changeText(next: string, caret: number) {
    setText(next)
    draftEdited.current = true
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void saveDraft(), draftSaveDelayMs)
    updateMention(next, caret)
  }

  function updateMention(value: string, caret: number) {
    const command = activeCommand(value, caret)
    const file = activeMention(value, caret)
    const next: Completion | null = command
      ? { kind: 'command', ...command }
      : file
        ? { kind: 'file', ...file }
        : null
    // Asked for each time, so files an agent has just created, and skills just added, appear.
    if (next?.kind === 'file' && mention?.kind !== 'file') void api.listProjectFiles(projectId).then(setFiles)
    if (next?.kind === 'command' && mention?.kind !== 'command') {
      void api.listCommands(projectId, pointer.agent).then(setCommands)
    }
    if (next?.kind !== mention?.kind || next?.query !== mention?.query) {
      setSelected(0)
      setPicked(false)
    }
    setMention(next)
  }

  function choose(option: Option) {
    const element = textarea.current
    if (!mention || !element) return
    const inserted = insertMention(text, element.selectionStart, mention, option.word)
    changeText(inserted.text, inserted.caret)
    setMention(null)
    requestAnimationFrame(() => element.setSelectionRange(inserted.caret, inserted.caret))
  }

  async function attach(files: File[]) {
    const results = await Promise.allSettled(files.map(toAttachment))
    const attached = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
    const errors = results.flatMap((result, index) =>
      result.status === 'rejected' ? [`Couldn't attach ${files[index]!.name || 'the image'}: ${errorText(result.reason)}`] : [],
    )
    setImages((current) => [...current, ...attached])
    setAttachErrors(errors)
  }

  function send() {
    if (!canSend) return
    clearTimeout(saveTimer.current)
    draftEdited.current = false
    api.sendMessage(pointer, { text: text.trim(), images }).catch((error: unknown) => {
      console.error(error)
      draftEdited.current = true
      setText((current) => current || text)
      setImages((current) => (current.length > 0 ? current : images))
    })
    setText('')
    setImages([])
    setAttachErrors([])
    setMention(null)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return
    if (matches.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setSelected((selected + step + matches.length) % matches.length)
        setPicked(true)
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && entersOption(matches[selected]!))) {
        event.preventDefault()
        choose(matches[selected]!)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMention(null)
        return
      }
    }
    // A phone's keyboard has no Shift+Enter, so there the button sends.
    if (event.key === 'Enter' && !event.shiftKey && !compact) {
      event.preventDefault()
      send()
    } else if (event.key === 'Tab' && event.shiftKey) {
      const mode = nextPermissionMode(choices, settings.permissionMode)
      if (mode) {
        event.preventDefault()
        void api.changeSessionSettings(pointer, { permissionMode: mode })
      }
    }
  }

  // A complete command is sent, and a fuzzy match (`/tmp` finding `/template`) only replaces what was typed if chosen.
  function entersOption(option: Option): boolean {
    if (mention?.kind !== 'command' || picked) return true
    const name = option.word.slice(1)
    return name !== mention.query && name.startsWith(mention.query)
  }

  function onPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = imageFiles(event.clipboardData)
    if (pasted.length === 0) return
    // Some apps put an image's name or source alongside it; the image is what was meant.
    event.preventDefault()
    void attach(pasted)
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    const dropped = imageFiles(event.dataTransfer)
    if (dropped.length === 0) return
    event.preventDefault()
    void attach(dropped)
  }

  return (
    <div className="relative">
      {matches.length > 0 && (
        <div className="bg-popover text-popover-foreground absolute right-0 bottom-full left-0 mb-1 max-h-72 overflow-y-auto rounded-lg border p-1 shadow-md">
          {matches.map((option, index) => (
            <button
              key={option.key}
              ref={index === selected ? (element) => element?.scrollIntoView({ block: 'nearest' }) : undefined}
              type="button"
              // Keeps focus, and so the caret, in the textarea.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
              onMouseEnter={() => {
                setSelected(index)
                setPicked(true)
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm',
                index === selected && 'bg-accent text-accent-foreground',
              )}
            >
              {mention?.kind === 'command' ? (
                <SlashIcon className="text-muted-foreground size-3.5 shrink-0" />
              ) : (
                <FileIcon className="text-muted-foreground size-3.5 shrink-0" />
              )}
              <span className="shrink-0">{option.label}</span>
              {option.hint && <span className="text-muted-foreground shrink-0 text-xs">{option.hint}</span>}
              <span className="text-muted-foreground min-w-0 truncate text-xs">{option.detail}</span>
            </button>
          ))}
        </div>
      )}
      <div
        onDragOver={(event) => event.dataTransfer.types.includes('Files') && event.preventDefault()}
        onDrop={onDrop}
        className="focus-within:ring-ring/50 bg-background flex flex-col gap-1 rounded-xl border p-2 focus-within:ring-2"
      >
        {attachErrors.map((error) => (
          <p key={error} className="text-destructive px-2 text-xs">
            {error}
          </p>
        ))}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1 pt-1">
            {images.map((image, index) => (
              <div key={index} className="group relative">
                <img src={imageUrl(image)} alt="" className="h-16 max-w-32 rounded-md border object-cover" />
                <button
                  type="button"
                  title="Remove"
                  onClick={() => setImages(images.filter((_, i) => i !== index))}
                  className="bg-background absolute -top-1.5 -right-1.5 hidden rounded-full border p-0.5 group-hover:block compact:block"
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={textarea}
            value={text}
            onChange={(event) => changeText(event.target.value, event.target.selectionStart)}
            onSelect={(event) => updateMention(text, event.currentTarget.selectionStart)}
            onBlur={() => setMention(null)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            autoFocus={autoFocus}
            rows={1}
            placeholder={working ? (compact ? 'Queue a message' : 'Queue a message for when the agent finishes') : compact ? 'Message agent' : 'Message agent, @ to mention a file, / for commands'}
            className="placeholder:text-muted-foreground field-sizing-content max-h-60 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 outline-none"
          />
          {working && !canSend ? (
            <button
              type="button"
              title="Interrupt"
              onClick={() => void api.interrupt(pointer)}
              className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg compact:size-10"
            >
              <SquareIcon className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              title={compact ? 'Send' : 'Send (Enter)'}
              disabled={!canSend}
              onClick={send}
              className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg disabled:opacity-40 compact:size-10"
            >
              <ArrowUpIcon className="size-4" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}

type Completion = Mention & { kind: 'file' | 'command' }

/** A completion the popover offers; choosing it replaces the mention with `word`. */
type Option = { key: string; word: string; label: string; hint?: string; detail: string }

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
