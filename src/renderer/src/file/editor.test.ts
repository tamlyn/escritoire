import { EditorState } from '@codemirror/state'
import { expect, test } from 'vitest'
import { changeFromDisk } from './editor'

function applyFromDisk(state: EditorState, text: string): string {
  return state.update({ changes: changeFromDisk(state, text) }).state.sliceDoc()
}

test('changes only the part that differs', () => {
  const state = EditorState.create({ doc: 'port: 3000\nhost: local\n' })
  expect(changeFromDisk(state, 'port: 4000\nhost: local\n')).toEqual({ from: 6, to: 7, insert: '4' })
})

test('keeps CRLF line endings and offsets right', () => {
  const state = EditorState.create({
    doc: 'a=1\r\nb=2\r\n',
    extensions: EditorState.lineSeparator.of('\r\n'),
  })
  expect(applyFromDisk(state, 'a=1\r\nb=3\r\nc=4\r\n')).toBe('a=1\r\nb=3\r\nc=4\r\n')
})
