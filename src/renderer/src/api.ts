import type { Api, EventSubscriber } from '../../shared/api'

declare global {
  interface Window {
    api: Api
    subscribe: EventSubscriber
  }
}

export const api = window.api
export const subscribe = window.subscribe
