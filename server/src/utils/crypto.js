import crypto from 'node:crypto';
import bcrypt from 'bcrypt';

const BCRYPT_COST = 12;

export const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_COST);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

// refresh 토큰은 원문 대신 SHA-256 해시만 DB 에 저장한다.
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// 존재하지 않는 이메일로 로그인할 때도 bcrypt 비교를 수행해 응답 시간 차이로 계정 존재 여부가 드러나지 않게 한다.
export const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST);
