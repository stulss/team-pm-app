import { useState } from 'react';

// 이메일(정확히 일치)로 멤버를 초대한다. 사용자 목록은 공개하지 않으므로 일반 소유자는 이 방식을 쓴다.
export default function MemberEmailAdd({ onAdd, disabled = false }) {
  const [email, setEmail] = useState('');
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        const value = email.trim();
        if (!value) return;
        onAdd(value);
        setEmail('');
      }}
    >
      <input
        type="email"
        aria-label="초대할 멤버 이메일"
        placeholder="가입한 이메일로 초대"
        maxLength={254}
        value={email}
        disabled={disabled}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button type="submit" className="secondary" disabled={disabled || !email.trim()}>
        추가
      </button>
    </form>
  );
}
