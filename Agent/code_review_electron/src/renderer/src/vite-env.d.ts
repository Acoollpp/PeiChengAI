/// <reference types="vite/client" />

import type { CodeReviewApi } from './code-review-api'

declare global {
  interface Window {
    codeReview: CodeReviewApi
  }
}

export {}
