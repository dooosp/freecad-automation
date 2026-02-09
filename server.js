import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { readdir, readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseTOML } from 'smol-toml';
import { runScript } from './lib/runner.js';

const PUBLIC_DIR = join(import.meta.dirname, 'public');
const EXAMPLES_DIR = join(import.meta.dirname, 'configs', 'examples');

export function startServer(port = 3000) {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  app.use(express.static(PUBLIC_DIR));

  // List example configs
  app.get('/api/examples', async (_req, res) => {
    try {
      const files = await readdir(EXAMPLES_DIR);
      const examples = [];
      for (const f of files.filter(f => f.endsWith('.toml'))) {
        const content = await readFile(join(EXAMPLES_DIR, f), 'utf8');
        examples.push({ name: f, content });
      }
      res.json(examples);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  wss.on('connection', (ws) => {
    ws._building = false;

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return sendJSON(ws, { type: 'error', message: 'Invalid JSON' });
      }

      if (msg.action === 'build') {
        await handleBuild(ws, msg.config);
      }
    });
  });

  async function handleBuild(ws, tomlStr) {
    if (ws._building) {
      return sendJSON(ws, { type: 'error', message: 'Build already in progress' });
    }
    ws._building = true;
    let tmpDir = null;

    try {
      sendJSON(ws, { type: 'progress', text: 'Parsing TOML...' });

      let config;
      try {
        config = parseTOML(tomlStr);
      } catch (e) {
        return sendJSON(ws, { type: 'error', message: `TOML parse error: ${e.message}` });
      }

      // Create temp dir for STL output
      tmpDir = await mkdtemp(join(tmpdir(), 'viewer-'));
      config.export = { formats: ['stl'], directory: tmpDir };

      const hasFem = !!config.fem;
      const script = hasFem ? 'fem_analysis.py' : 'create_model.py';

      sendJSON(ws, { type: 'progress', text: `Running ${script}...` });

      const result = await runScript(script, config, {
        timeout: 300_000,
        onStderr: (text) => {
          if (ws.readyState === ws.OPEN) {
            sendJSON(ws, { type: 'progress', text: text.trim() });
          }
        },
      });

      if (!result.success) {
        return sendJSON(ws, { type: 'error', message: result.error || 'Build failed' });
      }

      // Send metadata
      sendJSON(ws, {
        type: 'metadata',
        model: result.model || null,
        fem: result.fem || null,
        exports: result.exports || [],
      });

      // Find and send STL file
      const stlExport = (result.exports || []).find(e => e.format === 'stl');
      if (stlExport) {
        // Read STL from WSL temp path (not the Windows path in result)
        const files = await readdir(tmpDir);
        const stlFile = files.find(f => f.endsWith('.stl'));
        if (stlFile) {
          const stlData = await readFile(join(tmpDir, stlFile));
          if (ws.readyState === ws.OPEN) {
            ws.send(stlData);
          }
        }
      }

      sendJSON(ws, { type: 'complete' });
    } catch (err) {
      sendJSON(ws, { type: 'error', message: err.message });
    } finally {
      ws._building = false;
      if (tmpDir) {
        rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  function sendJSON(ws, obj) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  server.listen(port, () => {
    console.log(`FreeCAD Viewer: http://localhost:${port}`);
  });

  return server;
}

// Direct execution
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const port = parseInt(process.argv[2]) || 3000;
  startServer(port);
}
