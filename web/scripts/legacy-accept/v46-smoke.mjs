import { createRequire } from 'module';
import fs from 'fs';
const req = createRequire(import.meta.url);
const { execSync } = req('child_process');
let pass = 0; const fails = [];
for (const f of ['v71-accept.mjs', 'v72-accept.mjs', 'v73-accept.mjs', 'v74-accept.mjs']) {
  try {
    const o = execSync('node ' + f, { cwd: 'D:/The Memory/mneme-web/web', encoding: 'utf8', timeout: 180000 });
    for (const line of o.split('\n')) {
      if (line.includes('✅')) pass++;
      if (line.includes('❌')) fails.push(f + ': ' + line.trim().slice(0, 60));
    }
  } catch (e) {
    const o = (e.stdout || '') + '';
    for (const line of o.split('\n')) {
      if (line.includes('✅')) pass++;
      if (line.includes('❌')) fails.push(f + ': ' + line.trim().slice(0, 60));
    }
    fails.push(f + ' EXIT ' + e.status);
  }
}
fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v46-smoke.txt', `pass: ${pass}\n${fails.join('\n') || '全绿'}`);
