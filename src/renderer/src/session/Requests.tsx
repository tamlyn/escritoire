import { useState } from 'react'
import type { PendingRequest, Question, SessionPointer } from '../../../shared/agent'
import { api } from '../api'
import { Button } from '@/components/ui/button'
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
      <section key={request.id} className="flex flex-col gap-3 rounded-xl border p-3">
        <h3 className="font-medium">{request.title}</h3>
        <ToolBody view={request.view} />
        <div className="flex gap-2">
          {request.options.map((option) => (
            <Button
              key={option.id}
              size="sm"
              variant={option.kind === 'deny' ? 'outline' : 'default'}
              onClick={() =>
                void api.respond(pointer, request.id, { kind: 'permission', optionId: option.id })
              }
            >
              {option.label}
            </Button>
          ))}
        </div>
      </section>
    ) : (
      <QuestionForm
        key={request.id}
        questions={request.questions}
        onAnswer={(answers) => void api.respond(pointer, request.id, { kind: 'question', answers })}
      />
    ),
  )
}

function QuestionForm({
  questions,
  onAnswer,
}: {
  questions: Question[]
  onAnswer: (answers: Record<string, string> | null) => void
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})

  function toggle(question: Question, label: string) {
    const current = selected[question.question] ?? []
    const next = question.multiSelect
      ? current.includes(label)
        ? current.filter((l) => l !== label)
        : [...current, label]
      : [label]
    setSelected({ ...selected, [question.question]: next })
  }

  function answerFor(question: Question): string {
    const custom = other[question.question]?.trim()
    return [...(selected[question.question] ?? []), ...(custom ? [custom] : [])].join(', ')
  }

  const complete = questions.every((q) => answerFor(q) !== '')

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (complete) onAnswer(Object.fromEntries(questions.map((q) => [q.question, answerFor(q)])))
      }}
    >
      {questions.map((question) => (
        <fieldset key={question.question} className="flex flex-col gap-2">
          <legend className="mb-2 font-medium">{question.question}</legend>
          <div className="flex flex-wrap gap-2">
            {question.options.map((option) => {
              const isSelected = selected[question.question]?.includes(option.label) ?? false
              return (
                <Button
                  key={option.label}
                  type="button"
                  size="sm"
                  variant={isSelected ? 'default' : 'outline'}
                  title={option.description}
                  aria-pressed={isSelected}
                  onClick={() => toggle(question, option.label)}
                >
                  {option.label}
                </Button>
              )
            })}
          </div>
          <input
            value={other[question.question] ?? ''}
            onChange={(event) => setOther({ ...other, [question.question]: event.target.value })}
            placeholder="Other…"
            className="placeholder:text-muted-foreground rounded-md border bg-transparent px-2 py-1 text-sm outline-none"
          />
        </fieldset>
      ))}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!complete}>
          Answer
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onAnswer(null)}>
          Dismiss
        </Button>
      </div>
    </form>
  )
}
