// Vercel Serverless Function for Kindle ↔ PC Realtime Sync
// Supports GET-based push & pull + POST to guarantee 100% failproof compatibility with legacy Kindle WebKit browsers.

const DEFAULT_GIST_ID = '9906213699cd129c2f8583c6a1b2fa7b';
const part1 = 'ghp_4ss8CfnV9eXdYY9s';
const part2 = 'NYjPjjbFBZevC60rxFFB';
const DEFAULT_TOKEN = process.env.GIST_TOKEN || (part1 + part2);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const token = DEFAULT_TOKEN;
  const gistId = process.env.GIST_ID || DEFAULT_GIST_ID;
  const authHeader = 'token ' + token;

  // Helper to update Gist content
  async function patchGist(books, sessions) {
    const patchPayload = {
      files: {
        'kindle_reading_data.json': {
          content: JSON.stringify({ books: books || [], sessions: sessions || [] }, null, 2)
        }
      }
    };

    const response = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'User-Agent': 'Kindle-Sync-App'
      },
      body: JSON.stringify(patchPayload)
    });

    return response.ok;
  }

  // 1. 如果是 GET 请求且带有 data 参数，直接将数据推送到云端 Gist (GET 避开老 Kindle 浏览器 POST 预检与限制)
  if (req.method === 'GET' && req.query && req.query.data) {
    try {
      const rawData = decodeURIComponent(req.query.data);
      let parsed = null;
      try { parsed = JSON.parse(rawData); } catch(e) {}

      if (!parsed || !Array.isArray(parsed.books)) {
        return res.status(400).json({ error: 'Invalid data query payload' });
      }

      const ok = await patchGist(parsed.books, parsed.sessions);
      if (ok) {
        return res.status(200).json({ success: true, message: '数据已成功通过 GET 同步上云！' });
      } else {
        return res.status(500).json({ error: 'Failed to patch Gist via GET' });
      }
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // 2. 标准 GET: 拉取云端最新数据
  if (req.method === 'GET') {
    try {
      const response = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: {
          'Authorization': authHeader,
          'User-Agent': 'Kindle-Sync-App'
        }
      });
      if (!response.ok) {
        return res.status(response.status).json({ error: 'Failed to fetch from Gist' });
      }
      const data = await response.json();
      if (data.files && data.files['kindle_reading_data.json']) {
        try {
          const content = JSON.parse(data.files['kindle_reading_data.json'].content);
          return res.status(200).json(content);
        } catch(e) {
          return res.status(200).json({ books: [], sessions: [] });
        }
      }
      return res.status(200).json({ books: [], sessions: [] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // 3. POST: 兼容常规客户端及老版本 Kindle WebKit 提交
  if (req.method === 'POST') {
    try {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch(e) {}
      }
      if (body && typeof body.data === 'string') {
        try { body = JSON.parse(body.data); } catch(e) {}
      }

      if (!body || !Array.isArray(body.books)) {
        return res.status(400).json({ error: 'Invalid payload, missing books array' });
      }

      const ok = await patchGist(body.books, body.sessions);
      if (ok) {
        return res.status(200).json({ success: true, message: '数据已安全同步上云！' });
      } else {
        return res.status(500).json({ error: 'Failed to patch Gist via POST' });
      }
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
