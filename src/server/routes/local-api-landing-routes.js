import express from 'express';
import { readFile } from 'node:fs/promises';
import { buildLandingPayload, sendLandingResponse } from '../local-api-landing.js';
import {
  LOCAL_API_STATIC_ASSET_REGISTRY,
  LOCAL_API_STATIC_FILE_OPTIONS,
} from '../local-api-static-assets.js';

export function registerLandingRoutes(app, {
  projectRoot,
  jobsDir,
}) {
  app.use(
    '/js/app',
    express.static(LOCAL_API_STATIC_ASSET_REGISTRY.app_js_dir, {
      index: false,
      ...LOCAL_API_STATIC_FILE_OPTIONS,
    })
  );
  app.use(
    '/js/i18n',
    express.static(LOCAL_API_STATIC_ASSET_REGISTRY.i18n_js_dir, {
      index: false,
      ...LOCAL_API_STATIC_FILE_OPTIONS,
    })
  );
  app.use(
    '/js/studio',
    express.static(LOCAL_API_STATIC_ASSET_REGISTRY.studio_js_dir, {
      index: false,
      ...LOCAL_API_STATIC_FILE_OPTIONS,
    })
  );

  app.get(['/api', '/api/'], (req, res) => {
    const payload = buildLandingPayload({ projectRoot, jobsDir });
    sendLandingResponse(req, res, payload);
  });

  app.get('/', (req, res) => {
    const payload = buildLandingPayload({ projectRoot, jobsDir });
    const accepted = req.accepts(['html', 'json', 'text']);
    if (accepted === 'html') {
      res.redirect(302, '/studio/');
      return;
    }
    sendLandingResponse(req, res, payload);
  });

  app.get(['/studio', '/studio/'], async (_req, res, next) => {
    try {
      res.type('html').send(await readFile(LOCAL_API_STATIC_ASSET_REGISTRY.studio_html));
    } catch (error) {
      next(error);
    }
  });

  app.get('/css/studio.css', async (_req, res, next) => {
    try {
      res.type('text/css').send(await readFile(LOCAL_API_STATIC_ASSET_REGISTRY.studio_css));
    } catch (error) {
      next(error);
    }
  });

  app.get('/js/studio-shell.js', async (_req, res, next) => {
    try {
      res.type('application/javascript').send(await readFile(LOCAL_API_STATIC_ASSET_REGISTRY.studio_shell_js));
    } catch (error) {
      next(error);
    }
  });
}
