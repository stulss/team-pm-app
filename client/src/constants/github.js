export const PR_STATE_LABELS = {
  open: '열림',
  draft: '초안',
  merged: '머지됨',
  closed: '닫힘',
};

export const prBadgeText = (pr) => `#${pr.number} ${PR_STATE_LABELS[pr.state] ?? ''}`.trim();
