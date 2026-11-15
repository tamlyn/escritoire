import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { StatementResult } from '../../../../shared/sql'
import type { SqlRun } from '../../sql'

/** A finished run: one result per statement, with a strip to choose between them if there are several. */
export function Results({ run }: { run: SqlRun }) {
  const { statements, results } = run
  // An error is what needs attention; otherwise the last result is the one asked for.
  const [selected, setSelected] = useState(() => {
    const error = results.findIndex((r) => r.kind === 'error')
    return error >= 0 ? error : results.length - 1
  })
  const result = results[selected]

  return (
    <div className="flex h-full flex-col">
      {statements.length > 1 && (
        <div role="tablist" className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1">
          {statements.map((statement, index) => (
            <button
              key={index}
              type="button"
              role="tab"
              aria-selected={index === selected}
              title={statement}
              onClick={() => setSelected(index)}
              className={cn(
                'max-w-56 shrink-0 truncate rounded px-2 py-0.5 font-mono text-xs',
                index === selected ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
                results[index]?.kind === 'error' && 'text-destructive',
                !results[index] && 'opacity-60',
              )}
            >
              {statement.replace(/\s+/g, ' ')}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {result ? <StatementResultView result={result} /> : <Message>Not run, after an earlier statement stopped.</Message>}
      </div>
    </div>
  )
}

function StatementResultView({ result }: { result: StatementResult }) {
  switch (result.kind) {
    case 'error':
      return (
        <pre role="alert" className="text-destructive h-full overflow-auto p-3 font-mono text-xs whitespace-pre-wrap select-text">
          {result.message}
        </pre>
      )
    case 'done':
      return (
        <Message>
          {result.affected === null ? 'Done' : `${result.affected} ${result.affected === 1 ? 'row' : 'rows'} affected`} ·{' '}
          {result.ms} ms
        </Message>
      )
    case 'rows':
      return (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1 overflow-auto select-text">
            <table className="border-separate border-spacing-0 font-mono text-xs">
              <thead className="bg-chrome sticky top-0">
                <tr>
                  <th className="text-muted-foreground border-b px-2 py-1 text-right font-normal" />
                  {result.columns.map((column, index) => (
                    <th key={index} className="border-b border-l px-2 py-1 text-left font-medium whitespace-nowrap">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="hover:bg-accent/50">
                    <td className="text-muted-foreground border-b px-2 py-0.5 text-right select-none">{rowIndex + 1}</td>
                    {row.map((value, index) => (
                      <td key={index} title={value ?? 'NULL'} className="max-w-[40ch] truncate border-b border-l px-2 py-0.5">
                        {value ?? <span className="text-muted-foreground italic">NULL</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-muted-foreground shrink-0 border-t px-3 py-1 text-xs">
            {result.truncated
              ? `First ${result.rows.length} rows`
              : `${result.rows.length} ${result.rows.length === 1 ? 'row' : 'rows'}`}{' '}
            · {result.ms} ms
          </div>
        </div>
      )
  }
}

function Message({ children }: { children: React.ReactNode }) {
  return <div className="text-muted-foreground flex h-full items-center justify-center text-sm">{children}</div>
}
