export interface LatestRequestHandlers<T> {
  onStart?(): void
  onSuccess(value: T): void
  onError?(error: unknown): void
  onSettled?(): void
}

export interface LatestRequestRunner {
  run<T>(request: () => Promise<T>, handlers: LatestRequestHandlers<T>): Promise<void>
}

export const createLatestRequestRunner = (): LatestRequestRunner => {
  let latestRequestId = 0

  return {
    async run(request, handlers) {
      const requestId = ++latestRequestId
      handlers.onStart?.()
      try {
        const result = await request()
        if (requestId === latestRequestId) {
          handlers.onSuccess(result)
        }
      } catch (error) {
        if (requestId === latestRequestId) {
          handlers.onError?.(error)
        }
      } finally {
        if (requestId === latestRequestId) {
          handlers.onSettled?.()
        }
      }
    }
  }
}
