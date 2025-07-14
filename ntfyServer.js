const dateFormat = require('dateformat');
const { createServer } = require('node:http');
const { WebSocketServer } = require('ws');

/**
 * @param {UpdateMessage[]} backlog
 */
module.exports = function (backlog) {
    const HTTP_PORT = 8003;
    const WS_PORT = 8004;
    const LISTEN_HOST = undefined;
    const KEEPALIVE_INTERVAL = 45000;

    /**
     * @typedef {Object} NtfyClient
     * @property {Object} res
     * @property {function} write
     */

    /** @type {NtfyClient[]} */
    const clients = [];

    /**
     * Prints a message to the log.
     *
     * @param {string} message
     */
    function logMsg(message) {
        const date = dateFormat(new Date(), 'yyyy-mm-dd HH:MM:ss');
        console.log(date, message);
    }

    /**
     * Ensures we have the required properties on a Ntfy message, then returns it as a json string.
     *
     * @param {Object} msg
     * @param {string|null} action
     * @return {string}
     */
    const encodeNtfyMessage = (msg, action = null) => {
        msg.id ??= [...Array(12)].map(() =>
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
                .charAt(Math.floor(Math.random() * 62))
        ).join('');

        msg.time ??= Date.now();
        if (msg.time > 10000000000) {
            msg.time = Math.floor(msg.time / 1000);
        }

        let result = JSON.stringify(msg) + '\n';

        if (action === 'sse') {
            result = `data: ${result}\n`;
            if (msg.event !== 'message') {
                result = `event: ${msg.event}\n${result}`;
            }
        }

        return result;
    };

    /**
     * Converts an update message into a ntfy message.
     *
     * @param {UpdateMessage} msg
     */
    const compose = msg => {
        const padNumbers = str => str.replace(/\d+/g, num => num.padStart(4, '0'));

        return {
            'event': 'message',
            'tags': ['frog'],
            'id': `seq${msg.sequence}`,
            'time': msg.timestamp,
            'click': `https://ribbit.watch/#${msg.sequence}`,
            'title': 'Ribbit Watch',
            'message': 'New Ribbit Update for ' +
                Array.from((new Set(msg.changes.map(change => change.product + (change.file !== 'versions' ? `/${change.file}` : '')))).values())
                    .sort((a, b) => padNumbers(a).localeCompare(padNumbers(b)))
                    .join(', '),
        };
    };

    /**
     * Returns the value under the key with one of the given names from the ntfy request.
     *
     * @param {Object} req
     * @param {string[]} names
     * @return {*}
     */
    const getParam = (req, names) => {
        const url = new URL(`http://localhost${req.url}`);

        return names
            .map(name => name.toLowerCase())
            .map(name =>
                Array.from(url.searchParams.entries())
                    .find(([key]) => key.toLowerCase() === name)?.[1] ??
                req.headers[name])
            .find(value => value != null);
    };

    /**
     * Handles a request from the HTTP server.
     *
     * @param {Object} req
     * @param {Object} res
     */
    const handleHTTPRequest = (req, res) => {
        logMsg('Incoming ntfy request at ' + req.url);

        const abort = () => {
            res.writeHead(404);
            res.end();
        };

        const url = new URL(`http://localhost${req.url}`);
        const match = url.pathname.match(/^\/([^\/,]+)\/([^\/]+)$/);
        if (!match) {
            return abort();
        }
        const [topic, action] = match.slice(1);

        if (action === 'auth') {
            res.writeHead(204);
            res.end();

            return;
        }

        if (!['json', 'sse'].includes(action)) {
            return abort();
        }

        const oneShot = getParam(req, ['poll', 'x-poll', 'po']) != null;
        const since = getParam(req, ['since', 'x-since', 'si']);

        const headers = {
            'Content-Type': ({
                'json': 'application/x-ndjson; charset=utf-8',
                'sse': 'text/event-stream; charset=utf-8',
            })[action],
            'Cache-Control': 'no-cache',
        };
        res.writeHead(200, headers);

        const write = msg => res.write(encodeNtfyMessage({topic, ...msg}, action));

        if (!oneShot) {
            write({'event': 'open'});
        }

        handleSince(since, write);

        if (oneShot) {
            res.end();

            return;
        }

        const keepaliveInterval = setInterval(() => void write({'event': 'keepalive'}), KEEPALIVE_INTERVAL);
        clients.push({res, topic, write});
        res.on('close', () => {
            clearInterval(keepaliveInterval);

            const idx = clients.findIndex(entry => entry.res === res);
            if (idx !== -1) {
                clients.splice(idx, 1);
            }
        });
    };

    {
        const server = createServer(handleHTTPRequest);
        server.listen(HTTP_PORT, LISTEN_HOST, () => logMsg(`Ntfy.sh HTTP server started on port ${HTTP_PORT}.`));
    }
    let wss;
    {
        const server = createServer();
        wss = new WebSocketServer({ server });
        wss.on('connection', (ws, req) => {
            ws.on('ping', () => void ws.pong());
            ws.on('pong', () => void (ws.isAlive = true));

            const url = new URL(`http://localhost${req.url}`);
            const match = url.pathname.match(/^\/([^\/,]+)\/ws$/);
            if (!match) {
                ws.close();
                return;
            }

            const topic = match[1];
            const write = msg => ws.send(encodeNtfyMessage({topic, ...msg}));
            ws.ribbit = {topic, write};

            const oneShot = getParam(req, ['poll', 'x-poll', 'po']) != null;
            const since = getParam(req, ['since', 'x-since', 'si']);

            if (!oneShot) {
                write({'event': 'open'});
            }

            handleSince(since, write);

            if (oneShot) {
                ws.close();
            }
        });
        const pingInterval = setInterval(() => {
            wss.clients.forEach(ws => {
                if (ws.isAlive === false) {
                    return ws.terminate();
                }

                ws.isAlive = false;
                ws.ping();
            });
        }, KEEPALIVE_INTERVAL);
        wss.on('close', () => clearInterval(pingInterval));
        server.listen(WS_PORT, LISTEN_HOST, () => logMsg(`Ntfy.sh WS server started on port ${WS_PORT}.`));
    }

    /**
     * Prints the backlog to the connection as requested.
     *
     * @param {string|null} since
     * @param {function} write
     */
    const handleSince = (since, write) => {
        if (!backlog.length || since == null) {
            return;
        }

        let sinceTimestamp;
        let sinceSequence;

        const match = since.match(/^(\d+)(ms|s|m|h|d)$/);
        if (match) {
            const [, amount, unit] = match;
            const n = parseInt(amount, 10);

            sinceTimestamp = Date.now();
            switch (unit) {
                case 'ms':
                    sinceTimestamp -= n;
                    break;
                case 's':
                    sinceTimestamp -= n * 1000;
                    break;
                case 'm':
                    sinceTimestamp -= n * 60 * 1000;
                    break;
                case 'h':
                    sinceTimestamp -= n * 60 * 60 * 1000;
                    break;
                case 'd':
                    sinceTimestamp -= n * 24 * 60 * 60 * 1000;
                    break;
            }
        } else if (/^\d+$/.test(since)) {
            sinceTimestamp = parseInt(since) * 1000;
        } else if (/^seq(\d+)$/.test(since)) {
            sinceSequence = parseInt(since.substring(3));
        }

        {
            let catchUp = [];
            if (since === 'latest') {
                catchUp.push(backlog[backlog.length - 1]);
            } else {
                catchUp = backlog.filter(message =>
                    message.timestamp > (sinceTimestamp ?? 0) &&
                    message.sequence > (sinceSequence ?? 0)
                );
            }

            catchUp.forEach(msg => write(compose(msg)));
        }
    };

    this.send = msg => {
        const composed = compose(msg);
        clients.forEach(client => void client.write(composed));
        wss.clients.forEach(ws => ws.ribbit.write(composed));
    };
};
