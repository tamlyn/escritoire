import { describe, expect, it } from 'vitest'
import { activeMention, insertMention } from './mentions'

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

describe('insertMention', () => {
  it('replaces the query with the path and a space', () => {
    const text = 'see @ma please'
    expect(insertMention(text, 7, { start: 4, query: 'ma' }, 'src/main.ts')).toEqual({
      text: 'see @src/main.ts please',
      caret: 17,
    })
  })
})
