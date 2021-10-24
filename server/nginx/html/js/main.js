'use strict';

import * as r8 from '/js/r8.js';

document.addEventListener('DOMContentLoaded', async () => {
    document.addEventListener('spa.enterPage', (e) => {
        notifyWidgets('enter', e.detail);
        setupNotifyListener();
    });

    document.addEventListener('spa.exitPage', (e) => {
        notifyWidgets('exit', e.detail);
    });

    phInit();
});

function notifyWidgets(eventName, detail) {
    detail.page && detail.page.querySelectorAll('*[data-id]')
        .forEach( (el) => {
            const id = el.getAttribute('data-id');
            const notifyFnName = [eventName, id].join('_');

            console.debug('notifyWidgets', notifyFnName);
            widgetHandlers[notifyFnName] && widgetHandlers[notifyFnName](detail);
        });
}

const widgetHandlers = {
    "enter_dashboard": async (detail) => {
        addPackage.addEventListener('click', (e) => {
            if (packages.querySelector('x-tile.new')) {
                return;
            }

            const np = newPackage.content.children[0].cloneNode(true);
            packages.insertBefore(np, addPackage.closest('x-tile'));
        });
        packages.addEventListener('rc.endPackageTileEditing', (e) => {
            const packageId = e.target.getAttribute('data-id');
            const csrf = e.target.closest('x-page').getAttribute('data-csrf');

            if (!packageId) {
                return renderRequest('POST', location.href, {
                        serviceAction: 'createPackage',
                        _csrf: csrf,
                        packageName: e.detail.newName
                    },
                    updateState='replaceState');
            }

            console.log(e);
        });
        packages.addEventListener('click', (e) => {
            const target = e.target;

            if (!target.closest('#packages')) {
                return;
            }

            const tile = target.closest('x-tile[data-packageid]');
            if (tile) {
                e.preventDefault();

                renderRequest('GET', '#/package/' + tile.getAttribute('data-packageid'), null, updateState='pushState');

                return false;
            }
        });
    },
    "enter_packagehome": async (detail) => {
        function pushEditTerm(termName) {
            const url = new URL(location.href);
            url.searchParams.append('ts', termName);

            renderRequest('GET', url, null, updateState="replaceState");
        }

        products.addEventListener('x.tileClicked', (e) => {
            const termName = e.target.getAttribute('data-termname');

            if (termName) {
                pushEditTerm(termName);
            }
        });
    }
}

let notifySocket = null;

function setupNotifyListener() {
    if (notifySocket) {
        return;
    }

    notifySocket = new WebSocket('ws:' + location.hostname + '/websocket/');
    notifySocket.onopen = (e) => {
        console.log(e);
    }

    notifySocket.onclose = (e) => {
        notifySocket = null;
        console.debug('notifySocket: closed');
    }

    notifySocket.onerror = (e) => {
        console.log(e);
    }

    notifySocket.onmessage = (e) => {
        const message = JSON.parse(e.data);

        switch (message.message) {
            case 'loginConfirmed': {
                renderRequest('GET', '#/', null,
                        updateState='pushState');
            } break;

            default: {
                console.debug(e);
            } break;
        }
    }
}
