require('dotenv').config({silent: true});
const express = require('express');
const path = require('path');
const logger = require('morgan');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const session = require('express-session');
const passport = require('passport');
const mustacheExpress = require('mustache-express');
const helmet = require('helmet');
const OIDCStrategy = require('passport-azure-ad').OIDCStrategy;

let routes = require('./routes/index');

const env = {
  AAD_IDENTITY_METADATA: "https://login.windows.net/"+process.env.AAD_TENANT_ID+"/.well-known/openid-configuration",
  AAD_CLIENT_ID: process.env.AAD_CLIENT_ID,
  AAD_CLIENT_SECRET: process.env.AAD_CLIENT_SECRET,
  AAD_RESPONSE_TYPE: process.env.AAD_RESPONSE_TYPE || 'code',
  CALLBACK_URL: process.env.CALLBACK_URL || 'http://localhost:3000/callback',
};

let strategy = new OIDCStrategy({
    identityMetadata: env.AAD_IDENTITY_METADATA,
    clientID: env.AAD_CLIENT_ID,
    responseType: env.AAD_RESPONSE_TYPE,
    responseMode: 'form_post',
    redirectUrl: env.CALLBACK_URL,
    allowHttpForRedirectUrl: true,
    clientSecret: env.AAD_CLIENT_SECRET,
    validateIssuer: true,
    isB2C: false,
    issuer: null,
    passReqToCallback: false,
    scope: ['profile','group'],
    loggingLevel: 'warn',
    nonceLifetime: null,
    nonceMaxAmount: 5,
    loggingNoPII: true // Don't log tokens
  },
  function(iss, sub, profile, accessToken, refreshToken, params, done) {
    if (!profile.oid) {
      return done(new Error("No oid found"), null);
    }
    var userData = {};
    userData.oid = profile.oid;
    userData.upn = profile.upn;
    userData.profile = profile;
    userData.refreshToken = refreshToken;
    userData.accessToken = accessToken;
    userData.expiresIn = params.expires_in;
    userData.expiresOn = params.expires_on;
    // asynchronous verification, for effect...
    process.nextTick(function () {
      findByOid(userData.oid, function(err, user) {
        if (err) {
          return done(err);
        }
        if (!user) {
          // "Auto-registration"
          users.push(userData);
          return done(null, userData);
        } else {
          user.refreshToken = userData.refreshToken;
          user.accessToken = userData.accessToken;
          user.expiresIn = userData.expiresIn;
          user.expiresOn = userData.expiresOn;
        }
        return done(null, user);
      });
    });
  }
);

passport.use(strategy);

// array to hold logged in users
var users = [];
var findByOid = function(oid, fn) {
  for (var i = 0, len = users.length; i < len; i++) {
    var user = users[i];
    if (user.oid === oid) {
      return fn(null, user);
    }
  }
  return fn(null, null);
};

// you can use this section to keep a smaller payload
passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(user, done) {
  done(null, user);
});
const SECRET = 'Bc7V#3BoPupeFkt$%x4gJuyZ';
var app = express();
app.enable('trust proxy');
// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.engine('mustache', mustacheExpress());
app.set('view engine', 'mustache');
app.use(helmet());
app.use(helmet.noCache());

app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(session({
  secret: SECRET,
  resave: true,
  saveUninitialized: true,
  cookie: {maxAge: 3600000 }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', routes);

// catch 404 and forward to error handler
app.use(function(err, req, res, next) {
  console.log(err.message);
  if (err.name === 'UnauthorizedError') {
    res.set('Content-Type', 'text/html');
    res.status(401).send('<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=/login"></head></html>');
  } else {
    next(err);
  }
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: {}
  });
});

app.listen(3000, function () {
  console.log('App started up and listening on port 3000!');  
});

module.exports = app;
