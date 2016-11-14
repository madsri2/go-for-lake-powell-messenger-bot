// Set up logging
const winston = require('winston');
const fs = require('fs');
const logDir = '/home/ec2-user/log';

// Create the log directory if it does not exist
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}
winston.level = 'debug';
const tsFormat = () => (new Date()).toLocaleTimeString();
const logger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({ json: false, timestamp: tsFormat, level: 'info' }),
    new winston.transports.File({ filename: `${logDir}/results.log`, json: false, 
      colorize: true, timestamp: tsFormat, level: 'debug' })
  ],
  exceptionHandlers: [
    new (winston.transports.Console)({ json: false, timestamp: true }),
    new winston.transports.File({ filename: `${logDir}/exceptions.log`, json: false })
  ],
  exitOnError: false
});
logger.info('log to file');

// ----------------------------------------------------------------------------
// Wit.ai bot specific code

let Wit = null;
let log = null;
try {
  // if running from repo
  Wit = require('../').Wit;
  log = require('../').log;
} catch (e) {
  Wit = require('node-wit').Wit;
  log = require('node-wit').log;
}

const firstEntityValue = (entities, entity) => {
  const val = entities && entities[entity] &&
    Array.isArray(entities[entity]) &&
    entities[entity].length > 0 &&
    entities[entity][0].value
  ;
  if (!val) {
    return null;
  }
  return typeof val === 'object' ? val.value : val;
};

const request = require('request');
const fetch = require('node-fetch');

// The function used by the wit bot to send a message to facebook, which will then be posted to the user as part of the messenger chat.
const fbMessage = (id, text) => {
  const body = JSON.stringify({
    recipient: { id },
    message: { text },
  });
  const qs = 'access_token=' + encodeURIComponent(PAGE_ACCESS_TOKEN);
  return fetch('https://graph.facebook.com/v2.6/me/messages?' + qs, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body,
  })
  .then(rsp => rsp.json())
  .then(json => {
    if (json.error && json.error.message) {
      throw new Error(json.error.message);
    }
    return json;
  });
};

// ----------------------------------------------------------------------------
// Polaama specific code

var _ = require('lodash');

function createPackList(weather) {
  var packList = [];
  // if the weather is sunny, add corresponding items.
  switch(weather) {
    case "sunny": 
      packList.push("cap/hat");
      packList.push("sunglass");
      break;
  }

  return packList;
}

function createTodoList(trip) {
  var todoList = [];
  todoList.push("Flight tickets");
  todoList.push("Place to stay");
  todoList.push("Rental car");

  return todoList;
}

function encode(tripName) {
  return tripName.toLowerCase().replace(" ","_");
}

const tripPlanFile = "trips/";

function tripFile(tripName) {
  // TODO: check parameters
  return _.template("trips/${name}.txt")({
    name: encode(tripName)
  });
}

function persistUpdatedTrip(tripName, trip) {
  const file = tripFile(tripName);
  try {
    fs.writeFileSync(file, JSON.stringify(trip));
    logger.info("saved trip for ",tripName);
    return true;
  }
  catch(err) {
    logger.error("error writing to ",file,err.stack);
    return false;
  }
}

function persistTrip(tripName, context) {
  var trip = {};
  trip['destination'] = context.destination;
  trip['duration'] = context.duration;
  trip['startDate'] = context.datetime;
  // TODO: Get this information from weather API or the file persisted.
  trip['weather'] = "sunny";
  trip['packList'] = createPackList(trip['weather']);
  trip['todoList'] = createTodoList(trip);
  trip['comments'] = [
    "Average water temperature will be around 60F, not suitable for swimming",
  ];

  persistUpdatedTrip(tripName, trip);
}

function retrieveTrip(tripName) {
  try {
    const file = tripFile(tripName);
    logger.info("trying to retrieve trip from file: ",file);
    fs.accessSync(file, fs.F_OK);
    try {
      const trip = JSON.parse(fs.readFileSync(file, 'utf8')); 
      console.log("returning trip " + JSON.stringify(trip));
      return trip;
    }
    catch(err) {
      logger.error("error reading from ",file, err.stack);
      return null;
    }
  }
  catch(err) {
      logger.info("file does not exist. returning empty map");
      var empty = {};
      return empty; 
  }
}

function captureAvailableEntity(context, entities, valueKey, missingKey) {
  const value = firstEntityValue(entities, valueKey);
  if(value) { 
    logger.info("Found value " + value + " for " + valueKey);
    context[valueKey] = value;
  }
  // even if the value was not passed in this entity, it might have been passed to this session in a previous entity and persisted in the session state.
  if(context[valueKey]) {
    logger.info("Deleting " + missingKey + " from context since valueKey was found with value: " + context[valueKey]);
    delete context[missingKey];
  }
  else {
    logger.info("Did not find value for " + valueKey + ". Adding " + missingKey + " to context");
    context[missingKey] = true;
  }
}

// at this point, we are only keeping 2 messages in history
const HISTORY_LENGTH = 2;

function updateHistoryAndCallResolve(resolve, message, context) {
  const sessionId = context.sessionId;
  var history = sessions[sessionId].botMesgHistory;
  // add this message to the sessions's previous messages.
  if(history.length == HISTORY_LENGTH) {
    // an innefficient circular buffer
    history.forEach(function(element,i,array) {
      history[i] = history[i+1];
    });
    history[HISTORY_LENGTH - 1] = message;
  }
  else {
    history.push(message);
  }
  return resolve(context);
}

const actions = {
  send(request, response) {
    const {sessionId, context, entities} = request;
    const {text, quickreplies} = response;
    // Our bot has something to say!
    // Let's retrieve the Facebook user whose session belongs to
    const recipientId = sessions[sessionId].fbid;
    if (recipientId) {
      // Yay, we found our recipient!
      // Let's forward our bot response to her.
      // We return a promise to let our bot know when we're done sending
      logger.info("sending response from bot to recipient. text is " + text);
      return fbMessage(recipientId, text)
      .then(() => null)
      .catch((err) => {
        logger.error(
          'Oops! An error occurred while forwarding the response to',
          recipientId,
          ':',
          err.stack || err
        );
      });
    } else {
      logger.error('Oops! Couldn\'t find user for session:', sessionId);
      // Giving the wheel back to our bot
      return Promise.resolve()
    }
  },
  createNewTrip({context, entities}) {
    return new Promise(function(resolve, reject) {
      logger.info("createNewTrip: Called with context: " + JSON.stringify(context) + ". Entity: " + JSON.stringify(entities));
      captureAvailableEntity(context, entities, 'destination', 'missingLocation');
      captureAvailableEntity(context, entities, 'datetime', 'missingDatetime');
      captureAvailableEntity(context, entities, 'duration', 'missingDuration');
      if(context.missingLocation || context.missingDatetime || context.missingDuration) {
        logger.info("createNewTrip: Updated context: ",JSON.stringify(context));
        return resolve(context);
      }
      // both location & date time exist. Time to do some work.
      // TODO: we should call a weather API here
      /*
      var text = {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements: [{
              title: "Trip details",
              subtitle: "Lake Powell",
              item_url: "",
              buttons: [{
                type: "web_url",
                url: "https://polaama.com/lake-powell",
                title: "Lake Powell details",
              }],
            }]
          }
        }
      };
      */
      const tripName = context.destination + "-" + context.datetime + "-" + context.duration;
      var trip = persistTrip(tripName, context);
      context.firstResponse = "Great! It's going to be " + trip['weather'] + " in " + trip['destination'] + ". I have created your trip plan with pack list, todo lists etc. Check it out at https://polaama.com/trips";
      context.done = true;
      logger.info("createNewTrip: Updated context: ",JSON.stringify(context));
      return updateHistoryAndCallResolve(resolve, context.firstResponse, context);
    });
  },
  getName({context, entities}) {
    console.log("getName called");
    return new Promise(function(resolve, reject) {
      context.name = "Madhu";
      return updateHistoryAndCallResolve(resolve, context.name, context);
    });
  },
  greeting({context, entities}) {
    console.log("greeting called");
    return new Promise(function(resolve, reject) {
      const greeting = "Hi there! How can I help you today?";
      // if we are repeating ourselves, ask the user to help!
      const sessionId = context.sessionId;
      logger.info("session id in context is ",sessionId);
      const history = sessions[sessionId].botMesgHistory;
      if(history.length == HISTORY_LENGTH && history[history.length-1] === greeting) {
        // TODO: Get the message from a random list of strings so you don't ask the same thing..
        context.greeting = "Can you please ask the question a different way?";
        return resolve(context);
      }
      context.greeting = greeting;
      return updateHistoryAndCallResolve(resolve, greeting, context);
    });
  },
  farewellMessage({context, entities}) {
    console.log("farewell Message");
    return new Promise(function(resolve, reject) {
      context.farewellMessage = "Talk to you later.";
      return updateHistoryAndCallResolve(resolve, context.farewellMessage, context);
    });
  },
  saveFrequentFlyerDetails({context, entities}) {
    logger.info("saveFrequentFlyerDetails: Called with context: " + JSON.stringify(context) + ". Entity: " + JSON.stringify(entities));
    return new Promise(function(resolve, reject) {
      captureAvailableEntity(context, entities, 'contact', 'missingName');
      captureAvailableEntity(context, entities, 'mileageNumber', 'missingMileageNumber');
      captureAvailableEntity(context, entities, 'airlinesName', 'missingAirlines');
      if(context.missingName || context.missingMileageNumber || context.missingAirlines) {
        logger.info("saveFrequentFlyerDetails: Updated context: ",JSON.stringify(context));
        return resolve(context);
      }
      // If we have everything, do some work.
      // TODO: Need to overwrite existing mileage number.
      var miles = {};
      miles.name = context.contact;
      miles.mileageNumber = context.mileageNumber;
      miles.airlines = context.airlinesName;
      try {
        fs.appendFileSync("frequentFlyer.txt", JSON.stringify(miles));
        logger.info("Saved frequent flyer details: ", miles);
        context.message = "Saved!";
        // indicate that the session can be deleted after the response is sent!
        context.done = true;
      }
      catch(err) {
        logger.error("Error appending to frequent flyer file: ",err);
        context.message = "Could not save mileage details now. Please try again in a while..";
      }
      logger.info("saveFrequentFlyerDetails: Updated context: ",JSON.stringify(context));
      return updateHistoryAndCallResolve(resolve, context.message, context);
    });
  }
};

const WIT_ACCESS_TOKEN = "2DA4HZAX6JJKVBN5OWWB6FZHGHVGQUAN"
// Setting up our bot
const wit = new Wit({
  accessToken: WIT_ACCESS_TOKEN,
  actions,
  // logger: new log.Logger(log.INFO)
  logger: logger
});

// This will contain all user sessions.
// Each session has an entry:
// sessionId -> {fbid: facebookUserId, context: sessionState}
const sessions = {};

const findSession = (fbid) => {
  let sessionId;
  // Let's see if we already have a session for the user fbid
  Object.keys(sessions).forEach(k => {
    if (sessions[k].fbid === fbid) {
      // Yep, got it!
      sessionId = k;
      logger.info("Found session for ",fbid, JSON.stringify(sessions[sessionId]));
    }
  });
  return sessionId;
};

const findOrCreateSession = (fbid) => {
  let sessionId = findSession(fbid);
  if (_.isUndefined(sessionId)) {
    // No session found for user fbid, let's create a new one
    logger.info("Creating a new session for ",fbid);
    sessionId = new Date().toISOString();
    sessions[sessionId] = {fbid: fbid, context: {}};
    sessions[sessionId].botMesgHistory = [];
  }
  sessions[sessionId].context.sessionId = sessionId;
  // TODO: This value needs to be obtained a different way. Possibly by asking the user and or inferring it somehow.
  sessions[sessionId].tripName = "Big Island";
  logger.info("This session's id is",sessionId);
  return sessionId;
};


// ----------------------------------------------------------------------------
// Set up a webserver

// For validation with facebook & verifying signature
const VALIDATION_TOKEN = "go-for-lake-powell";
const PAGE_ACCESS_TOKEN = "EAAXu91clmx0BAONN06z8f5Nna6XnCH3oWJChlbooiZCaYbKOUccVsfvrbY0nCZBXmZCQmZCzPEvkcJrBZAHbVEZANKe46D9AaxOhNPqwqZAGZC5ZCQCK4dpxtvgsPGmsQNzKhNv5OdNkizC9NfrzUQ9s8FwXa7GK3EAkOWpDHjZAiGZAgZDZD";
const FB_APP_SECRET = "a26c4ad2358b5b61942227574532d174";

// A secure webserver
const util = require('util');
const express = require('express');  
const app = express();
const https = require('https');
const sslPath = '/etc/letsencrypt/live/polaama.com/';
const port = 443
const options = {  
    key: fs.readFileSync(sslPath + 'privkey.pem'),
    cert: fs.readFileSync(sslPath + 'fullchain.pem')
};

const crypto = require('crypto');
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
    // For testing, let's log an error. In production, you should throw an
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    let elements = signature.split('=');
    let method = elements[0];
    let signatureHash = elements[1];

    let expectedHash = crypto.createHmac('sha1', FB_APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

// get weather info for later use

var server = https.createServer(options, app);  
// this.io = require('socket.io').listen(this.server);  
server.listen(port, function() {
  logger.info("Listening on port " + port);
}); 
// log every response
app.use(({method, url}, rsp, next) => {
  rsp.on('finish', () => {
    logger.info(`${rsp.statusCode} ${method} ${url}`);
  });
  next();
});
const bodyParser = require('body-parser');
const jsonParser = bodyParser.json();
app.use(bodyParser.json({ verify: verifyRequestSignature }));

app.get('/', function(req, res) {
  return res.send("<meta name='B-verify' content='ee02308f7491f4aef923b2d1184072ccd1f6367a' /><body>Hello secure world</body>");
});

// var json2html = require('node-json2html');
app.get('/trips', function(req, res) {
  return res.send("This will eventually return a list of trips planned for this user.");
});


function getInfoFromTrip(req, tripKey) {
  const tripName = req.params.tripName;
  const trip = retrieveTrip(tripName);
  console.log("Found trip in getInfoFromTrip: " + JSON.stringify(trip));
  if(_.isUndefined(trip) || _.isUndefined(trip[tripKey])) {
    logger.info("could not find " + tripKey + " for trip " + tripName);
    return undefined;
  }
  logger.info("returning " + trip[tripKey] + " with " + trip[tripKey].length + " items. ;Destination is " + trip.destination);
  return trip[tripKey];
}

function formatListResponse(headers, list) {
  if(_.isUndefined(headers) || _.isUndefined(headers['user-agent'])) {
    logger.info("header or user-agent not defined. sending back json");
    return list;
  }
  if(headers['user-agent'].startsWith("Mozilla")) {
    logger.info("request call from browser. sending back html");
    var html = "<ol>";
    list.forEach(function(item) {
      html += "<li>" + item + "</li>";
    });
    html += "</ol>";
    return html;
  }
  logger.info("request call from something other than browser. sending back json");
  return list;
}

app.get('/:tripName/pack-list', function(req, res) {
  const packList = getInfoFromTrip(req, "packList");
  // logger.info("req value is " + util.inspect(req, {showHidden: true, color: true, depth: 5}));
  if(_.isUndefined(packList)) {
    return res.send("Could not find pack list for trip " + req.params.tripName);
  }
  return res.send(formatListResponse(req.headers, packList));
});

app.get('/:tripName/todo', function(req, res) {
  const todoList = getInfoFromTrip(req, "todoList");
  if(_.isUndefined(todoList)) {
    return res.send("Could not find todo list for trip " + req.params.tripName);
  }
  return res.send(formatListResponse(req.headers, todoList));
});

app.get('/:tripName/comments', function(req, res) {
  const comments = getInfoFromTrip(req, "comments");
  if(_.isUndefined(comments)) {
    return res.send("Could not find todo list for trip " + req.params.tripName);
  }
  return res.send(formatListResponse(req.headers, comments));
});

app.get('/text', function(req, res) {
  try {
    const text = fs.readFileSync(freeFormTextFile, 'utf8');
    const lines = text.split(/\r?\n/);
    let html = "<ol>";
    // TODO: Test that lines is of the right type and that the split worked.
    lines.forEach(function(line) {
      html += "<li>" + line + "</li>";
    });
    html += "</ol>";
    return res.send(html);
  }
  catch(err) {
    logger.error("error reading file: <" + err + ">");
    return res.send("Sorry, Could not retrieve text. Please try again later!");
  }
});

app.get('/todo', function(req, res) {
  try {
    var text = fs.readFileSync(todoTextFile, 'utf8');
    var lines = text.split(/\r?\n/);
    var html = "<ol>";
    // TODO: Test that lines is of the right type and that the split worked.
    lines.forEach(function(line) {
      html += "<li>" + line + "</li>";
    });
    html += "</ol>";
    return res.send(html);
  }
  catch(err) {
    logger.error("error reading file: <" + err + ">");
    return res.send("Sorry, Could not retrieve text. Please try again later!");
  }
});

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
  logger.info("In post webhook");
  var data = req.body;
  
  // Make sure this is a page subscription
  if(data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function(pageEntry) {
      var pageID = pageEntry.id;
      var timeOfEvent = pageEntry.time;
      pageEntry.messaging.forEach(function(messagingEvent) {
        try {
          if (messagingEvent.optin) {
            console.log("optin message");
            // receivedAuthentication(messagingEvent);
          } else if (messagingEvent.message) {
            console.log("Received Messaging event");
            receivedMessage(messagingEvent);
          } else if (messagingEvent.delivery) {
            console.log("Message delivered");
            // receivedDeliveryConfirmation(messagingEvent);
          } else if (messagingEvent.postback) {
            console.log("Deliver postback"); 
            receivedPostback(messagingEvent);
          } else {
            logger.info("Webhook received unknown messagingEvent: ", messagingEvent);
          }
        }
        catch(err) {
          logger.error("an exception was thrown: " + err.stack);
          sendTextMessage(messagingEvent.sender.id,"Even bots need to eat! Be back in a bit..");
        }
      });
    });

    // Assume all went well.
    //
    // You must send back a 200, within 20 seconds, to let us know you've 
    // successfully received the callback. Otherwise, the request will time out.
    res.sendStatus(200);
  }
});

function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;

  // The 'payload' param is a developer-defined field which is set in a postback 
  // button for Structured Messages. 
  var payload = event.postback.payload;

  logger.info("Received postback for user %d and page %d with payload '%s' " + 
    "at %d", senderID, recipientID, payload, timeOfPostback);

  // When a postback is called, we'll send a message back to the sender to 
  // let them know it was successful
  sendTextMessage(senderID, "Postback called");
}

/*
 * Message Event
 *
 * This event is called when a message is sent to your page. The 'message' 
 * object format can vary depending on the kind of message that was received.
 * Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-received
 *
 * For this example, we're going to echo any text that we get. If we get some 
 * special keywords ('button', 'generic', 'receipt'), then we'll send back
 * examples of those bubbles to illustrate the special message bubbles we've 
 * created. If we receive a message with an attachment (image, video, audio), 
 * then we'll simply confirm that we've received the attachment.
 * 
 */
function receivedMessage(event) {
  const senderID = event.sender.id;
  const recipientID = event.recipient.id;
  const timeOfMessage = event.timestamp;
  const message = event.message;

  logger.info("Received event for user %d and page %d at %d. Event: ", 
    senderID, recipientID, timeOfMessage, JSON.stringify(event));

  const messageText = message.text;
  const messageAttachments = message.attachments;
  // find or create the session here so it can be used elsewhere.
  findOrCreateSession(senderID);
  if (messageText) {
      // If we receive a text message, check to see if it matches any special
      // keywords and send back the corresponding example. Otherwise, just echo
      // the text we received.
      switch (messageText) {
        case 'generic':
          sendGenericMessage(senderID);
          break;
        case 'Help':
          handleHelpMessage(senderID); 
          break;
        default:
          determineResponseType(senderID,messageText);
          // sendTextMessage(senderID, messageText);
      }
    } else if (messageAttachments) {
      sendTextMessage(senderID, "Message with attachment received");
    }
}

function determineResponseType(senderID, messageText) {
  const mesg = messageText.toLowerCase();

  if(mesg.startsWith("save")) {
    storeFreeFormText(senderID, messageText);
    return;
  }
  if(mesg.startsWith("todo")) {
    storeTodoList(senderID, messageText);
    return;
  }
  if(mesg.startsWith("pack")) {
    storePackList(senderID, messageText);
    return;
  }
  if(mesg.startsWith("get todo")) {
    retrieveTodoList(senderID, messageText);
    return;
  }
  if(mesg.startsWith("retrieve") || mesg.startsWith("comments") || mesg.startsWith("get comments")) {
    retrieveStoredText(senderID, messageText);
    return;
  }
  if(mesg.startsWith("get list") || mesg.startsWith("get pack")) {
    retrievePackList(senderID, messageText);
    return;
  }
  if(mesg.startsWith("deals")) {
    retrieveDeals(senderID, messageText);
    return;
  }
  sendResponseFromWitBot(senderID,messageText);
}

const freeFormTextFile = "freeForm.txt";
function retrieveStoredText(senderID, messageText) {
  const tn = encode(sessions[findSession(senderID)].tripName);
  const url = _.template('https://polaama.com/${tripName}/comments')({
    tripName: tn
  });
  sendTextMessage(senderID, url);
}

function retrieveTodoList(senderID, messageText) {
  const tn = encode(sessions[findSession(senderID)].tripName);
  const url = _.template('https://polaama.com/${tripName}/todo')({
    tripName: tn
  });
  sendTextMessage(senderID, url);
}

function retrievePackList(senderID, messageText) {
  const tn = encode(sessions[findSession(senderID)].tripName);
  const url = _.template('https://polaama.com/${tripName}/pack-list')({
    tripName: tn
  });
  sendTextMessage(senderID, url);
}

function retrieveDeals(senderId, messageText) {
  const messageData = {
    recipient: {
      id: senderId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: "Wine tasting tour deal from livingsocial",
            subtitle: "Great deal on a wine tasting tour",
            item_url: "https://www.livingsocial.com/deals/1618024-2017-washington-wine-passport-with-tastings",
            image_url: "https://a1.lscdn.net/imgs/fe9f05ff-f78a-4652-b350-2e7bc0c13d7a/570_q80.jpg",
            buttons: [{
              type: "web_url",
              url: "https://www.livingsocial.com/deals/1618024-2017-washington-wine-passport-with-tastings",
              title: "Open Web URL"
            }],
          }]
        }
      }
    }
  };  
  callSendAPI(messageData);
}

function storeList(senderId, messageText, regex, key, retrieveString) {
  const tripName = sessions[findSession(senderId)].tripName;
  const trip = retrieveTrip(tripName);
  // retrieve text
  const items = messageText.replace(regex,"").split(',');
  if(!(key in trip)) {
    trip[key] = [];
  } 
  trip[key] = trip[key].concat(items);
  // store it locally
  persistUpdatedTrip(tripName, trip);
  logger.info("successfully stored item " + items + " in " + key);
  sendTextMessage(senderId, "Saved! You can retrieve this by saying \"" + retrieveString + "\"");
  return;
}

function storeTodoList(senderId, messageText) {
  const reg = new RegExp("todo[:]*[ ]*","i"); // ignore case
  storeList(senderId, messageText, reg, "todoList", "get todo");  
}

function storePackList(senderId, messageText) {
  const reg = new RegExp("pack[:]*[ ]*","i"); // ignore case
  storeList(senderId, messageText, reg, "packList", "get pack list");  
}

/*
 * Store whatever string the user input and return "Saved!"
 */
function storeFreeFormText(senderId, messageText) {
  const reg = new RegExp("save[:]*[ ]*","i"); // ignore case
  storeList(senderId, messageText, reg, "comments", "comments, get comments or retrieve");
}

/*
 * Send the text to wit bot and send the response sent by wit
 */
function sendResponseFromWitBot(senderID, messageText) {
  // This is needed for our bot to figure out the conversation history
  const sessionId = findSession(senderID);

  // Let's forward the message to the Wit.ai Bot Engine
  // This will run all actions until our bot has nothing left to do
  wit.runActions(
    sessionId, // the user's current session
    messageText, // the user's message
    sessions[sessionId].context // the user's current session state
  ).then((context) => {
    // Our bot did everything it has to do.
    // Now it's waiting for further messages to proceed.
    logger.info('Waiting for next user message. current context: ', JSON.stringify(context));

    // Based on the session state, you might want to reset the session.
    // This depends heavily on the business logic of your bot.
    // Example:
    if (context.done) {
      logger.info("Deleting Session " + sessionId + " and associated context since all related work is done");
      delete sessions[sessionId].context;
    }
    else {
      // Updating the user's current session state. 
      sessions[sessionId].context = context;
    }
  })
  .catch((err) => {
    logger.error('Oops! Got an error from Wit: ', err.stack || err);
    sendTextMessage(senderID,"Even bots need to eat. Out for lunch! Be back in a bit.");
  })
}

/*
 * Send a few buttons in response to "Help message" from the user.
 */
function handleHelpMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "What do you want to do next?",
          buttons: [
            {
              type: "postback",
              title: "Start new trip",
              payload: "DEVELOPER_DEFINED_PAYLOAD",
            },
            {
              type: "postback",
              title: "List trips",
              payload: "DEVELOPER_DEFINED_PAYLOAD",
            },
          ]
        }
      }
    }
  };
  callSendAPI(messageData);
}

/*
 * Send a Structured Message (Generic Message type) using the Send API.
 *
 */
function sendGenericMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: "rift",
            subtitle: "Next-generation virtual reality",
            item_url: "https://www.oculus.com/en-us/rift/",               
            image_url: "http://messengerdemo.parseapp.com/img/rift.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/rift/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for first bubble",
            }],
          }, {
            title: "touch",
            subtitle: "Your Hands, Now in VR",
            item_url: "https://www.oculus.com/en-us/touch/",               
            image_url: "http://messengerdemo.parseapp.com/img/touch.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/touch/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for second bubble",
            }]
          }]
        }
      }
    }
  };  
  callSendAPI(messageData);
}

/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText,
      metadata: "DEVELOPER_DEFINED_METADATA"
    }
  };

  callSendAPI(messageData);
}

function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData
  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      logger.info("Successfully sent generic message with id %s to recipient %s", 
        messageId, recipientId);
    } else {
      logger.error("Unable to send message.");
      logger.error(response);
      logger.error(error);
    }
  });  
}

