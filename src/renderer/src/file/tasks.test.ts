import { expect, test } from 'vitest'
import { findTasks } from './tasks'

const lineOf = (text: string, offset: number) => text.slice(0, offset).split('\n').length

test('finds package.json scripts on their lines', () => {
  const text = `{
  "name": "dev",
  "scripts": {
    "dev": "vite",
    "build:prod": "vite build",
    "name": "echo"
  }
}`
  const tasks = findTasks('package.json', text)
  expect(tasks.map((t) => [t.name, lineOf(text, t.offset)])).toEqual([
    ['dev', 4],
    ['build:prod', 5],
    ['name', 6],
  ])
  expect(findTasks('package.json', '{ "scripts": ')).toEqual([])
})

test('finds mise tasks in tables and in a tasks table', () => {
  const text = `[tools]
node = "26"

[tasks.build]
run = "make"

[tasks."db:reset"]
run = "x"

[tasks]
lint = "eslint ."
'quoted' = { run = "y" }

[env]
FOO = "1"`
  const tasks = findTasks('mise.toml', text)
  expect(tasks.map((t) => [t.name, lineOf(text, t.offset)])).toEqual([
    ['build', 4],
    ['db:reset', 7],
    ['lint', 11],
    ['quoted', 12],
  ])
  expect(findTasks('other.toml', text)).toEqual([])
})
