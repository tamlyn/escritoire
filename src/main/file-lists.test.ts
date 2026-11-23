import { expect, test } from 'vitest'
import { FileLists } from './file-lists'

function lists() {
  let loads = 0
  const fileLists = new FileLists(async (projectId) => [`${projectId}-${++loads}`])
  return { fileLists, loads: () => loads }
}

test("keeps a watched project's list until it changes", async () => {
  const { fileLists, loads } = lists()
  fileLists.watch(['p'])
  expect(await fileLists.get('p')).toEqual(['p-1'])
  expect(await fileLists.get('p')).toEqual(['p-1'])
  fileLists.changed('p')
  expect(await fileLists.get('p')).toEqual(['p-2'])
  expect(loads()).toBe(2)
})

test('lists an unwatched project afresh, and forgets a list once its project is unwatched', async () => {
  const { fileLists } = lists()
  expect(await fileLists.get('q')).toEqual(['q-1'])
  expect(await fileLists.get('q')).toEqual(['q-2'])
  fileLists.watch(['q'])
  await fileLists.get('q')
  fileLists.watch([])
  fileLists.watch(['q'])
  expect(await fileLists.get('q')).toEqual(['q-4'])
})
