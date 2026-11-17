import { describe, expect, it } from 'vitest'
import { activeCommand, activeMention, insertMention } from './mentions'

describe('activeMention', () => {
  it('finds an @ at the start of a word up to the caret', () => {
    expect(activeMention('look at @src/ma', 15)).toEqual({ start: 8, query: 'src/ma' })
    expect(activeMention('@', 1)).toEqual({ start: 0, query: '' })
  })

  it('ignores @ inside a word or once a space follows', () => {
    expect(activeMention('me@example.com', 14)).toBeNull()
    expect(activeMention('@src/main.ts and', 16)).toBeNull()
  })
})

describe('activeCommand', () => {
  it('finds a / that starts the message, up to the caret', () => {
    expect(activeCommand('/', 1)).toEqual({ start: 0, query: '' })
    expect(activeCommand('/comp', 5)).toEqual({ start: 0, query: 'comp' })
  })

  it('ignores a / later in the message or once a space follows', () => {
    expect(activeCommand('see /comp', 9)).toBeNull()
    expect(activeCommand(' /comp', 6)).toBeNull()
    expect(activeCommand('/compact now', 12)).toBeNull()
  })
})

describe('insertMention', () => {
  it('replaces the query with the word and a space', () => {
    const text = 'see @ma please'
    expect(insertMention(text, 7, { start: 4, query: 'ma' }, '@src/main.ts')).toEqual({
      text: 'see @src/main.ts please',
      caret: 17,
    })
  })
})
