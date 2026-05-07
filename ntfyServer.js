const dateFormat = require('dateformat');
const { createServer } = require('node:http');
const { WebSocketServer } = require('ws');
const fs = require('node:fs');
const Path = require('node:path');

/**
 * @param {UpdateMessage[]} backlog
 */
module.exports = function (backlog) {
    const HTTP_PORT = 8003;
    const WS_PORT = 8004;
    const LISTEN_HOST = '127.0.0.1';
    const KEEPALIVE_INTERVAL = 45000;

    /**
     * @typedef {Object} NtfyClient
     * @property {Object} res
     * @property {TopicFilters[]} filterSets
     * @property {function} write
     */

    /**
     * @typedef {Object} TopicFilters
     * @property {string} topic
     * @property {string} productsFilter
     * @property {RegExp} productsRegex
     * @property {number} flags
     * @property {number} version
     */

    /** @type {NtfyClient[]} */
    const clients = [];

    /** @type {Object<string, Deets>} */
    let productDeets = {};

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
     * @param {TopicFilters} filters
     * @returns {Object|undefined}
     */
    const compose = (msg, filters) => {
        const padNumbers = str => str.replace(/\d+/g, num => num.padStart(4, '0'));

        const products = getShownProducts(msg, filters);
        const paths = Array.from(
            (
                new Set(
                    msg.changes
                    .filter(change => products.includes(change.product))
                    .map(change => change.product + (change.file !== 'versions' ? `/${change.file}` : ''))
                )
            ).values()
        );

        if (!paths.length) {
            return;
        }

        const params = new URLSearchParams();
        if (filters.productsFilter !== '') {
            params.set('products', filters.productsFilter);
        }
        const deniedFields = getDeniedFields(filters);
        if (deniedFields.length) {
            params.set('skipFields', deniedFields.join(' '));
        }
        if (filters.flags & 0x1) {
            params.set('encrypted', 'no');
        }

        const click = new URL(`https://ribbit-watch.everynothing.net/#${msg.sequence}`);
        click.search = params.toString();

        return {
            'event': 'message',
            'topic': filters.topic,
            'tags': ['frog'],
            'id': `seq${msg.sequence}`,
            'time': msg.timestamp,
            'click': click.toString(),
            'title': 'Ribbit Watch',
            'message': 'New Ribbit Update for ' + paths
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
        const abort = () => {
            res.writeHead(404);
            res.end();
        };

        const url = new URL(`http://localhost${req.url}`);
        const match = url.pathname.match(/^\/([-_A-Za-z0-9,]+)\/(auth|json|sse)$/);
        if (!match) {
            return abort();
        }
        const [topicCsv, action] = match.slice(1);

        if (action === 'auth') {
            res.writeHead(204);
            res.end();

            return;
        }

        let filterSets = [];
        try {
            topicCsv.split(',').forEach(topic => filterSets.push(parseTopic(topic)));
        } catch (e) {
            return abort();
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

        const write = msg => msg && res.write(encodeNtfyMessage(msg, action));

        if (!oneShot) {
            write({'event': 'open', topic: topicCsv});
        }

        filterSets.forEach(filters => handleSince(since, write, filters));

        if (oneShot) {
            res.end();

            return;
        }

        const keepaliveInterval = setInterval(
            () => void write({'event': 'keepalive', topic: topicCsv}),
            KEEPALIVE_INTERVAL,
        );
        clients.push({res, filterSets, write});
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
            const match = url.pathname.match(/^\/([-_A-Za-z0-9,]+)\/ws$/);
            if (!match) {
                ws.close();
                return;
            }

            const topicCsv = match[1];
            let filterSets = [];
            try {
                topicCsv.split(',').forEach(topic => filterSets.push(parseTopic(topic)));
            } catch (e) {
                ws.close();
                return;
            }

            const write = msg => msg && ws.send(encodeNtfyMessage(msg));
            ws.ribbit = {filterSets, write};

            const oneShot = getParam(req, ['poll', 'x-poll', 'po']) != null;
            const since = getParam(req, ['since', 'x-since', 'si']);

            if (!oneShot) {
                write({'event': 'open', topic: topicCsv});
            }

            filterSets.forEach(filters => handleSince(since, write, filters));

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
     * @param {TopicFilters} filters
     */
    const handleSince = (since, write, filters) => {
        if (!backlog.length || since == null || since === 'none') {
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

            catchUp.forEach(msg => void write(compose(msg, filters)));
        }
    };

    /**
     * Parses a topic string to return the checkbox flags and products regex.
     *
     * @param {string} topic
     * @return {TopicFilters}
     */
    const parseTopic = topic => {
        const match = topic.match(/^([0-9a-f]+)-([-_A-Za-z0-9]*)$/);
        if (!match) {
            throw new Error('Pattern not matched.');
        }

        const packedNum = parseInt(match[1], 16);
        const version = packedNum & 0xF;
        if (version !== 0) {
            throw new Error('Unsupported version.');
        }
        const flags = packedNum >> 4;
        const productsFilter = decodeURIComponent(match[2]
            .replace(/-/g, '%')
            .replace(/%%/g, '-')
            .replace(/(%)?_/g, (match, pct) => pct ? '_' : '%20'));
        const productsRegex = getProductsRegex(productsFilter);

        return {
            topic,
            version,
            flags,
            productsFilter,
            productsRegex,
        };
    };

    /**
     * Returns a regex built from the given products input string.
     *
     * @param {string} input
     * @returns {RegExp}
     */
    const getProductsRegex = input => {
        if (input === '') {
            return /.*/;
        }

        let match = /^\/([\w\W]+)\/([iu]*)$/.exec(input);
        if (match) {
            return new RegExp(match[1], match[2]);
        }

        return new RegExp(
            '^(?:' +
            Array.from(input.matchAll(/[\w*]+/g)).map(match => '(?:' + match[0].replace(/\*/g, '.*') + ')').join('|') +
            ')$',
            'i'
        );
    };

    /**
     * Returns a list of denied fields from the given filters.
     *
     * @param {TopicFilters} filters
     * @return {string[]}
     */
    const getDeniedFields = filters => {
        const fieldFlags = {
            'BuildConfig'  : 0x2,
            'CDNConfig'    : 0x4,
            'KeyRing'      : 0x8,
            'BuildId'      : 0x10,
            'VersionsName' : 0x20,
            'ProductConfig': 0x40,
            'Path'         : 0x80,
            'Hosts'        : 0x100,
            'Servers'      : 0x200,
            'ConfigPath'   : 0x400,
        };

        return Object.entries(fieldFlags)
            .filter(([field, flag]) => !!(filters.flags & flag))
            .map(([field, flag]) => field);
    }

    /**
     * Returns a list of products which would be shown in an alert from the given message, after the given filters.
     *
     * @param {UpdateMessage} msg
     * @param {TopicFilters} filters
     * @returns {string[]}
     */
    const getShownProducts = (msg, filters) => {
        const encryptedExcluded = filters.flags & 0x1;
        const deniedFields = getDeniedFields(filters);

        const result = new Set();
        msg.changes.forEach(change => {
            if (!filters.productsRegex.test(change.product)) {
                return;
            }
            const deets = productDeets[change.product];
            const isEncrypted = deets?.encrypted || deets?.key != null;
            if (isEncrypted && encryptedExcluded) {
                return;
            }
            if (!change.diffs.some(diff => !deniedFields.includes(diff.field))) {
                return;
            }

            result.add(change.product);
        });

        return Array.from(result.values());
    }

    /**
     * Loads the deets into the productDeets variable.
     *
     * @return {Promise<void>}
     */
    const loadDeets = async () => {
        const path = Path.join(__dirname, 'deets', 'deets.json');
        try {
            const json = await fs.promises.readFile(path, {encoding: 'utf8'});
            productDeets = JSON.parse(json);
            setTimeout(() => void loadDeets(), 45 * 60 * 1000);
        } catch (e) {
            logMsg('Failed to load deets json');
            logMsg(e);
            setTimeout(() => void loadDeets(), 60 * 1000);
        }
    };

    void loadDeets();

    this.send = msg => {
        clients.forEach(
            client => client.filterSets.forEach(
                filters => void client.write(compose(msg, filters))
            )
        );
        wss.clients.forEach(
            ws => ws.ribbit.filterSets.forEach(
                filters => void ws.ribbit.write(compose(msg, filters))
            )
        );
    };
};
