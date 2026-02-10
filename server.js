import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { readdir, readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseTOML } from 'smol-toml';
import { runScript } from './lib/runner.js';
import { designFromTextStreaming } from './scripts/design-reviewer.js';

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
      } else if (msg.action === 'design') {
        await handleDesign(ws, msg.description);
      } else if (msg.action === 'draw') {
        await handleDraw(ws, msg.config);
      }
    });
  });

  async function handleDesign(ws, description) {
    if (!description || !description.trim()) {
      return sendJSON(ws, { type: 'error', message: 'Description is required' });
    }
    if (ws._building) {
      return sendJSON(ws, { type: 'error', message: 'Build already in progress' });
    }

    try {
      sendJSON(ws, { type: 'progress', text: 'Generating design with Gemini...' });

      let lastSendTime = 0;
      const result = await designFromTextStreaming(description.trim(), (delta, totalChars) => {
        if (ws.readyState !== ws.OPEN) return;
        const now = Date.now();
        if (now - lastSendTime >= 400) {
          lastSendTime = now;
          const kChars = (totalChars / 1000).toFixed(1);
          sendJSON(ws, {
            type: 'stream_chunk',
            chars: totalChars,
            text: `Generating design... ${kChars}k chars`,
          });
        }
      });

      if (!result.toml) {
        return sendJSON(ws, { type: 'error', message: 'Failed to generate valid TOML from description' });
      }

      // Send design result (TOML + report) to frontend
      sendJSON(ws, { type: 'design_result', toml: result.toml, report: result.report });

      // Automatically build the generated TOML
      await handleBuild(ws, result.toml);
    } catch (err) {
      const msg = err.message.includes('GEMINI_API_KEY')
        ? 'GEMINI_API_KEY not set. Add it to .env or export it.'
        : err.message;
      sendJSON(ws, { type: 'error', message: msg });
    }
  }

  async function handleDraw(ws, tomlStr) {
    if (!tomlStr) {
      return sendJSON(ws, { type: 'error', message: 'TOML config is required for drawing' });
    }
    if (ws._building) {
      return sendJSON(ws, { type: 'error', message: 'Build already in progress' });
    }
    ws._building = true;
    let tmpDir = null;

    try {
      sendJSON(ws, { type: 'progress', text: 'Parsing TOML for drawing...' });

      let config;
      try {
        config = parseTOML(tomlStr);
      } catch (e) {
        return sendJSON(ws, { type: 'error', message: `TOML parse error: ${e.message}` });
      }

      // Create temp dir for SVG output
      tmpDir = await mkdtemp(join(tmpdir(), 'drawing-'));
      config.export = { formats: [], directory: tmpDir };

      // Ensure drawing config defaults
      config.drawing = config.drawing || {};
      if (!config.drawing.views) {
        config.drawing.views = ['front', 'top', 'right', 'iso'];
      }
      config.drawing.bom_csv = true;

      sendJSON(ws, { type: 'progress', text: 'Generating engineering drawing...' });

      const result = await runScript('generate_drawing.py', config, {
        timeout: 180_000,
        onStderr: (text) => {
          if (ws.readyState === ws.OPEN) {
            sendJSON(ws, { type: 'progress', text: text.trim() });
          }
        },
      });

      if (!result.success) {
        return sendJSON(ws, { type: 'error', message: result.error || 'Drawing generation failed' });
      }

      // Read SVG content and send to client
      let svgContent = null;
      const svgExport = (result.drawing_paths || []).find(p => p.format === 'svg');
      if (svgExport) {
        const svgFilename = svgExport.path.replace(/\\/g, '/').split('/').pop();
        svgContent = await readFile(join(tmpDir, svgFilename), 'utf8');
      }

      sendJSON(ws, {
        type: 'drawing_result',
        svg: svgContent,
        bom: result.bom || [],
        views: result.views || [],
        scale: result.scale || '1:1',
      });

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
      const isAssembly = !!config.parts && !!config.assembly;
      config.export = {
        formats: ['stl'],
        directory: tmpDir,
        ...(isAssembly && { per_part_stl: true }),
      };

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

      // Send STL data
      const partFiles = result.assembly?.part_files;
      if (partFiles && partFiles.length > 0) {
        // Assembly mode: send parts manifest then each part STL
        const manifest = partFiles.map((pf, i) => ({
          id: pf.id,
          label: pf.label,
          index: i,
          size_bytes: pf.size_bytes,
          material: pf.material || null,
        }));
        sendJSON(ws, { type: 'parts_manifest', parts: manifest });

        for (const pf of partFiles) {
          // path may be Windows (\) or Unix (/) — extract filename from either
          const filename = pf.path.replace(/\\/g, '/').split('/').pop();
          const stlData = await readFile(join(tmpDir, filename));
          if (ws.readyState === ws.OPEN) {
            ws.send(stlData);
          }
        }
      } else {
        // Single-part (legacy): send one STL
        const stlExport = (result.exports || []).find(e => e.format === 'stl');
        if (stlExport) {
          const files = await readdir(tmpDir);
          const stlFile = files.find(f => f.endsWith('.stl'));
          if (stlFile) {
            const stlData = await readFile(join(tmpDir, stlFile));
            if (ws.readyState === ws.OPEN) {
              ws.send(stlData);
            }
          }
        }
      }

      // Send motion data (if kinematic simulation present)
      if (result.motion_data) {
        sendJSON(ws, { type: 'motion_data', ...result.motion_data });
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
