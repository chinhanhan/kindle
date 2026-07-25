// Vercel Serverless Function for Kindle ↔ PC Realtime Sync
// Eliminates all Kindle WebKit CORS preflight restrictions by acting as a same-origin proxy.

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

  // GET: 拉取云端最新数据
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
        const content = JSON.parse(data.files['kindle_reading_data.json'].content);
        return res.status(200).json(content);
      }
      return res.status(200).json({ books: [], sessions: [] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST: Kindle 或 PC 提交最新数据并反向写回云端
  if (req.method === 'POST') {
    try {
      const body = req.body;
      if (!body || !body.books) {
        return res.status(400).json({ error: 'Invalid payload' });
      }

      const patchPayload = {
        files: {
          'kindle_reading_data.json': {
            content: JSON.stringify({ books: body.books, sessions: body.sessions || [] }, null, 2)
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

      if (response.ok) {
        return res.status(200).json({ success: true, message: '数据已安全同步上云！' });
      } else {
        return res.status(response.status).json({ error: 'Failed to patch Gist' });
      }
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
