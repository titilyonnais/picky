import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

function listen(handler, host) {
  return new Promise((resolve) => {
    const server = http.createServer(handler).listen(0, host, () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function fixture(name) {
  try {
    return readFileSync(join(FIXTURES, name.replace(/[^\w.-]/g, '')));
  } catch {
    return null;
  }
}

// Deux origines : la page sur localhost, une image « étrangère » sur 127.0.0.1.
// Les images sont servies sans Content-Type pour vérifier la détection du format.
export async function startServers() {
  const cross = await listen((req, res) => {
    const body = fixture(req.url.slice(1));
    res.statusCode = body ? 200 : 404;
    res.end(body ?? '');
  }, '127.0.0.1');
  const crossOrigin = `http://127.0.0.1:${cross.port}`;

  let origin;
  const main = await listen((req, res) => {
    const name = req.url.slice(1);
    if (name === '') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(fixture('page.html').toString().replace('{{CROSS_ORIGIN}}', crossOrigin));
    }
    if (name === 'protege.png' && !(req.headers.referer ?? '').startsWith(origin)) {
      res.statusCode = 403;
      return res.end('interdit');
    }
    const body = fixture(name);
    res.statusCode = body ? 200 : 404;
    res.end(body ?? '');
  }, 'localhost');
  origin = `http://localhost:${main.port}`;

  return {
    origin,
    close: () => {
      main.server.close();
      cross.server.close();
    },
  };
}
