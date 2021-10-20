'use strict';

const express = require('express');
const log = require('log');
const router = express.Router();

const { LoginSession } = require('db');

async function validateApiUser(req, res, next) {
    const loginSessionId = req.session && req.session.loginSessionId;

    if (loginSessionId) {
        const loginSession = (loginSessionId
                && await LoginSession.findById(loginSessionId));
        if (loginSession && loginSession.valid) {
            await loginSession.user.populate();
            req.apiMeta = {
                mode: req.query.mode || '_run',
                loginSession: loginSession,
                user: loginSession.user
            }

            return next();
        }
    }

    return res.status(403).json({
            status: 403,
            message: 'FORBIDDEN'
        });
}

/**
 * Return current system status. Useful for testing
 * connectivity and service availability.
 */
router.get('/status', function(req, res, next) {
    return res.json({
            status: 200,
            message: 'OK',
            apiMeta: req.apiMeta
        });
});

/**
 * Return a list of all packages available to the currently
 * authenticated user.
 */
router.get('/packages', async function (req, res, next) {
    return res.json(await req.apiMeta.user.getPackageList());
});

module.exports = {
    router,
    validateApiUser
};
