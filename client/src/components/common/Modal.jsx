import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';

// 네이티브 <dialog> 기반 모달: ESC 닫기·배경 비활성화를 브라우저가 처리한다.
// 열린 상태일 때만 렌더링한다(부모가 마운트/언마운트로 제어). wide 는 작업 상세처럼 넓은 내용용.
// 처음 포커스는 닫기 버튼이 아니라 본문의 첫 입력칸(autofocus 가 있으면 그것)으로 보내고,
// 닫히면 모달을 연 요소로 포커스를 돌려준다.
const FIELD =
  'input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled)';

export default function Modal({ title, onClose, children, wide = false }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    if (dialog && !dialog.open) dialog.showModal();
    const target =
      dialog?.querySelector('[autofocus]') ?? dialog?.querySelector(`.modal-body ${FIELD}`);
    target?.focus();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={wide ? 'modal wide' : 'modal'}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // 배경(backdrop) 클릭
      }}
    >
      <div className="modal-body">
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="닫기" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
