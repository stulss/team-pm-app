export const PR_STATE_LABELS = {
  open: '열림',
  draft: '초안',
  merged: '머지됨',
  closed: '닫힘',
};

export const GITHUB_KIND_LABELS = { pull_request: 'PR', commit: '커밋', issue: '이슈' };

export const ISSUE_STATE_LABELS = { open: '열림', closed: '닫힘' };

export const prBadgeText = (pr) => `#${pr.number} ${PR_STATE_LABELS[pr.state] ?? ''}`.trim();
