'use strict';

const express = require('express');
const log = require('log');
const router = express.Router();
const YAML = require('yaml');

const { Organization, LoginSession } = require('db');

const R8TYPE_TO_OPENAPI = {
    undefined: "number",
    "String": 'string',
    "Integer": 'integer',
    "Currency": "number",
    "Float": "number",
    "Date": "string",
    "DateTime": "string"
}

async function buildOrgOpenApiJson(organization) {
    const out = {
        openapi: "3.0.1",
        info: {
            "title": `${organization.name}-api`,
            "version": `${organization.currentEnvironment}-1.0.0`
        },
        paths: {}
    }

    const packageList = await organization.getPackageList();

    for (const packageName in packageList) {
        const pkg = await organization.getPackage(packageName);

        // !!!TBD!!! this is where we can use user roles to filter
        // what terms are available to each user type. For example,
        // an internal integration dev should be able to see any
        // terms in a package, where an external integration dev
        // can only see public terms.
        const terms = Object.values(pkg.terms).filter(term => term.isPublic);
        for (let i = 0; i < terms.length; i++) {
            const term = terms[i];
            const requiredInputs = pkg.getRequiredInputs(term);
            const endpoint = {
                parameters: Array.from(requiredInputs).map(ri => {
                    return {
                        "name": ri.name,
                        "in": "query",
                        "description": ri.description,
                        "schema": {
                            "type": R8TYPE_TO_OPENAPI[ri.dataType]
                        }
                    }
                }),
                "get": {
                    "responses": {
                        "200": {
                            "description": term.description,
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            [term.name]: {
                                                "type": R8TYPE_TO_OPENAPI[term.dataType]
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            };

            console.log(endpoint);
            out.paths[`/api/${packageName}/products/${term.name}`] = endpoint;
        }
    }

    return out;
}

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

    if (req.headers.authorization) {
        const authorization = req.headers.authorization.split(/\s+/);
        if (authorization.shift() == 'Bearer' && authorization.length > 0) {
            const token = authorization.shift();
            const organization = await Organization.findByApiToken(token);

            if (organization) {
                req.apiMeta = {
                    mode: req.query.mode || '_run',
                    organization: organization
                };

                return next();
            }
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

router.get('/openapi/:format((json|yaml))', async function(req, res, next) {
    const openApiJson = await buildOrgOpenApiJson(req.apiMeta.organization);

    switch (req.params.format) {
        case 'yaml': {
            res.contentType('application/x-yaml');

            return res.send(YAML.stringify(openApiJson));
        }

        case 'json': {
            return res.json(openApiJson);
        }
    }
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
    req.params.packageId = pkg.id;

    next();
});

router.param('productName', async function (req, res, next, productName) {
    const term = req.package.getTerm(productName);

    if (!term) {
        res.status(404);

        return res.json({
            status: 404,
            message: `product ${req.params.productName} not found`
        });
    }

    req.product = term;

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
 * Execute specific packages and return results.
 */
router.route('/packages/:packageId/products/:productName')
    .get(async function (req, res, next) {
        const out = {};
        try {
            const ec = req.package.evalTerm(req.product, req.query);

            out[req.product.name] = ec.value;

            if (ec.log.length) {
                out.log = ec.log.map(msg => {
                    return {
                        level: msg.level,
                        term: msg.term.name,
                        message: msg.message
                    }
                });
            }

            // !!!TBD!!! implement setTermValue() in all terms for tracing
            console.debug(`${req.product.name}: term values`, JSON.stringify(ec.termValues));
        } catch (e) {
            console.error(`${req.product.name}: eval error: ${e}`, e.stack);

            res.status(500);

            out.log = out.log || [];
            out.log.push({
                level: 'error',
                term: req.product.name,
                message: e.toString()
            })
        }

        return res.json(out);
    });

/**
 * Query and return rows for specified table term.
 */
router.route('/packages/:packageId/tables/:tableTermName')
    .get(async function (req, res, next) {
        return res.json(Array.from(req.tableTerm.table.query()));
    })
    .post(async function (req, res, next) {
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
