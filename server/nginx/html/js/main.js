'use strict';

import * as r8 from '/js/r8.js';

document.addEventListener('DOMContentLoaded', () => {
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
    "enter_dashboard": (detail) => {
        const packages = document.querySelector('rc-packages');
        packages.host = r8.R8HostLocal.host;
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
