'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer();
const { URL } = require('url');

const notify = require('notify');

const { User, LoginSession } = require('db');

class SPAURL extends URL {
    static RELATIVE_BASE_URL = new URL('http://localhost');
    isRelative = false;

    constructor(url, base) {
        try {
            super(url, base);
        } catch(e) {
            if (e.code != 'ERR_INVALID_URL' || base) {
                throw e;
            }

            super(url, SPAURL.RELATIVE_BASE_URL);
            this.isRelative = true;
        }

        if (this.isRelative) {
            this.hash = this.pathname;
            this.pathname = '/';
        }
    }

    toString() {
        if (this.isRelative) {
            let out = this.pathname;
            if (this.searchParams) {
                out += '?' + this.searchParams;
            }

            return out + this.hash;
        } else {
            return super.toString();
        }
    }
}

async function validateUiUser(req, res, next) {
    const loginSessionId = req.session && req.session.loginSessionId;

    if (loginSessionId) {
        const loginSession = (loginSessionId
                && await LoginSession.findById(loginSessionId));
        if (loginSession && loginSession.valid) {
            await loginSession.user.populate();


            req.loginSession = loginSession;
            req.organization = loginSession.user.organization;
            req.organization.currentEnvironment = loginSession.user.defaultEnvironment;
            req.errors = [];
        }
    }

    // !!!TBD!!! here is where we can enforce user roles
    // (e.g. don't allow API users to use the UI)
    return next();
}

async function render(req, res, next) {
    const templateName = req.params[0] || 'home';
    const loginSession = req.loginSession || {};
    const packageList = loginSession && loginSession.user
            && await loginSession.user.getPackageList();

    const sidebar = [];

    res.render('render/' +  templateName, {
        req,
        res,
        loginSession,
        packageList,
        sidebar,
        next
    });
}

async function renderApim(req, res, next) {
    const loginSession = req.loginSession || {};

    const sidebar = [];
    const changeLog = loginSession && await loginSession.user.organization.getChangeLog();

    res.render('render/apim', {
        req,
        res,
        loginSession,
        sidebar,
        changeLog,
        next
    });
}

const serviceActions = {
    addApiToken: async (req, res, next) => {
        // !!!TBD!!! here is where we need to check user permissions

        req.organization.issueApiToken(req.body.issueTo, req.body.environment);

        await req.organization.save();

        return next();
    },
    revokeApiToken: async (req, res, next) => {
        // !!!TBD!!! here is where we need to check user permissions

        req.organization.revokeApiToken(req.body.token);

        await req.organization.save();

        return next();
    },
    createPackage: async (req, res, next) => {
        const packageName = req.body.packageName;

        if (!req.organization) {
            res.status(400);

            return next();
        }

        await req.organization.createPackage(packageName);

        return next();
    },
    addProduct: async (req, res, next) => {
        const parsedUrl = req._parsedUrl || new URL(req.url);
        const packageId = parsedUrl.pathname.split('/')[2];
        const loginSession = req.loginSession;
        const pkg = await req.organization.getPackage(packageId);

        const term = pkg.createTerm('expression');
        term.isPublic = true;
        pkg.defineTerm(req.body.newProductName, term);

        await req.organization.savePackage(pkg, {
            userId: loginSession.user.id
        });

        return next();
    },
    saveTerm: async (req, res, next) => {
        const parsedUrl = req._parsedUrl || new URL(req.url);
        const packageId = parsedUrl.pathname.split('/')[2];
        const loginSession = req.loginSession;
        const pkg = await req.organization.getPackage(packageId);

        const termName = req.body.termName;
        let term = pkg.getTerm(termName);

        if (term) {
            console.debug('saving term', term.name);
            // !!!TBD!!! add versioning support here
            for (const p in req.body) {
                console.debug('property', p);
                if (p in term.constructor.prototype) {
                    console.debug('updating', p);
                    term[p] = req.body[p];
                }
            }

            await req.organization.savePackage(pkg, {
                userId: loginSession.user.id
            });
        } else {
            console.warn('unable to save term', termName, 'term does not exist');
        }

        return next();
    },
    createTerm: async (req, res, next) => {
        const parsedUrl = req._parsedUrl || new URL(req.url);
        const packageId = parsedUrl.pathname.split('/')[2];
        const loginSession = req.loginSession;
        const pkg = await req.organization.getPackage(packageId);

        const termName = req.body.termName;
        const termType = req.body.termType;

        if (pkg.getTerm(termName)) {
            res.status(400);

            return next();
        }

        if (!req.organization.validateIdentifier(termName)) {
            req.errors.push(`'${termName}' does not follow this organization's naming convention (${req.organization.idPolicy})`);

            return next();
        }

        const term = pkg.createTerm(termType);
        pkg.defineTerm(termName, term);
        await req.organization.savePackage(pkg, {
            userId: loginSession.user.id
        });

        return next();
    },
    deleteTerm: async (req, res, next) => {
        const parsedUrl = req._parsedUrl || new URL(req.url);
        const packageId = parsedUrl.pathname.split('/')[2];
        const loginSession = req.loginSession;
        const pkg = await req.organization.getPackage(packageId);

        const termName = req.body.termName;

        if (pkg.deleteTerm(termName)) {
            console.debug('deleting term', termName);

            await req.organization.savePackage(pkg, {
                userId: loginSession.user.id
            });
        }

        return next();
    },
    addKeyTerm: async (req, res, next) => {
        const parsedUrl = req._parsedUrl || new URL(req.url);
        const packageId = parsedUrl.pathname.split('/')[2];
        const loginSession = req.loginSession;
        const pkg = await req.organization.getPackage(packageId);
        const keyTermName = req.body.keyTermName;

        if (!req.organization.validateIdentifier(keyTermName)) {
            req.errors.push(`'${keyTermName}' does not follow this organization's naming convention (${req.organization.idPolicy})`);

            return next();
        }

        const termName = req.body.termName;
        let term = pkg.getTerm(termName);

        if (term) {
            if (term.termTypeName != 'table') {
                res.status(400);

                return next();
            }

            term.addKeyTerm(req.body.keyTermName);

            await req.organization.savePackage(pkg, {
                userId: loginSession.user.id
            });
        } else {
            res.status(404);
        }

        return next();
    },
    deleteKeyTerm: async (req, res, next) => {
        const parsedUrl = req._parsedUrl || new URL(req.url);
        const packageId = parsedUrl.pathname.split('/')[2];
        const loginSession = req.loginSession;
        const pkg = await req.organization.getPackage(packageId);
        const keyTermName = req.body.keyTermName;

        const termName = req.body.termName;
        let term = pkg.getTerm(termName);

        if (term) {
            if (term.termTypeName != 'table') {
                res.status(400);

                return next();
            }

            term.deleteKeyTerm(req.body.keyTermName);

            console.log('saving after delete');

            await req.organization.savePackage(pkg, {
                userId: loginSession.user.id
            });
        } else {
            res.status(404);
        }

        return next();
    },
    changeKeyTermMatchType: async (req, res, next) => {
        const parsedUrl = req._parsedUrl || new URL(req.url);
        const packageId = parsedUrl.pathname.split('/')[2];
        const loginSession = req.loginSession;
        const pkg = await req.organization.getPackage(packageId);
        const keyTermName = req.body.keyTermName;

        const termName = req.body.termName;
        let term = pkg.getTerm(termName);

        if (term) {
            if (term.termTypeName != 'table') {
                res.status(400);

                return next();
            }

            term.setKeyTermMatchType(keyTermName, req.body.matchType);

            await req.organization.savePackage(pkg, {
                userId: loginSession.user.id
            });
        } else {
            res.status(404);
        }

        return next();
    },
    deploy: async (req, res, next) => {
        const loginSession = req.loginSession;
        await loginSession.user.organization.deploy({
            userId: loginSession.user.id
        });

        next();
    }
};

async function renderServiceAction(req, res, next) {
    const  serviceAction =  req.body.serviceAction;

    console.debug('renderServiceAction', serviceAction);
    if (serviceActions.hasOwnProperty(serviceAction)) {
        try {
            return await serviceActions[serviceAction](req, res, next)
        } catch (e) {
            req.errors.push(e);
        }
    }

    return next();
}

async function renderLogin(req, res, next) {
    const email = req.body.email;
    const session = req.session;
    let loginSession = req.loginSession;

    if (loginSession) {
        await loginSession.user.cancelLogin(session.loginSessionId);

        delete session.loginSessionId;
    }

    if (email) {
        let user = await User.findById(User.normalizeEmail(email));
        if (!user) {
            try {
                user = User.create({
                    email: email
                });
                user.id = email;
                await user.save();
            } catch (e) {
                console.error(e);
            }
        } else {
            console.debug('user exists', user.email);
        }

        loginSession = await user.initiateLogin(session.id)
            .catch(e => {
                console.error('unable to initiate login', e);

                render(req, res, next);
            });

        if (loginSession) {
            session.loginSessionId = loginSession.id;

            const confirmUrl = `${req.protocol}://${req.hostname}?t=${loginSession.confirmSecret}#/confirmlogin`;

            console.debug(`user ${loginSession.user.id}: confirm url ${confirmUrl}`);

            // !!!TBD!!! send confirmation email here

            res.render('render/redirect', {url: '#/pendinglogin'});

            return;
        }
    }

    render(req, res, next);
}

async function renderLogout(req, res, next) {
    const session = req.session;
    const loginSession = req.loginSession;
    const loginSessionId = loginSession && loginSession.id;

    if (loginSession) {
        console.info('logout: deleting existing loginSession: ID', loginSession.id);

        await loginSession.user.cancelLogin(loginSessionId);

        delete session.loginSessionId;
    }

    req.session.destroy();

    res.render('render/redirect', {url: '#/'});
}

async function renderPendingLogin(req, res, next) {
    const session = req.session;
    let loginSessionId = session.loginSessionId;
    let loginSession = loginSessionId && await LoginSession.findById(loginSessionId);

    if (loginSession) {
        if (loginSession && loginSession.valid) {
            res.render('render/redirect', {url: '#/'});
        }
    }

    const sidebar = [];

    res.render('render/pendinglogin', {
        req,
        res,
        loginSession,
        sidebar,
        next
    });
}

/**
 * Processes a login confirmation link. There are several
 * cases which need to be processed correctly to avoid
 * security issues:
 * 1) (happy path) The link was opened in the same browser in which
 *      the `LoginSession` was created. Automatically approve the session
 *      and redirect to home (the dashboard).
 * 2) The link was opened in a browser without any loginSession. This
 *      would happen if the user clicked the confirm button on their
 *      phone after initiating a login on their laptop, for example. We
 *      should prompt the user to check the confirmation images (emojis)
 *      from their email against the ones displayed in their browser. Warn
 *      about phishing. If they still confirm, approve the session.
 * 3) The link was opened in a browser that has a loginSession for
 *      a different user. Other than in testing, this shouldn't really
 *      happen. Maybe log a security warning and treat as case #2.
 */
async function renderConfirmLogin(req, res, next) {
    const confirmSecret = req.query.t;
    const session = req.session;
    const loginSessionId = session.loginSessionId;
    let loginSession = loginSessionId && await LoginSession.findById(loginSessionId);
    const args = {req, res, next, loginSession};
    args.badSession = false;

    switch (req.method) {
        case 'GET': {
            if (loginSession && loginSession.confirmLogin(confirmSecret)) {
                notify.notifySession(loginSessionId, {
                    message: 'loginConfirmed'
                });

                return res.render('render/redirect', {url: '#/'});
            }
        } break;

        case 'POST': {
            loginSession = await await LoginSession.findOne({confirmSecret});

            args.loginSession = loginSession;
            if (!args.loginSession) {
                return res.render('error', {message:'Invalid login session, please log in again.'});
            }

            switch (req.body.form_action) {
                case 'ignore': {
                    loginSession.user.cancelLogin(loginSession.id);
                } break;

                case 'confirm': {
                    if (loginSession.confirmLogin(confirmSecret)) {
                        notify.notifySession(loginSession.id, {
                            message: 'loginConfirmed'
                        });
                    }
                } break;
            }

            return res.render('render/redirect', {url: '#/'});
        } break;
    }

    res.render('render/confirmLogin', args);
}

async function renderPackageHome(req, res, next) {
    const packageId = req.params[0];
    const loginSession = req.loginSession;
    const pkg = await req.organization.getPackage(packageId);
    let termStack = req.query.ts || [];
    if (!(Array.isArray(termStack))) {
        termStack = [termStack];
    }
    termStack = termStack.map(termName => pkg.getTerm(termName))
            .filter(term => !!term);
    const focusTerm = termStack.length > 0 ? termStack[termStack.length-1]
        : null;

    const breadCrumbTrail = [];
    const bcUrl = new SPAURL(req.url);
    bcUrl.searchParams.delete('ts');
    breadCrumbTrail.push({
        url: bcUrl.toString(),
        label: pkg.packageName,
        icon: '/svg/package.svg'
    });
    for (let i = 0; i < termStack.length; i++) {
        bcUrl.searchParams.append('ts', termStack[i].name);
        // !!!TBD!!! fix icon fill by removing fill from SVG files and using CSS
        breadCrumbTrail.push({
            url: bcUrl.toString(),
            label: termStack[i].name,
            icon: `/svg/term-icon-${termStack[i].termTypeName}.svg`
        });
    }

    const sidebar = [];

    res.render('render/packagehome', {
        req,
        res,
        loginSession,
        termStack,
        focusTerm,
        SPAURL,
        breadCrumbTrail,
        sidebar,
        pkg,
        next
    });
}

router.post(/\/(login)/, renderLogin);
router.post(/\/(logout)/, renderLogout);
router.get(/\/(pendinglogin)/, renderPendingLogin);
router.get(/\/(confirmlogin)/, renderConfirmLogin);
router.post(/\/(confirmlogin)/, renderConfirmLogin);
router.post(/\/?(\w*)/, renderServiceAction);
router.all(/apim/, renderApim);
router.all(/\/package\/([0-9a-f\-]+)/, renderPackageHome);
router.all(/\/?(\w*)/, render);

module.exports = {
    validateUiUser,
    router
};
