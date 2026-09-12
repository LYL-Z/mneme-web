import fs from 'fs';
const http = await import('http');
http.get('http://127.0.0.1:8491/', res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v45-home.html', 'status:' + res.statusCode + '\n' + body.slice(0, 900)));
}).on('error', e => fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v45-home.html', 'ERR ' + e.message));
