#!/usr/bin/env node
/** Servidor estático mínimo para abrir a Forja fora do Foundry: `npm start`. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5173;
const TYPES = {
    '.html': 'text/html',
    '.mjs': 'text/javascript',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml'
};

createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(ROOT, path === '/' ? 'index.html' : path));
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    try {
        const body = await readFile(file);
        res.writeHead(200, {
            'Content-Type': `${TYPES[extname(file)] ?? 'application/octet-stream'}; charset=utf-8`,
            'Cache-Control': 'no-store'
        });
        res.end(body);
    } catch {
        res.writeHead(404).end('Não encontrado');
    }
}).listen(PORT, '127.0.0.1', () => console.log(`Forja de Antagonistas em http://localhost:${PORT}`));
