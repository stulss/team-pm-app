import { useEffect } from 'react';
import Icon from './Icon.jsx';

const SHORTCUT_GROUPS = [
  {
    title: '전역 & 내비게이션',
    items: [
      { keys: ['Ctrl', 'K'], label: '명령 팔레트 열기 (Mac: ⌘K)' },
      { keys: ['?'], label: '단축키 치트시트 열기/닫기' },
      { keys: ['/'], label: '전역 통합 검색 바로가기' },
      { keys: ['Esc'], label: '모달 및 다이얼로그 닫기' },
    ],
  },
  {
    title: '보드 & 칸반 탐색',
    items: [
      { keys: ['J', '/', 'K'], label: '다음 / 이전 작업 카드로 포커스 이동' },
      { keys: ['H', '/', 'L'], label: '이전 / 다음 칸반 컬럼으로 이동' },
      { keys: ['Enter'], label: '선택한 작업 상세 모달 열기' },
      { keys: ['Space'], label: '체크리스트 토글' },
    ],
  },
  {
    title: '작업 빠른 조작 (Quick Actions)',
    items: [
      { keys: ['C'], label: '신규 작업 생성 퀵 다이얼로그' },
      { keys: ['S'], label: '작업 상태(Status) 변경' },
      { keys: ['P'], label: '우선순위(Priority) 변경' },
      { keys: ['A'], label: '나에게 즉시 배정 (Assign to Me)' },
    ],
  },
];

export default function ShortcutCheatsheet({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="cheatsheet-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="키보드 단축키">
      <div className="cheatsheet-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cheatsheet-header">
          <div className="cheatsheet-title">
            <Icon name="keyboard" size={18} />
            <span>키보드 단축키 가이드 (Keyboard Shortcuts)</span>
          </div>
          <button type="button" className="icon-btn cheatsheet-close" onClick={onClose} aria-label="닫기">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="cheatsheet-body">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="cheatsheet-group">
              <h4 className="cheatsheet-group-title">{group.title}</h4>
              <div className="cheatsheet-list">
                {group.items.map((item) => (
                  <div key={item.label} className="cheatsheet-row">
                    <span className="cheatsheet-label">{item.label}</span>
                    <div className="cheatsheet-keys">
                      {item.keys.map((k, idx) => (
                        <kbd key={idx} className="kbd-chip">
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="cheatsheet-footer">
          <span>팁: <code>?</code> 키를 언제든 다시 누르면 이 창을 빠르게 열고 닫을 수 있습니다.</span>
        </div>
      </div>
    </div>
  );
}
