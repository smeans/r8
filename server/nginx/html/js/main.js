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

function setPageEditing(page) {
    page.classList.remove('mode-default');
    page.classList.remove('mode-test');
    page.classList.add('mode-edit');
}

function getPageMode(page) {
    const mode = Array.from(page.classList).filter(v => v.startsWith('mode-')).pop();

    return mode && mode.replace('mode-', '') || 'mode-default';
}

function getPageHref(newMode) {
    const url = new URL(location.href);
    const pageMode = getPageMode(document.querySelector('x-page'));

    url.searchParams.set('mode', newMode || pageMode);

    return url;
}

function getFocusTerm() {
    const url = new URL(location.href);

    return url.searchParams.getAll('ts').pop();
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
        const qp = new URLSearchParams(location.search);

        document.body.classList.remove('dirty');

        notifyWidgets('enter', e.detail);
        setupNotifyListener();

        const pageMode = qp.get('mode');
        if (['edit', 'test'].indexOf(pageMode) >= 0) {
            if (`${pageMode}Button` in window) {
                window[`${pageMode}Button`].click();
            }
        }        
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

        if (currentModal && !currentModal.contains(e.target)
                && !e.target.closest('*[data-action]')) {
            hideModal();
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

    document.addEventListener('input', (e) => {
        if (e.target.type != 'search' || !e.target.hasAttribute('data-searchtarget')) {
            return;
        }

        const searchString = e.target.value.toLowerCase();
        const items = document.querySelectorAll(e.target.getAttribute('data-searchtarget'));

        items.forEach((item, i) => {
            item.classList.toggle('unmatched', !item.innerText.toLowerCase().includes(searchString));
        });
    });

    phInit();
});

function notifyWidgets(eventName, detail) {
    if (!detail.page) {
        return;
    }

    const page = detail.page;
    const notifyList = [];

    if (page.hasAttribute('data-widgetid')) {
        notifyList.push([eventName, page.getAttribute('data-widgetid')].join('_'));
    }

    page.querySelectorAll('*[data-widgetid]')
        .forEach( (el) => {
            const id = el.getAttribute('data-widgetid');
            const notifyFnName = [eventName, id].join('_');

            notifyList.push(notifyFnName);
        });

    notifyList.forEach((notifyFnName) => {
        console.debug('notifyWidgets', notifyFnName);
        widgetHandlers[notifyFnName] && widgetHandlers[notifyFnName](detail);
    });
}

function openNewTermDialog(termName) {
    newTermDialog.classList.remove('hidden');
    newTermName.innerText = termName;
}

function cancelNewTermDialog() {
    newTermDialog.classList.add('hidden');
}

function openTestDialog(e) {
    testDialog.classList.remove('hidden');
    activateTab(testTabLinks.firstElementChild);

    refreshTestForm();
}

window['closeTestDialog'] = (e) => {
    testDialog.classList.add('hidden');
}

function pushEditTerm(termName) {    
    if (getFocusTerm() == termName) {
        return;
    }
    
    const url = new URL(getPageHref());
    url.searchParams.append('ts', termName);

    renderRequest('GET', url, null, updateState="replaceState");
}

function pushCreateTerm(termName, termType) {
    const csrf = document.querySelector('x-page').getAttribute('data-csrf');
    const url = new URL(location.href);
    url.searchParams.append('ts', termName);
    url.searchParams.set('mode', 'edit');

    renderRequest('POST', url, {
        '_csrf': csrf,
        'serviceAction': 'createTerm',
        'termName': termName,
        'termType': termType
    }, updateState='pushState');
}

const widgetHandlers = {
    "enter_login": async (detail) => {
        document.forms.login.email.focus();
    },
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
                return renderRequest('POST', getPageHref(), {
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
        const linter = new R8Linter(packageJson.getAttribute('data-linter'));
        window.focusPackage = R8Package.fromJson(json, linter);
    },
    "exit_update_package": async (detail) => {
        window['focusPackage'] && delete window.focusPackage;
    },
    "enter_undefinedtermswidget": async (detail) => {
        undefinedtermswidget.querySelectorAll('x-token').forEach(el => {
            el.package = window.focusPackage;
        });
    },
    "enter_testformwidget": async (detail) => {
        testDialog.addEventListener('input', (e) => refreshTestForm(e.target));
        testDialog.addEventListener('keydown', (e) => {
            if (e.code == 'Enter') {
                e.preventDefault();

                return false;
            }
        });

        refreshTestForm(testform);
    },
    "enter_termlistwidget": async (detail) => {
    },
    "enter_package_home": async (detail) => {
        if ('cancelButton' in window)  {
            cancelButton.addEventListener('click', (e) => {
                const page = e.target.closest('x-page');

                if (page && getPageMode(page) != 'edit') {
                    return;
                }

                if (!isPageDirty() || confirm('Abandon your changes and reload?')) {
                    const url = getPageHref();
                    url.searchParams.delete('mode');

                    renderRequest('GET', url, null, updateState='replaceState');
                }
            });
        }

        if ('testButton' in window) {
            testButton.addEventListener('click', openTestDialog);
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
        if ('deleteButton' in window) {
            deleteButton.addEventListener('click', (e) => {
                if (confirm('Delete this term?')) {
                    const csrf = e.target.closest('x-page').getAttribute('data-csrf');
                    const termName = e.target.closest('*[data-termname]').getAttribute('data-termname');

                    renderRequest('POST', getPageHref(), {
                        '_csrf': csrf,
                        'serviceAction': 'deleteTerm',
                        'termName': termName
                    }).then(res => {
                        if (res && res.ok) {
                            const url = new URL('', getPageHref('default'));
                            url.searchParams.delete('ts');
                            url.hash = location.hash;

                            renderRequest('GET', url, null, updateState="replaceState");
                        }
                    })
                }
            });
        }
    },
    "enter_expression_editor": async (detail) => {
        console.assert(focusPackage);
        editor.package = focusPackage;

        function hasTermChanged() {
            return editor.isDirty
                || description.value != description.getAttribute('data-initialvalue')
                || dataType.value != dataType.getAttribute('data-initialvalue');
        }

        const page = document.querySelector('x-page');

        page.addEventListener('input', (e) => {
            setPageDirty(hasTermChanged());
            saveButton.disabled = !isPageDirty();
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

            const errors = editor.errors;
            expressionErrors.classList.toggle('hidden', errors.length <= 0);

            if (errors.length) {
                expressionErrors.innerHTML = `<li>${errors.join('</li><li>')}</li>`;

                return;
            }

            renderRequest('POST', getPageHref('view'), {
                '_csrf': csrf,
                'serviceAction': 'saveTerm',
                'termName': termName,
                'description': description.value,
                'dataType': dataType.value,
                'value': editor.value
            }, updateState='replaceState');
        });

        window['editButton'] && editButton.addEventListener('click', (e) => {
            const page = e.target.closest('x-page');
            setPageEditing(page)

            dataType.disabled =
            description.disabled =
            editor.disabled = false;

            editor.focus();
        });

        editor.addEventListener('dblclick', (e) => {
            const page = e.target.closest('x-page');

            if (getPageMode(page) == 'default') {
                editButton.click();
            }
        });

        initNewTermDialog();
    },
    "enter_constant_editor": async (detail) => {
        function hasTermChanged() {
            return dataType.value != dataType.getAttribute('data-initialvalue')
                || description.value != description.getAttribute('data-initialvalue')
                || constantValue.value != constantValue.getAttribute('data-originalvalue');
        }

        function updateInputMethod() {
            const inputAttrs = {
                "String": {type: "text", placeholder: ""},
                "Integer": {type: "number", placeholder: "#"},
                "Currency": {type: "number", placeholder: "#.##"},
                "Float": {type: "number", placeholder: "#.##"},
                "Date": {type: "date", placeholder: "yyyy-mm-dd"},
                "DateTime": {type: "datetime-local", "placeholder": "yyyy-mm-dd hh:mm:ss"}
            }[dataType.value] || {type: 'text', placeholder: null};
            constantValue.type = inputAttrs.type;
            constantValue.placeholder = inputAttrs.placeholder;
        }

        document.querySelector('x-page').addEventListener('input', (e) => {
            if (e.target == dataType) {
                updateInputMethod();
            }
            document.body.classList.toggle('dirty', hasTermChanged());
            saveButton.disabled = !hasTermChanged();
        });

        saveButton.addEventListener('click', (e) => {
            if (e.target.disabled) {
                return;
            }

            const csrf = e.target.closest('x-page').getAttribute('data-csrf');
            const termName = e.target.closest('*[data-termname]').getAttribute('data-termname');

            renderRequest('POST', getPageHref('view'), {
                '_csrf': csrf,
                'serviceAction': 'saveTerm',
                'termName': termName,
                'dataType': dataType.value,
                'description': description.value,
                'value': constantValue.value
            }, updateState='replaceState');
        });

        editButton.addEventListener('click', (e) => {
            const page = e.target.closest('x-page');
            setPageEditing(page);

            dataType.disabled =
            description.disabled =
            constantValue.disabled = false;

            constantValue.focus();
        });

        updateInputMethod();
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
        });

        saveButton.addEventListener('click', (e) => {
            if (e.target.disabled) {
                return;
            }

            renderRequest('POST', getPageHref('view'), {
                '_csrf': csrf,
                'serviceAction': 'saveTerm',
                'termName': termName,
                'description': description.value,
                'dataType': dataType.value,
            }, updateState='replaceState');
        });

        editButton.addEventListener('click', (e) => {
            const page = e.target.closest('x-page');
            setPageEditing(page);

            dataType.disabled =
            description.disabled = false;
        });
    },
    "enter_table_editor": async (detail) => {
        const page = document.querySelector('x-page');
        const csrf = page.getAttribute('data-csrf');
        const termName = page.querySelector('*[data-termname]').getAttribute('data-termname');

        function hasTermChanged() {
            return description.value != description.getAttribute('data-initialvalue')
                || dataType.value != dataType.getAttribute('data-initialvalue');
        }

        page.addEventListener('input', (e) => {
            document.body.classList.toggle('dirty', hasTermChanged());
            saveButton.disabled = !hasTermChanged();
        });

        saveButton.addEventListener('click', (e) => {
            renderRequest('POST', getPageHref('view'), {
                '_csrf': csrf,
                'serviceAction': 'saveTerm',
                'termName': termName,
                'description': description.value,
                'dataType': dataType.value
            }, updateState='replaceState');
        });

        editButton.addEventListener('click', (e) => {
            const page = e.target.closest('x-page');

            setPageEditing(page);

            dataType.disabled =
            description.disabled =
            termTable.disabled = false;

            saveButton.disabled = true;
        });


        termTable.addEventListener('x.addKeyTerm', (e) => {
            renderRequest('POST', getPageHref(), {
                '_csrf': csrf,
                'serviceAction': 'addKeyTerm',
                'termName': termName,
                'keyTermName': e.detail.keyTermName
            }, updateState='replaceState');
        });

        termTable.addEventListener('x.deleteKeyTerm', (e) => {
            renderRequest('POST', getPageHref(), {
                '_csrf': csrf,
                'serviceAction': 'deleteKeyTerm',
                'termName': termName,
                'keyTermName': e.detail.keyTermName
            }, updateState='replaceState');
        });

        termTable.addEventListener('x.changeKeyTermMatchType', (e) => {
            renderRequest('POST', getPageHref(), {
                '_csrf': csrf,
                'serviceAction': 'changeKeyTermMatchType',
                'termName': termName,
                'keyTermName': e.detail.keyTermName,
                'matchType': e.detail.matchType
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
    },
    "enter_settings_home": async (detail) => {
    }
}

let notifySocket = null;

function setupNotifyListener() {
    if (notifySocket) {
        return;
    }

    notifySocket = new WebSocket(`wss:${location.hostname}:${location.port}/websocket/`);
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

let currentModal = null;

function _applyModalStyles(show) {
    if (!currentModal) {
        return;
    }

    if (!currentModal.hasAttribute('data-modalout')) {
        currentModal && currentModal.classList.toggle('hidden', !show);

        return;
    }

    let outStyles = currentModal.getAttribute('data-modalout') || '';
    outStyles = outStyles.split(/\s+/);
    let inStyles = currentModal.getAttribute('data-modalin') || '';
    inStyles = inStyles.split(/\s+/);

    if (show) {
        currentModal.classList.remove(...outStyles);
        currentModal.classList.add(...inStyles);
    } else {
        currentModal.classList.remove(...inStyles);
        currentModal.classList.add(...outStyles);
    }
}

window['showModal'] = (target) => {
    const previousModal = currentModal;

    hideModal();

    if (previousModal == target) {
        return;
    }

    currentModal = target;
    if (!currentModal) {
        return;
    }

    _applyModalStyles(true);
    let af = currentModal.querySelector('[autofocus]');
    af && af.focus();
}

window['hideModal'] = () => {
    _applyModalStyles(false);

    currentModal = null;
}

window['toggleModal'] = (e) => {
    const actor = e.target.closest('*[data-action]');
    const targetSelector = actor.getAttribute('data-target');
    const target = document.querySelector(targetSelector);

    if (!target) {
        console.warn(`toggleModal() target "${targetSelector}" not found`);
    }

    showModal(target);
}

window['newTermFromEvent'] = (e) => {
    openNewTermDialog(e.target.innerText.trim());
}

window['handleTabs'] = (e) => {
    const tab = e.target.closest('a');
    if (!tab) {
        return;
    }

    activateTab(tab);
}

function activateTab(tab) {
    const tabs = Array.from(tab.parentElement.children);
    const tabIndex = tabs.indexOf(tab);

    console.log('tabIndex', tabIndex);

    const tabsTarget = document.querySelector(tab.closest("*[data-tabstarget").getAttribute('data-tabstarget'));
    const tabPanes = Array.from(tabsTarget.children);

    for (let i = 0; i < tabs.length; i++) {
        tabs[i].classList = tabIndex == i ? activeTabLink.classList : defaultTabLink.classList;
        tabPanes[i].classList.toggle('hidden', i != tabIndex);
    }
}

window['handleTestTabs'] = (e) => {
    handleTabs(e);

    refreshTestForm();
}

window['refreshTestForm'] = async (target) => {
    if (target instanceof Event) {
        target = target.target;
    }

    if (!target) {
        target = testDialog.querySelector("#testForms>:not(.hidden) form");
    }
    
    const form = target.closest('form');
    const testTerm = target.closest('*[data-testterm]').getAttribute('data-testterm');
    const formData = new FormData(form);
    const url = `/api/packages/${focusPackage.id}/term/${testTerm}?${new URLSearchParams(formData)}`;

    console.debug('test url', url);

    testformerrors.innerHTML = '';

    document.body.classList.add('busy');
    await fetch(url)
        .then(async resp => {
            const json = await resp.json();

            if (resp.ok) {
                form[testTerm].value = json.outputs && json.outputs[testTerm];
            }

            json.log && json.log.forEach(err => {
                const li = document.createElement('li');
                li.innerText = `${err.level}: ${err.term}: ${err.message}`;

                testformerrors.appendChild(li);
            });
        })
        .finally(() => {
            document.body.classList.remove('busy');
        });
}

window['logout'] = (e) => {
    renderRequest('GET', '#/logout', null, updateState="replaceState");
}

window['cycleLoginMessage'] = (e) => {
    let el = e.target;

    while (el && el.parentElement.id != 'loginMessage') {
        el = el.parentElement;
    }

    el.classList.add('hidden');
    const nextEl = el.nextElementSibling || el.parentElement.firstElementChild;

    nextEl.classList.remove('hidden');
}

window['deployPackage'] = (packageId, fromEnvironment) => {
    const csrf = document.querySelector('x-page[data-csrf]').getAttribute('data-csrf');

    renderRequest('POST', getPageHref(), {
        '_csrf': csrf,
        'serviceAction': 'deployPackage',
        'fromEnvironment': fromEnvironment,
        'packageId': packageId
    }).then(res => {
        if (res && res.ok) {
            const url = new URL('', getPageHref('default'));
            url.searchParams.delete('ts');
            url.hash = location.hash;

            renderRequest('GET', url, null, updateState="replaceState");
        }
    });
}

window['clonePackage'] = (packageId, fromEnvironment, effectiveDate) => {
    const form = document.forms.cloneVersion;

    form.packageId.value = packageId;
    form.fromEnvironment.value = fromEnvironment;
    form.querySelector('.environment').innerText = fromEnvironment;
    form.querySelector('.effectiveDate').innerText = effectiveDate;

    showModal(cloneVersionModal);
}

window['confirmDeletePackage'] = (packageId, effectiveDate) => {
    confirmPackageDelete.querySelector('.effectiveDate').innerText = effectiveDate;
    confirmPackageDelete.packageId = packageId;

    showModal(confirmPackageDelete);
}

window['deletePackage'] = (e) => {
    const csrf = document.querySelector('x-page[data-csrf]').getAttribute('data-csrf');

    renderRequest('POST', getPageHref(), {
        '_csrf': csrf,
        'serviceAction': 'deletePackage',
        'packageId': confirmPackageDelete.packageId
    }).then(res => {
        if (res && res.ok) {
            const url = new URL('', getPageHref('default'));
            url.searchParams.delete('ts');
            url.hash = location.hash;

            renderRequest('GET', url, null, updateState="replaceState");
        }
    });
}

window['confirmDeleteApiToken'] = (token, record) => {
    confirmTokenDelete.querySelector('.environment').innerText = record.environment;
    confirmTokenDelete.querySelector('.token').innerText = token;
    confirmTokenDelete.querySelector('.issuedTo').innerText = record.issuedTo;
    confirmTokenDelete.token = token;

    showModal(confirmTokenDelete);
}

window['deleteApiToken'] = (e) => {
    const csrf = document.querySelector('x-page[data-csrf]').getAttribute('data-csrf');

    renderRequest('POST', getPageHref(), {
        '_csrf': csrf,
        'serviceAction': 'revokeApiToken',
        'token': confirmTokenDelete.token
    }).then(res => {
        if (res && res.ok) {
            const url = new URL('', getPageHref('default'));
            url.searchParams.delete('ts');
            url.hash = location.hash;

            renderRequest('GET', url, null, updateState="replaceState");
        }
    });
}

window['confirmDeleteProduct'] = (productId, productName) => {
    confirmProductDelete.querySelector('.productName').innerText = productName;
    confirmProductDelete.productId = productId;

    showModal(confirmProductDelete);
}

window['deleteProduct'] = (e) => {
    const csrf = document.querySelector('x-page[data-csrf]').getAttribute('data-csrf');

    renderRequest('POST', "#/", {
        '_csrf': csrf,
        'serviceAction': 'deleteProduct',
        'productId': confirmProductDelete.productId
    }, updateState="replaceState");
}
