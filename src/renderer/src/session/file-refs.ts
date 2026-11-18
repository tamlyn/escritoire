/**
 * Finds file paths in agent messages, such as `src/main/index.ts:42` or
 * `/path/to/PLAN.md#L83`, and turns them into links that open the editor.
 */

export type FileRef = { path: string; line?: number }

const segment = String.raw`[\w@.+-]`
const pathBody = String.raw`\.{0,2}/?(?:${segment}+/)*[\w@+-](?:${segment}*[\w@+-])?`
const lineSuffix = String.raw`(?::(\d+)(?:[-:]\d+)?|#L(\d+)(?:-L?\d+)?)?`
const inText = new RegExp(String.raw`(?<![\w@.+/:#-])(${pathBody})${lineSuffix}(?![\w/])`, 'g')
const whole = new RegExp(String.raw`^(${pathBody})${lineSuffix}$`)
const withLine = /^(.*?)(?::(\d+)(?:[-:]\d+)?|#L(\d+)(?:-L?\d+)?)?$/
// A query, or an anchor such as a heading: neither is part of the file's name.
const notLineAnchor = /(?:\?|#(?!L\d+(?:-L?\d+)?$)).*$/

/**
 * Words that could be paths: an absolute path of two or more segments, or a
 * relative one with a directory or an extension. Relative ones still need
 * checking against the project's files, since `e.g.` or `Node.js` match too.
 */
function isCandidate(path: string): boolean {
  if (path.startsWith('/')) return path.indexOf('/', 1) !== -1
  return /[/.]/.test(path.replace(/^\.{1,2}\//, ''))
}

function toRef(path: string, line: string | undefined): FileRef {
  return line ? { path, line: Number(line) } : { path }
}

export function findFileRefs(text: string): (FileRef & { start: number; end: number })[] {
  return [...text.matchAll(inText)].flatMap((match) =>
    isCandidate(match[1]!)
      ? [{ ...toRef(match[1]!, match[2] ?? match[3]), start: match.index, end: match.index + match[0].length }]
      : [],
  )
}

/** For a code span that is nothing but a path. */
export function wholeFileRef(text: string): FileRef | null {
  const match = whole.exec(text.trim())
  return match && isCandidate(match[1]!) ? toRef(match[1]!, match[2] ?? match[3]) : null
}

/** A link the agent wrote to a file rather than a web page. */
export function hrefFileRef(href: string): FileRef | null {
  // A scheme, unless what follows the colon is a line number (`PLAN.md:83`).
  if (href.startsWith('#') || (/^[a-z][a-z\d+.-]*:(?!\d)/i.test(href) && !href.startsWith('file:'))) return null
  let decoded: string
  try {
    decoded = decodeURI(href.replace(/^file:\/\//, ''))
  } catch {
    return null
  }
  const match = withLine.exec(decoded.replace(notLineAnchor, ''))!
  return match[1] ? toRef(match[1], match[2] ?? match[3]) : null
}

// Survives Streamdown's sanitising, which drops or mangles relative paths and unknown schemes.
const hrefPrefix = '#open-file?'

export function fileHref(ref: FileRef, detected: boolean): string {
  const params = new URLSearchParams({ path: ref.path })
  if (ref.line) params.set('line', String(ref.line))
  if (detected) params.set('detected', '')
  return hrefPrefix + params.toString()
}

/** `detected` links were found in plain text rather than written as links, so may not be files. */
export function parseFileHref(href: string): (FileRef & { detected: boolean }) | null {
  if (!href.startsWith(hrefPrefix)) return null
  const params = new URLSearchParams(href.slice(hrefPrefix.length))
  const path = params.get('path')
  if (!path) return null
  return { ...toRef(path, params.get('line') ?? undefined), detected: params.has('detected') }
}

type Node = { type: string; value?: string; url?: string; children?: Node[] }

/** A remark plugin, to run after GFM so its autolinked URLs are left alone. */
export function remarkFileLinks() {
  return (tree: Node) => linkChildren(tree)
}

function linkChildren(parent: Node): void {
  if (!parent.children) return
  parent.children = parent.children.flatMap((node): Node[] => {
    switch (node.type) {
      case 'link':
      case 'definition': {
        const ref = hrefFileRef(node.url ?? '')
        if (ref) node.url = fileHref(ref, false)
        return [node]
      }
      case 'inlineCode': {
        const ref = wholeFileRef(node.value ?? '')
        return [ref ? link(ref, [node]) : node]
      }
      case 'text':
        return splitText(node.value ?? '')
      case 'code':
      case 'html':
        return [node]
      default:
        linkChildren(node)
        return [node]
    }
  })
}

function splitText(text: string): Node[] {
  const nodes: Node[] = []
  let at = 0
  for (const ref of findFileRefs(text)) {
    if (ref.start > at) nodes.push({ type: 'text', value: text.slice(at, ref.start) })
    nodes.push(link(ref, [{ type: 'text', value: text.slice(ref.start, ref.end) }]))
    at = ref.end
  }
  if (at < text.length) nodes.push({ type: 'text', value: text.slice(at) })
  return nodes
}

function link(ref: FileRef, children: Node[]): Node {
  return { type: 'link', url: fileHref({ path: ref.path, line: ref.line }, true), children }
}
