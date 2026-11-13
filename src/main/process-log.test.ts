import { expect, test } from 'vitest'
import { ProcessLog } from './process-log'

const texts = (log: ProcessLog, count = 100, pattern?: RegExp) => log.tail(count, pattern).map((l) => l.text)

test('strips escape sequences and collapses progress redraws', () => {
  const log = new ProcessLog()
  log.append('\x1b[32mready\x1b[0m in 3ms\r\n\x1b]0;title\x07loading 10%\rloading 50%\rloading 100%\n')
  log.append('waiting for chan')
  log.append('ges')
  expect(texts(log)).toEqual(['ready in 3ms', 'loading 100%', 'waiting for changes'])
  expect(texts(log, 1)).toEqual(['waiting for changes'])
  expect(texts(log, 10, /ready/i)).toEqual(['ready in 3ms'])
})

test('groups stack traces into one error', () => {
  const log = new ProcessLog()
  log.append(
    [
      'GET / 200',
      'TypeError: Cannot read properties of undefined',
      '    at handler (/app/server.js:10:5)',
      '    at next (/app/router.js:4:2)',
      'GET / 500',
      'Traceback (most recent call last):',
      '  File "app.py", line 3, in <module>',
      '    main()',
      'ValueError: bad value',
      'Compiled with 0 errors',
      '[ERROR] build failed',
      '',
    ].join('\n'),
    1000,
  )
  expect(log.errorsSince(0).map((e) => e.text)).toEqual([
    'TypeError: Cannot read properties of undefined\n    at handler (/app/server.js:10:5)\n    at next (/app/router.js:4:2)',
    'Traceback (most recent call last):\n  File "app.py", line 3, in <module>\n    main()\nValueError: bad value',
    '[ERROR] build failed',
  ])
  expect(log.errorsSince(1001)).toEqual([])
})

test('marks are never errors and end an open one', () => {
  const log = new ProcessLog()
  log.append('Error: boom\n')
  log.mark('── Restarted: fatal ──')
  log.append('  indented after restart\n')
  expect(log.errorsSince(0).map((e) => e.text)).toEqual(['Error: boom'])
})

test('removes escape sequences split across chunks', () => {
  const log = new ProcessLog()
  log.append('\x1b[3')
  expect(texts(log)).toEqual([])
  log.append('1mError: split\x1b[0m\r')
  log.append('\n')
  expect(texts(log)).toEqual(['Error: split'])
  expect(log.errorsSince(0).map((e) => e.text)).toEqual(['Error: split'])
})
