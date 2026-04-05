import { LOCAL_API_VERSION } from './local-api-contract.js';
import { validateLocalApiResponse } from './local-api-schemas.js';

export function createErrorResponse(code, messages, status = 400) {
  return {
    status,
    body: {
      api_version: LOCAL_API_VERSION,
      ok: false,
      error: {
        code,
        messages,
      },
    },
  };
}

export function assertResponse(kind, payload) {
  const validation = validateLocalApiResponse(kind, payload);
  if (!validation.ok) {
    throw new Error(`Invalid ${kind} response: ${validation.errors.join(' | ')}`);
  }
  return payload;
}

export function createInvalidJsonMiddleware() {
  return function invalidJsonMiddleware(error, _req, res, next) {
    if (error instanceof SyntaxError && 'body' in error) {
      const response = createErrorResponse('invalid_json', ['Request body must be valid JSON.']);
      res.status(response.status).json(assertResponse('error', response.body));
      return;
    }
    next(error);
  };
}

export function createInternalErrorMiddleware() {
  return function internalErrorMiddleware(error, _req, res, _next) {
    const response = createErrorResponse(
      'internal_error',
      [error instanceof Error ? error.message : String(error)],
      500
    );
    res.status(response.status).json(assertResponse('error', response.body));
  };
}
