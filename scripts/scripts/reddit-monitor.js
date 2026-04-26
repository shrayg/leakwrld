// Reddit Post Monitor — runs locally, scans Reddit every 10 minutes
// Posts notifications to Discord webhook when preset videos are found
// Usage: node scripts/reddit-monitor.js

const https = require('https');

const WEBHOOK_URL = 'https://discord.com/api/webhooks/1492362757691936868/J3wYROtmRvOlEnljUu74LxtecA4cwU4FTBD-ytMG_kxuSYKtGOWdsYL3jvfZTzM1T9h-';

const SEARCH_QUERIES = [
  'url:pornyard.xyz',
  'url:redgifs.com/watch/cumbersomemediocreamericanshorthair',
  'url:redgifs.com/i/stainedzestybedlingtonterrier',
  'url:redgifs.com/watch/dapperprofusebongo',
  'url:redgifs.com/watch/salmonidiotictiger',
];

const seenPosts = new Set();

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function sendWebhook(payload) {
  return new Promise((resolve) => {
    try {
      const body = JSON.stringify(payload);
      const u = new URL(WEBHOOK_URL);
      const req = https.request(u, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', () => resolve(0));
      req.write(body);
      req.end();
    } catch { resolve(0); }
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function scan() {
  const now = new Date().toLocaleTimeString();
  console.log(`[${now}] Scanning Reddit...`);
  let found = 0;

  for (const query of SEARCH_QUERIES) {
    try {
      const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&t=month&limit=25&include_over_18=on`;
      const resp = await httpGet(url);

      if (resp.status !== 200) {
        console.log(`  [WARN] Query "${query}" returned ${resp.status}`);
        await sleep(3000);
        continue;
      }

      const json = JSON.parse(resp.body);
      const posts = (json.data && json.data.children) || [];

      for (const post of posts) {
        const d = post.data;
        if (!d || seenPosts.has(d.id)) continue;
        seenPosts.add(d.id);
        found++;

        const redditLink = `https://www.reddit.com${d.permalink}`;
        const selftext = (d.selftext || '').toLowerCase();

        console.log(`  [NEW] r/${d.subreddit} — "${d.title}" by u/${d.author} (${redditLink})`);

        const embed = {
          title: '\uD83D\uDCE2 New Reddit Post Detected',
          color: 0xFF4500,
          fields: [
            { name: 'Title', value: d.title || '(untitled)', inline: false },
            { name: 'Subreddit', value: `r/${d.subreddit}`, inline: true },
            { name: 'Author', value: `u/${d.author}`, inline: true },
            { name: 'Score', value: String(d.score || 0), inline: true },
            { name: 'Link', value: redditLink, inline: false },
          ],
          timestamp: new Date(d.created_utc * 1000).toISOString(),
        };
        if (d.url) embed.fields.push({ name: 'Posted URL', value: d.url, inline: false });
        if (selftext.includes('pornyard.xyz')) embed.fields.push({ name: '\u2705 Has Referral Link', value: 'Yes', inline: true });

        await sendWebhook({ embeds: [embed] });
        await sleep(1500);
      }

      await sleep(2000);
    } catch (e) {
      console.log(`  [ERR] Query "${query}": ${e.message}`);
    }
  }

  console.log(`  Done. ${found} new posts found. Tracking ${seenPosts.size} total.`);
}

// Run immediately, then every 10 minutes
console.log('Reddit Monitor started. Scanning every 10 minutes.');
console.log('Press Ctrl+C to stop.\n');
scan();
setInterval(scan, 10 * 60 * 1000);
