const dateFormat = require('dateformat');
const Path = require('node:path');

const gitDir = Path.join(__dirname, 'current', '.git');

const git = new (require('./git'))(gitDir);
const gitWatcher = new (require('./gitWatcher'))(gitDir);
const ribbitVersions = require('./ribbitVersions');

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
 * @property {FileChanges[]} updates
 */

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
async function processCommit(ref = 'HEAD') {
    /** @type {FileChanges[]} */
    const results = [];
    const paths = (await git.getChangedFiles(ref)).filter(path => path.startsWith('products/'));

    await Promise.all(paths.map(async (path) => {
        const logMessages = [`Processing ${path}`];
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
    logMsg('Starting...');
    await gitWatcher.watchHead(async (commit) => {
        logMsg(`Detected new commit: ${commit}`);

        const msg = {
            commitHash: null,
            sequence: null,
            timestamp: null,
            updates: [],
        };

        await Promise.all([
            (async () => msg.commitHash = await git.getCommit(commit))(),
            (async () => msg.sequence = ribbitVersions.getSequenceNumber(await git.getFile(commit, 'summary')))(),
            (async () => msg.timestamp = await git.getTime(commit))(),
            (async () => msg.updates = await processCommit(commit))(),
        ]);

        logMsg(msg);
        //msg.updates.forEach(entry => logMsg(JSON.stringify(entry)));
    });
    logMsg('Watching for new commits...');
}

main();
