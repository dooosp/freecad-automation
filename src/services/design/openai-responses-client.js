const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-sol';
export const DEFAULT_OPENAI_MAX_OUTPUT_TOKENS = 12_000;
export const DEFAULT_OPENAI_TIMEOUT_MS = 120_000;
export const DEFAULT_OPENAI_MAX_REQUESTS = 1;

function boundedInteger(value, fallback, { min, max }) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function createProviderError(status, payload) {
  const providerMessage = typeof payload?.error?.message === 'string'
    ? payload.error.message.slice(0, 300)
    : '';
  const error = new Error(
    `OpenAI Responses API request failed (${status})${providerMessage ? `: ${providerMessage}` : ''}`,
  );
  error.status = status;
  error.retryable = status === 408 || status === 409 || status === 429 || status >= 500;
  return error;
}

async function requestResponse(fetchFn, apiKey, payload, timeoutMs, consume) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      let errorPayload;
      try {
        errorPayload = await response.json();
      } catch {
        errorPayload = null;
      }
      throw createProviderError(response.status, errorPayload);
    }

    return await consume(response);
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`OpenAI Responses API request timed out after ${timeoutMs}ms`);
      timeoutError.retryable = true;
      throw timeoutError;
    }
    if (error && error.retryable === undefined) error.retryable = true;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function extractOpenAIResponseText(response) {
  if (typeof response?.output_text === 'string' && response.output_text) {
    return response.output_text;
  }

  const chunks = [];
  for (const item of response?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join('');
}

function parseSseData(block) {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');

  if (!data || data === '[DONE]') return null;
  try {
    return JSON.parse(data);
  } catch {
    throw new Error('OpenAI Responses API returned an invalid streaming event');
  }
}

async function consumeSse(body, onEvent) {
  if (!body) throw new Error('OpenAI Responses API returned an empty streaming body');

  const decoder = new TextDecoder();
  let buffer = '';

  async function flush({ final = false } = {}) {
    buffer = buffer.replace(/\r\n/g, '\n');
    const blocks = buffer.split('\n\n');
    buffer = final ? '' : blocks.pop();
    for (const block of blocks) {
      const event = parseSseData(block);
      if (event) await onEvent(event);
    }
    if (final && blocks.length === 0 && buffer) {
      const event = parseSseData(buffer);
      if (event) await onEvent(event);
    }
  }

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    await flush();
  }
  buffer += decoder.decode();
  await flush({ final: true });
}

function requestPayload({ model, maxOutputTokens, instructions, input, stream = false }) {
  return {
    model,
    instructions,
    input,
    reasoning: { effort: 'low' },
    max_output_tokens: maxOutputTokens,
    store: false,
    ...(stream ? { stream: true } : {}),
  };
}

export function createOpenAIResponsesClient({
  apiKey,
  model = DEFAULT_OPENAI_MODEL,
  maxOutputTokens = DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
  timeoutMs = DEFAULT_OPENAI_TIMEOUT_MS,
  allowLiveRequests = false,
  maxRequests = DEFAULT_OPENAI_MAX_REQUESTS,
  fetchFn = globalThis.fetch,
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('OPENAI_API_KEY environment variable is required.');
  }
  if (typeof fetchFn !== 'function') {
    throw new Error('A fetch implementation is required for the OpenAI Responses API.');
  }

  const selectedModel = String(model || DEFAULT_OPENAI_MODEL).trim();
  const outputLimit = boundedInteger(maxOutputTokens, DEFAULT_OPENAI_MAX_OUTPUT_TOKENS, {
    min: 1_024,
    max: 32_768,
  });
  const requestTimeout = boundedInteger(timeoutMs, DEFAULT_OPENAI_TIMEOUT_MS, {
    min: 1_000,
    max: 300_000,
  });
  const requestLimit = boundedInteger(maxRequests, DEFAULT_OPENAI_MAX_REQUESTS, {
    min: 1,
    max: DEFAULT_OPENAI_MAX_REQUESTS,
  });
  let requestsStarted = 0;

  function authorizeRequest() {
    if (allowLiveRequests !== true) {
      const error = new Error(
        'OpenAI live request blocked. Use the explicit one-request authorization wrapper.',
      );
      error.code = 'OPENAI_LIVE_REQUEST_NOT_AUTHORIZED';
      error.retryable = false;
      throw error;
    }
    if (requestsStarted >= requestLimit) {
      const error = new Error('OpenAI request limit exceeded for this process.');
      error.code = 'OPENAI_REQUEST_LIMIT_EXCEEDED';
      error.retryable = false;
      throw error;
    }

    // Consume the authorization before fetch so failures cannot reuse the allowance.
    requestsStarted += 1;
  }

  return {
    model: selectedModel,
    maxOutputTokens: outputLimit,
    maxRequests: requestLimit,

    async complete({ instructions, input }) {
      authorizeRequest();
      return requestResponse(
        fetchFn,
        apiKey,
        requestPayload({
          model: selectedModel,
          maxOutputTokens: outputLimit,
          instructions,
          input,
        }),
        requestTimeout,
        async (response) => {
          const payload = await response.json();
          const text = extractOpenAIResponseText(payload);
          if (!text) throw new Error('OpenAI Responses API returned no output text');
          return text;
        },
      );
    },

    async stream({ instructions, input, onChunk }) {
      authorizeRequest();
      return requestResponse(
        fetchFn,
        apiKey,
        requestPayload({
          model: selectedModel,
          maxOutputTokens: outputLimit,
          instructions,
          input,
          stream: true,
        }),
        requestTimeout,
        async (response) => {
          let fullText = '';
          await consumeSse(response.body, async (event) => {
            if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
              fullText += event.delta;
              if (onChunk) await onChunk(event.delta, fullText.length);
              return;
            }

            if (event.type === 'response.output_text.done' && !fullText && typeof event.text === 'string') {
              fullText = event.text;
              if (onChunk) await onChunk(event.text, fullText.length);
              return;
            }

            if (event.type === 'response.completed' && !fullText) {
              fullText = extractOpenAIResponseText(event.response);
              return;
            }

            if (event.type === 'response.failed' || event.type === 'response.incomplete' || event.type === 'error') {
              const message = event.response?.error?.message || event.error?.message || 'stream failed';
              const error = new Error(`OpenAI Responses API ${event.type}: ${String(message).slice(0, 300)}`);
              error.retryable = false;
              throw error;
            }
          });

          if (!fullText) throw new Error('OpenAI Responses API returned no streaming output text');
          return fullText;
        },
      );
    },
  };
}
