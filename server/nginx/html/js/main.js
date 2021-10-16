document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('spa.enterPage', (e) => {
        notifyWidgets('enter', e.detail);
        setupNotifyListener();
    });
    document.addEventListener('spa.exitPage', (e) => {
        notifyWidgets('exit', e.detail);
    });
});

function notifyWidgets(eventName, detail) {
    detail.page && detail.page.querySelectorAll('*[data-id]')
        .forEach( (el) => {
            const id = el.getAttribute('data-id');
            const notifyFnName = ['handle', eventName, id].join('_');

            window[notifyFnName] && window[notifyFnName](detail);
        });
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
