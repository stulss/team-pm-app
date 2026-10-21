import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';

// 네이티브 <dialog> 기반 모달: 포커스 이동·ESC 닫기·배경 비활성화를 브라우저가 처리한다.
// 열린 상태일 때만 렌더링한다(부모가 마운트/언마운트로 제어). wide 는 작업 상세처럼 넓은 내용용.
export default function Modal({ title, onClose, children, wide = false }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
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
