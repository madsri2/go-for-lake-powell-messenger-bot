'use strict';
const _ = require('lodash');
const request = require('request');
const logger = require('./my-logger');
const TripData = require('./trip-data');
const Sessions = require('./sessions');
const moment = require('moment');
const FbidHandler = require('./fbid-handler');
const formidable = require('formidable');
const TripInfoProvider = require('./trip-info-provider');
const Promise = require('promise');
const validator = require('node-validator');

// NOTE: WebhookPostHandler is a singleton, so all state will need to be maintained in this.session object. fbidHandler is also a singleton, so that will be part of the WebhookPostHandler object.
function WebhookPostHandler(session) {
  this.sessions = new Sessions();
  this.fbidHandler = new FbidHandler();
  if(!_.isUndefined(session)) {
    logger.info(`WebhookPostHandler: A session with id ${session.sessionId} was passed. Using that in the post hook handler`);
    this.passedSession = session;
    this.session = session;
  }
}

function handleMessagingEvent(messagingEvent) {
  // find or create the session here so it can be used elsewhere. Only do this if a session was NOT passed in the constructor.
  if(_.isUndefined(this.passedSession)) {
    this.session = this.sessions.findOrCreate(messagingEvent.sender.id);
    logger.info(`handleMessagingEvent: This chat's session id is ${this.session.sessionId}`);
  }
  else {
    this.session = this.passedSession;
  }

  try {
    if (messagingEvent.optin) {
      receivedAuthentication(messagingEvent);
    } else if (messagingEvent.message) {
      receivedMessage.call(this, messagingEvent);
    } else if (messagingEvent.delivery) {
      // console.log("Message delivered");
      // receivedDeliveryConfirmation(messagingEvent);
    } else if (messagingEvent.postback) {
      receivedPostback.call(this, messagingEvent);
    } else {
      logger.info("Webhook received unknown messagingEvent: ", messagingEvent);
    }
  }
  catch(err) {
    logger.error("an exception was thrown: " + err.stack);
    sendTextMessage(messagingEvent.sender.id,"Even bots need to eat! Be back in a bit..");
  }
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to 
 * Messenger" plugin, it is the 'data-ref' field. Read more at 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
  const senderID = event.sender.id;
  const recipientID = event.recipient.id;
  const timeOfAuth = event.timestamp;

  // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
  // The developer can set this to an arbitrary value to associate the 
  // authentication callback with the 'Send to Messenger' click event. This is
  // a way to do account linking when the user clicks the 'Send to Messenger' 
  // plugin.
  const passThroughParam = event.optin.data-ref;

  logger.info("Received authentication for user %d, page %d, session %d at timestamp: %d. Pass-through param: %s", senderID, recipientID, this.session.fbid, timeOfMessage, passThroughParam);

  // When an authentication is received, we'll send a message back to the sender
  // to let them know it was successful.
  sendTextMessage(senderID, "Authentication successful");
}

function handlePageEntry(pageEntry) {
    const pageID = pageEntry.id;
    const timeOfEvent = pageEntry.time;
    for (let i = 0, len = pageEntry.messaging.length; i < len; i++) {
      handleMessagingEvent.call(this, pageEntry.messaging[i]);
    }
}

WebhookPostHandler.prototype.handle = function(req, res) {
  const data = req.body;
  
  // Make sure this is a page subscription
  if(data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    for(let i = 0, len = data.entry.length; i < len; i++) {
      handlePageEntry.call(this, data.entry[i]);
    }
  }
  // Assume all went well.
  //
  // You must send back a 200, within 20 seconds, to let us know you've 
  // successfully received the callback. Otherwise, the request will time out.
  res.sendStatus(200);
}

function getComment() {
  // update this session that we are awaiting response for comments postback
  this.session.awaitingComment = true;
  sendTextMessage(this.session.fbid, "Enter your free-form text");
  return;
}

function getTodoItem() {
  this.session.awaitingTodoItem = true;
  sendTextMessage(this.session.fbid, "Enter a todo item");
  return;
}

function getPacklistItem() {
  this.session.awaitingPacklistItem = true;
  sendTextMessage(this.session.fbid, "Enter a pack-list item");
  return;
}

function getTripInContext(payload) {
  const tripName = payload.substring("trip_in_context ".length);
  logger.info(`Setting the trip name for this session's context to ${tripName}. User assumes this is an existing trip.`);
  this.session.addTrip(tripName);
  sendHelpMessage.call(this);
  return;
}

// Gather trip details (weather, flight, hotel, etc.) and send it in a web_url format.
// This is a callback that is passed to TripInfoProvider to be called after weather (and other relevant information) is obtained. TODO: Handler cases where there is no weather data / flight data etc.
function displayTripDetails() {
  let messageData = {
    recipient: {
      id: this.session.fbid
    }
  };
  const tripData = this.session.tripData();
  messageData.message = {
    attachment: {
      type: "template",
      payload: {
        template_type: "generic",
        elements: [{
          title: "Get Weather details",
          buttons: [{
            type: "web_url",
            url: sendUrl.call(this, tripData.weatherUrlPath()),
            title: "Weather",
            webview_height_ratio: "compact",
            messenger_extensions: true,
            fallback_url: sendUrl.call(this, tripData.weatherUrlPath()),
          }]
        }, {
          title: "Get Flight details",
          buttons: [{
            type:"web_url",
            url: sendUrl.call(this, tripData.flightUrlPath()),
            title:"Flight",
            webview_height_ratio: "compact",
            messenger_extensions: true,
            fallback_url: sendUrl.call(this, tripData.flightUrlPath())
          }]
        }, /*{
          title: "Get Stay details",
          buttons: [{
            type:"web_url",
            url: sendUrl.call(this, tripData.stayUrlPath()),
            title:"Stay",
            webview_height_ratio: "compact",
            messenger_extensions: true,
            fallback_url: sendUrl.call(this, tripData.stayUrlPath())
          }]
        },*/ {
          title: "Get Activities details",
          buttons: [{
            type:"web_url",
            url: sendUrl.call(this, tripData.activitiesUrlPath()),
            title:"Activities",
            webview_height_ratio: "compact",
            messenger_extensions: true,
            fallback_url: sendUrl.call(this, tripData.activitiesUrlPath())
          }]
        }]
      }
    }
  };
  callSendAPI(messageData);
}

// Start collecting useful information for trip and update the user.
WebhookPostHandler.prototype.startPlanningTrip = function() {
  sendTextMessage(this.session.fbid, `Gathering weather, flight and stay related information for ${this.session.tripNameInContext}`);
  sendTypingAction.call(this);
  const tip = new TripInfoProvider(this.session.tripData(), this.session.hometown);
  const activities = Promise.denodeify(tip.getActivities.bind(tip));
  const flightDetails = Promise.denodeify(tip.getFlightDetails.bind(tip));
  const weatherDetails = Promise.denodeify(tip.getWeatherInformation.bind(tip));
  const dtdCallback = displayTripDetails.bind(this);

  // TODO: If this is a beach destinataion, use http://www.blueflag.global/beaches2 to determine the swimmability. Also use http://www.myweather2.com/swimming-and-water-temp-index.aspx to determine if water conditions are swimmable
  activities()
    .then(flightDetails())
    .then(weatherDetails())
    .done(
      dtdCallback(), 
      function(err) {
        logger.error(`error in gathering data for trip ${this.session.tripNameInContext}: ${err.stack}`);
    });
}

function planNewTrip() {
  logger.info("User wants to plan a new trip");
  sendTextMessage(this.session.fbid, "Can you provide details about your trip: destination country, start date, duration (in days) as a comma separated list?"); 
  sendTextMessage(this.session.fbid, "Example: India,11/01,20 or India,11/01/17,20");
	this.session.awaitingNewTripDetails = true;
  this.session.planningNewTrip = true;
}

function receivedPostback(event) {
  const senderID = event.sender.id;
  const recipientID = event.recipient.id;
  const timeOfPostback = event.timestamp;
  // The 'payload' param is a developer-defined field which is set in a postback 
  // button for Structured Messages. 
  const payload = event.postback.payload;

  logger.info("Received postback for user %d, page %d, session %d at timestamp: %d. Payload: %s", senderID, recipientID, this.session.fbid, timeOfPostback, payload);

  // A postback is indicative of the beginning of a new state in the state machine. So, clear the session's "awaiting" states to indicate the beginning of a new state.
  this.session.clearAllAwaitingStates();

	// new trip cta
  if(payload === "new_trip" || payload === "pmenu_new_trip") {
    planNewTrip.call(this);
		return;
	}

  // existing trip
  if(payload.startsWith("trip_in_context")) {
    getTripInContext.call(this, payload);
    this.session.noTripContext = false;
    return;
  }
  if(payload === "pmenu_existing_trip") {
		sendTripButtons.call(this);
		return;
  }
  if(payload === "past_trips") {
    sendPastTrips.call(this);
    return;
  }
	
	// In order to add travelers to a trip, we need to know the trip in context.
  if((_.isNull(this.session.tripNameInContext) || _.isUndefined(this.session.tripNameInContext) || this.session.tripNameInContext === "") && !this.session.noTripContext) {
    logger.info("receivedPostback: no trip name in context. Asking user!");
    sendTripButtons.call(this, true /* add new trip */);
    return;
  }
	
	if(payload === "pmenu_add_travelers") {
		determineTravelCompanions.call(this);
		return;
	}

	// actual features
  if(payload === "comments") {
    getComment.call(this);
    return;
  }
  if(payload === "todo") {
    getTodoItem.call(this);
    return;
  }
  if(payload === "qr_pack_item") {
    getPacklistItem.call(this);
    return;
  }

  // When an unknown postback is called, we'll send a message back to the sender to 
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

  if(message.is_echo) {
    // for now simply log a message and return 200;
    // logger.info("Echo message received. Doing nothing at this point");
    return;
  }

  logger.info("Received event for user %d, page %d, session %d at timestamp: %d. Event: ", senderID, recipientID, this.session.fbid, timeOfMessage, JSON.stringify(event));

  const messageText = message.text;
  const messageAttachments = message.attachments;
  if (messageText) {
      // If we receive a text message, check to see if it matches any special
      // keywords and send back the corresponding example. Otherwise, just echo
      // the text we received.
      switch (messageText) {
        case 'generic':
          sendGenericMessage(senderID);
          break;
        default:
          determineResponseType.call(this, event);
      }
    } else if (messageAttachments) {
      sendTextMessage(senderID, "Message with attachment received");
    }
}

function sendUrl(urlPath) {
  const encodedId = this.fbidHandler.encode(this.session.fbid);
  return `https://polaama.com/${encodedId}/${urlPath}`;
}

function sendPastTrips() {
  // reset this sessions' context
  this.session.noTripContext = true;
  const elements = [];
  const tripNames = this.session.getPastTrips();
  tripNames.forEach(t => {
    elements.push({
      title: t.rawName,
      buttons: [{
        type: "web_url",
        url:sendUrl.call(this, `${t.rawName}`),
        title: t.name,
        webview_height_ratio: "compact",
        messenger_extensions: true
      }]
    })
  });
  const messageData = {
    recipient: {
      id: this.session.fbid
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: elements
        }
      }
    }
  };
  callSendAPI(messageData);
  return;
}

function sendTripButtons(addNewTrip) {
  const tripDetails = this.session.getFutureTrips();
  const tripNames = tripDetails.futureTrips;
  console.log(`sendTripButtons: trip length for fbid ${this.session.fbid} is ${tripNames.length}`);
  if(tripNames.length == 0) {
    sendTextMessage(this.session.fbid, "You don't have any trips planned yet.");
    const messageData = {
      recipient: {
        id: this.session.fbid
      },
      message: {
        text: `Create New Trip`,
        quick_replies:[
          {
            content_type: "text",
            title: "Create New trip",
            payload: "qr_new_trip"
          }
        ]
      }
    };
    callSendAPI(messageData);
    return;
  }
    
  // reset this sessions' context
  this.session.noTripContext = true;
  sendTextMessage(this.session.fbid, "Hi, which trip are we discussing?");
  const elements = [];
  tripNames.forEach(t => {
    elements.push({
      title: t.rawName,
      buttons: [{
        type: "postback",
        title: t.name,
        payload: `trip_in_context ${t.name}`
      }]
    })
  });

  if(addNewTrip) {
    elements.push({
      title: "Create new trip",
      buttons: [{
       type: "postback",
       title: "New Trip",
       payload: "new_trip"
    	}]
    });
  }
  if(tripDetails.pastTrips) {
    elements.push({
      title: "Past trips",
      buttons: [{
        type: "postback",
        title: "Past Trips",
        payload: "past_trips"
      }]
    });
  }
  const messageData = {
    recipient: {
      id: this.session.fbid
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: elements
        }
      }
    }
  };
  callSendAPI(messageData);
}

function handleQuickReplies(payload) {
  if(_.isUndefined(payload)) {
    logger.error(`handleQuickReplies: Payload is undefined in quick_reply.`);
    return;
  }
    if(payload === "comments") {
      getComment.call(this);
      return;
    }
    if(payload === "todo") {
      getTodoItem.call(this);
      return;
    }
    if(payload === "qr_pack_item") {
      getPacklistItem.call(this);
      return;
    }
    if(payload === "qr_other_details") {
      displayTripDetails.call(this);
      return;
    }
    if(payload === "qr_new_trip") {
      planNewTrip.call(this);
      return;
    }
    if(payload === "qr_add_cities") {
      addCitiesToExistingTrip.call(this);
      return;
    }
    logger.warn(`handleQuickReplies: Session ${this.session.fbid}: A quick reply without actionoble payload called: ${JSON.stringify(message.quick_reply)}`);
    return;
}

function validateStartDate(value, onError) {
  const now = moment();
  
  const check = validator.isObject()
    .withRequired('startDate', validator.isDate());

  var errCount = 0;
  var error = {};
  validator.run(check, { startDate: value}, function(ec, e) {
      errCount = ec;
      error = e;
  });
  if(errCount > 0) {
    return onError(error[0].message, error.parameter, error.value);
  }

  if(now.diff(moment(new Date(value).toISOString()),'days') >= 0) {
    return onError("Provided start date is in the past","",value);
  }
  return null;
}

function extractNewTripDetails(messageText) {
  const td = messageText.split(',');
  if(td[1].match(/\d+\/\d+/)) {
    td[1] = td[1].concat(`/${new Date().getFullYear()}`);
  }
  const tripDetails = {
    destination: td[0],
    startDate:  td[1],
    duration: parseInt(td[2]) 
  };
  const customValidator = {
      validate: validateStartDate
  };
  // validate tripData
  const check = validator.isObject()
    .withRequired('duration', validator.isInteger({min: 1, max: 200}))
    .withRequired('startDate', customValidator)
    .withRequired('destination', validator.isString({regex: /^[A-Za-z]+$/}));
  
  var error = null;
  validator.run(check, tripDetails, function(ec, e) {
    if(ec > 0) {
      error = e;
    }
    return;
  });
  if(error) {
    logger.warn(`extractNewDetails: Validation error: ${JSON.stringify(error)}`);
    return error;
  }

  this.session.addTrip(tripDetails.destination);
  const tripData = this.session.tripData();
  tripData.addTripDetailsAndPersist(tripDetails);
  logger.info(`extractNewTripDetails: This session's trip name in context is ${tripDetails.destination}`);
  this.session.awaitingNewTripDetails = false;
  // this new trip will also be the context for this session;
  this.session.noTripContext = false;
  return null;
}

function extractCityDetails(messageText) {
  const cities = messageText.split(',');
  // TODO: Validate city
  this.session.tripData().addCities(cities);
  this.session.tripData().addPortOfEntry(cities[0]); // assume that the first city is port of entry. See determineResponseType 3rd step in new trip workflow
  // indicate that the tripData for this trip is stale in the session object.
  this.session.invalidateTripData();
  this.session.awaitingCitiesForNewTrip = false;
}

// TODO: This code duplicates some aspects of "getting cities for the trip" in determineResponseType. Fix that.
function addCitiesToExistingTrip() {
    const tripData = this.session.tripData();
    if(!determineCities.call(this, true /* existingTrip */)) {
      if(!this.session.awaitingCitiesForExistingTrip) {
        sendTextMessage(this.session.fbid, `What cities in ${tripData.data.destination} are you traveling to (comma separated list)?`);
        this.session.awaitingCitiesForExistingTrip = true;
        return;
      }
      else {
        if(tripData.data.cities) {
          logger.info(`addCitiesForExistingTrip: Start planning trip for customer`);
          this.startPlanningTrip();
        }
        else {
          logger.error(`addCitiesForExistingTrip: Session ${this.session.sessionId}: Cannot determine cities for trip ${tripData.data.destination} even after getting cities from customer. Possible BUG!`);
          sendTextMessage(this.session.fbid,"Even bots need to eat! Be back in a bit..");
        }
      }
    }
}

/*
New trip Workflow:

1) Create a new trip
2) Is this a group trip?
3) yes: 
      Add the names of travelers. This is the tricky part. How do we do this? For now, it could simply be the list of all people and asking the user to select from them.
      Add trip to the session of each of these travelers.
      For group trips, a message from any member of the group is shared with everyone. Only messages that are not comment, todo, pack list will be shared.
4) no:
      Add trip to just this user's session.
      Discussions will be between user, polaama (and human in background).
*/
// TODO: Use a State Machine pattern
function determineResponseType(event) {
  const senderID = this.session.fbid;
  const messageText = event.message.text;
  const mesg = messageText.toLowerCase();

  // if we don't know what trip is being discussed, ask the user for this, unless the user is adding details about a new trip.
  if((_.isNull(this.session.tripNameInContext) 
			|| _.isUndefined(this.session.tripNameInContext) 
			|| this.session.tripNameInContext === "") 
			&& !this.session.planningNewTrip) {
    logger.info("determineResponseType: no trip name in context. Asking user!");
    sendTripButtons.call(this, true);
    return;
  }

  // New trip workflow
  if(this.session.planningNewTrip) {
    // 1) Extract trip details like destination, start date and duration
    if(this.session.awaitingNewTripDetails) {
      const err = extractNewTripDetails.call(this, messageText);
      if(err) {
        sendTextMessage(this.session.fbid, `Input error: parameter ${err[0].parameter}:${err[0].message}`);
        return;
      }
    }

    // 2) Get hometown if it's undefined.
    if(_.isUndefined(this.session.hometown)) {
      // TODO: If the hometown is defined, don't simply assume that to be the point of origin. Confirm with the user.
      if(this.session.awaitingHometownInfo) {
        // TODO: Validate hometown
        this.session.persistHometown(messageText); 
        this.session.awaitingHometownInfo = false;
      }
      else {
        sendTextMessage(this.session.fbid, "What is your home city? We will use this as your trip's origin");
        this.session.awaitingHometownInfo = true;
        return;
      }
    }
  
    // 3) Get cities for the trip.
    // TODO: Handle case where user does not yet know which cities they are going to!
    if(this.session.awaitingCitiesForNewTrip) {
      extractCityDetails.call(this, messageText);
    }
    else {
      const tripData = this.session.tripData();
      if(!determineCities.call(this)) {
        // ask user to enter cities and port of entry
        if(!this.session.awaitingCitiesForNewTrip) {
          sendTextMessage(this.session.fbid, `What cities in ${tripData.data.destination} are you traveling to (comma separated list)?`);
          sendTextMessage(this.session.fbid, `The first city in your list will be used as your port of entry`);
          this.session.awaitingCitiesForNewTrip = true;
          return;
        }
        else {
          if(tripData.data.cities) {
            logger.info(`determineResponseType: Start planning trip for customer`);
            this.startPlanningTrip();
          }
          else {
            logger.error(`determineResponseType: Session ${this.session.sessionId}: Cannot determine cities for trip ${tripData.data.destination} even after getting cities from customer. Possible BUG!`);
            sendTextMessage(this.session.fbid,"Even bots need to eat! Be back in a bit..");
          }
        }
      }
    }
    // End of new trip workflow. The workflow will complete when user selects cities (handled by determineCities function) and webpage-handler.js calls the startPlanningTrip method
    this.planningNewTrip = false;
    return;
  }

  if(!_.isUndefined(event.message.quick_reply)) { 
    return handleQuickReplies.call(this, event.message.quick_reply.payload);
  }

  if(mesg.startsWith("help")) {
    return sendHelpMessage.call(this); 
  }
  const tripData = this.session.tripData();
  if(mesg.startsWith("save") || this.session.awaitingComment) {
    const returnString = tripData.storeFreeFormText(senderID, messageText);
    sendTextMessage(senderID, returnString);
    this.session.awaitingComment = false;
    return;
  }
  if(mesg.startsWith("todo") || this.session.awaitingTodoItem) {
    const returnString = tripData.storeTodoList(senderID, messageText);
    sendTextMessage(senderID, returnString);
    this.session.awaitingTodoItem = false;
    return;
  }
  if(mesg.startsWith("pack") || this.session.awaitingPacklistItem) {
    const returnString = tripData.storePackList(senderID, messageText);
    sendTextMessage(senderID, returnString);
    this.session.awaitingPacklistItem = false;
    return;
  }
  if(mesg.startsWith("get todo")) {
    sendTextMessage(senderID, sendUrl.call(this, tripData.todoUrlPath()));
    return;
  }
  if(mesg.startsWith("retrieve") || mesg.startsWith("comments") || mesg.startsWith("get comments")) {
    sendTextMessage(senderID, sendUrl.call(this, tripData.commentUrlPath()));
    return;
  }
  if(mesg.startsWith("get list") || mesg.startsWith("get pack")) {
    sendTextMessage(senderID, sendUrl.call(this, tripData.packListPath()));
    return;
  }
  if(mesg.startsWith("deals")) {
    retrieveDeals(senderID, messageText);
    return;
  }
  if(mesg.startsWith("top activity list") || mesg.startsWith("top activities") || mesg.startsWith("get top activities")) {
    sendActivityList.call(this, messageText);
    return;
  }
  if(mesg.startsWith("other activity list") || mesg.startsWith("other activities") || mesg.startsWith("get other activities")) {
    sendOtherActivities.call(this, messageText);
    return;
  }
  const humanContext = this.session.humanContext();
  logger.info("determineResponseType: human context: ",JSON.stringify(humanContext));
  if(senderID != humanContext.fbid) {
    // TODO: If response could not be sent to human as expected, we need to figure out what to do. One option is to wing it and send the message to bot. Another option is to simply throw an error that we are experieincing difficult. This might be a little 
    interceptMessage(humanContext,senderID,event);
    logger.info("intercepted message and updated human context: ",JSON.stringify(humanContext));
    return;
  }
  handleMessageSentByHuman.call(this, messageText, senderID);
}

function sendOtherActivities(messageText) {
  const messageData = {
    recipient: {
      id: this.session.fbid
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: "Lava flow viewing after sunset (~5.45 PM), Spectacular, but not kid friendly",
            subtitle: "32 miles (51 min drive) south of Hilo condo. Need to bike or walk 4.2 miles",
            buttons: [{
              type: "web_url",
              url: "http://www.familyvacationcritic.com/attraction/hawaii-county-kalapana-lava-visiting-site/big-island/",
              title: "Kalapana Lava visiting"
            }]
          }, {
            title: "Koi feeding on thursday and saturday, mall",
            subtitle: "26 miles (40 min drive) north of kona reef resort",
            buttons: [{
              type: "web_url",
              url: "http://queensmarketplace.net/",
              title: "Queens marketplace"
            }]
          }]
        }
      }
    }
  };
  callSendAPI(messageData);
}

function sendActivityList(messageText) {
  const messageData = {
    recipient: {
      id: this.session.fbid
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: "Beautiful, sandy, family friendly beach with restrooms, can get windy",
            buttons: [{
              type: "web_url",
              url: "http://www.familyvacationcritic.com/attraction/hapuna-beach-state-recreation-area/big-island/",
              title: "Hapuna Beach"
            }],
            subtitle: "33 miles (49 min drive) north of Kona reef resort"
          }, {
            title: "Sandy, calm, small beach close to resort. Might be rough if windy",
            subtitle: "2.8 miles (7 min drive) south of kona reef resorts",
            buttons: [{
              type: "web_url",
              url: "http://tinyurl.com/jfka26v",
              title: "Magic sand beach"
            }]
          }, {
            title: "Garden, ocean views, waterfall, open 9 to 5, $15 pp, require 2-3 hours",
            subtitle: "10.5 miles (23 min drive) north of hotel",
            buttons: [{
              type: "web_url",
              url: "http://htbg.com/",
              title: "Botanical Gardens"
            }]
          }, {
            title: "Great for kids, very calm, sandy",
            subtitle: "32.3 miles (47 min drive) north of kona reef resort",
            buttons: [{
              type: "web_url",
              url: "http://tinyurl.com/gt8dyr9",
              title: "Beach 69"
            }]
          }, {
            title: "Go early, crowded, good sea-life BEWARE of sea urchins, slightly rocky",
            subtitle: "3.9 miles (10 min drive) south of kona reef resort",
            buttons: [{
              type: "web_url",
              url: "https://www.yelp.com/biz/kahaluu-beach-park-kailua-kona-2",
              title: "Kahaluu beach park"
            }]
          }]
        }
      }
    }
  };
  callSendAPI(messageData);
}

/*
 For each trip in this user's session, find the corresponding trip data information and if the trip is still not complete, then send a notification.
*/
WebhookPostHandler.prototype.sendReminderNotification = function() {
  // get todo list
  const sessions = this.sessions.allSessions();
  Object.keys(sessions).forEach(id => {
    sessions[id].allTrips().forEach(trip => {
      const todoList = trip.data.todoList;
      logger.info(`sendReminderNotification: Trip ${trip.data.name} from session ${id} has ${todoList.length} todo items.`);
      if(!todoList.length) {
        return;
      }
      const now = moment();
      const tripEnd = trip.data.returnDate;
      if(now.diff(tripEnd,'days') >= 0) {
        logger.info(`Trip ${trip.data.name} started on ${trip.data.startDate} and has a duration of ${trip.data.duration} days. No longer sending reminder because the trip is over (difference is ${now.diff(tripEnd,'days')} days).`);
        return;
      }
      // only send reminder if we are within 45 days of the trip.
      const startDate = moment(new Date(trip.data.startDate).toISOString());
      const daysToTrip = startDate.diff(now, 'days');
      if(daysToTrip <= 45) {
        sendTextMessage(sessions[id].fbid, `Reminder: You still have ${todoList.length} items to do for your trip to ${trip.data.name}`);
      }
      else {
        logger.info(`Not sending reminder because there are ${daysToTrip} days to the trip ${trip.data.name}`);
      }
    });
  });
}

// This message was sent by the human. Figure out if it was sent in response to a previous question by one of our users. If so, identify the user and send response back to the right user.
function handleMessageSentByHuman(messageText, senderID) {
  const arr = messageText.split(' ');
  const [origSenderId,seq,done] = arr[0].split('-');
  if(_.isUndefined(origSenderId) || _.isUndefined(seq)) {
    if(this.session.nooneAwaitingResponse()) {
      logger.info("message being sent as user, not human. Sending message from them to ai bot");
      sendResponseFromWitBot.call(this, origSenderId, origMsg);
      return;
    }
    logger.info("handleMessageSentByHuman: response from human is not in the right format. senderId and/or sequence number is missing");
    sendTextMessage(senderID,"wrong format. correct format is <original-sender-id>-<sequence number> message text");
    return;
  }
  // send the message from human to the original user. If human indicated that a bot look at it, send the user's original message to the bot.
  arr.shift(); // remove first element.
  const mesgToSender = arr.join(' ');
  // TODO: Figure out a way if we need to reconcile the original sender's session with the session of the human. This might be needed because the human could be handling multiple sessions at once. One way to accomplish this would be to keep a separate session for the human inside the user's session and use that. Also, think about making a session have a 1:1 mapping with trip-fbid. Might make things easier..
  const origSenderSession = this.sessions.find(origSenderId);
  // TODO: Handle origSenderSession not being available
  const humanContext = origSenderSession.humanContext();
  logger.info(`handleMessageSentByHuman: obtained original sender id ${origSenderId}; seq ${seq}; mesg from human: ${mesgToSender}; human context: ${JSON.stringify(humanContext)}`);
  let thread = humanContext.conversations[seq];
  thread.messagesSent.push(mesgToSender);
  if(mesgToSender === "ai") {
    const origMsg = thread.originalMessage;
    logger.info("human sent \"ai\". Sending original message ",origMsg, " to ai bot");
    sendResponseFromWitBot.call(this, origSenderId, origMsg);
  }
  else {
    sendMessageFromHuman(origSenderId, mesgToSender);
  }
  if(!_.isUndefined(done) || (mesgToSender === "ai")) {
    logger.info("handleMessageSentByHuman: human has sent the last message for this conversation. Mark awaiting response as done");
    thread.awaitingResponse = false;
  }
  logger.info("handleMessageSentByHuman: updated conversation for original user ",origSenderId, "; value is ", JSON.stringify(humanContext));
  return;
}

function sendMessageFromHuman(originalSenderId, messageText) {
  // expect message from human to be of the form 1326674134041820-1714-done <text meant to be sent to the user
  const messageData = {
    recipient: {
      id: originalSenderId
    },
    message: {
      text: messageText,
      metadata: "response from human"
    }
  };
  logger.info("sendMesssageFromHuman: sending message from human to sender: " + JSON.stringify(messageData));
  callSendAPI(messageData);
}

function interceptMessage(hContext, senderID, event) {
  const textFromSender = event.message.text;
  // update the conversation in humanContext
  if(_.isUndefined(hContext.conversations[event.message.seq])) {
    hContext.conversations[event.message.seq] = {};
  }
  hContext.conversations[event.message.seq].awaitingResponse = true;
  hContext.conversations[event.message.seq].originalMessage = textFromSender;
  hContext.conversations[event.message.seq].messagesSent = [];

  const msg = _.template("msg from ${senderId}-${seq}: ${origMsg}")({
    senderId: senderID,
    seq: event.message.seq,
    origMsg: textFromSender
  });
  const messageData = {
    recipient: {
      id: hContext.fbid
    },
    message: {
      text: msg,
      metadata: senderID, // a way to capture the original sender. This will be used when sending it back to the right user. TODO: This is not how metadata works. See http://tinyurl.com/ju3h74b
    }
  };
  logger.info("intercepting message and sending to human: " + JSON.stringify(messageData));
  callSendAPI(messageData);
  sendTypingAction.call(this, senderID);
  return;
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

/*
 * Send the text to wit bot and send the response sent by wit
 */
function sendResponseFromWitBot(senderID, messageText) {
  // This is needed for our bot to figure out the conversation history
  const aiContext = this.session.aiContext();
  // Let's forward the message to the Wit.ai Bot Engine
  // This will run all actions until our bot has nothing left to do
  wit.runActions(
    aiContext.sessionId, // the user's current session
    messageText, // the user's message
    aiContext // the user's current session state
  ).then((context) => {
    // Our bot did everything it has to do.
    // Now it's waiting for further messages to proceed.
    logger.info('Waiting for next user message. current context: ', JSON.stringify(context));

    // Based on the session state, you might want to reset the session.
    // This depends heavily on the business logic of your bot.
    // Example:
    if (context.done) {
      logger.info("Deleting Session " + aiContext.sessionId + " and associated context since all related work is done");
      this.session.deleteAiContext();
    }
    else {
      // Updating the user's current session state. 
      this.session.updateAiContext(context);
    }
  })
  .catch((err) => {
    logger.error('Oops! Got an error from Wit: ', err.stack || err);
    sendTextMessage(senderID,"Even bots need to eat. Out for lunch! Be back in a bit.");
  })
}

function determineCities(existingTrip) {
	const trip = this.session.tripData();
  const country = trip.country;
  if(_.isUndefined(country.cities)) {
    logger.warn(`determineCities: countries not defined in trip ${trip.rawTripName}. Doing nothing`);
    return false;
  }
  // logger.info(`Asking user to select from the following cities: ${JSON.stringify(country)} for country ${trip.rawTripName}.`);
  sendTextMessage(this.session.fbid,`Which cities of ${country.name} are you traveling to?`);
  let uri = "cities";
  if(existingTrip) {
    uri = "add-cities";
  }
  const messageData = {
    recipient: {
      id: this.session.fbid
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: "Select cities",
            buttons: [{
              type:"web_url",
              url: sendUrl.call(this, `${trip.rawTripName}/${uri}`),
              title:"Cities",
              webview_height_ratio: "compact",
              messenger_extensions: true,
              // url: sendUrl.call(this, `${trip.rawTripName}/${uri}`),
            }]
          }]
        }
      }
    }
  };
  callSendAPI(messageData);
  return true;
}

function determineTravelCompanions() {
  sendTextMessage(this.session.fbid, `Choose your travel companions`);
  const messageData = {
    recipient: {
      id: this.session.fbid
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: "Who are you traveling with?",
            buttons: [{
              type:"web_url",
              url: sendUrl.call(this, "friends"),
              title:"Choose Friends",
              webview_height_ratio: "compact",
              messenger_extensions: true,
              fallback_url: sendUrl.call(this, "friends")
            }]
          }]
        }
      }
    }
  };
  callSendAPI(messageData);
}

/*
 * Send a few buttons in response to "Help message" from the user.
 */
function sendHelpMessage() {
  const messageData = {
    recipient: {
      id: this.session.fbid
    },
    message: {
      text: `Choose from the following list of features:`,
      quick_replies:[
        {
          content_type: "text",
          title: "Add comment",
          payload: "comments"
          // TODO: add image
          // image_url: "https://polaama.com/img/destination.png"
        },
        {
          content_type: "text",
          title: "Add Task",
          payload: "todo",
        },
        {
          content_type: "text",
          title: "Add pack item",
          payload: "qr_pack_item",
        },
        {
          content_type: "text",
          title: "Add cities",
          payload: "qr_add_cities",
        },
        {
          content_type: "text",
          title: "Other details",
          payload: "qr_other_details",
        },
      ]
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

function sendTypingAction() {
  logger.info(`sendTypingAction: session id is ${this.session.sessionId}`);
  const messageData = {
    recipient: {
      id: this.session.fbid
    },
    sender_action:"typing_on"
  };

  callSendAPI(messageData);
}

/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
  const messageData = {
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

const PAGE_ACCESS_TOKEN = "EAAXu91clmx0BAONN06z8f5Nna6XnCH3oWJChlbooiZCaYbKOUccVsfvrbY0nCZBXmZCQmZCzPEvkcJrBZAHbVEZANKe46D9AaxOhNPqwqZAGZC5ZCQCK4dpxtvgsPGmsQNzKhNv5OdNkizC9NfrzUQ9s8FwXa7GK3EAkOWpDHjZAiGZAgZDZD";

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
      // logger.info("Successfully sent generic message with id %s to recipient %s", messageId, recipientId);
    } else {
      // TODO: If there was an error in sending an intercept message to a human, then send a push notification to the original sender that we are having some technical difficulty and will respond to them shortly.
      logger.error(`Unable to send message to recipient ${recipientId}. status code is ${response.statusCode}. Message from FB is <${response.body.error.message}>; Error type: ${response.body.error.type}`);
    }
  });  
}

module.exports = WebhookPostHandler;
