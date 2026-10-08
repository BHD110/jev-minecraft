import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { express } from '../viewer-server.mjs';
import { createJevCredentials, installJevKeyEndpoint } from '../jev-credentials.mjs';

const key = 'apikey_' + 'a'.repeat(24);
const otherKey = 'apikey_' + 'b'.repeat(24);
const createClient = (apiKey) => ({ apiKey });

test('未配置和无效环境配置都允许无密钥启动', () => {
  for (const initialKey of [undefined, '', 'invalid', 'apikey_your_key_here']) {
    const credentials = createJevCredentials({ initialKey, createClient });
    assert.equal(credentials.configured, false);
    assert.equal(credentials.client, null);
  }
});

test('运行时启用与更换密钥，错误输入保留原客户端，错误信息隐藏密钥', () => {
  const credentials = createJevCredentials({ initialKey: key, createClient });
  assert.equal(credentials.configured, true);
  assert.equal(credentials.client.apiKey, key);
  credentials.configure(` ${otherKey} `);
  assert.equal(credentials.client.apiKey, otherKey);
  for (const value of [null, 42, {}, '', 'bad', 'apikey_' + 'x'.repeat(501)]) {
    assert.throws(() => credentials.configure(value));
    assert.equal(credentials.client.apiKey, otherKey);
  }
  assert.equal(credentials.redact(`problem: ${otherKey}`), 'problem: [密钥已隐藏]');
});

test('密钥接口不回传密钥，拒绝跨站、非 JSON、忙碌时更换和非法格式', async (t) => {
  const app = express();
  app.use(express.json({ limit: '10kb' }));
  const credentials = createJevCredentials({ createClient });
  let busy = false;
  const server = app.listen(0, '127.0.0.1');
  t.after(() => { server.closeAllConnections(); server.close(); });
  await once(server, 'listening');
  const port = server.address().port;
  installJevKeyEndpoint(app, { credentials, port, isBusy: () => busy });
  const url = `http://127.0.0.1:${port}/api/config/jev`;
  const post = (value, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ apiKey: value }) });
  const crossSite = await post(key, { Origin: 'https://example.com' });
  assert.equal(crossSite.status, 403);
  assert.equal(credentials.configured, false);
  assert.equal((await post(key, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post(key, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('invalid')).status, 400);
  const enabled = await post(key, { Origin: `http://127.0.0.1:${port}` });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.headers.get('cache-control'), 'no-store');
  assert.equal((await enabled.text()).includes(key), false);
  assert.equal(credentials.client.apiKey, key);
  busy = true;
  assert.equal((await post(otherKey)).status, 409);
  assert.equal(credentials.client.apiKey, key);
  busy = false;
  assert.equal((await post(otherKey, { Origin: `http://localhost:${port}` })).status, 200);
  assert.equal(credentials.client.apiKey, otherKey);
});
