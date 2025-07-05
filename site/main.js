(function () {
    /**
     * Create Element.
     *
     * @param {string} tag
     * @param {object} [props]
     * @param {HTMLElement} [child]
     * @return {HTMLElement}
     */
    function ce(tag, props, child) {
        const result = document.createElement(tag);

        co(result, props || {});

        if (child) {
            result.appendChild(child);
        }

        return result;
    }

    /**
     * Copy Object. Properties from source are set onto dest.
     *
     * @param {object} dest
     * @param {object} source
     */
    function co(dest, source) {
        for (let k in source) {
            if (!source.hasOwnProperty(k)) {
                continue;
            }
            if (typeof source[k] === 'object') {
                if (Array.isArray(source[k])) {
                    dest[k] = source[k].slice(0);
                } else {
                    if (!(k in dest)) {
                        dest[k] = {};
                    }
                    co(dest[k], source[k]);
                }
            } else {
                dest[k] = source[k];
            }
        }
    }

    /**
     * Returns a formatted string for the given timestamp.
     *
     * @param {number} timestamp
     * @returns {string}
     */
    function makeDate(timestamp) {
        const shortFormatter = new Intl.DateTimeFormat([], {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        });

        return shortFormatter.format(new Date(timestamp))
    }

    /**
     * @param {UpdateMessage} updateMessage
     */
    function logChanges(updateMessage) {
        const rowTemplate = document.querySelector('#update-row');
        const rows = document.createDocumentFragment();

        const prev = {};
        const first = (key, value) => {
            if (prev[key] === value) {
                return false;
            }
            prev[key] = value;

            return true;
        };

        updateMessage.changes.forEach(change => change.diffs.forEach(diff => {
            const row = rowTemplate.content.cloneNode(true);
            const qs = row.querySelector.bind(row);
            qs('.update-row-product-product').textContent = change.product;
            qs('.update-row-product-file').textContent = change.file !== 'versions' ? ` (${change.file})` : '';
            qs('.update-row-product').classList.toggle('hidden', !first('prod', `${change.product}|${change.file}`));

            qs('.update-row-keys').textContent = diff.keys.join(' ');
            qs('.update-row-keys').classList.toggle('hidden', !first('keys', `${change.product}|${change.file}|${diff.keys.join(' ')}`));

            qs('.update-row-field-name-name').textContent = diff.field;
            qs('.update-row-field-values-new').textContent = diff.newValue || '\u00A0';
            qs('.update-row-field-values-old').textContent = diff.oldValue || '\u00A0';

            rows.appendChild(row);
        }));

        if (!rows.hasChildNodes()) {
            return;
        }

        const surround = ce('div', {className: 'updates-list-container'});
        {
            const header = document.querySelector('#update-header').content.cloneNode(true);
            header.querySelector('.updates-list-time').textContent = makeDate(updateMessage.timestamp);

            surround.appendChild(header);
        }

        const table = ce('table', {className: 'updates-list'}, rows);
        surround.appendChild(table);

        const listParent = document.querySelector('#updates-list-parent');
        listParent.insertBefore(surround, listParent.firstChild);
    }

    function main() {
        let lastSequence = 0;
        const socket = new WebSocket('ws://localhost:8001');
        socket.addEventListener('message', event => {
            /** @type {UpdateMessage} */
            const entry = JSON.parse(event.data);
            if (entry.sequence < lastSequence) {
                return;
            }

            lastSequence = entry.sequence;
            logChanges(entry);
        });
    }

    addEventListener('DOMContentLoaded', () => main());
})();
