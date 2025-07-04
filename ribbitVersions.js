module.exports = new function () {
    /**
     * @typedef {Object} VersionLine
     * @property {string} Region
     * @property {string} BuildConfig
     * @property {string} CDNConfig
     * @property {string} KeyRing
     * @property {string} BuildId
     * @property {string} VersionsName
     * @property {string} ProductConfig
     */

    /**
     * @typedef {Object} VersionLineDiff
     * @property {string}      field
     * @property {string|null} oldValue
     * @property {string|null} newValue
     * @property {string[]}    keys     Regions
     */

    /**
     * Returns a list of field changes between prior and current.
     *
     * @param {Object<string, VersionLine>} prior
     * @param {Object<string, VersionLine>} current
     * @returns {VersionLineDiff[]}
     */
    this.diffVersionLines = function (prior, current) {
        const differences = [];
        const fieldMap = new Map();

        const priorKeys = new Set(Object.keys(prior));
        const currentKeys = new Set(Object.keys(current));

        const allKeys = new Set([...priorKeys, ...currentKeys]);

        for (const key of allKeys) {
            const aEntry = prior[key];
            const bEntry = current[key];

            if (!aEntry) {
                // Added key in current
                for (const [field, newValue] of Object.entries(bEntry)) {
                    const diffKey = `${field}\0|\0${newValue}`;
                    if (!fieldMap.has(diffKey)) fieldMap.set(diffKey, new Set());
                    fieldMap.get(diffKey).add(key);
                }
                continue;
            }

            if (!bEntry) {
                // Removed key from current
                for (const [field, oldValue] of Object.entries(aEntry)) {
                    const diffKey = `${field}\0${oldValue}\0|`;
                    if (!fieldMap.has(diffKey)) fieldMap.set(diffKey, new Set());
                    fieldMap.get(diffKey).add(key);
                }
                continue;
            }

            // Compare fields for shared keys
            for (const field of Object.keys(aEntry)) {
                const aVal = aEntry[field];
                const bVal = bEntry[field];

                if (aVal !== bVal) {
                    const diffKey = `${field}\0${aVal}\0${bVal}`;
                    if (!fieldMap.has(diffKey)) fieldMap.set(diffKey, new Set());
                    fieldMap.get(diffKey).add(key);
                }
            }
        }

        for (const [compoundKey, keys] of fieldMap.entries()) {
            const [field, oldValue, newValue] = compoundKey.split('\0');
            differences.push({
                field,
                oldValue: oldValue === '|' ? null : oldValue,
                newValue: newValue === '|' ? null : newValue,
                keys: Array.from(keys).sort((a, b) => Object.keys(current).indexOf(a) - Object.keys(current).indexOf(b)),
            });
        }

        return differences;
    };

    /**
     * Returns the sequence number found in the given multipart document.
     *
     * @param {string} ribbitMultipart - The full MIME multipart document from Ribbit.
     * @param {string} disposition - The content-disposition part to extract.
     * @returns {number|null}
     */
    this.getSequenceNumber = function (ribbitMultipart, disposition = 'summary') {
        let doc = '';
        try {
            doc = getMimePart(ribbitMultipart, disposition);
        } catch (e) {
        }

        const match = doc.match(/^## seqn = (\d+)/m);

        return match ? parseInt(match[1]) : null;
    };

    /**
     * Returns the parsed version lines from the given ribbit versions document.
     *
     * @param {string} ribbitMultipart - The full MIME multipart document from Ribbit.
     * @param {string} [disposition='version'] - The content-disposition part to extract.
     * @returns {Object<string, VersionLine>} - A map of region => version line data.
     */
    this.getVersionLines = function (ribbitMultipart, disposition = 'version') {
        const doc = getMimePart(ribbitMultipart, disposition);

        const lines = {};
        let cols = null;

        for (const rawLine of doc.split('\n')) {
            const line = rawLine.trim();
            if (line.startsWith('#') || !line.includes('|')) {
                continue;
            }

            const splitLine = line.split('|');

            if (cols === null) {
                // Parse header line
                cols = splitLine.map(col => {
                    const exclPos = col.indexOf('!');
                    return exclPos !== -1 ? col.substring(0, exclPos).trim() : col.trim();
                });
                continue;
            }

            if (splitLine.length !== cols.length) {
                continue;
            }

            const entry = Object.fromEntries(cols.map((key, i) => [key, splitLine[i]]));
            //entry.index = lines.length;
            lines[entry[cols[0]]] = entry;
        }

        return lines;
    };

    /**
     * Returns the part of a multipart message which has the given Content-Disposition header.
     *
     * @param {string} multipart - A MIME Multipart message.
     * @param {string} disposition - The content-disposition header value to find.
     * @returns {string}
     */
    function getMimePart(multipart, disposition) {
        const boundaryMatch = multipart.match(/boundary="([-0-9a-f]+)"/);
        if (!boundaryMatch) {
            throw new Error('Boundary not found in multipart header');
        }

        const boundary = boundaryMatch[1];
        const parts = multipart.split(`--${boundary}`);

        // remove doc header and footer
        parts.shift();
        parts.pop();

        const result = {};

        for (const part of parts) {
            const [rawHeader, ...bodyParts] = part.split('\r\n\r\n');
            const body = bodyParts.join('\r\n\r\n').trim();

            const headerMatch = rawHeader.match(/Content-Disposition: ([^\r\n]+)/i);
            if (!headerMatch) continue;

            const headerValue = headerMatch[1].trim();
            result[headerValue] = body;
        }

        if (!(disposition in result)) {
            throw new Error(`Failed to find [${disposition}] section of multipart message.`);
        }

        return result[disposition];
    }
};
