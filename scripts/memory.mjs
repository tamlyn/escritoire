import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

// Covers the packaged app on macOS and Linux, and `pnpm dev`.
const MAIN_PROCESS =
  /^\S*\/(MacOS\/Escritoire|escritoire|escritoire\/node_modules\/\S*\/(MacOS\/Electron|dist\/electron))(\s|$)/
const ELECTRON_HELPER = /--type=|crashpad/
const MEASURING_COMMAND = /pnpm|scripts\/memory\.mjs/

async function listProcesses() {
  const { stdout } = await run('ps', ['-axww', '-o', 'pid=,ppid=,rss=,args='], {
    maxBuffer: 64 * 1024 * 1024,
  })
  const processes = new Map()
  for (const line of stdout.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)
    if (!match) continue
    const [, pid, ppid, rssKb, args] = match
    processes.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), rssKb: Number(rssKb), args })
  }
  return processes
}

// Run through `pnpm memory` inside an Escritoire terminal, this script and its wrappers are
// descendants of the app, and shouldn't count towards what it uses.
function findOwnProcesses(processes) {
  const own = new Set([process.pid])
  let parent = processes.get(process.ppid)
  while (parent && MEASURING_COMMAND.test(parent.args)) {
    own.add(parent.pid)
    parent = processes.get(parent.ppid)
  }
  return own
}

function findMainProcesses(processes) {
  const candidates = [...processes.values()].filter(({ args }) => MAIN_PROCESS.test(args) && !args.includes('--type='))
  const pids = new Set(candidates.map(({ pid }) => pid))
  return candidates.filter(({ ppid }) => !pids.has(ppid))
}

function collectTree(root, childrenOf, excluded) {
  const tree = []
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    if (excluded.has(current.pid)) continue
    tree.push(current)
    pending.push(...(childrenOf.get(current.pid) ?? []))
  }
  return tree
}

// Footprint is what Activity Monitor reports. It only exists on macOS, and can fail for a process
// that has just exited, so RSS is the fallback.
async function measure({ pid, rssKb }) {
  const rss = { bytes: rssKb * 1024, estimated: true }
  if (process.platform !== 'darwin') return rss
  try {
    const { stdout } = await run('footprint', ['-p', String(pid)])
    const match = stdout.match(/(?:phys_footprint|Footprint):\s*([\d.]+)\s*(KB|MB|GB)/)
    if (!match) return rss
    const unit = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[match[2]]
    return { bytes: Number(match[1]) * unit, estimated: false }
  } catch {
    return rss
  }
}

function formatBytes(bytes) {
  const megabytes = bytes / 1024 ** 2
  return megabytes >= 1024 ? `${(megabytes / 1024).toFixed(1)} GB` : `${Math.round(megabytes)} MB`
}

function commandName(args) {
  return basename(args.split(/\s/)[0]).replace(/^-/, '')
}

function plural(count) {
  return `${count} process${count === 1 ? '' : 'es'}`
}

async function report(root, childrenOf, excluded) {
  const groups = [{ label: 'Electron app', members: [root] }]
  for (const child of childrenOf.get(root.pid) ?? []) {
    if (excluded.has(child.pid)) continue
    if (ELECTRON_HELPER.test(child.args)) {
      groups[0].members.push(child)
    } else {
      groups.push({
        label: `${commandName(child.args)} (pid ${child.pid})`,
        members: collectTree(child, childrenOf, excluded),
      })
    }
  }

  const measured = await Promise.all(
    groups.map(async ({ label, members }) => {
      const sizes = await Promise.all(members.map(measure))
      return {
        label,
        count: members.length,
        bytes: sizes.reduce((sum, { bytes }) => sum + bytes, 0),
        estimated: sizes.filter(({ estimated }) => estimated).length,
      }
    }),
  )
  measured.sort((a, b) => b.bytes - a.bytes)

  const total = measured.reduce((sum, { bytes }) => sum + bytes, 0)
  const count = measured.reduce((sum, group) => sum + group.count, 0)
  const estimated = measured.reduce((sum, group) => sum + group.estimated, 0)

  console.log(`Escritoire (pid ${root.pid}): ${formatBytes(total)} across ${plural(count)}`)
  for (const group of measured) {
    console.log(`${formatBytes(group.bytes).padStart(9)}  ${group.label}, ${plural(group.count)}`)
  }
  if (estimated > 0) console.log(`RSS used for ${plural(estimated)} without a footprint.`)
}

const processes = await listProcesses()
const roots = findMainProcesses(processes)
if (roots.length === 0) {
  console.error('Escritoire is not running.')
  process.exit(1)
}

const childrenOf = new Map()
for (const entry of processes.values()) {
  childrenOf.set(entry.ppid, [...(childrenOf.get(entry.ppid) ?? []), entry])
}

const excluded = findOwnProcesses(processes)
for (const entry of childrenOf.get(process.pid) ?? []) excluded.add(entry.pid)

for (const root of roots) await report(root, childrenOf, excluded)
