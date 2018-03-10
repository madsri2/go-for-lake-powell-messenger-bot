'use strict';

const fs = require('fs');
const _ = require('lodash');
const WebhookPostHandler = require('./webhook-post-handler');
const WebpageHandler = require('./webpage-handler');
const TripData = require('./trip-data');
const logger = require('./my-logger');
const crypto = require('crypto');
const TripDataFormatter = require('./trip-data-formatter.js');
const passport = require('passport');
const FacebookStrategy = require('passport-facebook').Strategy;
const session = require('express-session');
const Session = require('./session');
const EmailParser = require('flight-details-parser/app/email-parser');
const SecretManager = require('secret-manager/app/manager');
const FbidHandler = require('fbid-handler/app/handler');
const RequestProfiler = require('./request-profiler');
// ----------------------------------------------------------------------------
// Set up a webserver

// For validation with facebook & verifying signature
const VALIDATION_TOKEN = "go-for-lake-powell";
const FB_APP_SECRET = (new SecretManager()).getFBAppId();
const FB_APP_ID = (new SecretManager()).getFBAppSecret();

// Polaama related handler
const postHandler = new WebhookPostHandler();

// A secure webserver
const util = require('util');
const express = require('express');  
const morgan = require('morgan');
const app = express();
const https = require('https');
const sslPath = '/etc/letsencrypt/live/polaama-backend.com/';
const port = 1443;
const options = {  
  key: fs.readFileSync(sslPath + 'privkey.pem'),
  cert: fs.readFileSync(sslPath + 'fullchain.pem')
};

let userIdMapping = {};
// Our Authentication strategy:  FacebookStrategy is used by passport when passport.authenticate is called below. passport.authenticate is used as a middleware for "/auth/facebook" request (which is in turn called by app.get("/") or any other app.get() where the ensureAuthenticated() middleware is used (see ensureAuthenticated below).
passport.use(new FacebookStrategy({
    clientID: FB_APP_ID,
    clientSecret: FB_APP_SECRET,
    callbackURL: "https://polaama-backend.com/auth/facebook/callback"
  },
  function(accessToken, refreshToken, profile, done) {
    // From https://scotch.io/tutorials/easy-node-authentication-facebook
    // This is to store the user profile in local database. For now, simply persist the access token corresponding to the user.
    // logger.info(`login details: accessToken: ${accessToken}; profile: ${JSON.stringify(profile)}`);
    const user = {
      name: profile._json.name,
      id: profile._json.id
    };
    // TODO: This will not work when there are name collisions.
    user.myId = FbidHandler.get().getId(user.name);
    userIdMapping[user.id] = user;
    logger.debug(`FacebookStrategy: found fbid: ${user.myId} for id: ${user.id} & name: ${user.name}`);
    done(null, user);
  }
));

// used to serialize the user for the session. This is called by passport.authenticate. see app.get(/auth/facebook/callback)
passport.serializeUser(function(user, done) {
  // logger.debug(`serializeUser called with ${JSON.stringify(user)}`);
  done(null, user.id);
});

// used to deserialize the user. This is called by passport.authenticate after authentication is done as part of app.get(/auth/facebook/callback). Also called by req.isAuthenticated() (in ensureAuthentication). This sets the request.user object (done by passport).
passport.deserializeUser(function(id, done) {
  // logger.debug(`deserializeUser: called with id ${id}. Returning ${JSON.stringify(userIdMapping[id])}`);
  done(null, userIdMapping[id]);
});

// configure
app.use(session({
  secret: 'polaama',
  resave: false,
  saveUninitialized: true
}));
// use passport session
app.use(passport.initialize());
app.use(passport.session());
// logger. create a write stream (in append mode) 
const accessLogStream = fs.createWriteStream('log/access.log', {flags: 'a'})
app.use(morgan('common', { stream: accessLogStream }));
// body parser
const bodyParser = require('body-parser');
const jsonParser = bodyParser.json();
app.use(bodyParser.json({ verify: verifyRequestSignature }));

// Routes
app.use(RequestProfiler.profile());

// Routes for authentication
// Redirect the user to Facebook for authentication.  When complete,
// Facebook will redirect the user back to the application at /auth/facebook/callback
app.get('/auth/facebook', passport.authenticate('facebook'));

// Facebook will redirect the user to this URL after approval.  Finish the
// authentication process by attempting to obtain an access token.  If
// access was granted, the user will be logged in.  Otherwise,
// authentication has failed.
app.get('/auth/facebook/callback', function(req, res, next) {
    // Not using successRedirect here because ensureAuthentication handles that by setting req.session.redirectTo
    passport.authenticate('facebook', function(err, user, info) {
      // logger.debug(`passport.authentication: info details: ${JSON.stringify(info)}`);
      if(err) { 
        logger.error(`facebook callback: passport.authenticate: error authenticating using facebook strategy. info object is ${JSON.stringify(info)}`);
        return next(err);
      }
      if(!user) {
        logger.info(`facebook callback: passport.authenticate: user object not present. redirecting to "/login"`);
        return res.redirect('/login');
      }
      req.login(user, function(err) {
        if(err) { 
          logger.error(`facebook callback: passport.authenticate: req.login threw error: ${err.stack}`);
          return next(err);
        }
        if(!req.session.redirectTo) req.session.redirectTo = "/index";
        // logger.info(`/auth/facebook/callback: passport.authenticate was successful. redirecting to the original request path ${req.session.redirectTo}. user details: ${JSON.stringify(user)}. req.param.id: ${req.session.myId}; req param: ${JSON.stringify(req.param)};`);
        const mesg = compareCallerWithUserInRequest(req, user);
        if(mesg) return res.send(mesg);
        else return res.redirect(req.session.redirectTo);
      });
    })(req, res, next);
});

function compareCallerWithUserInRequest(req, user) {
  // if there was no fbid passed in the path, then there is no comparing to be done.
  if(!req.session.myId) return null;
  // only the authorized user or the admin can see this page.
  // TODO: The keflavik trip is shared so Arpan & Avani can use it. Fix me.
  const thisFbid = FbidHandler.get().decode(user.myId);
  // logger.debug(`compareCallerWithUserInRequest: userFbid: ${user.myId}; id is ${thisFbid}. adminId is ${Session.adminId}`);
  if(req.session.myId === user.myId || thisFbid === Session.adminId || req.session.redirectTo.includes("keflavik")) return null;
  logger.error(`facebook callback: passport authenticate: user ${user.myId} attempted to call url ${req.session.redirectTo}, whose id is ${req.session.myId}. Rejecting the call.`);
  return "You are not authorized to view this page!";
}

/*
 * Verify that the callback came from Facebook. Using the App Secret from
 * the App Dashboard, we can verify the signature that is sent with each
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an error.
    logger.error("verifyRequestSignature: Couldn't validate the signature.");
    throw new Error("Could not validate the signature");
  } else {
    let elements = signature.split('=');
    let method = elements[0];
    let signatureHash = elements[1];

    let expectedHash = crypto.createHmac('sha1', FB_APP_SECRET)
                        .update(buf)
                        .digest('hex');

    let prototypeExpectedHash = crypto.createHmac('sha1', "a26c4ad2358b5b61942227574532d174")
                        .update(buf)
                        .digest('hex');
    if (signatureHash != expectedHash) {
      logger.error(`verifyRequestSignature: Could not validate request signature. signatureHash: <${signatureHash}>; expectedHash: <${expectedHash}>; prototype_expected_hash: <${prototypeExpectedHash}>`);
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

// set up plain http server
const http = require('http');
const regularApp = express();
regularApp.get('*',function(req,res){  
  res.redirect('https://polaama-backend.com'+req.url)
});
http.createServer(regularApp).listen(8080, function() {
  logger.info("Listening on port 8080 (all requests to this port will be redirected to the secure port).");
});

const server = https.createServer(options, app);  
server.listen(port, function() {
  logger.info("Listening on port " + port);
}); 

app.get('/index', function(req, res) {
  // return res.send("<meta name='B-verify' content='ee02308f7491f4aef923b2d1184072ccd1f6367a' /><body>Hello secure world</body>");
  return res.send(fs.readFileSync("html-templates/home.html", 'utf8'));
});

app.get('/', function(req, res) {
  return res.redirect('https://polaama.wixsite.com/polaama');
  // return res.redirect('https://34.217.232.9');
});
app.get('/business', function(req, res) {
  return res.redirect('https://polaama.wixsite.com/polaama/businesses');
});
app.get('/businesses', function(req, res) {
  return res.redirect('https://polaama.wixsite.com/polaama/businesses');
});
app.get('/survey', function(req, res) {
  return res.redirect('https://madhu85.typeform.com/to/J8M7ka');
});
app.get('/end-user-survey',function(req, res) {
  return res.redirect('https://madhu85.typeform.com/to/tIf9xh');
});

/*
app.get('/', ensureAuthenticated, function(req, res) {
  // this code is executed after ensureAuthenticated is called (by virtue of next() being called in ensureAuthenticated()). Redirect to "/index" if we were successfully ensured.
  res.redirect('/index');
});
*/

app.get('/login', function(req, res) {
  return res.send(fs.readFileSync("html-templates/login.html", 'utf8'));
});

// Simple middleware to ensure user is authenticated.
// Use this middleware on any resource that needs to be protected.
// If the request is authenticated (typically via a persistent login session),
// the request will proceed.  Otherwise, the user will be redirected to the
// login page.
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    // req.user is available for use here
    // logger.info(`ensureAuthenticated: request is authenticated. now the actual request (${req.path}) will be handled. req.user is ${JSON.stringify(req.user)}; req.session is ${JSON.stringify(req.params)}; req.path is ${req.path}`);
    if(req.path === "/") req.session.redirectTo = "/index";
    else req.session.redirectTo = req.path;
    // Ideally, this would be req.session.id, but that is taken already
    req.session.myId = req.params.id;
    const mesg = compareCallerWithUserInRequest(req, req.user);
    if(mesg) return res.send(mesg);
    return next(); 
  }
  // denied. redirect to login
  logger.info(`ensureAuthenticated: not authenticated. Redirecting to /auth/facebook; req.path is ${req.path}. params.id is: ${req.params.id}`);
  req.session.redirectTo = req.path;
  req.session.myId = req.params.id;
  // TODO: this might be useless.
  res.redirect('/auth/facebook');
  // res.redirect('/");
}

// var json2html = require('node-json2html');
app.get('/:id/trips', ensureAuthenticated, function(req, res) {
  return res.send("This will eventually return a list of trips planned for this user.");
});

app.get('/favicon.ico', function(req, res) {
  res.type('image/x-icon');
  res.status(301);
  return res.end();
});

app.get('/images/:file/', function(req, res) {
  let file = `/home/ec2-user/images/${req.params.file}`;
  if(fs.existsSync(`${file}.png`)) file = file.concat(".png");
  if(fs.existsSync(`${file}.jpg`)) file = file.concat(".jpg");
  return res.sendFile(`${file}`, null,
    function(e) {
      if(e) {
        logger.error(`images file: could not return file ${file}: ${e.stack}`);
        return res.status(404).send("Could not retrieve image at this time");
      }
  });
});

app.get('/:id/:tripName/friends', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.sendFriendsList(res);
});

app.post('/:id/:tripName/handle_trip_friends', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.handleTravelersForNewTrip(req, res);
	// TODO: close this page and then send the "help" message to the session in order to make forward progress.
});

app.get('/:id/:tripName', ensureAuthenticated, function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.handleWebpage(res, handler.displayTrip);
});

app.get('/:id/:tripName/pack-list', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.handleWebpage(res, handler.displayPackList, [req.headers]);
});

app.get('/:id/:tripName/todo', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.handleWebpage(res, handler.displayTodoList, [req.headers]);
});

app.get('/:id/:tripName/raw-comments', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.handleWebpage(res, handler.displayRawComments, [req.headers]);
});

app.get('/:id/:tripName/comments', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.handleWebpage(res, handler.displayComments);
});

app.get('/:id/:tripName/comments/weather', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.handleWebpage(res, handler.displayWeatherDetails);
});

app.get('/:id/:tripName/comments/activities', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.handleWebpage(res, handler.displayActivityDetails);
});

app.get('/:id/:tripName/comments/flight', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.handleWebpage(res, handler.displayFlightDetails);
});

app.get('/:id/:tripName/cities', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.handleWebpage(res, handler.displayCities);
});

app.get('/:id/:tripName/expense-report', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.handleWebpage(res, handler.displayExpenseReport);
});

app.post('/:id/:tripName/handle-city-choice', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  // The global postHandler could have a different session than the one on this page. so, create a new webhook handler using the session belonging to this page to start planning a trip.
  const myPostHandler = new WebhookPostHandler(handler.session);
  return handler.handleAddCityChoice(req, res, myPostHandler);
});

// Handling the addition of cities to existing trips
app.get('/:id/:tripName/add-cities', ensureAuthenticated, function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.handleWebpage(res, handler.displayCitiesForExistingTrip);
});

app.get('/controlgroup', function(req, res) {
  return res.send(fs.readFileSync("/home/ec2-user/html-templates/controlgroup.html",'utf8'));
});

app.get('/grid', function(req, res) {
  return res.send(fs.readFileSync("/home/ec2-user/html-templates/grid.html",'utf8'));
});

app.get('/mobile-itin', function(req, res) {
  return res.send(fs.readFileSync("/home/ec2-user/html-templates/mobile-itinerary-view-1.html",'utf8'));
});

app.get('/jqmobile-itin', function(req, res) {
  return res.send(fs.readFileSync("/home/ec2-user/html-templates/jqmobile-itin.html",'utf8'));
});

app.get('/:id/:tripName/calendar', ensureAuthenticated, function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.handleWebpage(res, handler.displayCalendar);
});

app.get('/:id/:tripName/:date/:file', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.getItemDetails(res, req.params.date, req.params.file);
});

app.get('/:id/:tripName/-/receipts/:file', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.getReceiptDetails(res, req.params.file);
});

app.get('/:id/:tripName/:date/-/map', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.getMap(res, req.params.date);
});

app.get('/:id/:tripName/:date/images/:item', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.getItemImage(res, req.params.date, req.params.item);
});

/*
app.get('/:id/:tripName/itin-detail/:file', function(req, res) {
  return res.sendFile(`/home/ec2-user/html-templates/${req.params.file}.html`, null, 
  function(err) {
    if(err) {
      logger.error(`error sending file ${req.params.file}: ${err.stack}`);
      return res.status(404).send("Even Bots need to eat lunch. Be back in a bit!");
    }
  });
});

app.get('/:id/:tripName/:date/-/map', function(req, res) {
  const fileName = `${req.params.tripName}-${req.params.date}-map.png`;
  return res.sendFile(`/home/ec2-user/html-templates/${fileName}`);
});

app.get('/:id/:tripName/-/test-day', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.handleWebpage(res, handler.myDayPlan);
});
*/

app.get('/:id/:tripName/flight-quotes', function(req, res) {
  logger.debug(`flight-quotes: called`);
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.displayFlightQuotes(req, res);
});

app.get('/todo', function(req, res) {
  return res.sendFile("/home/ec2-user/html-templates/todo-list.html");
});

// The filler "-" is needed here to disambiguate this route from "/:id/:tripName". If we don't use the filler here, that route will be chosen. TODO: FIX ME by chaining (see https://expressjs.com/en/guide/routing.html "Route handlers")
app.get('/-/images/boarding-pass', function(req, res) {
  return res.sendFile('/home/ec2-user/boardingPass.png');
});

app.get('/partly-cloudy', function(req, res) {
  return res.sendFile('/home/ec2-user/html-templates/partlycloudy.gif');
});

app.get('/clear', function(req, res) {
  return res.sendFile('/home/ec2-user/html-templates/clear.gif');
});

app.get('/nt_clear', function(req, res) {
  return res.sendFile('/home/ec2-user/html-templates/nt_clear.gif');
});

app.get('/:id/:tripName/boarding-pass-image', function(req, res) {
  return (new WebpageHandler(req.params.id, req.params.tripName)).getBoardingPass(req, res);
});

app.post('/handle-controlgroup', function(req, res) {
  const handler = new WebpageHandler(null, null);
  return handler.handleControlGroup(req, res);
});

app.post('/:id/:tripName/handle-add-city-choice', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  // The global postHandler could have a different session than the one on this page. so, create a new webhook handler using the session belonging to this page to start planning a trip.
  const myPostHandler = new WebhookPostHandler(handler.session);
  return handler.handleAddCityChoice(req, res, myPostHandler, true /* existingTrip */);
});

app.post('/:id/:tripName/save-itin-update', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.saveItinUpdate(req, res);
});

// tripName is the arrival city for this flight
app.post('/:id/:tripName/handle-flight-itinerary', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.handleFlightItinerary(req, res);
});

app.get('/:id/:tripName/flight-itinerary', function(req, res) {
  return res.sendFile('/home/ec2-user/html-templates/flight-itinerary.html', 'utf8');
});

// tripName is the place where the car receipt is provided
app.post('/:id/:tripName/handle-car-receipt', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.handleCarReceipt(req, res);
});

app.get('/:id/:tripName/car-receipt', function(req, res) {
  return res.sendFile('/home/ec2-user/html-templates/car-receipt.html', 'utf8');
});

// tripName is the place where the hotel receipt is provided
app.post('/:id/:tripName/handle-hotel-receipt', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  return handler.handleHotelReceipt(req, res);
});

app.get('/:id/:tripName/hotel-receipt', function(req, res) {
  return res.sendFile('/home/ec2-user/html-templates/hotel-receipt.html', 'utf8');
});

app.get('/:id/:tripName/:date', function(req, res) {
  const handler = new WebpageHandler(req.params.id, req.params.tripName);
  // TODO: This is ridiculous. fix me!
  if(req.params.date === "boarding-pass-image") return handler.getBoardingPass(req, res);
  return handler.handleWebpage(res, handler.dayPlan, [req.params.date]);
});

app.get('/my-map', function(req, res) {
  return res.sendFile(`/home/ec2-user/html-templates/map.html`, 'utf8');
});

/************ CHOICES ***************/
// TODO: Fix me!
app.get('/:id/:tripName/:location/-/breakfast-choices', function(req, res) {
  return res.sendFile(`/home/ec2-user/html-templates/${req.params.location}-breakfast-choices.html`, 'utf8');
});
app.get('/:id/:tripName/:location/-/hotel-choices', function(req, res) {
  return res.sendFile(`/home/ec2-user/html-templates/${req.params.location}-hotel-choices.html`, 'utf8');
});

app.get('/:id/:tripName/:location/-/car-choices', function(req, res) {
  return res.sendFile(`/home/ec2-user/html-templates/${req.params.location}-car-choices.html`, 'utf8');
});

app.get('/:id/:tripName/:location/-/lunch-choices', function(req, res) {
  return res.sendFile(`/home/ec2-user/html-templates/${req.params.location}-lunch-choices.html`, 'utf8');
});

app.get('/:id/:tripName/:location/-/running-trail', function(req, res) {
  return res.sendFile(`/home/ec2-user/html-templates/${req.params.location}-running-trail.html`, 'utf8');
});

app.get('/:id/:tripName/:location/-/activities', function(req, res) {
  return res.sendFile(`/home/ec2-user/html-templates/${req.params.location}-activities.html`, 'utf8');
});
/************ CHOICES ***************/

// handling webhook
app.get('/webhook', function(req, res) {
  logger.info("called /webhook");
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    logger.info("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    logger.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);          
  }  
});

app.post('/webhook', jsonParser, function(req, res) {
  // DONT log "is_echo" messages. They pollute the logs.
  const echo = (req.body.entry[0].messaging[0].message) ?  req.body.entry[0].messaging[0].message.is_echo : false; 
  const watermark = (req.body.entry[0].messaging[0].delivery) ? req.body.entry[0].messaging[0].delivery.watermark : false;
  if(!echo && !watermark) logger.debug(`/webhook called: fbid: ${req.body.entry[0].messaging[0].sender.id}; page id: ${req.body.entry[0].id}; messagingEvent dump: <${JSON.stringify(req.body.entry[0].messaging[0])}>`);
  postHandler.handle(req, res);
});

app.head('/emails', function(req, res) {
  logger.debug(`emails: head was called`);
  res.sendStatus(200);
});

app.post('/emails', function(req, res) {
  logger.debug("emails: post /emails was called");
  const emailParser = new EmailParser(req, res);
  emailParser.parse(req, res);
});

app.get('/emails', function(req, res) {
  logger.debug(`emails: get /emails was called`);
  res.send("get: ack receiving email");
});

app.get('/privacy-policy', function(req, res) {
  return res.sendFile('/home/ec2-user/html-templates/privacy-policy.html', 'utf8');
});

app.get('/terms-of-service', function(req, res) {
  return res.send(fs.readFileSync('/home/ec2-user/html-templates/terms-of-service.html', 'utf8'));
});

function sendTodoReminders() {
  postHandler.sendReminderNotification();
}

function pushTripDetailsJustBeforeTrip() {
  postHandler.pushTripDetailsJustBeforeTrip();
}

