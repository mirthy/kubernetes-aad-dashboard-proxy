let express = require('express');
let passport = require('passport');
let ensureLoggedIn = require('connect-ensure-login').ensureLoggedIn();
let router = express.Router();
let bouncer = require ("express-bouncer")();
const log = require('../libs/logger');
let httpProxy = require('http-proxy');
let proxy = httpProxy.createProxy({secure:false});
let fs = require("fs");
let caCert = "";
try {
  caCert = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt', 'utf8');
} catch(ex) {}
let env = {
  CALLBACK_URL: process.env.CALLBACK_URL || 'http://localhost:3000/callback',
  AAD_TENANT_ID: process.env.AAD_TENANT_ID,
  AAD_K8S_API_SERVER_APP_ID: process.env.AAD_K8S_API_SERVER_APP_ID,
  AAD_K8S_API_SERVER_RESOURCE_ID: "spn:"+process.env.AAD_K8S_API_SERVER_APP_ID,
  AAD_K8S_KUBECTL_APP_ID: process.env.AAD_K8S_KUBECTL_APP_ID, // Used for kubeconfig, it's the "native" App Registration for kubectl
  CLUSTER_NAME: process.env.CLUSTER_NAME,
  CLUSTER_API_URL: process.env.CLUSTER_API_URL,
  PROXY_DESTINATION_AUTHORITY: process.env.PROXY_DESTINATION_AUTHORITY,
  LOGIN_WARNING_MESSAGE: process.env.LOGIN_WARNING_MESSAGE || 'THIS IS AN ACTIVE WORKING SYSTEM. BE RESPONSIBLE.'
};

let authenticate = function (req, res, next) {
  if (req.isAuthenticated()) {
      bouncer.reset (req);
      return next()
  }
  req.session.returnTo = req.path;
  res.redirect('/login');
};

router.get('/', authenticate, function(req, res, next) {
  res.render('index', {
    name: req.user.profile.displayName,
    email: req.user.profile.upn,
    clusterName: env.CLUSTER_API_URL.replace('https://api.',''),
    clusterUrl: env.CLUSTER_API_URL,
    apiserverAppId: env.AAD_K8S_API_SERVER_APP_ID,
    kubectlAppId: env.AAD_K8S_KUBECTL_APP_ID,
    tenantId: env.AAD_TENANT_ID,
    clusterCaCert: caCert
  });
});

router.get('/login', bouncer.block, function(req, res, next) {
  log.info({user: req.user}, "Authentication Request");
  // res.render('login', { title: 'Authenticated Proxy', env: env });
  passport.authenticate('azuread-openidconnect',
    {
      response: res,                      // required
      resourceURL: env.AAD_K8S_API_SERVER_RESOURCE_ID,
      extraTokenReqQueryParams: { "api-version": "1.0"},
      failureRedirect: '/error'
    }
  )(req, res, next);
});
// Get the permissions for the current user after authenticating and authorizing
router.get('/permissions', ensureLoggedIn, function(req, res) {
  res.end();
});

router.get('/logout', function(req, res){
  req.logout();
  res.send("Logged out.");
  res.end();
});

// 'POST returnURL'
// `passport.authenticate` will try to authenticate the content returned in
// body (such as authorization code). If authentication fails, user will be
// redirected to '/' (home page); otherwise, it passes to the next middleware.
router.post('/callback',
  function(req, res, next) {
    passport.authenticate('azuread-openidconnect',
        {
          response: res,                      // required
          resourceURL: env.AAD_K8S_API_SERVER_RESOURCE_ID,
          extraTokenReqQueryParams: { "api-version": "1.0"},
          failureRedirect: '/error'
        }
      )(req, res, next);
  },
  function(req, res) {
    res.render('callback', {
      title: 'Completed Callback',
      returnTo: req.session.returnTo || '/',
      warningMessage: env.LOGIN_WARNING_MESSAGE
    });
});

router.get('/user', authenticate, function(req, res, next) {
  console.log(JSON.stringify(req.user));
  res.render('user', {
    user: req.user,
    env: env
  });
});

router.get('/kubeconfig', authenticate, function(req, res, next) {
  console.log(JSON.stringify(req.user));
  
  res.attachment('kubeconfig-'+env.CLUSTER_NAME);
  res.render('kubeconfig', {
    accessToken: req.user.accessToken,
    refreshToken: req.user.refreshToken,
    user: req.user.upn,
    expiresIn: req.user.expiresIn,
    expiresOn: req.user.expiresOn,
    clusterName: env.CLUSTER_NAME,
    clusterUrl: env.CLUSTER_API_URL,
    apiserverAppId: env.AAD_K8S_API_SERVER_APP_ID,
    kubectlAppId: env.AAD_K8S_KUBECTL_APP_ID,
    tenantId: env.AAD_TENANT_ID
  });
});

// Fix for unresponsive POSTs:
// Undo the meddling that the express bodyparser middleware is doing and send an unparsed body
// https://github.com/nodejitsu/node-http-proxy/blob/master/examples/middleware/bodyDecoder-middleware.js
proxy.on('proxyReq', function(proxyReq, req, res, options) {
  if (req.user && req.user.accessToken) {
    proxyReq.path = proxyReq.path.replace(/^\/dashboard/,"");
    if (!proxyReq.path) {
      proxyReq.path = "/";
    }
    // Set the accessToken as a bearer token for the request to the dashboard
    let token = req.user.accessToken;
    proxyReq.setHeader('Authorization','Bearer '+ token);
    if(req.body) {
      if ((req.method == "PUT" || req.method == "POST") && req.headers && req.headers["content-type"] && req.headers["content-type"].indexOf("application/json") > -1) {
        let bodyData = JSON.stringify(req.body);
        // incase if content-type is application/x-www-form-urlencoded -> we need to change to application/json
        proxyReq.setHeader('Content-Type','application/json');
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        // stream the content
        proxyReq.write(bodyData);
      }
    }
  }
});

proxy.on('proxyRes', function (proxyRes, req, res) {
  // Something is wrong with your auth...
  if (proxyRes.statusCode === 401) {
    req.logout();
    req.session.returnTo = req.path;
    // Hacky way to do this, but there's no way to redirect from the res directly
    // Indirectly doing it by overwriting the proxy result
    proxyRes.statusCode = 302;
    proxyRes.headers['location'] = '/login';
    log.debug('Token expired, redirecting to login')
  }
});

proxy.on('upgrade', function (req, socket, head) {
  proxy.ws(req, socket, head);
});

// Proxy Routes - All paths and the major 4 verbs - make sure they're authenticated
// and authorized to access the resource
// TODO: Add authorization for these verbs with Graph API
router.get('/*', authenticate, function(req, res) {
  try {
    log.info({user: req.user.sub, path: req.path, verb: "GET"}, "GET");
    return proxy.web(req, res, {target: env.PROXY_DESTINATION_AUTHORITY});
  } catch (exception) {
    res.redirect('/error');
  }
});

router.put('/*', authenticate, function(req, res) {
  log.info({user: req.user.sub, path: req.path, verb: "PUT"}, "PUT");
  return proxy.web(req, res, { target: env.PROXY_DESTINATION_AUTHORITY});
});

router.post('/*', authenticate, function(req, res) {
  log.info({user: req.user.sub, path: req.path, verb: "POST"}, "POST");
  return proxy.web(req, res, { target: env.PROXY_DESTINATION_AUTHORITY});
});

router.delete('/*', authenticate, function(req, res) {
  log.info({user: req.user.sub, path: req.path, verb: "DELETE"}, "DELETE");
  return proxy.web(req, res, { target: env.PROXY_DESTINATION_AUTHORITY});
});

router.get('/error', function(req, res) {
  res.status(400);
  res.end();
});

module.exports = router;
