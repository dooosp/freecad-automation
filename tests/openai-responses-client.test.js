import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';

import {
  createOpenAIResponsesClient,
  DEFAULT_OPENAI_MODEL,
  extractOpenAIResponseText,
} from '../src/services/design/openai-responses-client.js';
import { designFromText } from '../scripts/design-reviewer.js';

assert.throws(
  () => createOpenAIResponsesClient({ apiKey: '' }),
  /OPENAI_API_KEY/,
  'client creation must fail closed without an API key',
);

assert.equal(
  extractOpenAIResponseText({ output_text: 'direct output' }),
  'direct output',
);

const requests = [];
const client = createOpenAIResponsesClient({
  apiKey: 'test-only-key',
  maxOutputTokens: 2_048,
  fetchFn: async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          output: [{
            type: 'message',
            content: [{ type: 'output_text', text: 'mocked design response' }],
          }],
        };
      },
    };
  },
});

assert.equal(requests.length, 0, 'creating a client must not make a billable request');
assert.equal(
  await client.complete({ instructions: 'system rules', input: 'user request' }),
  'mocked design response',
);
assert.equal(requests.length, 1, 'an explicit completion must make exactly one request');
assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
assert.equal(requests[0].options.method, 'POST');
assert.equal(requests[0].options.headers.Authorization, 'Bearer test-only-key');

const requestBody = JSON.parse(requests[0].options.body);
assert.equal(requestBody.model, DEFAULT_OPENAI_MODEL);
assert.equal(requestBody.instructions, 'system rules');
assert.equal(requestBody.input, 'user request');
assert.deepEqual(requestBody.reasoning, { effort: 'low' });
assert.equal(requestBody.max_output_tokens, 2_048);
assert.equal(requestBody.store, false);
assert.equal(requestBody.stream, undefined);

const streamRequests = [];
const streamClient = createOpenAIResponsesClient({
  apiKey: 'test-only-key',
  fetchFn: async (_url, options) => {
    streamRequests.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 200,
      body: Readable.from([
        Buffer.from('event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":"Hel"}\r\n\r\n'),
        Buffer.from('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"lo"}\n\n'),
        Buffer.from('event: response.output_text.done\ndata: {"type":"response.output_text.done","text":"Hello"}\n\n'),
      ]),
    };
  },
});

const streamedChunks = [];
const streamedText = await streamClient.stream({
  instructions: 'stream rules',
  input: 'stream request',
  onChunk(delta, totalLength) {
    streamedChunks.push([delta, totalLength]);
  },
});
assert.equal(streamedText, 'Hello');
assert.deepEqual(streamedChunks, [['Hel', 3], ['lo', 5]]);
assert.equal(streamRequests.length, 1);
assert.equal(streamRequests[0].stream, true);
assert.equal(streamRequests[0].store, false);

const authFailureClient = createOpenAIResponsesClient({
  apiKey: 'test-only-key',
  fetchFn: async () => ({
    ok: false,
    status: 401,
    async json() {
      return { error: { message: 'invalid test credential' } };
    },
  }),
});
await assert.rejects(
  () => authFailureClient.complete({ instructions: 'rules', input: 'request' }),
  /failed \(401\): invalid test credential/,
);

let designCalls = 0;
const invalidDesignClient = {
  async complete() {
    designCalls += 1;
    return `### GENERATED TOML
\`\`\`toml
name = "invalid_without_shapes"
\`\`\`

### DESIGN REPORT
\`\`\`json
{}
\`\`\``;
  },
};
const invalidDesign = await designFromText('a test mechanism', { client: invalidDesignClient });
assert.equal(invalidDesign.toml, null, 'invalid model output must fail closed');
assert.equal(designCalls, 1, 'repair retries must remain disabled by default for cost control');

let repairCalls = 0;
const repairDesignClient = {
  async complete() {
    repairCalls += 1;
    if (repairCalls === 1) {
      return `### GENERATED TOML
\`\`\`toml
name = "invalid_without_shapes"
\`\`\`

### DESIGN REPORT
\`\`\`json
{}
\`\`\``;
    }
    return `### GENERATED TOML
\`\`\`toml
name = "repaired_block"

[[shapes]]
id = "body"
type = "box"
length = 10
width = 10
height = 10
\`\`\`

### DESIGN REPORT
\`\`\`json
{"mechanism_type":"static block"}
\`\`\``;
  },
};
const repairedDesign = await designFromText('a repaired mechanism', {
  client: repairDesignClient,
  allowRepairRetry: true,
});
assert.match(repairedDesign.toml, /name = "repaired_block"/);
assert.equal(repairCalls, 2, 'repair retry must require explicit opt-in and make only one extra call');

const demoScript = readFileSync(new URL('../scripts/retractor-demo.sh', import.meta.url), 'utf8');
assert.match(
  demoScript,
  /OPENAI_DEMO_REVIEW:-.*= "1"/,
  'the demo must require a separate explicit opt-in before making an API call',
);
assert.doesNotMatch(
  demoScript,
  /if \[ -n "\$\{OPENAI_API_KEY/,
  'mere API-key presence must not trigger a demo API call',
);

console.log('openai-responses-client.test.js: ok');
