import { assertResponse, createErrorResponse } from './local-api-response-helpers.js';

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

// Accept only authorities served by this listener, before parsing any request body.
export function createLocalApiAccessMiddleware(server) {
  return function localApiAccess(req, res, next) {
    const port = server.address()?.port;
    const host = req.headers.host?.toLowerCase();
    const hostname = Number.isInteger(port) && LOOPBACK_HOSTS.find((name) =>
      host === `${name}:${port}` || (port === 80 && host === name)
    );
    if (!hostname) {
      const response = createErrorResponse('untrusted_host', ['Use the local API through its loopback address and listening port.'], 403);
      res.status(response.status).json(assertResponse('error', response.body));
      return;
    }

    const origin = port === 80 ? `http://${hostname}` : `http://${hostname}:${port}`;
    if (req.headers.origin !== undefined && req.headers.origin !== origin) {
      const response = createErrorResponse('untrusted_origin', ['Open Studio on the same local API address before sending browser requests.'], 403);
      res.status(response.status).json(assertResponse('error', response.body));
      return;
    }
    next();
  };
}
