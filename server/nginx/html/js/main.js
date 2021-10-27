'use strict';

document.addEventListener('DOMContentLoaded', async () => {
    document.addEventListener('spa.enterPage', (e) => {
        notifyWidgets('enter', e.detail);
        setupNotifyListener();
    });

    document.addEventListener('spa.exitPage', (e) => {
        notifyWidgets('exit', e.detail);
    });

    document.addEventListener('click', (e) => {
        const a = e.target.closest('a');
        const isDirty = document.body.classList.contains('dirty');

        if (a && isDirty) {
            if (!confirm(`Abandon your changes?`)) {
                e.preventDefault();
                e.stopPropagation();

                return false;
            }
        }
    }, {capture: true});

    addEventListener('beforeunload', (e) => {
        const isDirty = document.body.classList.contains('dirty');

        if (isDirty) {
            e.preventDefault();
            return e.returnValue = `Abandon your changes?`;
        }
    }, {capture: true});

    phInit();
});

function notifyWidgets(eventName, detail) {
    detail.page && detail.page.querySelectorAll('*[data-widgetid]')
        .forEach( (el) => {
            const id = el.getAttribute('data-widgetid');
            const notifyFnName = [eventName, id].join('_');

            console.debug('notifyWidgets', notifyFnName);
            widgetHandlers[notifyFnName] && widgetHandlers[notifyFnName](detail);
        });
}

function openNewTermDialog(termName) {
    newTermDialog.classList.remove('hidden');
    newTermName.innerText = termName;
}

function  cancelNewTermDialog() {
    newTermDialog.classList.add('hidden');
}

function pushEditTerm(termName) {
    const url = new URL(location.href);
    url.searchParams.append('ts', termName);

    renderRequest('GET', url, null, updateState="replaceState");
}

function pushCreateTerm(termName, termType) {
    const csrf = document.querySelector('x-page').getAttribute('data-csrf');
    const url = new URL(location.href);
    url.searchParams.append('ts', termName);

    renderRequest('POST', url, {
        '_csrf': csrf,
        'serviceAction': 'createTerm',
        'termName': termName,
        'termType': termType
    }, updateState='pushState');
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
    "enter_update_package": async (detail) => {
        const json = eval(packageJson.innerText)();
        window.focusPackage = R8Package.fromJson(json);
        'editor' in window && (editor.package = focusPackage);
    },
    "exit_update_package": async (detail) => {
        focusPackage && delete window.focusPackage;
    },
    "enter_package_editor": async (detail) => {
        products.addEventListener('x.tileClicked', (e) => {
            const termName = e.target.getAttribute('data-termname');

            if (termName) {
                pushEditTerm(termName);
            }
        });
    },
    "enter_expression_editor": async (detail) => {
        document.body.classList.remove('dirty');

        editor.addEventListener('input', (e) => {
            document.body.classList.toggle('dirty', e.target.isDirty);
            saveButton.disabled = !e.target.isDirty;
        });

        editor.addEventListener('x.openToken', (e) => {
            const token = e.detail.token;

            if (editor.isDirty) {
                // !!!TBD!!! this is very ugly, but it's quick and dirty
                // need to come up with a better plan
                alert('Save or abort your changes before editing another term.');

                return;
            }

            const term = focusPackage.getTerm(token.value);
            if (!term) {
                openNewTermDialog(token.value);
            } else {
                pushEditTerm(term.name);
            }
        });

        saveButton.addEventListener('click', (e) => {
            const csrf = e.target.closest('x-page').getAttribute('data-csrf');
            const termName = e.target.closest('*[data-termname]').getAttribute('data-termname');

            renderRequest('POST', location.href, {
                '_csrf': csrf,
                'serviceAction': 'saveTerm',
                'termName': termName,
                'value': editor.value
            }, updateState='replaceState');
        });

        newTermDialog.addEventListener('click', (e) => {
            if (e.target.name == 'cancel'
                    || e.target.classList.contains('cancelBackground')) {
                cancelNewTermDialog();
            }
            const li = e.target.closest('li');
            if (li) {
                const newTermType = li.innerText.trim().toLowerCase();
                pushCreateTerm(newTermName.innerText, newTermType);
            }
        });
    },
    "enter_constant_editor": async (detail) => {
        document.body.classList.remove('dirty');

        constantValue.addEventListener('input', (e) => {
            const isDirty = constantValue.value != constantValue.getAttribute('data-originalvalue');

            document.body.classList.toggle('dirty', isDirty);
            saveButton.disabled = !isDirty;
        });

        saveButton.addEventListener('click', (e) => {
            const csrf = e.target.closest('x-page').getAttribute('data-csrf');
            const termName = e.target.closest('*[data-termname]').getAttribute('data-termname');

            renderRequest('POST', location.href, {
                '_csrf': csrf,
                'serviceAction': 'saveTerm',
                'termName': termName,
                'value': constantValue.value
            }, updateState='replaceState');
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
