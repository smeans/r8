const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer();

const log = require('log');
const notify = require('notify');

const { User, LoginSession } = require('db');

async function render(req, res, next) {
    const templateName = req.params[0] || 'home';
    const loginSessionId = req.session && req.session.loginSessionId;

    const loginSession = (loginSessionId
            && await LoginSession.findById(loginSessionId)) || {};

    res.render('render/' +  templateName, {
        req,
        res,
        loginSession,
        next
    });
}

async function renderLogin(req, res, next) {
    const email = req.body.email;
    const session = req.session;
    let loginSession = null;

    console.debug('login: session ID', session.id);

    if (session.loginSessionId) {
        log.verbose('login: deleting existing loginSession: ID', session.loginSessionId);

        loginSession = await LoginSession.findById(session.loginSessionId);
        loginSession && await loginSession.user.cancelLogin(session.loginSessionId);

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
                log.error('unable to initiate login', e);

                render(req, res, next);
            });

        if (loginSession) {
            session.loginSessionId = loginSession.id;

            const confirmUrl = `${req.protocol}://${req.hostname}#/confirmlogin?t=${loginSession.confirmSecret}`;

            if (log.debugging) {
                log.debug(`user ${loginSession.user.id}: confirm url ${confirmUrl}`);
            }

            // !!!TBD!!! send confirmation email here

            res.render('render/redirect', {url: '#/pendinglogin'});

            return;
        }
    }

    render(req, res, next);
}

async function renderLogout(req, res, next) {
    const session = req.session;
    const loginSessionId = session && session.loginSessionId;

    if (loginSessionId) {
        log.verbose('logout: deleting existing loginSession: ID', loginSessionId);

        loginSession = await LoginSession.findById(loginSessionId);
        loginSession && await loginSession.user.cancelLogin(loginSessionId);

        delete session.loginSessionId;
    }

    req.session.destroy();

    res.render('render/redirect', {url: '#/'});
}

async function renderPendingLogin(req, res, next) {
    const session = req.session;
    let loginSession = null;

    console.debug('confirmlogin: session ID', session.id);

    if (session.loginSessionId) {
        loginSession = await LoginSession.findById(session.loginSessionId);

        if (loginSession && loginSession.valid) {
            res.render('render/redirect', {url: '#/'});
        }
    }

    render(req, res, next);
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
    const loginSessionId = session && session.loginSessionId;
    let loginSession = await LoginSession.findById(loginSessionId);
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

router.post(/\/(login)/, renderLogin);
router.post(/\/(logout)/, renderLogout);
router.get(/\/(pendinglogin)/, renderPendingLogin);
router.get(/\/(confirmlogin)/, renderConfirmLogin);
router.post(/\/(confirmlogin)/, renderConfirmLogin);
router.get(/\/(\w*)/, render);

module.exports = router;
