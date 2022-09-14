'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer();
const { URL } = require('url');

const email = require('email');

const notify = require('notify');

const { Organization, User, LoginSession, Product } = require('db');

const { buildOrgPostmanCollection } = require('./api');

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
    const productList = loginSession && loginSession.user
            && await loginSession.user.getProductList();

    const sidebar = [];

    res.render('render/' +  templateName, {
        req,
        res,
        loginSession,
        productList,
        sidebar,
        next
    });
}

async function renderPostmanCollection(req, res, next) {
    const token = req.params[0];

    console.log('token', token)

    const organization = await Organization.findByApiToken(token);

    if (!organization) {
        res.status(404);

        return next();
    }

    req.apiMeta = {
        mode: '_run',
        loginSession: req.loginSession,
        user: req.loginSession.user,
        organization: req.organization,
        effectiveDate: Date.now()
    };

    const postmanCollection = await buildOrgPostmanCollection(req);

    delete req.apiMeta;

    res.header('Content-Disposition', `attachment; filename="${postmanCollection.info.name}.postman_collection.json"`);

    return res.json(postmanCollection);
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
    createProduct: async (req, res, next) => {
        const productName = req.body.productName;
        const description = req.body.description;
        const states = Array.isArray(req.body.states) ? req.body.states
                : [req.body.states];

        console.debug('createProduct', productName);
        const product = await req.organization.createProduct(productName,
                description, states);

        res.render('render/redirect', {url: '#/product/' + product.id});
    },
    updateProduct: async (req, res, next) => {
        const product = await req.organization.getProduct(req.body.productId);

        if (!product) {
            res.status(400);

            return next();
        }

        console.debug('updateProduct', product.name);
        product.name = req.body.productName;
        product.description = req.body.description;
        product.states = Array.isArray(req.body.states) ? req.body.states
                        : [req.body.states];

        await product.save();

        return next();
    },
    createPackage: async (req, res, next) => {
        const loginSession = req.loginSession;
        const organization = req.organization;
        const product = await organization.getProduct(req.body.productId);
        const effectiveDate = req.body.effectiveDate;

        if (!req.organization) {
            res.status(400);

            return next();
        }

        await req.organization.createPackage(product, effectiveDate, {
            userId: loginSession.user.id
        });

        return next();
    },
    clonePackage: async (req, res, next) => {
        const loginSession = req.loginSession;
        const organization = req.organization;
        const product = await organization.getProduct(req.body.productId);
        const packageId = req.body.packageId;
        const effectiveDate = req.body.effectiveDate;
        const fromEnvironment = req.body.fromEnvironment;

        if (!req.organization) {
            res.status(400);

            return next();
        }

        try {
            await req.organization.clonePackage(packageId, effectiveDate, {
                userId: loginSession.user.id
            }, fromEnvironment);
        } catch (e) {
            console.error(`clonePackage: ${e}`);

            req.errors.push(e);
        }

        return next();
    },
    deletePackage: async (req, res, next) => {
        const loginSession = req.loginSession;
        const organization = req.organization;
        const packageId = req.body.packageId;

        if (!req.organization) {
            res.status(400);

            return next();
        }

        try {
            await req.organization.deletePackage(packageId, {
                userId: loginSession.user.id
            });
        } catch (e) {
            console.error(`deletePackage: ${e}`);

            req.errors.push(e);
        }

        return next();
    },
    addProductTerm: async (req, res, next) => {
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
    deployPackage: async (req, res, next) => {
        const packageId = req.body.packageId;
        const fromEnvironment = req.body.fromEnvironment;
        const loginSession = req.loginSession;

        try {
            await loginSession.user.organization.deploy(packageId, {
                    userId: loginSession.user.id
                }, fromEnvironment);
        } catch (e) {
            res.status(400);
            req.errors.push(e);
        }

        return next();
    },
    saveProfileSettings:  async (req, res, next) => {
        const loginSession = req.loginSession;
        const organization = loginSession.user.organization;

        organization.name = req.body.organizationName;

        await organization.save();

        return next();
    }
};

async function processServiceAction(req, res, next) {
    if (req.method != 'POST') {
        return next();
    }

    const serviceAction = req.body.serviceAction;

    console.debug('processServiceAction', serviceAction);
    if (serviceActions.hasOwnProperty(serviceAction)) {
        try {
            return await serviceActions[serviceAction](req, res, next)
        } catch (e) {
            console.error('processServiceAction', e);
            console.debug(e.stack);
            req.errors.push(e);
        }
    }

    return next();
}

async function renderLogin(req, res, next) {
    const userEmail = req.body.email;
    const session = req.session;
    let loginSession = req.loginSession;

    if (loginSession) {
        await loginSession.user.cancelLogin(session.loginSessionId);

        delete session.loginSessionId;
    }

    if (userEmail) {
        let user = await User.findById(User.normalizeEmail(userEmail));
        if (!user) {
            try {
                user = User.create({
                    email: userEmail
                });
                user.id = userEmail;
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

            const confirmUrl = `${req.proxyScheme}://${req.hostname}?t=${loginSession.confirmSecret}#/confirmlogin`;

            console.debug(`user ${loginSession.user.id}: confirm url ${confirmUrl}`);

            if (!(await email.sendEmail("confirmLogin", userEmail, {
                "confirmUrl": confirmUrl,
                "confirmMnemonic": loginSession.confirmMnemonic
            }))) {
                return res.render('error', {message:'There was an error on our end sending your login email. We\'re sorry, please try again later!'});    
            }

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

                return res.render('render/redirect', {url: '?#/'});
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

            return res.render('render/redirect', {url: '?#/'});
        } break;
    }

    res.render('render/confirmLogin', args);
}

async function renderProductHome(req, res, next) {
    const productId = req.params[0];
    const loginSession = req.loginSession;

    const product = await req.organization.getProduct(productId);
    if (!product) {
        res.status(404);

        return next();
    }

    const packageLists = await req.organization.getPackageLists(productId);

    res.render('render/producthome', {
        req,
        res,
        loginSession,
        product,
        packageLists,
        SPAURL,
        next
    });
}

async function renderPackageHome(req, res, next) {
    const packageId = req.params[0];
    const loginSession = req.loginSession;
    const organization = req.organization;
    const environment = req.query.env || organization.currentEnvironment;

    try {
        organization.currentEnvironment = environment;
    } catch (e) {
        console.warn(`renderPackageHome: bad environment ${environment}`);
    }

    const pkg = await req.organization.getPackage(packageId);

    if (!pkg) {
        res.status(404);
        return next();        
    }

    const product = await req.organization.getProduct(pkg.productId);

    console.debug('packageHome: pkg', pkg)
    console.log('packageHome: product', product)

    let termStack = req.query.ts || [];
    if (!(Array.isArray(termStack))) {
        termStack = [termStack];
    }
    termStack = termStack.map(termName => pkg.getTerm(termName))
            .filter(term => !!term);
    const focusTerm = termStack.length > 0 ? termStack[termStack.length-1]
        : null;

    const breadCrumbTrail = [{
        url: `#/`,
        label: 'Products'
    }];
    const bcUrl = new SPAURL(req.url);
    bcUrl.searchParams.delete('ts');
    breadCrumbTrail.push({
        url: `#/product/${product.id}`,
        label: product.name
    });
    const effectiveDate = pkg.effectiveDate.toLocaleString(undefined, {'dateStyle': 'short'});
    breadCrumbTrail.push({
        url: bcUrl.toString(),
        label: `Effective ${effectiveDate}`
    });
    for (let i = 0; i < termStack.length; i++) {
        bcUrl.searchParams.append('ts', termStack[i].name);

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
        product,
        pkg,
        next
    });
}

router.use(processServiceAction);

router.post(/\/(login)/, renderLogin);
router.all(/\/(logout)/, renderLogout);
router.get(/\/(pendinglogin)/, renderPendingLogin);
router.get(/\/(confirmlogin)/, renderConfirmLogin);
router.post(/\/(confirmlogin)/, renderConfirmLogin);
router.get(/apim\/postman\/([0-9a-f\-]+)/, renderPostmanCollection);
router.all(/apim/, renderApim);
router.all(/\/product\/([0-9a-f\-]+)/, renderProductHome);
router.all(/\/package\/([0-9a-f\-]+)/, renderPackageHome);
router.all(/\/?(\w*)/, render);

module.exports = {
    validateUiUser,
    router
};
