export type TaskPreflightErrorField = 'svn_url' | 'old_revision' | 'new_revision'

export type TaskPreflightResult =
  | { status: 'valid' }
  | {
      status: 'invalid'
      errors: Partial<Record<TaskPreflightErrorField, string>>
    }
