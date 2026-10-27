const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

function makeZip(files) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(content));
  }
  return zip.toBuffer();
}

function cleanupCreativeDir(id) {
  if (id == null) return;
  const dir = path.join(__dirname, '..', 'public', 'creatives', String(id));
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { makeZip, cleanupCreativeDir };
