import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { LOCAL_API_VERSION } from '../local-api-contract.js';
import {
  canDownloadArtifactContent,
  canServeArtifactContent,
  inferArtifactContentType,
  redactPublicPathValues,
  toArtifactResponse,
  toPublicStorage,
} from '../local-api-artifacts.js';
import { assertResponse, createErrorResponse } from '../local-api-response-helpers.js';

function isPathInside(rootDir, targetPath) {
  const root = resolve(rootDir);
  const target = resolve(targetPath);
  const rel = relative(root, target).replaceAll('\\', '/');
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function allowedArtifactRoots({ projectRoot, jobStore, jobId }) {
  const roots = [jobStore.getJobDir(jobId)];
  if (projectRoot) {
    roots.push(resolve(projectRoot, 'output', 'imports'));
    roots.push(resolve(projectRoot, 'tmp', 'codex', 'stage5b-evidence-audit-jobs', jobId));
  }
  return roots.map((root) => resolve(root));
}

async function resolvePublicArtifactPath({
  artifact,
  projectRoot,
  jobStore,
  jobId,
}) {
  if (!artifact?.path || artifact.exists !== true) {
    return { ok: false, path: null };
  }

  try {
    const resolvedPath = await realpath(resolve(artifact.path));
    const roots = await Promise.all(
      allowedArtifactRoots({ projectRoot, jobStore, jobId }).map(async (root) => {
        try {
          return await realpath(root);
        } catch {
          return resolve(root);
        }
      })
    );
    const allowed = roots.some((root) => isPathInside(root, resolvedPath));
    return {
      ok: allowed,
      path: allowed ? resolvedPath : null,
    };
  } catch {
    return { ok: false, path: null };
  }
}

export function registerArtifactRoutes(app, { jobStore, projectRoot = null }) {
  app.get('/jobs/:id/artifacts', async (req, res) => {
    try {
      const job = await jobStore.getJob(req.params.id);
      const rawArtifacts = await jobStore.listArtifacts(req.params.id);
      const publicAccess = await Promise.all(rawArtifacts.map((artifact) =>
        resolvePublicArtifactPath({
          artifact,
          projectRoot,
          jobStore,
          jobId: req.params.id,
        })
      ));
      const artifacts = rawArtifacts.map((artifact, index) =>
        toArtifactResponse(req.params.id, artifact, { publicPathAllowed: publicAccess[index].ok })
      );
      const storage = toPublicStorage(await jobStore.describeStorage(req.params.id));
      const payload = {
        api_version: LOCAL_API_VERSION,
        ok: true,
        job_id: req.params.id,
        artifacts,
        manifest: redactPublicPathValues(job.manifest),
        storage,
      };
      res.json(assertResponse('artifacts', payload));
    } catch {
      const response = createErrorResponse('job_not_found', [`No job found for id ${req.params.id}.`], 404);
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  async function sendArtifactContent({ jobId, artifactId, download = false }, res) {
    try {
      await jobStore.getJob(jobId);
      const artifact = await jobStore.getArtifact(jobId, artifactId);
      if (!artifact) {
        const response = createErrorResponse(
          'artifact_not_found',
          [`No artifact ${artifactId} found for job ${jobId}.`],
          404
        );
        res.status(response.status).json(assertResponse('error', response.body));
        return;
      }
      if (!artifact.exists) {
        const response = createErrorResponse(
          'artifact_missing',
          [`Artifact ${artifact.file_name} is registered for job ${jobId}, but the file is missing.`],
          404
        );
        res.status(response.status).json(assertResponse('error', response.body));
        return;
      }
      const publicAccess = await resolvePublicArtifactPath({
        artifact,
        projectRoot,
        jobStore,
        jobId,
      });
      const contentAllowed = download
        ? canDownloadArtifactContent(artifact, { publicPathAllowed: publicAccess.ok })
        : canServeArtifactContent(artifact, { publicPathAllowed: publicAccess.ok });
      if (!contentAllowed) {
        const code = artifact.scope === 'user-facing' && publicAccess.ok
          ? 'artifact_content_not_inline_safe'
          : 'artifact_content_not_public';
        const message = artifact.scope === 'user-facing' && publicAccess.ok
          ? `Artifact ${artifact.file_name} is not available for inline browser preview; use the download route instead.`
          : `Artifact ${artifact.file_name} is not available through browser open or download routes.`;
        const response = createErrorResponse(
          code,
          [message],
          403
        );
        res.status(response.status).json(assertResponse('error', response.body));
        return;
      }

      res.type(inferArtifactContentType(artifact.path));
      res.setHeader(
        'Content-Disposition',
        `${download ? 'attachment' : 'inline'}; filename="${artifact.file_name.replaceAll('"', '')}"`
      );
      res.send(await readFile(publicAccess.path));
    } catch {
      const response = createErrorResponse('job_not_found', [`No job found for id ${jobId}.`], 404);
      res.status(response.status).json(assertResponse('error', response.body));
    }
  }

  app.get('/jobs/:id/artifacts/:artifactId/content', async (req, res) => {
    await sendArtifactContent({
      jobId: req.params.id,
      artifactId: req.params.artifactId,
      download: req.query.download === '1',
    }, res);
  });

  app.get('/artifacts/:jobId/:artifactId', async (req, res) => {
    await sendArtifactContent({
      jobId: req.params.jobId,
      artifactId: req.params.artifactId,
      download: false,
    }, res);
  });

  app.get('/artifacts/:jobId/:artifactId/download', async (req, res) => {
    await sendArtifactContent({
      jobId: req.params.jobId,
      artifactId: req.params.artifactId,
      download: true,
    }, res);
  });
}
