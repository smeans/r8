var express = require('express');
const log = require('log');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
    res.render('index', {
        title: 'R8'
    });
});

module.exports = router;
