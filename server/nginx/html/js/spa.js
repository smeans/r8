document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('submit', handleSubmit);
    ['pushstate', 'popstate'].forEach(event => {
        window.addEventListener(event, handleNavigate);
    });

    document.addEventListener('click', handlePageClick);

    initState();
});

function isInternalLocation(location) {
    return location.protocol == window.location.protocol
            && location.hostname == window.location.hostname
            && location.pathname == window.location.pathname
            && location.hash.indexOf('#/') == 0;
}

function initState() {
    renderRequest('GET', window.location, null,
        updateState='replaceState');
}

function handleSubmit(e) {
    let url = e.target.action;

    if (routeRequest(url, e.target)) {
        e.preventDefault();

        return false;
    }
}

function handlePageClick(e) {
    const actor = e.target.closest('*[data-action]');
    if (actor) {
        const action = actor.getAttribute('data-action');
        if (action && window[action]) {
            return window[action](e);
        }
    }

    const a = e.target.closest('a');

    if (a) {
        const url = new URL(a.href);

        if (routeRequest(url, a)) {
            e.preventDefault();

            return false;
        }
    }
}

function routeRequest(url, target) {
    if (!(url instanceof URL)) {
        url = new URL(url, location.href);
    }

    if (!isInternalLocation(url)) {
        return false;
    }

    let promise = null;

    switch (target.tagName) {
        case 'FORM': {
            const method = target.getAttribute('method').toUpperCase() || 'GET';

            const data = ['POST', 'DELETE'].indexOf(method) >= 0 ? new FormData(target)
                    : null;

            promise = renderRequest(method, url, data);
        } break;

        case 'A': {
            promise = renderRequest('GET', url, null,
                    updateState='pushState');
        } break;
    }

    return !!promise;
}

function getPageTitle() {
    const page = document.querySelector('main>x-page');

    return page ? document.querySelector('head title').getAttribute('data-baseTitle')
            + ': ' + page.getAttribute('data-title')
            : document.title;
}

function renderRequest(method, url, body=null, updateState=null) {
    if (!(url instanceof URL)) {
        url = new URL(url, location.href);
    }

    const options = {
        method,
        body
    };

    const renderUrl = '/render' + url.hash.replace(/^\#/, '');

    clearErrors();
    const promise = fetch(renderUrl, options)
        .catch((error) => {
            log.debug(error);
            reportError(error);
        });

    const main = document.querySelector('main');

    if (promise) {
        promise.then(res => {
            if (res && res.ok) {
                fireCustomEvent('exitPage', {
                    page: main.querySelector('x-page')
                });

                res.text()
                    .then(data => {
                        main.innerHTML = data;

                        if (main.firstElementChild.tagName == 'X-REDIRECT') {
                            const url = main.firstElementChild.getAttribute('data-url');

                            return renderRequest('GET', url, null,
                                updateState='replaceState');
                        }

                        document.title = getPageTitle();

                        fireCustomEvent('enterPage', {
                            method: method,
                            page: main.querySelector('x-page')
                        });

                        const href = url.href;
                        if (updateState) {
                            history[updateState]({method, href, body}, document.title,
                                    url);
                        }
                    });
            } else if (res) {
                reportError(res);
                res.text()
                    .then(data => {
                        main.innerHTML = data;
                    });
            }
        });
    }

    return promise;
}

function handleNavigate(e) {
    if (e.state) {
        renderRequest(e.state.method, new URL(e.state.href), e.state.body);
    }
}

function reportError(err) {
    const errorHeader = document.querySelector('#error');

    if (err instanceof Response) {
        errorHeader.innerText = 'server error (' + err.status + ')';
    } else {
        errorHeader.innerText = err;
    }

    errorHeader.classList.add('active');
    errorHeader.scrollIntoView();
}

function clearErrors() {
    const errorHeader = document.querySelector('#error');

    errorHeader.classList.remove('active');
}

function fireCustomEvent(eventName, detail) {
    const event = new CustomEvent('spa.' + eventName, {detail});

    document.dispatchEvent(event);
}
