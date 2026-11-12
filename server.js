
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HOST = '127.0.0.1';
const PORT = 8787;

let bot = null;
let clients = [];
let logs = [];

function broadcast(type, data) {
    const message = `data: ${JSON.stringify({type, data})}\n\n`;

    clients = clients.filter(res => {
        try {
            res.write(message);
            return true;
        } catch {
            return false;
        }
    });
}

function log(message) {
    const entry = String(message).trimEnd();
    if (!entry) return;

    logs.push(entry);
    if (logs.length > 250) logs.shift();

    broadcast('log', entry);
}

function sendJSON(res, status, data) {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';

        req.on('data', chunk => {
            body += chunk;

            if (body.length > 4096) {
                reject(new Error('Request too large'));
                req.destroy();
            }
        });

        req.on('end', () => {
            try {
                resolve(JSON.parse(body || '{}'));
            } catch {
                reject(new Error('Invalid JSON'));
            }
        });

        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        res.write('\n');
        clients.push(res);

        res.write(`data: ${JSON.stringify({
            type: 'history',
            data: logs
        })}\n\n`);

        res.on('close', () => {
            clients = clients.filter(c => c !== res);
        });

        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
        return sendJSON(res, 200, {
            running: !!bot,
            pid: bot?.pid || null
        });
    }

    if (req.method === 'POST' && url.pathname === '/api/start') {
        if (bot) {
            return sendJSON(res, 409, {
                error: 'Bot is already running'
            });
        }

        let body;

        try {
            body = await readBody(req);
        } catch (error) {
            return sendJSON(res, 400, {error: error.message});
        }

        const mode = body.mode;

        if (!['dry-run', 'submit'].includes(mode)) {
            return sendJSON(res, 400, {error: 'Invalid mode'});
        }

        if (mode === 'submit' && body.confirm !== true) {
            return sendJSON(res, 400, {
                error: 'Explicit submission confirmation required'
            });
        }

        logs = [];
        log(`Starting Feedback Bot in ${mode} mode...`);

        bot = spawn(process.execPath, ['mobile_bot.js'], {
            cwd: __dirname,
            env: {
                ...process.env,
                SUBMIT: mode === 'submit' ? '1' : '0'
            },
            stdio: ['pipe', 'pipe', 'pipe']
        });

        const child = bot;

        child.stdout.on('data', data => log(data.toString()));
        child.stderr.on('data', data => log(data.toString()));

        child.on('error', error => {
            log(`Process error: ${error.message}`);
            if (bot === child) bot = null;
            broadcast('status', {running: false});
        });

        child.on('close', code => {
            log(`Bot process exited with code ${code}`);
            if (bot === child) bot = null;
            broadcast('status', {running: false, code});
        });

        broadcast('status', {running: true, mode});

        return sendJSON(res, 200, {
            started: true,
            mode
        });
    }

    if (req.method === 'POST' && url.pathname === '/api/input') {
        let body;

        try {
            body = await readBody(req);
        } catch (error) {
            return sendJSON(res, 400, {error: error.message});
        }

        if (!bot || !bot.stdin.writable) {
            return sendJSON(res, 409, {
                error: 'No active bot input'
            });
        }

        const answer = String(body.answer || '');

        if (answer.length > 100) {
            return sendJSON(res, 400, {error: 'Input too long'});
        }

        bot.stdin.write(answer + '\n');

        return sendJSON(res, 200, {sent: true});
    }

    if (req.method === 'POST' && url.pathname === '/api/stop') {
        if (!bot) {
            return sendJSON(res, 409, {error: 'Bot is not running'});
        }

        bot.kill('SIGTERM');

        return sendJSON(res, 200, {stopping: true});
    }

    if (req.method === 'GET' && url.pathname === '/') {
        const file = path.join(__dirname, 'public', 'index.html');

        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store'
        });

        return fs.createReadStream(file).pipe(res);
    }

    res.writeHead(404);
    res.end('Not found');
});

server.listen(PORT, HOST, () => {
    console.log(`Feedback Dashboard: http://${HOST}:${PORT}`);
});

