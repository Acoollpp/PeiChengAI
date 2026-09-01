export function formatReviewTaskErrorMessage(message?: string | null) {
  if (!message?.trim()) {
    return "-"
  }

  if (/Codex review timed out after \d+ms/.test(message)) {
    return "Codex 审查超过 90 分钟仍未完成，请稍后重试或联系管理员。"
  }

  if (message.includes("审查报告不存在")) {
    return "SVN权限不足（或者SVN账号未登录）"
  }

  if (/Codex review failed with exit code 1:/.test(message)) {
    return "Codex报错请检查Codex对话后重试。"
  }

  return message
}
