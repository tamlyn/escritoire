import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ScriptedTurn } from '../agent'
import type { ClaudeScript } from '../claude'

// A small, plausible project for the screenshots: a tide times app with some git
// history, uncommitted work, and scripts to run as processes.

const files: Record<string, string> = {
  'package.json': JSON.stringify(
    {
      name: 'tidepool',
      private: true,
      type: 'module',
      scripts: {
        dev: 'node scripts/dev-server.mjs',
        'test:watch': 'node scripts/test-watch.mjs',
        sync: 'node scripts/sync.mjs',
      },
    },
    null,
    2,
  ) + '\n',
  'package-lock.json': '{}\n',
  'README.md': '# Tidepool\n\nTide times for harbours around the British Isles.\n',
  'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'es2023', module: 'esnext', jsx: 'react-jsx', strict: true } }, null, 2) + '\n',
  'scripts/dev-server.mjs': `import { createServer } from 'node:http'

const server = createServer((request, response) => {
  console.log(\`\${new Date().toLocaleTimeString()} GET \${request.url}\`)
  response.end('tidepool')
})
// Falls back to any port, so the screenshots don't fail when 5173 is taken.
server.on('error', () => server.listen(0))
server.on('listening', () => {
  console.log('\\n  \\x1b[1;36mtidepool\\x1b[0m dev server\\n')
  console.log(\`  ➜  Local:   \\x1b[36mhttp://localhost:\${server.address().port}/\\x1b[0m\`)
  console.log('  ➜  Watching src/ for changes\\n')
  for (const path of ['/', '/harbours/whitby', '/api/tides?harbour=whitby', '/api/tides?harbour=whitby&days=7', '/harbours/oban', '/api/tides?harbour=oban']) {
    console.log(\`\${new Date().toLocaleTimeString()} GET \${path}\`)
  }
})
server.listen(5173)
`,
  'scripts/test-watch.mjs': `console.log('\\x1b[2mWatching for file changes…\\x1b[0m\\n')
for (const name of ['parses admiralty tide tables', 'finds the next high water', 'formats times in the harbour time zone', 'handles the clocks going back']) {
  console.log(\`\\x1b[32m✔\\x1b[0m \${name}\`)
}
console.log('\\n\\x1b[32m4 passed\\x1b[0m \\x1b[2m(312ms)\\x1b[0m')
setInterval(() => {}, 1 << 30)
`,
  'scripts/sync.mjs': `console.log('Fetching tide tables for 42 harbours…')
console.error('Error: TIDEPOOL_API_KEY is not set')
console.error('    at loadConfig (scripts/sync.mjs:12:11)')
console.error('    at main (scripts/sync.mjs:4:3)')
process.exit(1)
`,
  'src/main.tsx': `import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
`,
  'src/App.tsx': `import { HarbourPicker } from './components/HarbourPicker'
import { TideChart } from './components/TideChart'
import { useHarbour } from './harbours'

export function App() {
  const [harbour, setHarbour] = useHarbour()
  return (
    <main>
      <HarbourPicker value={harbour} onChange={setHarbour} />
      <TideChart harbour={harbour} />
    </main>
  )
}
`,
  'src/components/HarbourPicker.tsx': `import { harbours, type Harbour } from '../harbours'

export function HarbourPicker({ value, onChange }: { value: Harbour; onChange: (harbour: Harbour) => void }) {
  return (
    <select value={value.id} onChange={(event) => onChange(harbours.find((h) => h.id === event.target.value)!)}>
      {harbours.map((harbour) => <option key={harbour.id} value={harbour.id}>{harbour.name}</option>)}
    </select>
  )
}
`,
  'src/components/TideChart.tsx': `import { formatTime, type Tide } from '../tides'

export function TideChart({ tides, timeZone }: { tides: Tide[]; timeZone: string }) {
  return (
    <ol className="tide-chart">
      {tides.map((tide) => (
        <li key={tide.at.toISOString()} data-kind={tide.kind}>
          {tide.kind === 'high' ? 'High water' : 'Low water'} {formatTime(tide.at, timeZone)}, {tide.height.toFixed(1)} m
        </li>
      ))}
    </ol>
  )
}
`,
  'src/harbours.ts': `import { useState } from 'react'

export type Harbour = { id: string; name: string; timeZone: string }

export const harbours: Harbour[] = [
  { id: 'whitby', name: 'Whitby', timeZone: 'Europe/London' },
  { id: 'oban', name: 'Oban', timeZone: 'Europe/London' },
  { id: 'st-peter-port', name: 'St Peter Port', timeZone: 'Europe/Guernsey' },
  { id: 'cobh', name: 'Cobh', timeZone: 'Europe/Dublin' },
]

export function useHarbour() {
  return useState(harbours[0]!)
}
`,
  'src/tides.ts': `export type Tide = { kind: 'high' | 'low'; at: Date; height: number }

/** Parses one day of an Admiralty tide table: \`HW 04:12 5.1\` per line. */
export function parseTable(day: Date, table: string): Tide[] {
  return table
    .trim()
    .split('\\n')
    .map((line) => {
      const [kind, time, height] = line.trim().split(/\\s+/)
      const [hours, minutes] = time!.split(':').map(Number)
      const at = new Date(day)
      at.setUTCHours(hours!, minutes!)
      return { kind: kind === 'HW' ? 'high' : 'low', at, height: Number(height) }
    })
}

export function nextHighWater(tides: Tide[], now = new Date()): Tide | undefined {
  return tides.find((tide) => tide.kind === 'high' && tide.at > now)
}

export function formatTime(at: Date, timeZone: string): string {
  return at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone })
}
`,
  'src/tides.test.ts': `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatTime, nextHighWater, parseTable } from './tides'

const day = new Date('2026-07-14T00:00:00Z')
const tides = parseTable(day, 'HW 04:12 5.1\\nLW 10:31 1.2\\nHW 16:40 5.3\\nLW 22:58 1.0')

test('parses admiralty tide tables', () => assert.equal(tides.length, 4))
test('finds the next high water', () => assert.equal(nextHighWater(tides, new Date('2026-07-14T12:00:00Z'))?.height, 5.3))
test('formats times in the harbour time zone', () => assert.equal(formatTime(tides[0]!.at, 'Europe/London'), '05:12'))
`,
}

// The agent's change, uncommitted, so the tree and git view show work in progress.
const edits: Record<string, string> = {
  'src/App.tsx': files['src/App.tsx']!.replace(
    '<TideChart harbour={harbour} />',
    '<TideChart tides={useTides(harbour)} timeZone={harbour.timeZone} />',
  ).replace("import { useHarbour } from './harbours'", "import { useHarbour } from './harbours'\nimport { useTides } from './tides'"),
  'src/components/TideChart.tsx': files['src/components/TideChart.tsx']!,
}

export async function createDemoProject(path: string): Promise<void> {
  const write = async (files: Record<string, string>) => {
    for (const [name, content] of Object.entries(files)) {
      await mkdir(dirname(join(path, name)), { recursive: true })
      await writeFile(join(path, name), content)
    }
  }
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Ada Shore', '-c', 'user.email=ada@example.com', ...args], { cwd: path })
  const commit = async (message: string, files: Record<string, string>) => {
    await write(files)
    git('add', '.')
    git('commit', '-q', '-m', message)
  }

  await mkdir(path, { recursive: true })
  git('init', '-q', '-b', 'main')
  const { 'src/components/TideChart.tsx': chart, 'src/tides.test.ts': tests, ...rest } = files
  await commit('Parse Admiralty tide tables', rest)
  await commit('Chart the day’s tides', { 'src/components/TideChart.tsx': chart!.replace(', timeZone', '').replace('timeZone: string ', '').replace('formatTime(tide.at, timeZone)', 'tide.at.toISOString().slice(11, 16)').replace("import { formatTime, type Tide }", "import { type Tide }") })
  await commit('Test the tide table parser', { 'src/tides.test.ts': tests! })
  await write(edits)
}

const bash = (command: string, description: string, result: string) => ({ tool: 'Bash', input: { command, description }, result })

/** A call to one of the IDE's own tools, with the kind of result it gives. */
const ideTool = (name: string, input: Record<string, unknown>, result: string) => ({ tool: `mcp__escritoire__${name}`, input, result })

export const prompts = {
  timeZones: 'The tide chart shows times in UTC. Show them in each harbour’s own time zone, and check the clocks changing doesn’t break it.',
  forecast: 'Add a seven-day forecast below the chart',
  devServer: 'Does the forecast endpoint work? Check it against the dev server.',
}

export const script: ClaudeScript = {
  turns: {
    [prompts.timeZones]: {
      steps: [
        { thinking: 'Looking for where tide times are formatted.' },
        { tool: 'Grep', input: { pattern: 'toISOString|setUTCHours', path: 'src' }, result: 'src/tides.ts:11:      at.setUTCHours(hours!, minutes!)\nsrc/components/TideChart.tsx:7:        <li key={tide.at.toISOString()} data-kind={tide.kind}>\nsrc/components/TideChart.tsx:8:          {tide.at.toISOString().slice(11, 16)}' },
        { tool: 'Read', input: { file_path: 'src/harbours.ts' }, result: files['src/harbours.ts']! },
        {
          tool: 'Edit',
          input: {
            file_path: 'src/components/TideChart.tsx',
            old_string: "{tide.kind === 'high' ? 'High water' : 'Low water'} {tide.at.toISOString().slice(11, 16)}, {tide.height.toFixed(1)} m",
            new_string: "{tide.kind === 'high' ? 'High water' : 'Low water'} {formatTime(tide.at, timeZone)}, {tide.height.toFixed(1)} m",
          },
          result: 'The file has been updated.',
        },
        {
          tool: 'Edit',
          input: { file_path: 'src/App.tsx', old_string: '<TideChart harbour={harbour} />', new_string: '<TideChart tides={useTides(harbour)} timeZone={harbour.timeZone} />' },
          result: 'The file has been updated.',
        },
        bash('node --test src/', 'Run the tests', '✔ parses admiralty tide tables (0.4ms)\n✔ finds the next high water (0.1ms)\n✔ formats times in the harbour time zone (1.2ms)\n✔ handles the clocks going back (0.3ms)\nℹ tests 4\nℹ pass 4\nℹ fail 0'),
        {
          text: [
            'Tide times now show in each harbour’s own time zone.',
            '',
            '- `TideChart` takes the harbour’s `timeZone` and formats with `formatTime`, which uses `Intl` rather than slicing an ISO string.',
            '- `App` passes it through from the selected harbour.',
            '- Added a test for the night the clocks go back: the 01:00–02:00 hour appears twice and both tides keep their order.',
            '',
            'The tables themselves are still parsed as UTC, which matches the Admiralty data. St Peter Port uses `Europe/Guernsey`, which follows UK time, so nothing changes there today.',
          ].join('\n'),
        },
      ],
    },
    [prompts.devServer]: {
      steps: [
        ideTool('list_processes', {}, 'id: 1f0c9a2e\ncommand: npm run test:watch\ncwd: .\nstatus: running since 10:41:07\n\nid: 8d23b6f4\ncommand: npm run sync\ncwd: .\nstatus: failed at 10:41:09 with exit code 1'),
        ideTool('start_process', { task: { file: 'package.json', name: 'dev' } }, 'Started.\n\nid: 5be71d03\ncommand: npm run dev\ncwd: .\nstatus: running since 10:42:30\nlistening on: 5173 (http://localhost:5173/)'),
        bash('curl -s "localhost:5173/api/tides?harbour=whitby&days=7" | jq length', 'Ask for a week of tides', '7'),
        ideTool('read_output', { id: '5be71d03', grep: 'api/tides' }, '10:42:31 GET /api/tides?harbour=whitby\n10:42:33 GET /api/tides?harbour=whitby&days=7'),
        {
          text: [
            'The forecast endpoint works. I started the dev server (it wasn’t running) and asked it for a week at Whitby: it returned seven days, and its log shows the request served without errors.',
            '',
            'The `sync` job has crashed, though: `TIDEPOOL_API_KEY` isn’t set. That doesn’t affect the endpoint, which serves the cached tables, but they won’t refresh until it’s set.',
          ].join('\n'),
        },
      ],
    },
    [prompts.forecast]: {
      hold: true,
      steps: [
        { thinking: 'Planning the forecast component.' },
        { tool: 'Read', input: { file_path: 'src/components/TideChart.tsx' }, result: files['src/components/TideChart.tsx']! },
        { thinking: 'Choosing how to lay out a week of tides.' },
      ],
    },
  },
}

const codexCommand = (command: string, aggregatedOutput: string) => ({ type: 'commandExecution', command, aggregatedOutput })

export const codexPrompt = 'Why does `npm run sync` fail?'

/** Codex's turn, on a different task to Claude's. */
export const codexScript: Record<string, ScriptedTurn> = {
  [codexPrompt]: {
    usage: { totalTokens: 31840, inputTokens: 30200, cachedInputTokens: 26900, cacheWriteInputTokens: 3300, outputTokens: 1640, reasoningOutputTokens: 380 },
    items: [
      { type: 'reasoning', summary: ['Reproducing the failure'], content: [] },
      codexCommand('npm run sync', '> sync\n> node scripts/sync.mjs\n\nFetching tide tables for 42 harbours…\nError: TIDEPOOL_API_KEY is not set\n    at loadConfig (scripts/sync.mjs:12:11)'),
      codexCommand('rg -n "TIDEPOOL_API_KEY" --hidden', 'scripts/sync.mjs:12:  const key = process.env.TIDEPOOL_API_KEY'),
      codexCommand('ls -a', '.\n..\n.git\nREADME.md\npackage-lock.json\npackage.json\nscripts\nsrc\ntsconfig.json'),
      {
        type: 'fileChange',
        changes: [{ path: '.env.example', kind: { type: 'add' }, diff: '@@ -0,0 +1,2 @@\n+# From https://tidepool.example/account/keys\n+TIDEPOOL_API_KEY=\n' }],
      },
      {
        type: 'agentMessage',
        text: [
          'It needs an API key that nothing provides: `scripts/sync.mjs` reads `TIDEPOOL_API_KEY` from the environment, and there’s no `.env` file or mention of it anywhere else.',
          '',
          'I added `.env.example` with the variable and where to get a key. Copy it to `.env`, fill it in and run `npm run sync` again. Want me to load `.env` in the script so you don’t have to export it?',
        ].join('\n'),
      },
    ],
  },
}
