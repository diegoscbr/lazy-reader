import http from 'node:http';

const HOST = '127.0.0.1';
const PORT = Number(process.env.LAZY_READER_PROXY_PORT || 8787);
const API_BASE = 'https://api.elevenlabs.io';

function formatKeyFingerprint(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') {
    return 'none';
  }
  if (apiKey.length <= 10) {
    return apiKey;
  }
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`;
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, xi-api-key');
}

function sendJson(res, status, payload) {
  setCorsHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function pickForwardHeaders(req) {
  const apiKey = req.headers['xi-api-key'];
  const headers = {};

  if (typeof apiKey === 'string' && apiKey) {
    headers['xi-api-key'] = apiKey;
  }
  if (typeof req.headers.accept === 'string' && req.headers.accept) {
    headers.Accept = req.headers.accept;
  }
  if (typeof req.headers['content-type'] === 'string' && req.headers['content-type']) {
    headers['Content-Type'] = req.headers['content-type'];
  }

  return headers;
}

async function handleProxy(req, res) {
  setCorsHeaders(res);
  const keyFingerprint = formatKeyFingerprint(req.headers['xi-api-key']);
  console.log(`[proxy] ${req.method} ${req.url} key=${keyFingerprint}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const path = url.pathname;

  if (req.method === 'GET' && path === '/v1/voices') {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'GET',
      headers: pickForwardHeaders(req),
    });
    const body = await response.text();
    console.log(`[proxy] -> ${response.status} ${path}`);
    res.writeHead(response.status, {
      'Content-Type': response.headers.get('content-type') || 'application/json',
    });
    res.end(body);
    return;
  }

  if (req.method === 'POST' && path.startsWith('/v1/text-to-speech/')) {
    const body = await readRequestBody(req);
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: pickForwardHeaders(req),
      body,
    });
    const arrayBuffer = await response.arrayBuffer();
    console.log(`[proxy] -> ${response.status} ${path}`);
    res.writeHead(response.status, {
      'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
    });
    res.end(Buffer.from(arrayBuffer));
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  handleProxy(req, res).catch((error) => {
    console.error('Lazy Reader ElevenLabs proxy error:', error);
    sendJson(res, 500, { error: 'Proxy request failed' });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Lazy Reader ElevenLabs proxy listening on http://${HOST}:${PORT}`);
});
