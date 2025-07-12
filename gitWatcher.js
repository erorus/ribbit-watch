const fs = require('node:fs');
const Path = require('node:path');

/**
 * @param {string} gitDir The full filesystem path to the .git directory.
 */
module.exports = function (gitDir) {
    const headPath = Path.join(gitDir, 'HEAD');

    this.watchHead = function (onCommitChange) {
        let lastCommit = null;

        let activeRefWatcher = null;
        let headWatcher;

        function updateCommit(currentCommit) {
            if (currentCommit === lastCommit) {
                return;
            }

            const wasNull = lastCommit == null;
            lastCommit = currentCommit;

            if (!wasNull) {
                onCommitChange(currentCommit);
            }
        }

        function handleHeadChange() {
            headWatcher?.();
            activeRefWatcher?.();

            const [currentCommit, refPath] = getHeadCommit();

            headWatcher = watchFile(headPath, handleHeadChange);
            activeRefWatcher = refPath ? watchFile(refPath, handleHeadChange) : null;

            updateCommit(currentCommit);
        }

        handleHeadChange();
    };

    /**
     * Returns the full commit hash where HEAD currently points, and the ref path we had to check to get it.
     *
     * @returns {[string, string|undefined]}
     */
    function getHeadCommit() {
        const headContent = fs.readFileSync(headPath, 'utf8').trim();
        if (headContent.startsWith('ref:')) {
            const refPath = Path.join(gitDir, headContent.substring(5));

            return [fs.readFileSync(refPath, 'utf8').trim(), refPath];
        }

        return [headContent, undefined];
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
