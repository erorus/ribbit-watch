const fs = require('node:fs');
const Path = require('node:path');
const dateFormat = require("dateformat");

/**
 * @param {string} gitDir The full filesystem path to the .git directory.
 */
module.exports = function (gitDir) {
    const headPath = Path.join(gitDir, 'HEAD');

    this.watchHead = function (onCommitChange) {
        let lastCommit = null;

        let activeRefWatcher = null;
        let headWatcher;

        async function handleHeadChange() {
            // Close any open watchers.
            headWatcher?.();
            activeRefWatcher?.();

            // We assume that once we can resolve the HEAD commit hash, filesystem changes have settled, and we can
            // resume watching those paths.
            const [currentCommit, refPath] = await getHeadCommit();

            headWatcher = watchFile(headPath, handleHeadChange);
            activeRefWatcher = refPath ? watchFile(refPath, handleHeadChange) : null;

            if (currentCommit !== lastCommit) {
                const wasNull = lastCommit == null;
                lastCommit = currentCommit;

                if (!wasNull) {
                    onCommitChange(currentCommit);
                }
            }
        }

        handleHeadChange();
    };

    /**
     * Returns the full commit hash where HEAD currently points, and the ref path we had to read to get it.
     *
     * @returns {Promise<[string, string|undefined]>}
     */
    async function getHeadCommit() {
        const maxAttempts = 10;
        let attempts = 0;
        while (attempts++ < maxAttempts) {
            try {
                const headContent = fs.readFileSync(headPath, 'utf8').trim();
                if (headContent.startsWith('ref:')) {
                    const refPath = Path.join(gitDir, headContent.substring(5));

                    return [fs.readFileSync(refPath, 'utf8').trim(), refPath];
                }

                return [headContent, undefined];
            } catch (err) {
                logMsg(`Failed to get HEAD commit on attempt ${attempts} of ${maxAttempts}`);
                logMsg(err);

                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        throw new Error('Ran out of retries to get HEAD commit.');
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
     * Initializes watching $path for changes, and returns the closer for that watcher.
     *
     * @param {string} path
     * @param {function} onChange
     * @returns {function} Closer
     */
    function watchFile(path, onChange) {
        const watcher = fs.watch(path, undefined, () => void (onChange()));
        return () => watcher.close();
    }
};
