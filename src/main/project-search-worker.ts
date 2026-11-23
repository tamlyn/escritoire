// Find in files, in a worker thread so main keeps serving while a search runs,
// and so a regular expression that backtracks for minutes can be stopped.
import { parentPort } from 'node:worker_threads'
import type { SearchRequest, SearchWorkerMessage } from './project-search-runner'
import { FileTextCache, searchFiles } from './project-search'

const port = parentPort!
const cache = new FileTextCache()
const searches = new Map<number, AbortController>()
const post = (message: SearchWorkerMessage) => port.postMessage(message)

// Stops while a match blocks the thread, which is how main knows it's stuck.
setInterval(() => { if (searches.size > 0) post({ type: 'alive' }) }, 1000).unref()

port.on('message', (request: SearchRequest) => {
  if (request.type === 'cancel') {
    searches.get(request.id)?.abort()
    return
  }
  const controller = new AbortController()
  searches.set(request.id, controller)
  void searchFiles(request.root, request.paths, request.query, controller.signal, cache)
    .then(
      (results) => post({ type: 'results', id: request.id, results }),
      (error: unknown) => post({ type: 'failed', id: request.id, message: error instanceof Error ? error.message : String(error) }),
    )
    .finally(() => searches.delete(request.id))
})
