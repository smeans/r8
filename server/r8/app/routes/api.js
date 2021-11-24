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

            const organization = loginSession.user.organization;
            organization.currentEnvironment = loginSession.user.defaultEnvironment;

            req.apiMeta = {
                mode: req.query.mode || '_run',
                loginSession: loginSession,
                user: loginSession.user,
                organization: organization
            };

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
            message: 'OK'
        });
});

/**
 * Return a list of all packages available to the currently
 * authenticated user.
 */
router.get('/packages', async function (req, res, next) {
    return res.json(await req.apiMeta.user.getPackageList());
});

router.param('packageId', async function (req, res, next, packageId) {
    const pkg = await req.apiMeta.organization.getPackage(packageId);

    if (!pkg) {
        res.status(404);

        return res.json({
            status: 404,
            message: 'package not found'
        });
    }

    req.package = pkg;

    next();
});

router.param('tableTermName', async function (req, res, next, tableTermName) {
    const tableTerm = req.package.getTerm(tableTermName);

    console.debug('tableTermName parameter', tableTermName);

    if (!tableTerm) {
        res.status(404);

        return res.json({
            status: 404,
            message: `table ${req.params.tableTermName} not found`
        });
    }

    req.tableTerm = tableTerm;

    next();
});


/**
 * Query and return rows for specified table term.
 */
router.route('/packages/:packageId/tables/:tableTermName')
    .get(async function (req, res, next) {
        return res.json(Array.from(req.tableTerm.table.query()));
    })
    .post(async function (req, res, next) {
        console.debug('posted', req.body);
        return res.json(req.tableTerm.table.insert(req.body));
    });

router.route('/packages/:packageId/tables/:tableTermName/rows/:rowId')
    .post(async function (req, res, next) {
        const count = req.tableTerm.table.update({_id: req.params.rowId}, req.body);

        if (count <= 0) {
            res.status(400);

            return res.json({status: 400});
        }

        return res.json(Array.from(req.tableTerm.table.query()));
    })
    .delete(async function (req, res, next) {
        if (!req.tableTerm.table.delete({_id: req.params.rowId})) {
            res.status(400);

            return res.json({status: 400});
        }

        return res.json({status: 200});
    });

module.exports = {
    router,
    validateApiUser
};
