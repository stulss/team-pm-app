// 서버가 /login?github=<사유> 로 돌려보내는 GitHub 로그인 실패 사유 → 안내 문구
const MESSAGES = {
  denied: 'GitHub 승인을 취소했습니다.',
  bad_state: '로그인 요청이 만료되었거나 올바르지 않습니다. 다시 시도해 주세요.',
  bad_code: 'GitHub 승인 코드가 올바르지 않습니다. 다시 시도해 주세요.',
  github_error: 'GitHub 에서 정보를 가져오지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  unreachable: 'GitHub 에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  no_verified_email:
    'GitHub 계정에 인증된 기본 이메일이 없습니다. GitHub 설정에서 이메일을 인증한 뒤 다시 시도해 주세요.',
  email_linked_elsewhere: '이 이메일은 이미 다른 GitHub 계정과 연결돼 있습니다.',
  email_taken: '이미 사용 중인 이메일입니다. 이메일과 비밀번호로 로그인해 주세요.',
  registration_closed: '현재 신규 가입을 받지 않습니다.',
  inactive: '비활성화된 계정입니다. 관리자에게 문의해 주세요.',
  linked: 'GitHub 계정을 연결했습니다.',
  github_taken: '이 GitHub 계정은 이미 다른 사용자에게 연결돼 있습니다.',
  disabled: 'GitHub 로그인이 꺼져 있습니다.',
  error: 'GitHub 로그인에 실패했습니다. 잠시 뒤 다시 시도해 주세요.',
};

export const githubErrorMessage = (reason) => (reason ? (MESSAGES[reason] ?? MESSAGES.error) : '');
