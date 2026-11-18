import { describe, expect, it } from 'vitest'
import { quizItems } from '../src/data/grammar-quiz'
import { grammarById, grammarFrames } from '../src/lib/grammar'
import { getGrammarQuestion, grammarQuestions, grammarQuizFrames, QUIZ_BLANK } from '../src/lib/grammarQuiz'

describe('语法单选题库', () => {
  it('每道题关联已知语法点，含一个空格和四个不同选项', () => {
    const ids = new Set<string>()
    for (const [level, items] of Object.entries(quizItems)) {
      expect(items.length).toBeGreaterThanOrEqual(20)
      for (const [pattern, prompt, answer, distractors, explanation] of items) {
        const id = `${level}:${pattern}`
        expect(grammarById.has(id), id).toBe(true)
        expect(ids.has(id), id).toBe(false)
        expect(prompt.split(QUIZ_BLANK), id).toHaveLength(2)
        expect(new Set([answer, ...distractors]).size, id).toBe(4)
        expect(explanation, id).not.toBe('')
        expect(prompt.replace(QUIZ_BLANK, answer), id).not.toContain(QUIZ_BLANK)
        expect(getGrammarQuestion(id, 42)?.options, id).toEqual(getGrammarQuestion(id, 42)?.options)
        expect(getGrammarQuestion(id, 42)?.options, id).toEqual(expect.arrayContaining([answer, ...distractors]))
        ids.add(id)
      }
    }
  })

  it('每个级别的所有语法点都能从速筛入口抽取', () => {
    expect(grammarQuestions.size).toBe(grammarById.size)
    expect(grammarQuizFrames.map((frame) => frame.wordIds.length)).toEqual([120, 125, 153, 184, 206])
    for (const frame of grammarQuizFrames) {
      const source = grammarFrames.find((item) => item.id === frame.id)!
      expect(frame.wordIds).toEqual(source.wordIds)
      for (const id of frame.wordIds) expect(getGrammarQuestion(id, 1234), id).toBeDefined()
    }
  })
})
