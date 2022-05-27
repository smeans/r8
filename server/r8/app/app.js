'use strict';

const process = require('process');
const createError = require('http-errors');

const express = require('express');
const bodyParser = require('body-parser')
const multer = require('multer');
const upload = multer();
const cookieParser = require('cookie-parser');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);

const csurf = require('csurf');

const path = require('path');
const logger = require('web-logger');

const indexRouter = require('./routes/index');
const renderRouter = require('./routes/render');
const apiRouter = require('./routes/api');

const ejs = require('ejs');

const config = require('config');
const db = require('db');

const app = express();

// view engine setup
app.engine('ejs', ejs.__express);
app.set('views', [path.join(__dirname, 'views/v1_0'), path.join(__dirname, 'views/v0_5')]);
app.set('view engine', 'ejs');
app.set('view options', {
    debug: false
});

// middleware configuration
app.use(logger({
    connectionString: config.mongodb.url,
    collection: 'webLogs'
}));

// session middleware
const sessionStore = new MongoDBStore(config.session_store_options);

const sessionOptions = Object.assign({}, config.session_options);
sessionOptions.store = sessionStore;

// set up locals (really application globals)
app.locals.sessionParser = session(sessionOptions);
// for use in EJS templates
app.locals.require = require;

app.use(app.locals.sessionParser);

// request middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(upload.none());

app.use('/api', apiRouter.validateApiUser, apiRouter.router);
// app.use(bodyParser.urlencoded({ extended: false }));
// app.use(cookieParser(config.session_options.secret));
app.use(csurf({ cookie: false }));

// set up routers
app.use('/', indexRouter);
app.use('/render', renderRouter.validateUiUser, renderRouter.router);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    console.debug(req);
    next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
