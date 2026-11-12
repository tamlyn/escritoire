import { useState } from 'react'
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationTitle,
} from '@/components/ai-elements/confirmation'
import {
  Question as QuestionForm,
  QuestionInput,
  QuestionOption,
  QuestionOptions,
  QuestionPrompt,
  type QuestionValue,
} from '@/components/ai-elements/question'
import { Button } from '@/components/ui/button'
import type { PendingRequest, Question, QuestionAnswers, SessionPointer } from '../../../shared/agent'
import { api } from '../api'
import { ToolBody } from './Transcript'

/** Permission requests and questions blocking the agent, oldest first. */
export function Requests({
  requests,
  pointer,
}: {
  requests: PendingRequest[]
  pointer: SessionPointer
}) {
  return requests.map((request) =>
    request.kind === 'permission' ? (
      <Confirmation key={request.id}>
        <ConfirmationTitle className="text-foreground font-medium">{request.title}</ConfirmationTitle>
        <div className="space-y-2">
          <ToolBody view={request.view} />
        </div>
        <ConfirmationActions>
          {request.options.map((option) => (
            <ConfirmationAction
              key={option.id}
              variant={option.kind === 'deny' ? 'outline' : 'default'}
              onClick={() =>
                void api.respond(pointer, request.id, { kind: 'permission', optionId: option.id })
              }
            >
              {option.label}
            </ConfirmationAction>
          ))}
        </ConfirmationActions>
      </Confirmation>
    ) : (
      <Questions
        key={request.id}
        questions={request.questions}
        onAnswer={(answers) => void api.respond(pointer, request.id, { kind: 'question', answers })}
      />
    ),
  )
}

const emptyValue: QuestionValue = { selectedValues: [], text: '' }

/** Claude can ask several questions at once and takes all the answers together. */
function Questions({
  questions,
  onAnswer,
}: {
  questions: Question[]
  onAnswer: (answers: QuestionAnswers | null) => void
}) {
  const [values, setValues] = useState<Record<string, QuestionValue>>({})

  function answerFor(question: Question): string {
    const value = values[question.question] ?? emptyValue
    const text = value.text.trim()
    return [...value.selectedValues, ...(text ? [text] : [])].join(', ')
  }

  const complete = questions.every((q) => answerFor(q) !== '')

  return (
    <div className="flex flex-col gap-2">
      {questions.map((question) => (
        <QuestionForm
          key={question.question}
          selectionMode={question.multiSelect ? 'multiple' : 'single'}
          value={values[question.question] ?? emptyValue}
          onValueChange={(value) => setValues({ ...values, [question.question]: value })}
        >
          <QuestionPrompt>{question.question}</QuestionPrompt>
          <QuestionOptions>
            {question.options.map((option) => (
              <QuestionOption key={option.label} value={option.label} title={option.description}>
                {option.label}
              </QuestionOption>
            ))}
          </QuestionOptions>
          <QuestionInput placeholder="Other…" className="min-h-9" rows={1} />
        </QuestionForm>
      ))}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => onAnswer(null)}>
          Dismiss
        </Button>
        <Button
          size="sm"
          disabled={!complete}
          onClick={() =>
            onAnswer(Object.fromEntries(questions.map((q) => [q.question, answerFor(q)])))
          }
        >
          Answer
        </Button>
      </div>
    </div>
  )
}
