// backend/vendor_bootstrap.js
const fs = require('fs');
const path = require('path');
const fse = require('fs-extra');
const https = require('https');

const VER = '1.9.4';
const vendorDir = path.join(__dirname, '..', 'frontend', 'assets', 'vendor', `leaflet-${VER}`);

const files = [
  { url: `https://unpkg.com/leaflet@${VER}/dist/leaflet.js`,  dst: path.join(vendorDir, 'leaflet.js') },
  { url: `https://unpkg.com/leaflet@${VER}/dist/leaflet.css`, dst: path.join(vendorDir, 'leaflet.css') },
  { url: `https://unpkg.com/leaflet@${VER}/dist/images/marker-icon.png`,     dst: path.join(vendorDir, 'images', 'marker-icon.png') },
  { url: `https://unpkg.com/leaflet@${VER}/dist/images/marker-icon-2x.png`,  dst: path.join(vendorDir, 'images', 'marker-icon-2x.png') },
  { url: `https://unpkg.com/leaflet@${VER}/dist/images/marker-shadow.png`,   dst: path.join(vendorDir, 'images', 'marker-shadow.png') },
];

function download(url, dest, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    fse.ensureDirSync(path.dirname(dest));
    const out = fs.createWriteStream(dest);
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        out.close(() => fs.unlink(dest, () => {}));
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
    });
    req.on('error', (err) => {
      out.close(() => fs.unlink(dest, () => {}));
      reject(err);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
  });
}

async function ensureLeafletVendor() {
  const js = path.join(vendorDir, 'leaflet.js');
  const css = path.join(vendorDir, 'leaflet.css');
  if (fs.existsSync(js) && fs.existsSync(css)) return { ok: true, vendorDir };

  for (const f of files) {
    if (!fs.existsSync(f.dst)) {
      await download(f.url, f.dst);
    }
  }
  return { ok: true, vendorDir };
}

module.exports = { ensureLeafletVendor };
