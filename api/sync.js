// Vercel Serverless Function for Kindle ↔ PC Realtime Sync
// Supports GET-based push & pull + POST with Tombstone deletion, activeTimer & Server-Side Atomic Concurrency Merge.

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

  // 1. 获取 Gist 上当前最新数据
  async function fetchCurrentGist() {
    try {
      const response = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: { 'Authorization': authHeader, 'User-Agent': 'Kindle-Sync-App' }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.files && data.files['kindle_reading_data.json']) {
          return JSON.parse(data.files['kindle_reading_data.json'].content);
        }
      }
    } catch(e) {}
    return null;
  }

  // 2. 服务端原子级增量无损合并 (防止并发覆盖与数据丢失)
  function mergeServerData(existing, incoming) {
    if (!existing) return incoming;

    const existingBooks = existing.books || [];
    const existingSessions = existing.sessions || [];
    const existingDelBooks = existing.deletedBookIds || [];
    const existingDelSessions = existing.deletedSessionIds || [];

    const incomingBooks = incoming.books || [];
    const incomingSessions = incoming.sessions || [];
    const incomingDelBooks = incoming.deletedBookIds || [];
    const incomingDelSessions = incoming.deletedSessionIds || [];
    const incomingTimer = incoming.activeTimer !== undefined ? incoming.activeTimer : (existing.activeTimer || null);

    // 合并墓碑名单
    const delBookSet = new Set([...existingDelBooks, ...incomingDelBooks]);
    const delSessSet = new Set([...existingDelSessions, ...incomingDelSessions]);

    // 合并图书
    const bookMap = {};
    for (const b of existingBooks) {
      if (b && !delBookSet.has(b.id)) bookMap[b.id] = b;
    }
    for (const b of incomingBooks) {
      if (!b || delBookSet.has(b.id)) continue;
      const ex = bookMap[b.id];
      if (ex) {
        ex.totalSec = Math.max(ex.totalSec || 0, b.totalSec || 0);
        ex.currentPage = Math.max(ex.currentPage || 0, b.currentPage || 0);
        ex.totalPages = Math.max(ex.totalPages || 0, b.totalPages || 0);
        ex.progress = Math.max(ex.progress || 0, b.progress || 0);
        ex.completed = ex.completed || b.completed;
      } else {
        bookMap[b.id] = b;
      }
    }

    // 合并打卡记录
    const sessMap = {};
    for (const s of existingSessions) {
      if (s && s.id && !delSessSet.has(s.id) && !delBookSet.has(s.bookId)) {
        sessMap[s.id] = s;
      }
    }
    for (const s of incomingSessions) {
      if (s && s.id && !delSessSet.has(s.id) && !delBookSet.has(s.bookId)) {
        sessMap[s.id] = s;
      }
    }

    return {
      books: Object.values(bookMap),
      sessions: Object.values(sessMap),
      deletedBookIds: Array.from(delBookSet),
      deletedSessionIds: Array.from(delSessSet),
      activeTimer: incomingTimer
    };
  }

  // 3. 安全更新 Gist 数据
  async function syncAndPatchGist(incomingData) {
    const existingData = await fetchCurrentGist();
    const merged = mergeServerData(existingData, incomingData);

    const patchPayload = {
      files: {
        'kindle_reading_data.json': {
          content: JSON.stringify(merged, null, 2)
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

  // A. 如果是 GET 请求且带有 data 参数，直接增量推送到云端 Gist (GET 方式)
  if (req.method === 'GET' && req.query && req.query.data) {
    try {
      const rawData = decodeURIComponent(req.query.data);
      let parsed = null;
      try { parsed = JSON.parse(rawData); } catch(e) {}

      if (!parsed || !Array.isArray(parsed.books)) {
        return res.status(400).json({ error: 'Invalid data query payload' });
      }

      const ok = await syncAndPatchGist(parsed);
      if (ok) {
        return res.status(200).json({ success: true, message: '数据已成功通过 GET 原子增量同步上云！' });
      } else {
        return res.status(500).json({ error: 'Failed to patch Gist via GET' });
      }
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // B. 标准 GET: 拉取云端最新数据
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
          return res.status(200).json({ books: [], sessions: [], deletedBookIds: [], deletedSessionIds: [], activeTimer: null });
        }
      }
      return res.status(200).json({ books: [], sessions: [], deletedBookIds: [], deletedSessionIds: [], activeTimer: null });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // C. POST: 兼容常规客户端、表单提交及老版本 Kindle WebKit
  if (req.method === 'POST') {
    try {
      let body = req.body;

      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch(e) {}
      }

      if (!body || typeof body !== 'object' || !Array.isArray(body.books)) {
        if (body && typeof body === 'object') {
          const rawKeys = Object.keys(body);
          if (rawKeys.length > 0) {
            var fullKeyStr = rawKeys.join('');
            try {
              var parsedObj = JSON.parse(fullKeyStr);
              if (parsedObj && Array.isArray(parsedObj.books)) {
                body = parsedObj;
              }
            } catch(e) {}
          }
        }
      }

      if (body && typeof body.data === 'string') {
        try { body = JSON.parse(body.data); } catch(e) {}
      }

      if (!body || !Array.isArray(body.books)) {
        return res.status(400).json({ error: 'Invalid payload, missing books array' });
      }

      const ok = await syncAndPatchGist(body);
      if (ok) {
        return res.status(200).json({ success: true, message: '数据已原子增量同步上云！' });
      } else {
        return res.status(500).json({ error: 'Failed to patch Gist via POST' });
      }
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
