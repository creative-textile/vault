/**
 * Заглушка middleware/auth для смоук-тестов (tests/smoke.cjs).
 *
 * Настоящий middleware достаёт пользователя из JWT — в тестах «текущий
 * пользователь» задаётся переменной global.__STUB_USER__, чтобы один и тот же
 * запрос можно было выполнить от разных аккаунтов (участник / посторонний).
 */
exports.auth = (req, _res, next) => {
  req.user = global.__STUB_USER__ || { id: 1, role: 'admin', username: 'alice' };
  next();
};

exports.adminOnly = (_req, _res, next) => next();

/**
 * Необязательная авторизация: в тестах ведёт себя как auth — «текущий
 * пользователь» берётся из global.__STUB_USER__ (или остаётся анонимным,
 * если переменная явно выставлена в null).
 */
exports.optionalAuth = (req, _res, next) => {
  req.user = global.__STUB_USER__ === undefined
    ? { id: 1, role: 'admin', username: 'alice' }
    : global.__STUB_USER__;
  next();
};
