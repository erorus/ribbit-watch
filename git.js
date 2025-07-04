const util = require('node:util');
const exec = util.promisify(require('node:child_process').exec);

/**
 * @param {string} gitDir The full filesystem path to the .git directory.
 */
module.exports = function (gitDir) {
    /**
     * Returns a list of git paths which have changed in the current commit.
     *
     * @returns {Promise<string[]>}
     */
    this.getChangedFiles = async function (ref = 'HEAD') {
        return (await runGitCommand('git diff-tree --no-commit-id --name-only -r ' + escapeShellArg(ref)))
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
    };

    /**
     * Returns the short commit hash at the given ref.
     *
     * @param {string} ref
     * @returns {Promise<string>}
     */
    this.getCommit = async function (ref = 'HEAD') {
        return await runGitCommand('git rev-parse --short ' + escapeShellArg(ref));
    };

    /**
     * Returns the contents of path at commit from git.
     *
     * @param {string} ref
     * @param {string} path
     * @returns {Promise<string>}
     */
    this.getFile = async function (ref, path) {
        return await runGitCommand('git show ' + escapeShellArg(`${ref}:${path}`));
    };

    /**
     * Returns the UNIX timestamp (in milliseconds) when the given commit was made.
     *
     * @param {string} ref
     * @returns {Promise<number>}
     */
    this.getTime = async function (ref = 'HEAD') {
        return parseInt((await runGitCommand('git show -s --format=%ct ' + escapeShellArg(ref))).trim()) * 1000;
    };

    /**
     * Quotes the given string for use as a shell argument.
     *
     * @param {string} arg
     * @returns {string}
     */
    function escapeShellArg(arg) {
        return `'${arg.replace(/'/g, `'\\''`)}'`;
    }

    /**
     * Runs the cmd command line in the git directory, returning the result from STDOUT.
     *
     * @param {string} cmd
     * @returns {Promise<string>}
     */
    async function runGitCommand(cmd) {
        let stdout;
        try {
            const result = await exec(cmd, {cwd: gitDir, encoding: 'utf8'});
            stdout = result.stdout;
        } catch (e) {
            throw new Error(`Git failed: ${e.stderr}`);
        }

        return stdout.trim();
    }
};
