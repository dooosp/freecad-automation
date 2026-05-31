import { LOCAL_API_VERSION } from './local-api-contract.js';
import { validateLocalApiResponse } from './local-api-schemas.js';

const MAX_ERROR_MESSAGE_LENGTH = 240;

function normalizeErrorMessage(value) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!text) return 'Request failed.';
  if (text.length <= MAX_ERROR_MESSAGE_LENGTH) return text;
  return `${text.slice(0, MAX_ERROR_MESSAGE_LENGTH)}... [${text.length} chars]`;
}

function normalizeErrorMessages(messages) {
  const values = Array.isArray(messages) ? messages : [messages];
  const normalized = values
    .map((entry) => normalizeErrorMessage(entry))
    .filter(Boolean);
  return normalized.length > 0 ? normalized : ['Request failed.'];
}

export function createErrorResponse(code, messages, status = 400) {
  return {
    status,
    body: {
      api_version: LOCAL_API_VERSION,
      ok: false,
      error: {
        code: normalizeErrorMessage(code),
        messages: normalizeErrorMessages(messages),
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
    if (error?.type === 'entity.too.large' || error?.status === 413 || error?.statusCode === 413) {
      const response = createErrorResponse('request_too_large', ['Request body exceeds the local API JSON limit.'], 413);
      res.status(response.status).json(assertResponse('error', response.body));
      return;
    }
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
