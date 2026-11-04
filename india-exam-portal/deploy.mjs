// ExamSeva Netlify Deploy Script — uses Netlify API directly
import fs from 'fs';
import path from 'path';
import https from 'https';
import { createHash } from 'crypto';

const TOKEN = process.env.NETLIFY_TOKEN;
const SITE_NAME = 'examseva-india';
const DIST_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));

if (!TOKEN) {
  console.error('❌ NETLIFY_TOKEN not set');
  process.exit(1);
}

function apiRequest(method, endpoint, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.netlify.com',
      path: `/api/v1${endpoint}`,
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'ExamSeva-Deploy/1.0',
        ...extraHeaders,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function uploadFile(deployId, filePath, fileContent) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.netlify.com',
      path: `/api/v1/deploys/${deployId}/files/${filePath}`,
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileContent.length,
        'User-Agent': 'ExamSeva-Deploy/1.0',
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.write(fileContent);
    req.end();
  });
}

async function deploy() {
  console.log('🚀 ExamSeva Deploy Starting...\n');

  // 1. Create or find site
  console.log('📡 Creating site on Netlify...');
  let siteId;
  const sitesRes = await apiRequest('GET', '/sites?per_page=100');
  const existing = sitesRes.body?.find?.((s) => s.name === SITE_NAME);
  if (existing) {
    siteId = existing.id;
    console.log(`✅ Found existing site: ${existing.ssl_url || existing.url}`);
  } else {
    const createRes = await apiRequest('POST', '/sites', { name: SITE_NAME });
    if (createRes.status !== 201 && createRes.status !== 200) {
      // try random name
      const rnd = SITE_NAME + '-' + Math.random().toString(36).slice(2,6);
      const r2 = await apiRequest('POST', '/sites', { name: rnd });
      siteId = r2.body.id;
      console.log(`✅ Site created: ${r2.body.ssl_url || r2.body.url}`);
    } else {
      siteId = createRes.body.id;
      console.log(`✅ Site created: ${createRes.body.ssl_url || createRes.body.url}`);
    }
  }

  // 2. Read the HTML file
  const htmlFile = path.join(DIST_DIR, 'index.html');
  const htmlContent = fs.readFileSync(htmlFile);
  const sha1 = createHash('sha1').update(htmlContent).digest('hex');

  // 3. Create deploy
  console.log('\n📦 Creating deployment...');
  const deployRes = await apiRequest('POST', `/sites/${siteId}/deploys`, {
    files: { '/index.html': sha1 },
    async: false,
  });

  if (!deployRes.body.id) {
    console.error('❌ Deploy creation failed:', JSON.stringify(deployRes.body, null, 2));
    process.exit(1);
  }

  const deployId = deployRes.body.id;
  console.log(`✅ Deploy ID: ${deployId}`);

  // 4. Upload file
  console.log('\n⬆️  Uploading index.html...');
  const uploadRes = await uploadFile(deployId, '/index.html', htmlContent);
  console.log(`✅ Upload status: ${uploadRes.status}`);

  // 5. Get final URL
  console.log('\n⏳ Waiting for deploy to go live...');
  await new Promise(r => setTimeout(r, 4000));
  const finalRes = await apiRequest('GET', `/sites/${siteId}`);
  const liveUrl = finalRes.body.ssl_url || finalRes.body.url || `https://${SITE_NAME}.netlify.app`;

  console.log('\n' + '='.repeat(50));
  console.log('🎉 DEPLOY SUCCESSFUL!');
  console.log('='.repeat(50));
  console.log(`🌐 Live URL: ${liveUrl}`);
  console.log('='.repeat(50));
  console.log(JSON.stringify({ success: true, url: liveUrl, siteId }));
}

deploy().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
