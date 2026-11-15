import { expect, test } from 'vitest'
import { descendants, parseLsof, parseSs } from './ports'

test('parses lsof field output', () => {
  const output = ['p579', 'f9', 'n*:5173', 'f10', 'n[::1]:9229', 'p975', 'f81', 'n127.0.0.1:7768', ''].join('\n')
  expect(parseLsof(output)).toEqual([
    { pid: 579, address: '*', port: 5173 },
    { pid: 579, address: '::1', port: 9229 },
    { pid: 975, address: '127.0.0.1', port: 7768 },
  ])
})

test('parses ss output, with every process sharing a socket', () => {
  const output = [
    'LISTEN 0      511          0.0.0.0:5173      0.0.0.0:*    users:(("node",pid=1234,fd=23),("node",pid=1240,fd=23))',
    'LISTEN 0      4096   127.0.0.53%lo:53        0.0.0.0:*',
    'LISTEN 0      511             [::]:3000         [::]:*    users:(("ruby",pid=99,fd=7))',
    '',
  ].join('\n')
  expect(parseSs(output)).toEqual([
    { pid: 1234, address: '0.0.0.0', port: 5173 },
    { pid: 1240, address: '0.0.0.0', port: 5173 },
    { pid: 99, address: '::', port: 3000 },
  ])
})

test('finds every descendant of a process', () => {
  const children = new Map([
    [1, [10, 20]],
    [10, [11]],
    [11, [12]],
  ])
  expect([...descendants(children, 10)].sort()).toEqual([10, 11, 12])
})
