import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LOCAL_API_VERSION } from '../local-api-contract.js';
import {
  inferArtifactContentType,
  redactPublicPathValues,
  toArtifactResponse,
  toPublicStorage,
} from '../local-api-artifacts.js';
import { assertResponse, createErrorResponse } from '../local-api-response-helpers.js';

export function registerArtifactRoutes(app, { jobStore }) {
  app.get('/jobs/:id/artifacts', async (req, res) => {
    try {
      const job = await jobStore.getJob(req.params.id);
      const artifacts = (await jobStore.listArtifacts(req.params.id)).map((artifact) =>
        toArtifactResponse(req.params.id, artifact)
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

      res.type(inferArtifactContentType(artifact.path));
      res.setHeader(
        'Content-Disposition',
        `${download ? 'attachment' : 'inline'}; filename="${artifact.file_name.replaceAll('"', '')}"`
      );
      res.send(await readFile(resolve(artifact.path)));
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
