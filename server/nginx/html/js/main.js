'use strict';

function isPageDirty() {
    return document.body.classList.contains('dirty');
}

function setPageDirty(isDirty) {
    if (isPageDirty() == isDirty) {
        return;
    }

    document.body.classList.toggle('dirty', isDirty);
}

function initNewTermDialog() {
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
}

document.addEventListener('DOMContentLoaded', async () => {
    document.addEventListener('spa.enterPage', (e) => {
        document.body.classList.remove('dirty');

        notifyWidgets('enter', e.detail);
        setupNotifyListener();
    });

    document.addEventListener('spa.exitPage', (e) => {
        notifyWidgets('exit', e.detail);
    });

    document.addEventListener('click', (e) => {
        const a = e.target.closest('a');

        if (a && isPageDirty()) {
            if (!confirm(`Abandon your changes?`)) {
                e.preventDefault();
                e.stopPropagation();

                return false;
            }
        }

        const summary = e.target.closest('summary');

        if (summary && e.target.tagName == 'LABEL') {
            e.target.closest('details').toggleAttribute('open');
        }
    }, {capture: true});

    addEventListener('beforeunload', (e) => {
        if (isPageDirty()) {
            e.preventDefault();
            return e.returnValue = `Abandon your changes?`;
        }
    }, {capture: true});

    document.addEventListener('ph-loaded', (e) => {
        refreshPage();
    });

    document.addEventListener('keydown', (e) => {
        switch (e.code) {
            case 'KeyS': {
                if (e.ctrlKey) {
                    e.preventDefault();

                    if ('saveButton' in window) {
                        saveButton.click();
                    }

                    return false;
                }
            } break;

            case 'Escape': {
                if ('cancelButton' in window) {
                    e.preventDefault();

                    cancelButton.click();

                    return false;
                }
            } break;
        }
    });

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
    },
    "exit_update_package": async (detail) => {
        focusPackage && delete window.focusPackage;
    },
    "enter_undefinedtermswidget": async (detail) => {
        undefinedtermswidget.querySelectorAll('x-token').forEach(el => {
            el.package = window.focusPackage;
        });
    },
    "enter_testformwidget": async (detail) => {
        testform.addEventListener('input', async (e) => {
            const focusTerm = e.target.closest('*[data-focusterm]').getAttribute('data-focusterm');
            const formData = new FormData(e.target.form);
            const url = `/api/packages/${focusPackage.id}/products/${focusTerm}?${new URLSearchParams(formData)}`;
            console.log('test url ', url);
            document.body.classList.add('busy');
            await fetch(url)
                .then(async resp => {
                    if (resp.ok) {
                        const json = await resp.json();

                        console.log('value: ', JSON.stringify(json));
                        testformoutput.innerText = json[focusTerm];
                    }
                })
                .finally(() => {
                    document.body.classList.remove('busy');
                });
        });
    },
    "enter_termlistwidget": async (detail) => {
        termlistfilter.addEventListener('change', (e) => {
            const filter = e.target.value;

            termlistwidget.querySelectorAll('#termlist li').forEach(li => {
                li.classList.toggle('hidden', filter && !li.hasAttribute(filter));
            });

            e.target.closest('details').toggleAttribute('open', true);
        });
    },
    "enter_package_home": async (detail) => {
        if ('cancelButton' in window)  {
            cancelButton.addEventListener('click', (e) => {
                if (confirm('Abandon your changes and reload?')) {
                    renderRequest('GET', location.href, null, updateState='replaceState');
                }
            });
        }
    },
    "enter_package_editor": async (detail) => {
        products.addEventListener('x.tileClicked', (e) => {
            const termName = e.target.getAttribute('data-termname');

            if (termName) {
                pushEditTerm(termName);
            }
        });
    },
    "enter_term_editor": (detail) => {
        deleteButton.addEventListener('click', (e) => {
            if (confirm('Delete this term?')) {
                const csrf = e.target.closest('x-page').getAttribute('data-csrf');
                const termName = e.target.closest('*[data-termname]').getAttribute('data-termname');

                renderRequest('POST', location.href, {
                    '_csrf': csrf,
                    'serviceAction': 'deleteTerm',
                    'termName': termName
                }).then(res => {
                    if (res && res.ok) {
                        const url = new URL('', location.href);
                        url.searchParams.delete('ts');
                        url.hash = location.hash;

                        renderRequest('GET', url, null, updateState="replaceState");
                    }
                })
            }
        });
    },
    "enter_expression_editor": async (detail) => {
        console.assert(focusPackage);
        editor.package = focusPackage;

        function hasTermChanged() {
            return editor.isDirty
                || description.value != description.getAttribute('data-initialvalue');
        }

        const page = document.querySelector('x-page');

        page.addEventListener('input', (e) => {
            setPageDirty(hasTermChanged());
            saveButton.disabled = !isPageDirty();
            cancelButton.disabled = !isPageDirty();
        });

        page.addEventListener('x.openToken', (e) => {
            const token = e.detail.token;

            if (isPageDirty()) {
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
                'description': description.value,
                'value': editor.value
            }, updateState='replaceState');
        });

        initNewTermDialog();
    },
    "enter_constant_editor": async (detail) => {
        function hasTermChanged() {
            return constantValue.value != constantValue.getAttribute('data-originalvalue')
                || description.value != description.getAttribute('data-initialvalue');
        }

        document.querySelector('x-page').addEventListener('input', (e) => {
            document.body.classList.toggle('dirty', hasTermChanged());
            saveButton.disabled = !hasTermChanged();
            cancelButton.disabled = !hasTermChanged();
        });

        saveButton.addEventListener('click', (e) => {
            if (e.target.disabled) {
                return;
            }

            const csrf = e.target.closest('x-page').getAttribute('data-csrf');
            const termName = e.target.closest('*[data-termname]').getAttribute('data-termname');

            renderRequest('POST', location.href, {
                '_csrf': csrf,
                'serviceAction': 'saveTerm',
                'termName': termName,
                'description': description.value,
                'value': constantValue.value
            }, updateState='replaceState');
        });
    },
    "enter_input_editor": async (detail) => {
        const page = document.querySelector('x-page');
        const csrf = page.getAttribute('data-csrf');
        const termName = page.querySelector('*[data-termname]').getAttribute('data-termname');

        function hasTermChanged() {
            return description.value != description.getAttribute('data-initialvalue')
                    || dataType.value != dataType.getAttribute('data-initialvalue');
        }

        document.querySelector('x-page').addEventListener('input', (e) => {
            document.body.classList.toggle('dirty', hasTermChanged());
            saveButton.disabled = !hasTermChanged();
            cancelButton.disabled = !hasTermChanged();
        });

        saveButton.addEventListener('click', (e) => {
            if (e.target.disabled) {
                return;
            }

            renderRequest('POST', location.href, {
                '_csrf': csrf,
                'serviceAction': 'saveTerm',
                'termName': termName,
                'description': description.value,
                'dataType': dataType.value,
            }, updateState='replaceState');
        });

    },
    "enter_table_editor": async (detail) => {
        const page = document.querySelector('x-page');
        const csrf = page.getAttribute('data-csrf');
        const termName = page.querySelector('*[data-termname]').getAttribute('data-termname');

        function hasTermChanged() {
            return description.value != description.getAttribute('data-initialvalue');
        }

        page.addEventListener('input', (e) => {
            document.body.classList.toggle('dirty', hasTermChanged());
            saveButton.disabled = !hasTermChanged();
            cancelButton.disabled = !hasTermChanged();
        });

        saveButton.addEventListener('click', (e) => {
            renderRequest('POST', location.href, {
                '_csrf': csrf,
                'serviceAction': 'saveTerm',
                'termName': termName,
                'description': description.value
            }, updateState='replaceState');
        });

        termTable.addEventListener('x.addKeyTerm', (e) => {
            renderRequest('POST', location.href, {
                '_csrf': csrf,
                'serviceAction': 'addKeyTerm',
                'termName': termName,
                'keyTermName': e.detail.keyTermName
            }, updateState='replaceState');
        });

        termTable.addEventListener('x.deleteKeyTerm', (e) => {
            renderRequest('POST', location.href, {
                '_csrf': csrf,
                'serviceAction': 'deleteKeyTerm',
                'termName': termName,
                'keyTermName': e.detail.keyTermName
            }, updateState='replaceState');
        });

        page.addEventListener('x.openToken', (e) => {
            const token = e.detail.token;

            if (isPageDirty()) {
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

        termTable.term = focusPackage.getTerm(termName);

        initNewTermDialog();
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

window['hideElement'] = (e) => {
    const actor = e.target.closest('*[data-action]');

    actor.classList.add('hidden');
}
