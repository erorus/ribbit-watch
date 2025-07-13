const dateFormat = require('dateformat');
const fs = require('node:fs');
const Path = require('node:path');
const { createServer } = require('node:http');
const { WebSocketServer } = require('ws');

const gitDir = Path.join(__dirname, 'current', '.git');

const git = new (require('./git'))(gitDir);
const ribbitVersions = require('./ribbitVersions');

const BACKLOG_COMMITS = 50;
const WEBSOCKET_PORT = 8001;
const SSE_PORT = 8002;
const COMMIT_WATCH_PATH = Path.join(__dirname, 'last-commit-time');

/**
 * @typedef {Object} FileChanges
 * @property {string}            product
 * @property {string}            file
 * @property {VersionLineDiff[]} diffs
 */

/**
 * @typedef {Object} UpdateMessage
 * @property {string}        commitHash
 * @property {number}        sequence
 * @property {number}        timestamp
 * @property {FileChanges[]} changes
 */

/**
 * Builds a new update message object for the changes in the given git ref.
 *
 * @param {string} ref
 * @returns {Promise<UpdateMessage>}
 */
async function buildMessage(ref) {
    /** @type {UpdateMessage} */
    const msg = {
        commitHash: null,
        sequence: null,
        timestamp: null,
        changes: [],
    };

    await Promise.all([
        (async () => msg.commitHash = await git.getCommit(ref))(),
        (async () => msg.sequence = ribbitVersions.getSequenceNumber(await git.getFile(ref, 'summary')))(),
        (async () => msg.timestamp = await git.getTime(ref))(),
        (async () => msg.changes = await getChanges(ref))(),
    ]);

    return msg;
}

/**
 * Returns the most recent BACKLOG_COMMITS messages up to and including HEAD.
 *
 * @returns {Promise<UpdateMessage[]>}
 */
async function getBacklog() {
    /** @type UpdateMessage[] */
    const result = [];

    const curCommit = await git.getCommit();

    const promises = [];
    for (let x = 0; x < BACKLOG_COMMITS; x++) {
        promises.push((async () => result.push(await buildMessage(`${curCommit}~${x}`)))());
    }

    await Promise.all(promises);

    return result;
}

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
 * Returns a list of all product changes which occurred in current commit.
 *
 * @param {string} ref
 * @returns {Promise<FileChanges[]>}
 */
async function getChanges(ref = 'HEAD') {
    /** @type {FileChanges[]} */
    const results = [];
    const paths = (await git.getChangedFiles(ref)).filter(path => path.startsWith('products/'));

    await Promise.all(paths.map(async (path) => {
        const logMessages = [`Processing ${ref} ${path}`];
        const [product, file] = path.split('/').slice(1);
        const disposition = ({
            'bgdl': 'version',
            'cdns': 'cdn',
            'versions': 'version',
        })[file];

        let prevLines = {};
        let curLines = {};

        try {
            prevLines = ribbitVersions.getVersionLines(await git.getFile(`${ref}^`, path), disposition);
        } catch (e) {
            logMessages.push(`Failed getting [${path}] at [${ref}^]: ${e.message}`);
        }
        try {
            curLines = ribbitVersions.getVersionLines(await git.getFile(ref, path), disposition);
        } catch (e) {
            logMessages.push(`Failed getting [${path}] at [${ref}]: ${e.message}`);
        }

        results.push({
            product,
            file,
            diffs: ribbitVersions.diffVersionLines(prevLines, curLines),
        });
        logMessages.forEach(logMsg);
    }));

    const padNumbers = str => str.replace(/\d+/g, num => num.padStart(4, '0'));
    results.sort((a, b) => padNumbers(a.product).localeCompare(padNumbers(b.product)));

    return results;
}

/**
 * Initializes the watcher for new commits.
 *
 * @param {function} onNewCommit
 */
function setupWatcher(onNewCommit) {
    let closer;
    let lastCommit;
    const onChange = async () => {
        closer?.();
        const curCommit = await git.getCommit();
        const wasUpdated = lastCommit != null && curCommit !== lastCommit;
        lastCommit = curCommit;
        if (wasUpdated) {
            onNewCommit(curCommit);
        }

        const watcher = fs.watch(COMMIT_WATCH_PATH, undefined, () => void onChange());
        closer = () => watcher.close();
    };

    onChange();
}

/**
 * Starts the websocket server, returning a function which broadcasts a message.
 *
 * @param {UpdateMessage[]} backlog
 * @return {function}
 */
function startWebsocketServer(backlog) {
    logMsg('Starting websocket server.');
    const server = createServer()
    const wss = new WebSocketServer({ server });
    wss.on('connection', ws => {
        ws.on('error', message => logMsg(`WebSocket error: ${message}`));
        ws.on('pong', () => void (ws.isAlive = true));
        backlog.forEach(message => ws.send(JSON.stringify(message)));
    });
    const pingInterval = setInterval(() => {
        wss.clients.forEach(ws => {
            if (ws.isAlive === false) {
                return ws.terminate();
            }

            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);
    wss.on('close', () => clearInterval(pingInterval));
    server.listen(WEBSOCKET_PORT, '127.0.0.1', () => logMsg(`Websocket server started on port ${WEBSOCKET_PORT}.`));

    return msg => {
        const composed = JSON.stringify(msg);
        wss.clients.forEach(ws => ws.send(composed));
    };
}

/**
 * Starts the server-sent events server, returning a function which broadcasts a message.
 *
 * @param {UpdateMessage[]} backlog
 * @return {function}
 */
function startSSEServer(backlog) {
    const clients = [];
    const compose = msg => 'data: ' + JSON.stringify(msg) + '\n\n';

    const server = createServer((req, res) => {
        const headers = {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        };
        if (req.headers['origin'] === 'http://127.0.0.1:7777') {
            headers['Access-Control-Allow-Origin'] = req.headers['origin'];
        }
        res.writeHead(200, headers);
        backlog.forEach(message => res.write(compose(message)));

        clients.push(res);
        req.on('close', () => {
            const idx = clients.indexOf(res);
            if (idx !== -1) {
                clients.splice(idx, 1);
            }
        });
    });

    server.listen(SSE_PORT, '127.0.0.1', () => logMsg(`SSE server started on port ${SSE_PORT}.`));

    return msg => {
        const composed = compose(msg);
        clients.forEach(client => client.write(composed));
    };
}

async function main() {
    logMsg('Filling backlog.');
    const backlog = await getBacklog();
    const sortBacklog = () => backlog.sort((a, b) => a.sequence - b.sequence);
    sortBacklog();

    const wssSend = startWebsocketServer(backlog);
    const sseSend = startSSEServer(backlog);

    const handleNewCommit = async (commit) => {
        logMsg(`Detected new commit: ${commit}`);

        const shortCommit = await git.getCommit(commit);

        if (backlog.find(message => message.commitHash === shortCommit)) {
            logMsg(`Commit ${shortCommit} already processed.`);

            return;
        }

        const msg = await buildMessage(shortCommit);
        backlog.push(msg);
        sortBacklog();
        backlog.splice(0, backlog.length - BACKLOG_COMMITS);

        logMsg(msg);
        wssSend(msg);
        sseSend(msg);
    };

    setupWatcher(handleNewCommit);

    logMsg('Ready.');
}

main();
