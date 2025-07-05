(function () {
    /** @type {number} The max number of change lists (updates containers) we show on the page. */
    const MAX_UPDATES = 50;

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
     * Creates a new updates list and adds it to the DOM for the given update message.
     *
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
            qs('.update-row').dataset.product = change.product;
            qs('.update-row-product-product').textContent = change.product;
            qs('.update-row-product-product').href = `https://github.com/erorus-everynothing/ribbit/blob/${updateMessage.commitHash}/products/${change.product}/${change.file}`;
            qs('.update-row-product-file').textContent = change.file !== 'versions' ? ` (${change.file})` : '';
            qs('.update-row-product').dataset.first = `${change.product}|${change.file}`;

            qs('.update-row-keys').textContent = diff.keys.join(' ');
            qs('.update-row-keys').dataset.first = `${change.product}|${change.file}|${diff.keys.join(' ')}`;

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

            const sequence = header.querySelector('.updates-list-sequence');
            sequence.textContent = updateMessage.sequence;
            sequence.href = 'https://github.com/erorus-everynothing/ribbit/commit/' + updateMessage.commitHash;

            surround.appendChild(header);
        }

        const table = ce('table', {className: 'updates-list'}, rows);
        surround.appendChild(table);
        updateFilters(surround);

        const listParent = document.querySelector('#updates-list-parent');
        listParent.insertBefore(surround, listParent.firstChild);
        while (listParent.children.length > MAX_UPDATES) {
            listParent.removeChild(listParent.lastChild);
        }
    }

    /**
     * Sets event listeners and initial values in the filters section.
     */
    function filterSetup() {
        const productsBox = document.querySelector('#products-filter');
        let origValue;
        try {
            origValue = localStorage.getItem('products') ?? '';
            if (origValue !== '') {
                productsBox.value = origValue;
            }
        } catch (e) {
            console.log('Failed to get products from local storage.');
        }
        productsBox.addEventListener('input', () => {
            updateFilters();

            const value = productsBox.value.trim();
            try {
                if (value === '') {
                    localStorage.removeItem('products');
                } else {
                    localStorage.setItem('products', value);
                }
            } catch (e) {
                console.warn('Failed to update local storage', e);
            }
        });
    }

    /**
     * Returns a regex we can apply to a product string to determine whether it is filtered by the user's preferences.
     *
     * @returns {RegExp}
     */
    function getProductsRegex() {
        const ele = document.querySelector('#products-filter');
        const input = ele.value.trim();
        delete ele.dataset.invalid;

        if (input === '') {
            return /.*/;
        }

        let match = /^\/([\w\W]+)\/([iu]*)$/.exec(input);
        if (match) {
            try {
                return new RegExp(match[1], match[2]);
            } catch (e) {
                ele.dataset.invalid = 'true';
                return /^$/;
            }
        }

        return new RegExp(
            '^(?:' +
                Array.from(input.matchAll(/[\w*]+/g)).map(match => '(?:' + match[0].replace(/\*/g, '.*') + ')').join('|') +
                ')$',
            'i'
        );
    }

    /**
     * Updates the given/all containers to hide/display rows which match the user's filters. Containers which have no
     * rows visible are themselves hidden.
     *
     * @param {HTMLElement} [container] A single updates-list-container to update.
     */
    function updateFilters(container) {
        const containers = container ? [container] : document.querySelectorAll('.updates-list-container');

        const productsRegex = getProductsRegex();
        containers.forEach(container => {
            container.querySelectorAll('.update-row[data-product]').forEach(row => {
                row.classList.toggle('filtered', !productsRegex.test(row.dataset.product));
            });

            if (!container.querySelector('.update-row:not(.filtered)')) {
                container.classList.add('filtered');

                return;
            }

            container.classList.remove('filtered');
            container.querySelectorAll('[data-first]').forEach(firstEle => {
                const siblings = container.querySelectorAll(`[data-first="${firstEle.dataset.first}"]`);
                firstEle.classList.remove('hidden');
                for (let index = 0; index < siblings.length; index++) {
                    if (siblings[index] === firstEle) {
                        // All prior siblings are filtered. Stay visible.
                        break;
                    }
                    if (!siblings[index].closest('.filtered')) {
                        // This prior sibling is shown. So hide myself.
                        firstEle.classList.add('hidden');
                        break;
                    }
                    // This prior sibling is filtered. Continue looking.
                }
            });
        });
    }

    /**
     * Initial setup.
     */
    function main() {
        filterSetup();

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
