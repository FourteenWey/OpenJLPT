import { useEffect, useRef } from 'react'
import { CHOICE_KEYS, QUIZ_BLANK, type getGrammarQuestion } from '../lib/grammarQuiz'
import type { Attempt } from '../types'
import { BookmarkButton } from './BookmarkControls'

interface Props {
  question: NonNullable<ReturnType<typeof getGrammarQuestion>>
  feedback?: Attempt
  disabled: boolean
  last: boolean
  onChoose: (index: number) => void
  onNext: () => void
  onSpeak: () => void
}

export function GrammarQuestionCard({ question, feedback, disabled, last, onChoose, onNext, onSpeak }: Props) {
  const [before, after] = question.prompt.split(QUIZ_BLANK)
  const correct = feedback?.grade === 'A'
  const feedbackId = feedback?.id
  const explanation = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!feedbackId) return
    explanation.current?.focus({ preventScroll: true })
    explanation.current?.scrollIntoView?.({ block: 'nearest' })
  }, [feedbackId])
  return (
    <section className="card grammar-quiz">
      <p className="grammar-instruction muted small">选出最适合填入空格的一项</p>
      <p className="grammar-prompt" lang="ja">{question.prompt}</p>
      <div className="grammar-options" role="group" aria-label="选项">
        {question.options.map((option, index) => {
          const isAnswer = feedback && option === question.answer
          const isChoice = feedback && option === feedback.choice
          return (
            <button
              key={option}
              className={isAnswer ? 'quiz-correct' : isChoice ? 'quiz-incorrect' : undefined}
              disabled={disabled || !!feedback}
              onClick={() => onChoose(index)}
            >
              <kbd>{CHOICE_KEYS[index]}</kbd>
              <span lang="ja">{option}</span>
              {isAnswer ? <small>正确答案</small> : isChoice ? <small>你选的答案</small> : null}
            </button>
          )
        })}
      </div>
      {feedback && (
        <div className="grammar-feedback">
          <div ref={explanation} role="status" tabIndex={-1}>
            <strong className={`chip chip-${feedback.grade}`}>{correct ? '答对了' : '答错了'}</strong>
            <p lang="ja">{before}<mark>{question.answer}</mark>{after}</p>
            <p>{question.explanation}</p>
          </div>
          <BookmarkButton subject="grammar" itemId={feedback.wordId} label={question.pattern} disabled={disabled} />
        </div>
      )}
      {feedback && <div className="study-actions grammar-actions">
        <button disabled={disabled} onClick={onSpeak}>重播正确句 <kbd>R</kbd></button>
        <button className="primary" disabled={disabled} onClick={onNext}>{last ? '查看结果' : '下一题'} <kbd>Space</kbd></button>
      </div>}
    </section>
  )
}
