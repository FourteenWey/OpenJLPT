import { CHOICE_KEYS, QUIZ_BLANK, type getGrammarQuestion } from '../lib/grammarQuiz'
import type { Attempt } from '../types'

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
          <div role="status">
            <strong className={`chip chip-${feedback.grade}`}>{correct ? '答对了' : '答错了'}</strong>
            <p lang="ja">{before}<mark>{question.answer}</mark>{after}</p>
            <p>{question.explanation}</p>
          </div>
          <div className="row">
            <button className="primary" disabled={disabled} onClick={onNext}>
              {last ? '查看结果' : '下一题'} <kbd>Space</kbd>
            </button>
            <button disabled={disabled} onClick={onSpeak}>▶ 重播正确句 <kbd>R</kbd></button>
          </div>
        </div>
      )}
    </section>
  )
}
