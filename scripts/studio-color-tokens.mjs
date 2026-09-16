const approvedStudioColorDeclarations = new Set([
  '--review-comment-marker:#facc15',
  '--video-status-not-started-background:#e5e7eb',
  '--video-status-not-started-foreground:#374151',
  '--video-status-filming-background:#fef3c7',
  '--video-status-filming-foreground:#92400e',
  '--video-status-ready-to-edit-background:#dbeafe',
  '--video-status-ready-to-edit-foreground:#1e40af',
  '--video-status-ready-to-review-background:#ede9fe',
  '--video-status-ready-to-review-foreground:#5b21b6',
  '--video-status-published-background:#dcfce7',
  '--video-status-published-foreground:#166534',
  '--video-status-not-started-background:#374151',
  '--video-status-not-started-foreground:#f3f4f6',
  '--video-status-filming-background:#78350f',
  '--video-status-filming-foreground:#fef3c7',
  '--video-status-ready-to-edit-background:#1e3a8a',
  '--video-status-ready-to-edit-foreground:#dbeafe',
  '--video-status-ready-to-review-background:#4c1d95',
  '--video-status-ready-to-review-foreground:#ede9fe',
  '--video-status-published-background:#14532d',
  '--video-status-published-foreground:#dcfce7',
])

export function normalizeApprovedStudioColors(css) {
  return css.replace(
    /(^|[;{])(\s*)(--[\w-]+)(\s*:\s*)(#[0-9a-f]{3,8})(?=\s*[;}])/g,
    (declaration, boundary, spacing, property, separator, value) => approvedStudioColorDeclarations.has(`${property}:${value}`)
      ? `${boundary}${spacing}${property}${separator}#fff`
      : declaration,
  )
}
