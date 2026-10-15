import { badRequest } from '../utils/errors.js';

// zod 스키마로 req[source] 를 검증하고, 변환된 값으로 교체한다.
export const validate =
  (schema, source = 'body') =>
  (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.'),
        issue: i.message,
      }));
      return next(badRequest(details[0]?.issue ?? '입력값이 올바르지 않습니다.', details));
    }
    // Express 5 에서 req.query 는 getter 라 직접 대입이 안 되므로 속성을 새로 정의한다.
    Object.defineProperty(req, source, { value: result.data, writable: true, configurable: true });
    next();
  };
