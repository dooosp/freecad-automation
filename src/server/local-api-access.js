import { assertResponse, createErrorResponse } from './local-api-response-helpers.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

// Binding to loopback alone does not validate the authority used by a browser
// after DNS resolution. Check it before parsing bodies or dispatching work.
export function createLocalApiAccessMiddleware(server) {
  return function localApiAccess(req, res, next) {
    let authority;
    try {
      const host = req.headers.host;
      if (typeof host !== 'string') throw new Error('Missing Host');
      authority = new URL(`http://${host}`);
      const port = Number(authority.port || 80);
      if (!LOOPBACK_HOSTS.has(authority.hostname)
        || authority.host.toLowerCase() !== host.toLowerCase()
        || port !== server.address()?.port) throw new Error('Invalid Host');
    } catch {
      const response = createErrorResponse('untrusted_host', ['Use the local API through its loopback address and listening port.'], 403);
      res.status(response.status).json(assertResponse('error', response.body));
      return;
    }

    if (req.headers.origin !== undefined && req.headers.origin !== authority.origin) {
      const response = createErrorResponse('untrusted_origin', ['Open Studio on the same local API address before sending browser requests.'], 403);
      res.status(response.status).json(assertResponse('error', response.body));
      return;
    }
    next();
  };
}
