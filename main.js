const dateFormat = require('dateformat');
const Path = require('node:path');

const gitDir = Path.join(__dirname, 'current', '.git');

const git = new (require('./git'))(gitDir);
const gitWatcher = new (require('./gitWatcher'))(gitDir);
const ribbitVersions = require('./ribbitVersions');

const BACKLOG_COMMITS = 50;

/**
 * @typedef {Object} FileChanges
 * @property {string}            product
 * @property {string}            file
 * @property {VersionLineDiff[]} changes
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
        const pathParts = path.split('/');

        let prevLines = {};
        let curLines = {};

        try {
            prevLines = ribbitVersions.getVersionLines(await git.getFile(`${ref}^`, path));
        } catch (e) {
            logMessages.push(`Failed getting [${path}] at [${ref}^]: ${e.message}`);
        }
        try {
            curLines = ribbitVersions.getVersionLines(await git.getFile(ref, path));
        } catch (e) {
            logMessages.push(`Failed getting [${path}] at [${ref}]: ${e.message}`);
        }

        results.push({
            product: pathParts[1],
            file: pathParts[2],
            changes: ribbitVersions.diffVersionLines(prevLines, curLines),
        });
        logMessages.forEach(logMsg);
    }));

    const padNumbers = str => str.replace(/\d+/g, num => num.padStart(4, '0'));
    results.sort((a, b) => padNumbers(a.product).localeCompare(padNumbers(b.product)));

    return results;
}

async function main() {
    logMsg('Filling backlog.');
    const backlog = await getBacklog();
    const sortBacklog = () => backlog.sort((a, b) => a.sequence - b.sequence);
    sortBacklog();

    await gitWatcher.watchHead(async (commit) => {
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
        //msg.changes.forEach(entry => logMsg(JSON.stringify(entry)));
    });
    logMsg('Watching for new commits...');
}

main();
