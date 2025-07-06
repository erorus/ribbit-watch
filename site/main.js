(function () {
    /**
     * @typedef {Object} Deets
     * @property {string} configPath
     * @property {string} key
     * @property {string} name
     */

    /** @type {number} The max number of change lists (updates containers) we show on the page. */
    const MAX_UPDATES = 50;

    const CDN_HOST = 'https://level3.blizzard.com/';
    const PRODUCT_CONFIG_PATH = 'tpr/configs/data';

    /** @type {Object<string, Deets>} A map of product => details. */
    let productDeets = {};

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

    const qs = selector => document.querySelector(selector);
    const qsa = selector => document.querySelectorAll(selector);

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
        const rowTemplate = qs('#update-row');
        const rows = document.createDocumentFragment();

        /**
         * Returns value as a text node, or as a link when the field indicates it's a file hash.
         *
         * @param {string} product
         * @param {string} field
         * @param {string} value
         * @returns {Node}
         */
        const makeValueLink = (product, field, value) => {
            if (value === '') {
                return document.createTextNode('\u00A0');
            }

            let url = '';

            switch (field) {
                case 'BuildConfig':
                case 'CDNConfig':
                case 'KeyRing':
                    const path = productDeets[product]?.configPath;
                    if (path) {
                        url = `${CDN_HOST}${path}/config/${value.substring(0, 2)}/${value.substring(2, 4)}/${value}`;
                    }
                    break;

                case 'ProductConfig':
                    url = `${CDN_HOST}${PRODUCT_CONFIG_PATH}/${value.substring(0, 2)}/${value.substring(2, 4)}/${value}`;
                    break;
            }

            const text = document.createTextNode(value);
            if (url) {
                return ce('a', {href: url}, text);
            }

            return text;
        };

        updateMessage.changes.forEach(change => change.diffs.forEach(diff => {
            const row = rowTemplate.content.cloneNode(true);
            const qs = row.querySelector.bind(row);
            const deets = productDeets[change.product];
            qs('.update-row').dataset.product = change.product;
            qs('.update-row').dataset.field = diff.field;
            qs('.update-row-product-product').textContent = change.product;
            qs('.update-row-product-product').href = `https://github.com/erorus-everynothing/ribbit/blob/${updateMessage.commitHash}/products/${change.product}/${change.file}`;
            if (deets?.name) {
                qs('.update-row-product-product').title = deets.name;
            }
            if (deets?.key) {
                qs('.update-row-product-lock').textContent = '🔒';
                qs('.update-row-product-lock').title = `Encrypted: ${deets.key}`;
                qs('.update-row').dataset.encrypted = deets.key;
            }
            qs('.update-row-product-file').textContent = change.file !== 'versions' ? `/${change.file}` : '';
            qs('.update-row-product').dataset.first = `${change.product}|${change.file}`;

            qs('.update-row-keys').textContent = diff.keys.join(' ');
            qs('.update-row-keys').dataset.first = `${change.product}|${change.file}|${diff.keys.join(' ')}`;

            qs('.update-row-field-name-name').textContent = diff.field;
            qs('.update-row-field-values-new').appendChild(makeValueLink(change.product, diff.field, diff.newValue));
            qs('.update-row-field-values-old').appendChild(makeValueLink(change.product, diff.field, diff.oldValue));

            rows.appendChild(row);
        }));

        if (!rows.hasChildNodes()) {
            return;
        }

        const surround = ce('div', {className: 'updates-list-container'});
        {
            const header = qs('#update-header').content.cloneNode(true);
            header.querySelector('.updates-list-time').textContent = makeDate(updateMessage.timestamp);

            const sequence = header.querySelector('.updates-list-sequence');
            sequence.textContent = updateMessage.sequence;
            sequence.href = 'https://github.com/erorus-everynothing/ribbit/commit/' + updateMessage.commitHash;

            surround.appendChild(header);
        }

        const table = ce('table', {className: 'updates-list'}, rows);
        surround.appendChild(table);
        updateFilters(surround);

        const listParent = qs('#updates-list-parent');
        listParent.insertBefore(surround, listParent.firstChild);
        while (listParent.children.length > MAX_UPDATES) {
            listParent.removeChild(listParent.lastChild);
        }
    }

    /**
     * Sets event listeners and initial values in the filters section.
     */
    function filterSetup() {
        const productsBox = qs('#products-filter');
        productsBox.addEventListener('input', () => updateFilters());

        qsa('.columns-filter')
            .forEach(ele => ele.addEventListener('change', () => updateFilters()));

        qs('#encrypted-filter').addEventListener('change', () => updateFilters());

        qs('#filters-reset').addEventListener('click', () => {
            productsBox.value = '';
            qsa('.columns-filter').forEach(checkbox => checkbox.checked = true);
            updateFilters();
        });

        qs('#filters-load').addEventListener('click', () => {
            readLocalStorage();
            updateFilters();
        });

        qs('#filters-save').addEventListener('click', () => {
            try {
                const save = (key, value) => {
                    if (value === '') {
                        localStorage.removeItem(key);
                    } else {
                        localStorage.setItem(key, value);
                    }
                };

                save('products', productsBox.value.trim());
                save('skipFields', Array.from(qsa('.columns-filter'))
                    .filter(checkbox => !checkbox.checked)
                    .map(checkbox => checkbox.value)
                    .join(' '));
                save('skipEncrypted', qs('#encrypted-filter').checked ? '' : 'true');
            } catch (e) {
                console.warn('Could not save settings in local storage.', e);
            }
        });
    }

    /**
     * Returns a regex we can apply to a product string to determine whether it is filtered by the user's preferences.
     *
     * @returns {RegExp}
     */
    function getProductsRegex() {
        const ele = qs('#products-filter');
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
     * Sets our filters to reflect those in local storage.
     */
    function readLocalStorage() {
        let products = '';
        let skipFields = '';
        let skipEncrypted = '';
        try {
            products = localStorage.getItem('products') ?? '';
            skipFields = localStorage.getItem('skipFields') ?? '';
            skipEncrypted = localStorage.getItem('skipEncrypted') ?? '';
        } catch (e) {
            console.warn('Could not read local storage.', e);
        }

        const productsEle = qs('#products-filter');
        productsEle.value = products;
        qs('#encrypted-filter').checked = skipEncrypted === '';
        skipFields = skipFields.split(/\s+/);
        qsa('.columns-filter')
            .forEach(checkbox => checkbox.checked = !skipFields.includes(checkbox.value));
    }

    /**
     * Sets our filters to reflect those in this page's location.
     *
     * @returns {boolean} True when we used things from the location.
     */
    function readLocation() {
        const url = new URL(location.href);
        const productsEle = qs('#products-filter');
        productsEle.value = url.searchParams.get('products') ?? '';
        const encryptedEle = qs('#encrypted-filter');
        encryptedEle.checked = (url.searchParams.get('encrypted') ?? '') === '';
        const skipFields = (url.searchParams.get('skipFields') ?? '').split(/\s+/);
        qsa('.columns-filter')
            .forEach(checkbox => checkbox.checked = !skipFields.includes(checkbox.value));

        return (productsEle.value !== '') || !encryptedEle.checked || (qs('.columns-filter:not(:checked)') != null);
    }

    /**
     * Updates the given/all containers to hide/display rows which match the user's filters. Containers which have no
     * rows visible are themselves hidden.
     *
     * @param {HTMLElement} [container] A single updates-list-container to update.
     */
    function updateFilters(container) {
        const containers = container ? [container] : qsa('.updates-list-container');
        const deniedFields = Array.from(qsa('.columns-filter'))
            .filter(checkbox => !checkbox.checked)
            .map(checkbox => checkbox.value);

        const productsRegex = getProductsRegex();
        const encryptedEle = qs('#encrypted-filter');
        containers.forEach(container => {
            container.querySelectorAll('.update-row[data-product]').forEach(row => {
                row.classList.toggle('filtered',
                    !productsRegex.test(row.dataset.product) ||
                    deniedFields.includes(row.dataset.field) ||
                    (!encryptedEle.checked && !!row.dataset.encrypted)
                );
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

        // Update URL
        const productsFilter = qs('#products-filter').value.trim();
        const params = new URLSearchParams();
        if (productsFilter !== '') {
            params.set('products', productsFilter);
        }
        if (deniedFields.length) {
            params.set('skipFields', deniedFields.join(' '));
        }
        if (!encryptedEle.checked) {
            params.set('encrypted', 'no');
        }
        if (location.search.replace(/^\?/, '') !== params.toString()) {
            const next = new URL(location.href);
            next.search = params.toString();
            history.pushState({}, '', next);
        }
    }

    /**
     * Initial setup.
     */
    async function main() {
        filterSetup();
        readLocation() || readLocalStorage();
        window.addEventListener('popstate', () => {readLocation(); updateFilters()});

        {
            const response = await fetch('deets.json', {credentials: 'omit', mode: 'same-origin'});
            productDeets = await response.json();
        }

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

    window.addEventListener('DOMContentLoaded', () => main());
})();
