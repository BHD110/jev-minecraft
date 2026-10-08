const KEY_PATTERN = /^apikey_[A-Za-z0-9_-]{8,500}$/;

export function createJevCredentials({ initialKey, createClient }) {
  let client = null;
  let activeKey = '';
  function configure(value) {
    const key = typeof value === 'string' ? value.trim() : '';
    if (!KEY_PATTERN.test(key) || /your_key_here/i.test(key)) {
      throw new Error('请输入有效格式的官方 Jev 密钥，以 apikey_ 开头。');
    }
    const nextClient = createClient(key);
    activeKey = key;
    client = nextClient;
  }
  if (initialKey) {
    try { configure(initialKey); } catch { /* 无有效配置时由页面提示输入。 */ }
  }
  return {
    get configured() { return client !== null; },
    get client() { return client; },
    configure,
    redact(value) { return activeKey ? String(value).split(activeKey).join('[密钥已隐藏]') : String(value); },
  };
}

export function installJevKeyEndpoint(app, { credentials, port, isBusy }) {
  app.post('/api/config/jev', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const address = req.socket.remoteAddress;
    const allowedOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`];
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) ||
        (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) ||
        req.headers['sec-fetch-site'] === 'cross-site') {
      res.status(403).json({ error: '请在本机项目页面配置密钥。' }); return;
    }
    if (!req.is('application/json')) {
      res.status(415).json({ error: '请使用页面中的密钥输入窗口。' }); return;
    }
    if (isBusy()) {
      res.status(409).json({ error: '请暂停演示并等待当前动作结束，再修改密钥。' }); return;
    }
    try {
      credentials.configure(req.body?.apiKey);
      res.json({ configured: true, message: '密钥已启用，仅保存在当前服务内存中。' });
    } catch {
      res.status(400).json({ error: '请输入有效格式的官方 Jev 密钥，以 apikey_ 开头。' });
    }
  });
}
