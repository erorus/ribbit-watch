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

        function updateCommit() {
            const current = getHeadCommit();
            if (current !== lastCommit) {
                const wasNull = lastCommit == null;
                lastCommit = current;

                if (!wasNull) {
                    onCommitChange(current);
                }
            }
        }

        function handleHeadChange() {
            headWatcher?.();
            activeRefWatcher?.();

            headWatcher = watchFile(headPath, handleHeadChange);

            const headContent = fs.readFileSync(headPath, 'utf8').trim();
            if (headContent.startsWith('ref:')) {
                const refPath = Path.join(gitDir, headContent.substring(5));
                activeRefWatcher = watchFile(refPath, updateCommit);
            } else {
                activeRefWatcher = null;
            }

            updateCommit();
        }

        handleHeadChange();
    };

    /**
     * Returns the full commit hash where HEAD currently points.
     *
     * @returns {string}
     */
    function getHeadCommit() {
        const headContent = fs.readFileSync(headPath, 'utf8').trim();
        if (headContent.startsWith('ref:')) {
            const refPath = Path.join(gitDir, headContent.substring(5));

            return fs.readFileSync(refPath, 'utf8').trim();
        }

        return headContent;
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
