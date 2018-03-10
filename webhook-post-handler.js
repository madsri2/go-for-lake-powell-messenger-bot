'use strict';
const Notifier = require('notifications/app/notifier');

const baseDir = '/home/ec2-user';
const logger = require(`${baseDir}/my-logger`);
const Sessions = require('./sessions');
const Session = require('./session');
const FbidHandler = require('fbid-handler/app/handler');
const PageHandler = require('fbid-handler/app/page-handler');
const SecretManager = require('secret-manager/app/manager');
const ButtonsPlacement = require('get-buttons-placer/app/buttons-placement');
const watch = require('watch');
const fs = require('fs-extra');
const RequestProfiler = require('./request-profiler');
const TripData = require('./trip-data');

const TripInfoProvider = require('./trip-info-provider');
const CommentParser = require('./expense-report/app/comment-parser');
const ExpenseReportWorkflow = require('./expense-report/app/workflow');
const CreateItinerary = require('trip-itinerary/app/create-itin');
const Commands = require('trip-itinerary/app/commands');
const DepartureCityWorkflow = require('departure-city-workflow/app/workflow');
const DestinationCityWorkflow = require('destination-cities-workflow/app/workflow');
const AirportCodes = require('trip-flights/app/airport-codes');
const Validator = require('new-trip-planner/app/validate-details');

const _ = require('lodash');
const request = require('request');
const moment = require('moment-timezone');
const formidable = require('formidable');
const Promise = require('promise');
const validator = require('node-validator');
const Encoder = require(`${baseDir}/encoder`);
const TripReasonWorkflow = require('trip-reason-workflow/app/workflow');
const BaseHandler = require('business-pages-handler/app/base-handler');
const TravelSfoPageHandler = require('travel-sfo-handler');
const SeaSprayHandler = require('sea-spray-handler');
const SeaSprayPrototypeHandler = require('sea-spray-handler/app/prototype-handler');
const HackshawHandler = require('hackshaw-handler');
const HackshawPrototypeHandler = require('hackshaw-handler/app/prototype-handler');

let recordMessage = true;
let previousMessage = {};
let pageAccessToken;

let TEST_MODE = false;
// NOTE: WebhookPostHandler is a singleton, so all state will need to be maintained in this.session object. fbidHandler is also a singleton, so that will be part of the WebhookPostHandler object.
function WebhookPostHandler(session, testing, pageId) {
  if(testing) TEST_MODE = true; // Use sparingly. Currently, only used in callSendAPI
  this.travelSfoPageHandler = new TravelSfoPageHandler();
  this.seaSprayHandler = new BaseHandler(new SeaSprayHandler(TEST_MODE));
  this.seaSprayPrototypeHandler = new BaseHandler(new SeaSprayPrototypeHandler(TEST_MODE));
  this.hackshawHandler = new BaseHandler(new HackshawHandler(TEST_MODE));
  this.hackshawPrototypeHandler = new BaseHandler(new HackshawPrototypeHandler(TEST_MODE));
  this.newCustomerForPage = {};
	this.pageId = PageHandler.defaultPageId;
  if(pageId) {
    this.pageId = pageId;
    this.newCustomerForPage[this.pageId] = {};
    if(testing) setBusinessPageHandler.call(this);
  }
  this.secretManager = new SecretManager();
  this.sessions = Sessions.get();
  if(testing) this.pageHandler = PageHandler.get("fbid-test.txt");
	else this.pageHandler = PageHandler.get();
  this.fbidHandler = this.pageHandler.getFbidHandler();
  if(session) {
    logger.info(`WebhookPostHandler: A session with id ${session.sessionId} was passed. Using that in the post hook handler`);
    this.passedSession = session;
    this.session = session;
    logger.info(`WebhookPostHandler: Setting session state`);
    this.sessionState = this.sessions.testing_getState(session);
  }
  this.notifier = new Notifier(this.sessions);
  this.logOnce = {};
  // Creating this here because the constructor reads a huge file. Creating this here would mean we can simply pass this around, instead of creating it every single time.
  this.airportCodes = new AirportCodes();
  const self = this;
	// A Cheap way to trigger data update on changes across processes: Create a monitor that will trigger when files in ~/sessions changes, and reload the session that changed. This way, we don't have to reload sessions all over the place and this will work even across processes (for eg. when we create a new trip as a result of an itinerary or boarding pass email, the main webserver's sessions will automatically be reloaded within a few minutes)
  watch.createMonitor(Sessions.path(), { ignoreDotFiles: true }, function(monitor) {
    monitor.on('changed', function(f) {
      logger.debug(`file ${f} changed. reloading it.`);
      const s = JSON.parse(fs.readFileSync(f, 'utf8'));
      self.sessions.reloadSession(s.sessionId);
      self.tripCount = null; // force tripCount to be reloaded in determineResponseType below
    });
  });
}

// called to handle every message from the customer.
// TODO: there is already a this.pageId. Use that and remove the second parameter 'pageId' here.
function handleMessagingEvent(messagingEvent, pageId) {
  const fbid = messagingEvent.sender.id;
  // find or create the session here so it can be used elsewhere. Only do this if a session was NOT passed in the constructor.
  if(_.isUndefined(this.passedSession)) this.session = this.sessions.findOrCreate(fbid);
  else this.session = this.passedSession;
  this.sessionState = this.sessions.getSessionState(this.session.sessionId);
  if(!this.sessionState) {
    logger.error(`cannot find session state for sessionId ${this.session.sessionId}. Cannot proceed without it. session dump: ${JSON.stringify(this.session)}`);
    return sendTextMessage.call(this, fbid,"We will be back shortly.");
  }
  if(!this.logOnce[this.session.sessionId]) {
    logger.debug(`handleMessagingEvent: First message from user ${this.session.fbid} with session ${this.session.sessionId} since this process started.`);
    this.logOnce[this.session.sessionId] = true;
  }
  const self = this;
  const promise = this.pageHandler.add(fbid, pageId);
  return promise.then(
    function(status) {
      if(status) {
				self.fbidHandler = self.pageHandler.getFbidHandler(pageId);
        // logger.debug(`handleMessagingEvent: added new fbid ${fbid} to page ${pageId}`);
        try {
          if (messagingEvent.optin) {
            receivedAuthentication(messagingEvent);
          } else if (messagingEvent.message) {
            receivedMessage.call(self, messagingEvent);
          } else if (messagingEvent.delivery) {
            // console.log("Message delivered");
            // receivedDeliveryConfirmation(messagingEvent);
          } else if (messagingEvent.postback) {
            receivedPostback.call(self, messagingEvent);
          } else {
            logger.error("Webhook received unknown messagingEvent: ", messagingEvent);
            sendTextMessage.call(self, fbid,"We will be back shortly.");
          }
        }
        catch(err) {
          logger.error("an exception was thrown: " + err.stack);
          sendTextMessage.call(self, fbid,"We will be back shortly.");
        }
      }
      else {
        logger.warn(`handleMessagingEvent: adding new fbid ${fbid} to fbidHandler. Expected status to be true but it was ${status}`);
        sendTextMessage.call(self, fbid,"We will be back shortly.");
      }
      return Promise.resolve(true);
    },
    function(err) {
      logger.error(`handleMessagingEvent: error adding fbid ${fbid} to fbidHandler: ${err.stack}`);
      sendTextMessage.call(self, fbid,"We will be back shortly.");
      return Promise.resolve(false);
    }
  );
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
  sendTextMessage.call(this, senderID, "Authentication successful");
}

function setBusinessPageHandler() {
  switch(this.pageId) {
     case this.seaSprayPrototypeHandler.businessHandler.businessPageId:
      this.businessPageHandler = this.seaSprayPrototypeHandler;
      return;
     case this.seaSprayHandler.businessHandler.businessPageId:
       this.businessPageHandler = this.seaSprayHandler;
       return;
     case this.hackshawPrototypeHandler.businessHandler.businessPageId:
       this.businessPageHandler = this.hackshawPrototypeHandler;
       return;
     case this.hackshawHandler.businessHandler.businessPageId:
       this.businessPageHandler = this.hackshawHandler;
       return;
   }
   this.businessPageHandler = null;
}

function handlePageEntry(pageEntry) {
		this.pageId = pageEntry.id;
    if(!this.newCustomerForPage[this.pageId]) this.newCustomerForPage[this.pageId] = {};
    setBusinessPageHandler.call(this);
    pageAccessToken = this.pageHandler.getPageAccessToken(this.pageId);
    const timeOfEvent = pageEntry.time;
    for (let i = 0, len = pageEntry.messaging.length; i < len; i++) {
      handleMessagingEvent.call(this, pageEntry.messaging[i], pageEntry.id);
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
  // You must send back a 200, within 20 seconds, to let facebook know you've 
  // successfully received the callback. Otherwise, the request will time out.
  res.sendStatus(200);
}

function enterCommentAsMessage() {
  // update this session that we are awaiting response for comments postback
  this.sessionState.set("awaitingComment");
  sendTextMessage.call(this, this.session.fbid, "Enter your free-form text");
}

function enterTodoItemAsMessage() {
  this.sessionState.set("awaitingTodoItem");
  sendTextMessage.call(this, this.session.fbid, "Enter a todo item");
}

function enterPackItemAsMessage() {
  this.sessionState.set("awaitingPacklistItem");
  sendTextMessage.call(this, this.session.fbid, "Enter a pack-list item");
}

function setTripInContext(payload) {
  let tripName = payload.substring("trip_in_context ".length);
  this.session.setTripContextAndPersist(tripName);
}

WebhookPostHandler.prototype.urlButtonMessage = function(title, urlPath) {
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
          title: "Link",
          buttons: [{
            type: "web_url",
            url: sendUrl.call(this, urlPath),
            title: title,
            webview_height_ratio: "full",
            messenger_extensions: true,
            fallback_url: sendUrl.call(this, urlPath)
          }]
        }]
      }
    }
  };
  return messageData;
}

function sendUrlButton(title, urlPath) {
  callSendAPI.call(this, this.urlButtonMessage(title, urlPath));
}

WebhookPostHandler.prototype.handleDisplayTripDetailsPromise = function() {
  const threeHoursInMsec = 1000 * 60 * 60 * 3;
  const trip = this.session.tripData();
  const tip = new TripInfoProvider(trip, trip.data.leavingFrom);
  const refreshFlightQuotes = tip.refreshFlightQuotes.bind(tip);
  sendTypingAction.call(this);
  if(!this.tripPlanningPromise) throw new Error(`handleDisplayTripDetailsPromise: tripPlanningPromise is undefined`);
  const tripNameInContext = (this.session.tripData()) ? this.session.tripNameInContext : "unknown_trip";
  // set the promise value again so that it can be used in unit tests.
  const self = this;
  const fulfil = function(values) {
      // nothing to do here if create succeeds. The itinerary will be persisted and can be obtained by reading the file, which is done in trip-data-formatter:displayCalendar when /calendar is called
      setInterval(refreshFlightQuotes, threeHoursInMsec);
      displayTripDetails.call(self);  
  };
  const reject = function(err) {
      logger.error(`error in gathering data for trip ${tripNameInContext}: ${err.stack}`);
      // even if one of the previous promises were rejected, call the displayTripDetails since some of them might have succeeded.
      setInterval(refreshFlightQuotes, threeHoursInMsec);
      displayTripDetails.call(self);  
  };
  if(Array.isArray(this.tripPlanningPromise)) this.tripPlanningPromise = Promise.all(this.tripPlanningPromise).then(fulfil, reject);
  else this.tripPlanningPromise = this.tripPlanningPromise.then(fulfil, reject);
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
  if(!tripData || tripData.tripName === "conferences") return sendTripButtons.call(this);
  const tripName = tripData.data.name;
  const buttons = new ButtonsPlacement(this.urlPrefix(), tripData).getPlacement();
  messageData.message = {
    attachment: {
      type: "template",
      payload: {
        template_type: "generic",
        elements: [{
          title: "Get", 
          buttons: buttons.firstSet
        }]
      }
    }
  };
  if(buttons.secondSet) {
    messageData.message.attachment.payload.elements.push({
      title: "Get",
      buttons: buttons.secondSet
    });
  }
  if(buttons.thirdSet) {
    messageData.message.attachment.payload.elements.push({
      title: "Get",
      buttons: buttons.thirdSet
    });
  }
  callSendAPI.call(this, messageData);
}

WebhookPostHandler.prototype.setWeatherAndItineraryForNewTrip = function(tripName) {
	if(!tripName) throw new Error(`setWeatherAndItineraryForNewTrip: required parameter "tripName" not passed.`);
	logger.debug(`setWeatherAndItineraryForNewTrip: This sessions' guid is ${this.session.guid}. Beginning to set weather and trip itinerary details for new trip ${tripName}`);
	// reload this session to get the latest details about trips for this session (like flight itinerary and return flight itinerary).
	const session = this.sessions.reloadSession(this.session.sessionId);
	const trip = session.getTrip(tripName);
	if(!trip) throw new Error(`setWeatherAndItineraryForNewTrip: could not find trip ${tripName} in session with fbid ${session.fbid}`);
  // logger.debug(`setWeatherAndItineraryForNewTrip: trip dump is ${JSON.stringify(trip)}`);
	const tip = new TripInfoProvider(trip, trip.flightItin[0].departure_airport.city);
	const weatherDetails = Promise.denodeify(tip.getWeatherInformation.bind(tip));

	// TODO: If this is a beach destinataion, use http://www.blueflag.global/beaches2 to determine the swimmability. Also use http://www.myweather2.com/swimming-and-water-temp-index.aspx to determine if water conditions are swimmable
	const self = this;
	return weatherDetails()
		.then(
			function(response) {
				const tripNameInContext = trip.tripName;
				try {
					const createItin = new CreateItinerary(trip, trip.flightItin[0].departure_airport.city);
					Promise.all(createItin.create()).done(
						function(values) {
							// nothing to do here if create succeeds. The itinerary will be persisted and can be obtained by reading the file, which is done in trip-data-formatter:displayCalendar when /calendar is called
							logger.info(`Successfully created itinerary for trip ${tripNameInContext}`);
						},
						function(error) {
							logger.error(`Error creating itinerary for trip ${tripNameInContext}: ${error.stack}`);
						}
					);
				}
				catch(e) {
					logger.error(`Error creating itinerary for trip ${tripNameInContext}: ${e.stack}`);
				}
			},
			function(err) {
				logger.error(`error in gathering data for trip ${tripNameInContext}: ${err.stack}`);
			}
		);
}

// Start collecting useful information for trip and update the user.
WebhookPostHandler.prototype.startPlanningTrip = function(returnPromise) {
  const trip = this.session.tripData();
  sendTextMessage.call(this, this.session.fbid, `Gathering information for your ${trip.rawTripName} trip..`);
	// logger.debug(`startPlanningTrip: This sessions' guid is ${this.session.guid}`);
  const tip = new TripInfoProvider(trip, trip.data.leavingFrom);
  const activities = Promise.denodeify(tip.getActivities.bind(tip));
  const weatherDetails = Promise.denodeify(tip.getWeatherInformation.bind(tip));

  // TODO: If this is a beach destinataion, use http://www.blueflag.global/beaches2 to determine the swimmability. Also use http://www.myweather2.com/swimming-and-water-temp-index.aspx to determine if water conditions are swimmable
  const self = this;
  const tripNameInContext = (this.session.tripData()) ? this.session.tripData().rawTripName : "unknown_trip";
  this.tripPlanningPromise = 
    activities()
    .then(
      function(response) {
        if(trip.data.tripStarted) {
          // logger.warn(`startPlanningTrip: Trip ${trip.rawTripName} has already started. Not getting flight quote!`);
          return Promise.resolve(true);
        }
        if(fs.existsSync(trip.itineraryFile()) && fs.existsSync(trip.returnFlightFile())) {
          // logger.info(`startPlanningTrip: Trip ${trip.rawTripName} has flights reserved. Not getting flight quote!`);
          return Promise.resolve(true);
        }
        // logger.debug(`startPlanningTrip: About to get flight quotes`);
        return tip.getFlightQuotes();
      },
      function(err) {
        logger.error(`Activities promise returned error: ${err.stack}`);
        // even though Activities promise failed, we want flight quotes to be called.
        return tip.getFlightQuotes();
      }
    )
    .then(
      function(response) {
        return weatherDetails();
      },
      function(err) {
        logger.error(`FlightQuotes promise returned error: ${err.stack}`);
        // even though Flight Quotes promise failed, we want weatherDetails to be handled.
        return weatherDetails();
      }
    )
    .then(
      function(response) {
        try {
          // logger.debug(`startPlanningTrip: session dump: ${JSON.stringify(self.session)}`);
          const createItin = new CreateItinerary(trip, trip.data.leavingFrom);
          return createItin.create();
        }
        catch(e) {
          logger.error(`Error creating itinerary for trip ${tripNameInContext}: ${e.stack}`);
          return Promise.reject(e);
        }
      },
      function(err) {
        logger.error(`Error in gathering data for trip ${tripNameInContext}: ${err.stack}`);
        return Promise.reject(err);
      }
    );
    if(returnPromise) return this.tripPlanningPromise;
    this.handleDisplayTripDetailsPromise();
}

function emailOrEnterDetails() {
  const messageData = {
    recipient: {
      id: this.session.fbid
    },
    message: {
      attachment: {
        "type": "template",
        payload: {
          template_type: "list",
          elements: [
          {
            "title": "Great! Let's plan a trip together",
            "image_url": "http://icons.iconarchive.com/icons/artdesigner/urban-stories/256/Map-icon.png"
          },
          {
            "title": "Enter trip details",
            "subtitle": "Let's plan together",
            buttons: [{
              "title": "Enter details",
              "type": "postback", 
              "payload": "new_trip_enter_details"
            }]
          },
          {
            "title": "Booked flight, hotel etc.?",
            "subtitle": "Send us the details",
            buttons: [{
              "title": "Send details",
              "type": "postback", 
              "payload": "new_trip_email_details"
            }]
          }
          ]
        }
      }
    }
  };
  callSendAPI.call(this, messageData);
}

function planNewTrip(userChoice) {
  // this will result in quick_replies that will be handled by handleQuickReplies
  if(!userChoice) return emailOrEnterDetails.call(this); 
  logger.info("User wants to plan a new trip");
  if(userChoice.enter_details || userChoice === "new_trip_enter_details") {
    const messageData = {
      recipient: {
        id: this.session.fbid
      },
      message: {
        attachment: {
          "type": "template",
          payload: {
            template_type: "list",
            elements: [{
                "title": "Gathering trip details",
                "image_url": "http://icons.iconarchive.com/icons/andrea-aste/torineide/256/turin-map-detail-icon.png"
              },
              {
                "title": "Enter your destination, start date, duration",
                "subtitle": "example: India,11/1,20; New york,8/1/17,5; ewr,10/5,30 "
            }]
          }
        }
      }
    };
    callSendAPI.call(this, messageData);
    // reset existing trip context. The user is ready to plan a new trip.
    this.session.resetTripContext();
    this.sessionState.set("awaitingNewTripDetails");
    this.sessionState.set("planningNewTrip");
    return;
  }
  if(userChoice.email || userChoice === "new_trip_email_details") {
    const messageData = {
      recipient: {
        id: this.session.fbid
      },
      message: {
        attachment: {
          "type": "template",
          payload: {
            template_type: "list",
            elements: [{
                "title": "It's a snap to send us details",
                "image_url": "http://icons.iconarchive.com/icons/rade8/minium-2/256/Sidebar-Pictures-icon.png",
              },
              {
                "title": "Email receipt/itinerary to",
                "subtitle": "trips@mail.polaama.com"
              }/*,
              {
                "title": "Upload receipt",
                "subtitle": "as a photo or an attachment (if you are on a laptop)"
              }
              */
            ]
          }
        }
      }
    };
    return callSendAPI.call(this, messageData);
  }
}

function markTodoItemAsDone(payload) {
  const context = /pb_mark_done (.*)/.exec(payload);
  if(!context) throw new Error(`Payload is not in expected format "pb_mark_done [Todo Item]". It is ${payload}`);
  const doneItem = context[1];
  this.session.tripData().markTodoItemDone(doneItem);
  return sendTextMessage.call(this, this.session.fbid, "Marked item done");
}

function greetingForAnotherPage(fbid) {
  const response = this.businessPageHandler.greeting(this.pageId, fbid);
  if(!response) return false;
  if(Array.isArray(response)) this.sendMultipleMessages(fbid, response);
  else callSendAPI.call(this, response);
  return true;
}

function handleGettingStarted(senderID) {
  if(greetingForAnotherPage.call(this, senderID)) return;
  return sendWelcomeMessage.call(this, senderID); 
}

function handleLikeButton(fbid) {
  
}

function postbackForAnotherPage(payload, fbid) {
  return this.businessPageHandler.handlePostback(payload, this.pageId, fbid);
}

function receivedPostback(event) {
  const senderID = event.sender.id;
  const recipientID = event.recipient.id;
  const timeOfPostback = event.timestamp;
  // The 'payload' param is a developer-defined field which is set in a postback 
  // button for Structured Messages. 
  let payload = event.postback.payload;

  logger.info("Received postback for user %d, page %d, session %d at timestamp: %d. Payload: %s", senderID, recipientID, this.session.fbid, timeOfPostback, payload);

  if(!this.businessPageHandler) {
    logger.warn(`determineResponseType: Error. Unable to get business page handler for pageId '${this.pageId}'. Cannot proceed without it.`);
    return sendTextMessage.call(this, senderID, "We are working on something awesome! Check back in a few weeks.");
  }

  if(payload === "GET_STARTED_PAYLOAD") return handleGettingStarted.call(this, senderID);

  // if(postbackForAnotherPage.call(this, payload, senderID)) return;
  const self = this;
  const promise = postbackForAnotherPage.call(this, payload, senderID);
  if(promise) {
    if(typeof promise === "object") {
      promise.done(
        function(response) {
          if(Array.isArray(response)) self.sendMultipleMessages(senderID, response);
          else callSendAPI.call(self, response);
        },
        function(err) {
          sendTextMessage.call(self, senderID, "Even bots need to eat. Be back in a bit!");
        }
      );
    }
    return;
  }

  // give tripReasonWorkflow a chance to work.
  if(this.sessionState.get("planningNewTrip")) {
    // logger.debug(`receivedPostback: still planning new trip. workflow`);
    const done = new TripReasonWorkflow(this).handle(payload);
    if(done) this.sessionState.clear("planningNewTrip");
    // one way or the other, there's nothing else left to do with this postback
    return;
  }

  // A pmenu, past_trips or a postback starting with "trip_in_context" is indicative of the beginning of a new state in the state machine. So, clear the session's "awaiting" states to indicate the beginning of a new state.
  this.sessionState.clearAll();
  if(payload.startsWith("pb_mark_done ")) return markTodoItemAsDone.call(this, payload);
  if(payload === "mark_done") return sendMultipleMessages.call(this, this.session.fbid,
    textMessages.call(this, 
      [
        "Nice work being on top of your todo list. This item has been marked done.",
        "If you send the receipt to trips@mail.polaama.com, we can add the details to your itinerary for you."
      ])
  );

  if(payload.startsWith("get_receipt")) {
    const contents = /get_receipt (.*)/.exec(payload);
    if(!contents) throw new Error(`receivedPostback: get_receipt postback should be followed with valid title, but it's not: ${payload}`);
    const title = contents[1];
    logger.debug(`title is ${title}`);
    return sendGeneralReceipt.call(this, title);
  }

  if(payload === "pb_current_trip") return sendAddOrGetOptions.call(this);
  if(payload === "pb_event_supported_commands") return callSendAPI.call(this, new Commands(this.session.tripData(), this.session.fbid).getCommandsForEvents());
  // if(payload === "add_postback") return sendAddButtons.call(this);
  // if(payload === "get_postback") return displayTripDetails.call(this);
  if(payload === "supported_commands") return supportedCommands.call(this);
  if(payload === "view_more_commands") return supportedCommands.call(this, true /* more elements */);

  if(payload === "show_flight_booking") return showFlightBookingOptions.call(this);

	// new trip cta
  if(payload === "new_trip" || payload === "pmenu_new_trip" || payload === "postback_create_new_trip") return handlePlanningNewTrip.call(this);

  if(payload === "new_trip_enter_details" || payload === "new_trip_email_details") return planNewTrip.call(this, payload);

  if(payload === "postback_request_to_be_added") return addSenderToTrip.call(this);

  // existing trip
  if(payload.startsWith("trip_in_context")) {
    setTripInContext.call(this, payload);
    if(this.session.previousPayload) {
      // use the payload that the user chose before getting the trip in context
      payload = this.session.previousPayload;
      this.session.previousPayload = null;
    }
    else {
      // no previous payload. Simply present available options and return;
      sendAddOrGetOptions.call(this);
      return;
    }
  }
  if(payload === "pmenu_help") {
    let name = this.fbidHandler.getName(senderID);
    if(!name) name = ""; else name = ` ${name.substring(0, name.indexOf(" "))}`;
    return getHelpMessageData.call(this, senderID, `Hi${name}! How can I help you today?`);
  }

  if(payload === "pmenu_existing_trips") return sendTripButtons.call(this);
  // Do not set past trip as trip context because there is not much users can do.
  if(payload === "past_trips") return sendPastTrips.call(this);

  // CONFERENCE RELATED POSTBACK NEEDS TO BE HANDLED BEFORE CHECKING TO SEE IF REAL TRIP IN CONTEXT EXISTS!
  const commands = new Commands(this.session.tripData(), this.session.fbid);

  if(payload.startsWith("pb_event_details")) {
    const contents = payload.split(" ");
    if(contents.length < 2) {
      logger.error(`receivedPostback: postback "pb_event_details " not in expected format "pb_event_details <eventName> <optionalDay>"`);
      return sendTextMessage.call(this, this.session.fbid,"Even bots need to eat! Be back in a bit..");
    }
    // logger.debug(`getting details for event. contents are ${contents}`);
    return callSendAPI.call(this, commands.getEventItinerary(contents));
  }
  if(payload.includes("recommendation_next_set")) return callSendAPI.call(this, commands.handleRecommendationPostback(payload));
	
	// In order to add travelers to a trip, we need to know the trip in context.
  if(!this.session.doesTripContextOtherThanConferencesExist()) { 
    logger.info("receivedPostback: no real trip name in context. Asking user!");
    // store the current payload so it can be handled once we have the tripInContext.
    this.session.previousPayload = payload; 
    sendTripButtons.call(this, true /* add new trip */);
    return;
  }

  if(payload === "add_comments") return enterCommentAsMessage.call(this);
  if(payload === "add_todo") return enterTodoItemAsMessage.call(this);
  if(payload === "add_pack_item") return enterPackItemAsMessage.call(this);
  if(payload === "add_cities") return addCitiesToExistingTrip.call(this);
  if(payload === "add_expense") {
    this.session.expenseReportWorkflow = new ExpenseReportWorkflow(this.session);
    callSendAPI.call(this, this.session.expenseReportWorkflow.startWork());
    return;
  }
  if(payload === "add_travelers") return determineTravelCompanions.call(this);
  if(payload === "boarding_pass" || payload === "boarding pass") return sendBoardingPass.call(this);
  if(payload === "flight itinerary") {
    this.showReturnFlight = true;
    return sendFlightItinerary.call(this);
  }
  if(payload === "return flight") {
    this.showOnwardFlight = true;
    return sendReturnFlightDetails.call(this);
  }
  if(payload.startsWith("hotel details")) return sendHotelItinerary.call(this, payload);
  if(payload.includes("-hotel-receipt")) return sendCityHotelReceipt.call(this, payload);
  if(payload === "car details") return sendCarReceipt.call(this);
  if(payload === "get receipt") return sendGeneralReceipt.call(this);

  let handled = commands.handlePostback(payload);
  if(handled && (typeof handled === "object")) return callSendAPI.call(this, handled);
  handled = commands.handleActivityPostback(payload);
  if(handled && (typeof handled === "object")) return callSendAPI.call(this, handled);
  handled = commands.handleRecommendationPostback(payload);
  if(handled && (typeof handled === "object")) return callSendAPI.call(this, handled);

  // When an unknown postback is called, we'll send a message back to the sender to 
  // let them know it was successful
  sendTextMessage.call(this, senderID, `Unhandled Postback ${payload} called `);
}

function sendBoardingPass() {
    const boardingPass = (new Notifier(this.sessions)).getBoardingPass(this.session.tripData(), this.session.fbid);
    callSendAPI.call(this, boardingPass);
    return;
}

function sendReturnFlightDetails() {
  const trip = this.session.tripData();
  if(!fs.existsSync(trip.returnFlightFile())) {
    logger.warn(`sendReturnFlightDetails: No flight details exists for trip ${trip.rawTripName}`);
    if(!fs.existsSync(trip.itineraryFile())) {
      return sendNotFoundMessage.call(this, "flight", trip.rawTripName);
      // return this.sendTextMessage(this.session.fbid,`No flight itinerary present for your trip to ${trip.rawTripName}. If you have already booked a flight, send it to TRIPS@MAIL.POLAAMA.COM`);
    }
  }
  const fbid = this.session.fbid;
  const messageList = [];
  messageList.push({
    recipient: {
      id: fbid
    },
    message: {
      attachment: {
        type: "template",
        payload: JSON.parse(fs.readFileSync(trip.returnFlightFile(), 'utf8'))
      }
    }
  });
  this.showReturnFlight = false;
  if(this.showOnwardFlight) {
    messageList.push({
      recipient: {
        id: fbid
      },
      message: {
        text: "See onward flight",
        quick_replies:[
          {
            content_type: "text",
            title: "Onward flight",
            payload: "qr_onward_flight",
          }
        ]
      }
    });
  }
  sendMultipleMessages.call(this, fbid, messageList);
}

function sendFlightBookingMessage(ssMinPrice) {
   const trip = this.session.tripData();
   const departureCode = trip.data.departureCityCode;
   const arrivalCode = trip.data.portOfEntryCode;
   const numPassengers = 1;
   const startDate = trip.data.startDate;
   const returnDate = trip.data.returnDate;
   const sdMoment = new moment(startDate);
   const startDay = sdMoment.date() < 10 ? `0${sdMoment.date()}` : sdMoment.date(); 
   const startMonth = (sdMoment.month()+1) < 10 ? `0${sdMoment.month()+1}` : sdMoment.month()+1; 
   const startYear = sdMoment.year();
   const rdMoment = new moment(returnDate);
   const returnDay = rdMoment.date() < 10 ? `0${rdMoment.date()}` : rdMoment.date();
   const returnMonth = (rdMoment.month()+1) < 10 ? `0${rdMoment.month()+1}` : rdMoment.month()+1; 
   const returnYear = rdMoment.year();
   const expediaStartDate = `${startMonth}%2F${startDay}%2F${startYear}`;
   const expediaReturnDate = `${returnMonth}%2F${returnDay}%2F${returnYear}`;
   const skyscannerSubtitle = (ssMinPrice) ? `Prices starting from $${ssMinPrice}/- (non-stop)` : "";
   // url: "https://www.expedia.com/Flights-Search?flight-type=on&starDate=09%2F09%2F2017&endDate=09%2F15%2F2017&_xpid=11905%7C1&mode=search&trip=roundtrip&leg1=from%3AEWRto%3ASFO%2Cdeparture%3A09%2F09%2F2017TANYT&leg2=from%3ASFOtoEWR%2Cdeparture%3A09%2F15%2F2017TANYT&passengers=children%3A0%2Cadults%3A1%2Cseniors%3A0%2Cinfantinlap%3AY"
   const skyscannerApiKey = this.secretManager.getSkyscannerApiKey();
   const message = {
     recipient: {
       id: this.session.fbid
     },
     message: {
       attachment: {
         "type": "template",
         payload: {
           template_type: "list",
           elements: [
             {
               "title": `Flight Booking`,
               "image_url": "http://icons.iconarchive.com/icons/andrea-aste/torineide/256/turin-map-detail-icon.png"
             },
             {
               "title": "Skyscanner",
               "subtitle": skyscannerSubtitle,
               "image_url": "https://www.skyscanner.com/images/opengraph.png",
               "buttons": [{
                 title: "Book",
                 type: "web_url",
                 url: `http://partners.api.skyscanner.net/apiservices/referral/v1.0/US/USD/en-US/${departureCode}/${arrivalCode}/${startDate}/${returnDate}?apiKey=${skyscannerApiKey}`
               }]
             },
             {
               "title": "Kayak",
               "image_url": "http://www.simplebooking.travel/wp-content/uploads/2016/07/kayak-logo.png",
               "buttons": [{
                 title: "Book",
                 type: "web_url",
                 url: `https://www.kayak.com/flights/${departureCode}-${arrivalCode}/${startDate}/${returnDate}`
               }]
             },
             {
               "title": "Expedia",
               "image_url": "https://viewfinder.expedia.com/img//exp_us_basic_lrg_4c_rgb.jpg",
               "buttons": [{
                 title: "Book",
                 type: "web_url",
                 url: `https://www.expedia.com/Flights-Search?flight-type=on&starDate=09%2F09%2F2017&endDate=09%2F15%2F2017&_xpid=11905%7C1&mode=search&trip=roundtrip&leg1=from%3A${departureCode}to%3A${arrivalCode}%2Cdeparture%3A${expediaStartDate}TANYT&leg2=from%3A${arrivalCode}to${departureCode}%2Cdeparture%3A${expediaReturnDate}TANYT&passengers=children%3A0%2Cadults%3A1%2Cseniors%3A0%2Cinfantinlap%3AY`
               }]
             }
           ]
         }
       }
     }
   };
   return callSendAPI.call(this, message);
}

function showFlightBookingOptions() {
  const trip = this.session.tripData();
  const tip = new TripInfoProvider(trip);
  const promise = tip.getLowestNonstopPrice();
  const self = this;
  promise.done(
    function(ssMinPrice) {
      sendFlightBookingMessage.call(self, ssMinPrice);
    },
    function(err) {
      logger.error(`showFlightBookingOptions: error getting min price from browse quotes: ${err.stack}. Proceeding without min price`);
      sendFlightBookingMessage.call(self);
    }
  );
}

function sendFlightItinerary() {
  const trip = this.session.tripData();
  if(!fs.existsSync(trip.itineraryFile())) {
    logger.warn(`sendFlightItinerary: No flight details exists for trip ${trip.rawTripName}`);
    if(!fs.existsSync(trip.returnFlightFile())) {
      return sendNotFoundMessage.call(this, "flight", trip.rawTripName);
      // return this.sendTextMessage(this.session.fbid,`No flight itinerary present for your trip to ${trip.rawTripName}. If you have already booked a flight, send it to TRIPS@MAIL.POLAAMA.COM`);
    }
  }
  const fbid = this.session.fbid;
  const messageList = [];
  messageList.push({
    recipient: {
      id: fbid
    },
    message: {
      attachment: {
        type: "template",
        payload: JSON.parse(fs.readFileSync(trip.itineraryFile(), 'utf8'))
      }
    }
  });
  this.showOnwardFlight = false;
  if(this.showReturnFlight) {
    messageList.push({
      recipient: {
        id: fbid
      },
      message: {
        text: "See return flight",
        quick_replies:[
          {
            content_type: "text",
            title: "Return flight",
            payload: "qr_return_flight",
            // image_url: ""
          }
        ]
      }
    });
  }
  sendMultipleMessages.call(this, fbid, messageList);
}

function createElementsList(payloadPrefix, elArray, title) {
  const elements = [];
  const buttons = [];
  elArray.forEach((receipt,i) => {
    const j = parseInt(i/3);
    if(!buttons[j]) {
      buttons[j] = [];
    }
    buttons[j].push({
      type: "postback",
      title: `${Encoder.decode(receipt)}`,
      payload: `${payloadPrefix} ${receipt}`
    });
  });
  let lastIndex = buttons.length - 1;
  let numDashes = 3 - buttons[lastIndex].length;
  // if numDashes is 0, the number of trips is an exact multiple of 3. Add another entry in buttons array
  while(numDashes-- > 0) {
    // fill the remaining slots with "-"
    buttons[lastIndex].push({
      type: "postback",
      title: "-",
      payload: "dash"
    });
  }
  buttons.forEach(list => {
    elements.push({
      title: title,
      buttons: list
    });
  });
  logger.debug(`createElementsList: elements dump: ${JSON.stringify(elements)}`);
  return elements;
}

function sendGeneralReceipt(title) {
  const fbid = this.session.fbid;
  const trip = this.session.tripData();
  if(!title) {
    const receipts = trip.receipts();
    if(!receipts) return sendTextMessage.call(this, fbid, `No receipts found for trip ${trip.rawTripName}`);
    /*
    receipts.forEach(receipt => {
      const button = {
        "type": "postback"
      };
      button.payload = `get_receipt ${receipt}`;
      button.title = Encoder.decode(receipt);
      logger.debug(`sendGeneralReceipt: decode details: ${receipt}; ${buttons.title}`);
      buttons.push(button);
    });
    */
    const elements = createElementsList("get_receipt", receipts, "Receipts");
    const message = {
      recipient: {
        id: fbid
      },
      message: {
        attachment: {
          type: "template",
          payload: {
            /* 
              template_type: "button",
              text: "Which receipt would you like to see?",
              "buttons": buttons
            */
            template_type: "generic",
            "elements": elements
          }
        }
      }
    };
    return this.sendAnyMessage(message);
  }
  const receiptFile = trip.generalReceiptFile(title);
  if(!receiptFile) return sendTextMessage.call(this, fbid, `No receipts found for trip ${trip.rawTripName}`);
	const messages = [];
  const details = JSON.parse(fs.readFileSync(receiptFile));
    messages.push({
      recipient: {
        id: fbid
      },
      message: {
        attachment: {
          type: "template",
          payload: details.receipt
        }
      }
    });
    messages.push({
      recipient: {
        id: fbid
      },
      message: {
        attachment: {
          type: "template",
          payload: details.receipt_ext
        }
      }
    });
  return sendMultipleMessages.call(this, this.session.fbid, messages);
}

function sendCarReceipt() {
  const fbid = this.session.fbid;
  const trip = this.session.tripData();
  // if(!fs.existsSync(trip.rentalCarReceiptFile())) return sendTextMessage.call(this, fbid, `No car receipt found for your trip ${trip.rawTripName}`);
  if(!fs.existsSync(trip.rentalCarReceiptFile())) return sendNotFoundMessage.call(this, "car", trip.rawTripName);
  const details = JSON.parse(fs.readFileSync(trip.rentalCarReceiptFile(), 'utf8'));
	const messages = [];
  messages.push({
    recipient: {
      id: fbid
    },
    message: {
      attachment: {
        type: "template",
        payload: details.receipt
      }
    }
  });
  messages.push({
    recipient: {
      id: fbid
    },
    message: {
      attachment: {
        type: "template",
        payload: details.receipt_ext
      }
    }
  });
  sendMultipleMessages.call(this, this.session.fbid, messages);
}

function sendNotFoundMessage(prefix, trip) {
  const messageData = {
    recipient: {
      id: this.session.fbid
    },
    message: {
      attachment: {
        "type": "template",
        payload: {
          template_type: "list",
          elements: [
          {
            "title": `No ${prefix} details found for your ${trip} trip.`,
            "subtitle": "Have a reservation? Send it to us:",
            "image_url": "http://icons.iconarchive.com/icons/custom-icon-design/flatastic-1/128/alert-icon.png"
          },
          {
            "title": "Email",
            "subtitle": "receipt to trips@mail.polaama.com"
          },
          {
            "title": "Upload",
            "subtitle": "by clicking on the attachment icon below"
          }
          ]
        }
      }
    }
  };
	callSendAPI.call(this, messageData);
}

/*
function sendTourDetails() {
	const TripReceiptManager = require('receipt-manager/app/trip-receipt-manager');
	const messages = [];
	messages.push({
		recipient: {
			id: this.session.fbid
		},
		message: {
			attachment: {
				type: "template",
				payload: new TripReceiptManager().handle()
			}
		}
	});
  messages.push(getTextMessageData(this.session.fbid, "See you at our place at 9 AM"));
  messages.push(getTextMessageData(this.session.fbid, "It will be 80˚F and clear skies. The water will be calm and visibility is 100 feet, perfect for diving!"));
  sendMultipleMessages.call(this, this.session.fbid, messages);
}
*/

function sendCityHotelReceipt(payload) {
  const content = /(.*)-.*-.*/.exec(payload);
  if(!content) throw new Error(`cannot find city in hotel receipt postback: ${payload}`);
  const city = content[1];
  const trip = this.session.tripData();
  const details = trip.getHotelReceiptDetails();
  // logger.debug(`sendCityHotelReceipt: getting details for hotel [${content}]; ${city}: ${JSON.stringify(details[city])}`);
  sendHotelReceiptMessage.call(this, this.session.fbid, details[city]);
}

function sendHotelReceiptMessage(fbid, details) {
	const messages = [];
  messages.push({
    recipient: {
      id: fbid
    },
    message: {
      attachment: {
        type: "template",
        payload: details.receipt
      }
    }
  });
  messages.push({
    recipient: {
      id: fbid
    },
    message: {
      attachment: {
        type: "template",
        payload: details.receipt_ext
      }
    }
  });
  sendMultipleMessages.call(this, this.session.fbid, messages);
}

function sendHotelItinerary(payload) {
  let hotelKey;
  if(payload) {
    const contents = /hotel details (.*)/.exec(payload);
    if(contents) hotelKey = contents[1];
  }
  const fbid = this.session.fbid;
  const trip = this.session.tripData();
	const messages = [];
  const details = trip.getHotelReceiptDetails();
  if(!details) return sendNotFoundMessage.call(this, "hotel", trip.rawTripName); 
  const hotels = Object.keys(details);
  if(hotelKey && details[hotelKey]) return sendHotelReceiptMessage.call(this, fbid, details[hotelKey]);
  if(hotels.length > 1) {
    logger.debug(`cities with hotels: ${hotels}`);
    messages.push({
      recipient: {
        id: fbid
      },
      message: {
        text: "Which hotel's receipt would you like to see?",
        metadata: "hotel_receipt_list"
      }
    });
    const buttons = [];
    hotels.forEach((list,idx) => {
      const j = parseInt(idx/3);
      if(!buttons[j]) {
        buttons[j] = [];
      }
      buttons[j].push({
        "type": "postback",
        "title": `${Encoder.decode(list)}`,
        "payload": `${list}-hotel-receipt`
      });
    });
    const elements = [];
    buttons.forEach(buttonList => {
      elements.push({
        title: "Hotels",
        buttons: buttonList
      });
    });
    messages.push({
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
    });
    return sendMultipleMessages.call(this, this.session.fbid, messages);
  }
  sendHotelReceiptMessage.call(this, fbid, details[hotels[0]]);
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

  // logger.info("receivedMessage: Received event for user %d, page %d, session %d at timestamp: %d, guid: %s Event: ", senderID, recipientID, this.session.fbid, timeOfMessage, this.session.guid, JSON.stringify(event));

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
      const response = this.travelSfoPageHandler.handleSendingAttractionsNearMe(message, this.pageId, senderID);
      if(response) return callSendAPI.call(this, response);
      const stickerId = message.sticker_id;
      if(stickerId && stickerId === 369239263222822) {
        const handleMesg = this.travelSfoPageHandler.handleLikeButton(this.pageId, senderID);
        if(handleMesg) {
          if(Array.isArray(handleMesg)) {
            callSendAPI.call(this, handleMesg[0]);
            const self = this;
            setTimeout(function() {
              callSendAPI.call(self, handleMesg[1]);
            }, 2000);
            return;
          }
          return callSendAPI.call(this, handleMesg);
        }
        return sendTextMessage.call(this, senderID, "Glad you like us!");
      }
      // sendTextMessage.call(this, senderID, "Message with attachment received");
      return sendTextMessage.call(this, senderID, "Thanks!");
    }
}

WebhookPostHandler.prototype.urlPrefix = function() {
  const encodedId = this.fbidHandler.encode(this.session.fbid);
  return `https://polaama.com/${encodedId}`;
}

WebhookPostHandler.prototype.createUrl = function(urlPath) {
  return `${this.urlPrefix()}/${urlPath}`;
}

function sendUrl(urlPath) {
  return this.createUrl(urlPath);
}
WebhookPostHandler.prototype.sendUrl = sendUrl;

function sendPastTrips() {
  // reset this sessions' context
  this.session.resetTripContext();
  const elements = [];
  const tripNames = this.session.getPastTrips();
  tripNames.forEach(t => {
    elements.push({
      title: t.rawName,
      buttons: [{
        type: "web_url",
        url:sendUrl.call(this, `${t.name}`),
        title: t.name,
        webview_height_ratio: "full",
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
  callSendAPI.call(this, messageData);
  return;
}

function sendTripButtons(addNewTrip) {
	// Anytime we send trips for users to choose from, invalidate the session's tripData so it can be re-read from file. This way, any information that was added to the trip (by other session instances like the one in webpage-handler.js) will be re-read.
	this.session.invalidateTripData();
  const tripDetails = this.session.getCurrentAndFutureTrips();
  const tripNames = tripDetails.futureTrips;
  // logger.info(`sendTripButtons: trip length for fbid ${this.session.fbid} is ${tripNames.length}`);
  if(tripNames.length == 0) {
    const messageData = {
      recipient: {
        id: this.session.fbid
      },
      message: {
        text: `You don't have a any trips planned yet.`,
        quick_replies:[
          {
            content_type: "text",
            title: "Create New trip",
            payload: "qr_new_trip"
          }
        ]
      }
    };
    callSendAPI.call(this, messageData);
    return;
  }

  // if there is only one trip, there is no point in asking user
  // TODO: How would users get past trips in this case? Maybe add a separate "past trips" in Persistent Menu.
  if(tripNames.length === 1) {
    const t = tripNames[0];
    this.session.setTripContextAndPersist(t.name);
    sendAddOrGetOptions.call(this);
    return;
  }
    
  // reset this sessions' context
  this.session.resetTripContext();
  sendTextMessage.call(this, this.session.fbid, "Hi, which trip are we discussing?");
  const elements = [];
  const buttons = [];
  tripNames.forEach((t,i) => {
    const j = parseInt(i/3);
    if(!buttons[j]) {
      buttons[j] = [];
    }
    buttons[j].push({
      type: "postback",
      title: `    ${Encoder.decode(t.rawName)}    `,
      payload: `trip_in_context ${t.name}`
    });
  });
  let lastIndex = buttons.length - 1;
  let numDashes = 3 - buttons[lastIndex].length;
  // if numDashes is 0, the number of trips is an exact multiple of 3. Add another entry in buttons array
  if(numDashes === 0) {
    lastIndex++;
    buttons[lastIndex] = []; // this does not exist, so create it.
    numDashes = 3;
  }
  let pastTrips = tripDetails.pastTrips;
  while(numDashes-- > 0) {
    if(pastTrips) {
      buttons[lastIndex].push({
        type: "postback",
        title: " Past Trips  ",
        payload: "past_trips"
      });
      pastTrips = false;
      continue;
    }
    if(addNewTrip) {
      buttons[lastIndex].push({
         type: "postback",
         title: "New Trip",
         payload: "new_trip"
      });
      addNewTrip = false;
      continue;
    }
    // fill the remaining slots with "-"
    buttons[lastIndex].push({
      type: "postback",
      title: "-",
      payload: "dash"
    });
  }
  buttons.forEach(list => {
    elements.push({
      title: "Trips",
      buttons: list
    });
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
  callSendAPI.call(this, messageData);
}

function handleQuickRepliesToPlanNewTrip(quick_reply) {
  const payload = quick_reply.payload;
  if(!payload) throw new Error(`handleQuickRepliesToPlanNewTrip: payload is undefined in passed quick_reply: ${JSON.stringify(quick_reply)}`);
  // This quick reply came from the user typing "help" (see getHelpMessage) or
  // this quick reply came in response to "Abort the current trip being planned?" question in determineResponseType
  if(payload === "qr_new_trip" || payload === "qr_yes_plan_new_trip") {
    if(payload === "qr_yes_plan_new_trip") this.sessionState.clearAll();
    planNewTrip.call(this);
    return true;
  }

  if(payload === "qr_no_continue_current_plan") {
    if(!previousMessage) throw new Error(`unexpected error. previousMessage should be present, but it's not. ${new Error().stack}`);
    logger.debug(`handleQuickRepliesToPlanNewTrip: previous message ${JSON.stringify(previousMessage)}`);
    switch(previousMessage["func"]) {
      case "sendMultipleMessages": 
        sendMultipleMessages.call(this, this.session.fbid, previousMessage.message);
        break;
      case "callSendAPI": 
        callSendAPI.call(this, previousMessage.message);
        break;
    }
    return true;
  }

  // this quick reply came in response to emailOrEnterDetails
  if(payload === "qr_email") {
    planNewTrip.call(this, { email: true });
    return true;
  }
  if(payload === "qr_enter_details") {
    planNewTrip.call(this, { enter_details: true });
    return true;
  }

  return false;
}

function partialMatch(nameParts, friend) {
  let match = false;
  nameParts.forEach(part => {
    if(friend.includes(part)) match = true;
  });
  return match;
}

function addSenderToTrip() {
  // even though we don't expect an exception at this point, add the try catch block so that we send a message back to the customer.
  try {
    const tripDetails = inFriendsTripList.call(this);
    if(tripDetails) {
      // copy the trip details from owner's directory to friend's directory. Then return success
      // get owner's trip base dir 
      const tripBaseDir = `${baseDir}/trips/${tripDetails.owner}`;
      const senderId = this.fbidHandler.encode(this.session.fbid);
      const targetDir = `${baseDir}/trips/${senderId}`;
      const tripName = tripDetails.trip;
      if(!fs.existsSync(targetDir)) fs.mkdirSync(targetDir);
      fs.readdirSync(tripBaseDir).forEach(file => {
        if(file.includes(tripName)) {
          // logger.debug(`addSenderToTrip: Copying file ${tripBaseDir}/${file} to ${targetDir}/${file}`);
          fs.copySync(`${tripBaseDir}/${file}`, `${targetDir}/${file}`);
        }
      });
      this.session.addExistingTrip(tripName);
      return sendTripButtons.call(this);
    }
  }
  catch(e) {
    logger.error(`addSenderToTrip: Exception in adding sender: ${e.stack}`);
  }
  return sendTextMessage.call(this, this.session.fbid, "Could not add you to the trip at this point.");
}

function handleQuickReplies(quick_reply) {
  const payload = quick_reply.payload;
  if(!payload) throw new Error(`handleQuickReplies: payload is undefined in passed quick_reply: ${JSON.stringify(quick_reply)}`);

  // User clicked on "Add ..." or "Get ..." in help message or after choosing a trip under "Existing trips"
  if(payload === "qr_add_") {
    sendAddButtons.call(this);
    return true;
  }
  if(payload === "qr_get_") {
    displayTripDetails.call(this);
    return true;
  }
  if(payload === "qr_day_plan_") {
    sendTextMessage.call(this, this.session.fbid, `Enter a day. Example: '9th', '14', 'tomorrow', '8/15'`);
    return true;
  }

  // This quick reply came from the user typing "help" (see getHelpMessage)
  if(payload === "qr_existing_trips") {
		sendTripButtons.call(this);
    return true;
  }

  // quick reply from sendFlightItinerary and sendReturnFlightDetails
  if(payload === "qr_onward_flight") {
    sendFlightItinerary.call(this);
    return true;
  }

  if(payload === "qr_return_flight") {
    sendReturnFlightDetails.call(this);
    return true;
  }

  if(payload === "qr_request_to_be_added") {
    addSenderToTrip.call(this);   
    return true;
  }


  logger.warn(`handleQuickReplies: Session ${this.session.fbid}: quick_reply not handled here ${JSON.stringify(quick_reply)}`);
  return false;
}

function createNewTrip(tripDetails) {
  tripDetails.ownerId = this.fbidHandler.encode(this.session.fbid);
  this.session.addTrip(tripDetails.destination);
  this.tripCount = this.session.getCurrentAndFutureTrips().futureTrips.length;
  const tripData = this.session.tripData();
  tripData.addTripDetailsAndPersist(tripDetails);
  // logger.info(`createNewTrip: This session's trip name in context is ${tripData.rawTripName}. Destiantion is ${tripDetails.destination}`);
  this.sessionState.clear("awaitingNewTripDetails");
  // reload the session here to get the latest data
  this.sessions.reloadSession(this.session.sessionId);
  this.session = this.sessions.find(this.session.fbid);
  this.tripCount = 0; // force reload of tripCount in determineResponseType
}

// An object that is expected to be thrown by extractNewDetails below
function UserConfirmation(message) {
	this.message = message;
	this.name = "UserConfirmation";
}

function extractNewTripDetails(messageText) {
	// short-circuit parsing the input and validation if the data already existed.
	if(this.session.previouslyEnteredTripDetails && this.session.previouslyEnteredTripDetails.tripStarted) {
		// logger.debug(`extractNewTripDetails: User previously entered trip information and the trip has already started. Creating new trip`);
		createNewTrip.call(this, this.session.previouslyEnteredTripDetails);
		return;
	}
  const response = new Validator(messageText).validate();
  const error = response.error;
  const tripDetails = response.tripDetails;
  if(error) {
		if(error.length === 1 && error[0].message.startsWith("Provided")) {
			logger.warn(`extractNewDetails: Validation error thrown ${JSON.stringify(error)}`);
			// store the tripDetail so we can use this depending on how a user responds to this question.
			this.session.previouslyEnteredTripDetails = tripDetails;
			throw new UserConfirmation('Provided date is in the past. Has your trip already started?');
		}
    logger.warn(`extractNewDetails: Validation error: ${JSON.stringify(error)}`);
    return error;
  }
	createNewTrip.call(this, tripDetails);
}

// TODO: this duplicates functionality in webpage-handler.formParseCallback. Fix it. 
function getCityDetailsAndStartPlanningTrip(messageText, existingTrip) {
  try {
    const input = messageText.split(',');
    const regex = /^[A-Z a-z]+\((\d+)\)/;
    const check = validator.isArray(validator.isString({'regex': regex, message: "It should be of the form 'city(2)'"}), {min: 1});
    let error = null;
    validator.run(check, input, function(ec, e) {
      if(ec > 0) error = new Error(`Invalid input value "${e[0].value}": ${e[0].message}`);
    });
    if(error) throw error;
    let cities = [];
    let numberOfDays = [];
    input.forEach(item => {
      cities.push(item.split('(')[0]);
      numberOfDays.push(item.match(regex)[1]);
    });
    
    if(existingTrip) {
      this.sessionState.clear("awaitingCitiesForExistingTrip");
    }
    else {
      this.session.tripData().addPortOfEntry(cities[0]); // assume that the first city is port of entry. See determineResponseType 3rd step in new trip workflow
      this.sessionState.clear("awaitingCitiesForNewTrip");
    }
    // TODO: Validate city is valid by comparing against list of known cities
    this.session.tripData().addCityItinerary(cities, numberOfDays);
    // indicate that tripData for this trip is stale in the session object so that trip data will be read from the file
    this.session.invalidateTripData();
  }
  catch(e) {
    logger.error(`getCityDetailsAndStartPlanningTrip: exception calling getCityDetailsAndStartPlanningTrip: ${e.stack}`);
    sendTextMessage.call(this, this.session.fbid, e.message);
    return;
  }
  const tripData = this.session.tripData();
  if(tripData.data.cities) {
    // logger.debug(`getCityDetailsAndStartPlanningTrip: cities available for trip ${tripData.rawTripName}. Start planning trip for customer ${this.session.fbid}`);
    this.sessionState.clear("planningNewTrip");
    this.startPlanningTrip();
  }
  else {
    logger.error(`getCityDetailsAndStartPlanningTrip: Session ${this.session.sessionId}: Cannot determine cities for trip ${tripData.data.country} even after getting cities from customer. Possible BUG!`);
    sendTextMessage.call(this, this.session.fbid,"Even bots need to eat! Be back in a bit..");
  }
}

// TODO: This code duplicates some aspects of "getting cities for the trip" in determineResponseType. Fix that.
function addCitiesToExistingTrip() {
  const tripData = this.session.tripData();
  if(determineCities.call(this, true /* existingTrip */)) return;
  if(!this.sessionState.get("awaitingCitiesForExistingTrip")) {
    const messages = [
      `For your trip to ${tripData.data.country}, add cities and number of days in each city in the following format`,
      `seattle(3),portland(4),sfo(5)` 
    ];
    sendMultipleMessages.call(this, this.session.fbid, textMessages.call(this, messages));
    this.sessionState.set("awaitingCitiesForExistingTrip");
    logger.debug(`addCitiesToExistingTrip: Sent message asking for city. Session dump: ${this.sessionState.dump()}`);
    // After user enters the additional cities, determineResponseType will be called and the code block that checks for awaitingCitiesForExistingTrip will take action
  }
}

function askBusiness() {
  const fbid = this.session.fbid;
  if(!this.askBusiness) {
    this.askBusiness = true;
    return sendTextMessage.call(this, fbid, "What question do you have for \"Extreme Iceland\"?");
  }
  this.askBusiness = false;
  const message = {
    recipient: {
      id: fbid
    },
    message: {
      attachment: {
        "type": "template",
        payload: {
          template_type: "button",
          "text": "Lunch is not included. You can bring your own or we will stop at Akureyri to pick up lunch.",
          "buttons": [{
            "type": "web_url",
            "url": "https://www.tripadvisor.com/Restaurants-g189954-Akureyri_Northeast_Region.html",
            "title": "Options at Akureyri"
          }]
        }
      }
    }
  };
  return this.sendAnyMessage(message);
}

function handleDRandTR(mesg) {
  const fbid = this.session.fbid;
  const message = {
    recipient: {
      id: fbid
    },
    message: {
      attachment: {
        "type": "template",
        payload: {
        }
      }
    }
  };
  message.message.attachment.payload.elements = [{
    "title": "You still need to rent your car",
    "subtitle": "Click for car options",
    "image_url": "https://polaama.com/images/never-forget-md",
    "default_action": {
      "url": "http://www.rentalcars.com/SearchResults.do;jsessionid=EA55013837267879FB8435A66F319C86.node378a?enabler=&country=Iceland&doYear=2017&city=Keflavik&driverage=on&doFiltering=false&filterName=CarCategorisationSupplierFilter&dropCity=Keflavik&driversAge=30&filterTo=1000&fromLocChoose=true&dropLocationName=Keflavik+International+Airport&dropCountryCode=&doMinute=0&countryCode=is&puYear=2017&puSameAsDo=on&locationName=Keflavik+International+Airport&puMinute=0&doDay=11&searchType=&filterFrom=0&puMonth=9&dropLocation=840413&doHour=16&dropCountry=Iceland&puDay=3&puHour=7&location=840413&doMonth=9&filterAdditionalInfo=&advSearch=&exSuppliers=&groupSize=large",
      "webview_height_ratio": "full",
      "type": "web_url"
    }
  }];
  if(mesg === "tr") {
    message.message.attachment.payload.template_type = "generic";
    message.message.attachment.payload.elements[0].buttons = [
    {
      "title": "Mark Done",
      "type": "postback",
      "payload": "mark_done"
    },
    {
      "title": "Other reminders",
      "type": "postback",
      "payload": "other_reminders"
    }];
    return this.sendAnyMessage(message);
  }
  const messageList = [];
  messageList.push(this.getTextMessageData(fbid, `Good morning Madhu. It's going to be mostly sunny in the Diamond circle. Here's your plan for today`));
  message.message.attachment.payload.template_type = "list";
  message.message.attachment.payload.elements = [
  {
    "title": "Day's plan as a map",
    "subtitle": "Lots of driving. 6 hours/377 Km",
    "image_url": "https://polaama.com/aeXf/keflavik/2017-9-8/-/map",
    "default_action": {
      "url": "https://goo.gl/maps/82SGLEM4iuN2",
      "webview_height_ratio": "full",
      "type": "web_url"
    }
  },
  {
    "title": "Dettifoss waterfall",
    "subtitle": "2.5 hours from Hotel",
    "image_url": "https://www.northiceland.is/static/toy/images/Place_355_1___Selected.jpg",
    "default_action": {
      "url": "http://www.diamondcircle.is/dettifoss/",
      "webview_height_ratio": "full",
      "type": "web_url"
    }
  },
  {
    "title": "Tjornes Peninsula guided tour with Extreme Iceland",
    "subtitle": "Meet at Myvatn, 45 minutes from Dettifoss",
    "image_url": "http://www.diamondcircle.is/wp-content/uploads/2015/02/P7020263-672x372.jpg",
    "default_action": {
      "url": "https://www.extremeiceland.is/en/sightseeing-tours/day-tours/north-iceland/diamond-circle",
      "webview_height_ratio": "full",
      "type": "web_url"
    },
    buttons: [{
      "title": "Ask the business",
      "type": "postback",
      "payload": "business_question"
    }]
  }];
  messageList.push(message);
  return this.sendMultipleMessages(fbid, messageList);
}

function handleLicense() {
  const messageList = [];
  const fbid = this.session.fbid;
  messageList.push(getTextMessageData(fbid, "You DONT need an international license as long as you are over 21 years and possess a valid national driver's license to rent a car in Iceland"));
  messageList.push({
    recipient: {
      id: fbid
    },
    message: {
      attachment: {
        "type": "template",
        payload: {
          template_type: "generic",
          elements: [
          {
            "title": "More details",
            "subtitle": "See Frommer's guide on getting around in Iceland",
            "default_action": {
              "type": "web_url",
              "url": "http://www.frommers.com/destinations/iceland/planning-a-trip/getting-around",
              "webview_height_ratio": "full"
            }
          }]
        }
      }
    }
  });
  return this.sendMultipleMessages(fbid, messageList);
}

function handleEventWithoutTrip(m) {
  // only do this if this is was NOT sent as part of a new trip.
  if(this.sessionState.get("planningNewTrip")) return null;
  if(!m.includes("phocuswright") && !m.includes("the americas") && !m.includes("battleground") && !m.includes("arival")) return null;
  let trip = this.session.getTrip("conferences");
  if(!trip) {
    // logger.debug(`adding trip conference to session ${this.session.sessionId}`);
    this.session.addTrip("conferences");
    trip = this.session.tripData();
    trip.addEvent("phocuswright");
    trip.addEvent("test-phocuswright");
    trip.addEvent("test-arival");
    trip.addEvent("arival");
  }
  // else this.session.setTripContextAndPersist(trip.tripName);
  trip.setConferenceInContext(m);
  const commands = new Commands(trip, this.session.fbid);
  return commands.handleEventCommands(m);
}

function messageForAnotherPage(message, fbid, event) {
  return this.businessPageHandler.handleText(message, this.pageId, fbid);
}

function marketResearchPrototype(mesg, fbid) {
  // const response = this.travelSfoPageHandler.royalCoachResponse(mesg, fbid);
  // const response = this.travelSfoPageHandler.sanJoseBrewBike(mesg, fbid);
  const response = this.travelSfoPageHandler.mountainQueenExpeditions(mesg, fbid);
  logger.debug(`marketResearchPrototype: response: ${response}`);
  if(!response) return false;
  if(Array.isArray(response)) this.sendMultipleMessages(fbid, response);
  else callSendAPI.call(this, response);
  return true;
}

function notifyAdminOfNewMessage(mesg, senderId) {
  if(this.newCustomerForPage[this.pageId][senderId]) return;
  this.newCustomerForPage[this.pageId][senderId] = true;
  let name = FbidHandler.get().getName(senderId);
  if(!name) name = senderId;
  let recipientId = this.businessPageHandler.businessHandler.madhusPageScopedFbid();
  if(!recipientId) return logger.error(`Cannot get madhus page scoped fbid for business page '${this.pageId}' (name: <{this.businessPageHandler.businessHandler.name}>). Not notifying Madhu of new message '${mesg}' from sender '${name}'`);
  sendTextMessage.call(this, recipientId, `[ALERT] Received new message from user '${name}'. Message is "${mesg}"`);
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

  if(!this.businessPageHandler) {
    logger.warn(`determineResponseType: Unable to get business page handler for pageId '${this.pageId}'. Cannot proceed without it.`);
    return sendTextMessage.call(this, senderID, "We are working on something awesome! Check back in a few weeks.");
  }

  const self = this;
  const mesgPromise = messageForAnotherPage.call(this, mesg, senderID, event);
  if(mesgPromise) {
    if(typeof mesgPromise === "object") {
        mesgPromise.done(
          function(result) {
            const response = result.message;
            // logger.debug(`response: ${JSON.stringify(response)}`);
            if(Array.isArray(response)) self.sendMultipleMessages(senderID, response);
            else callSendAPI.call(self, response);
            // if this is the first message from this sender, send a note to "me"
            notifyAdminOfNewMessage.call(self, mesg, senderID);
          },
          function(err) {
            // sendTextMessage.call(self, senderID, "Even bots need to eat. Be back in a bit!");
            logger.error(`Error sending a response for message '${mesg}' from fbid ${senderID}: ${err}`);
            sendTextMessage.call(self, senderID, "We will get back to you shortly.");
          }
        );
    }
    // if messageForAnotherPage returned something, it indicates that we are done. So simply return.
    return;
  }
  else return sendTextMessage.call(self, senderID, "We will be back soon with an awesome chatbot for you! Prepare to be amazed!");

  // if(marketResearchPrototype.call(this, mesg, senderID)) return;

  if(mesg === "commands" || (mesg.includes("help") && mesg.includes("commands"))) return supportedCommands.call(this);

  // indicates a recommendation request from user. Send this to the admin to take action.
  if(mesg.startsWith("reco ")) {
    sendTextMessage.call(this, Session.adminId, `[ACTION REQD]: Recommendation request from ${this.session.fbid}: ${mesg}`);
    return sendTextMessage.call(this, this.session.fbid, "Received your request. We are actively working on it and will get back to you soon with results.");
  }

  const eventMesg = handleEventWithoutTrip.call(this, mesg);
  if(eventMesg) return callSendAPI.call(this, eventMesg);

  // Before doing anything, if the user types help, send the help message!
  if(!this.tripCount) this.tripCount = this.session.getCurrentAndFutureTrips().futureTrips.length;
  if(mesg === "hello" || mesg === "hi" || mesg === "howdy" || mesg === "hiya" || mesg === "help") {
    if(mesg.startsWith("help ") || mesg === "help") {
      // clear all states 
      this.sessionState.clearAll();
      if(this.session.doesTripContextOtherThanConferencesExist()) return respondToHelp.call(this);
    }
    if(this.tripCount) {
      let name = this.fbidHandler.getName(senderID);
      if(!name) name = ""; else name = ` ${name.substring(0, name.indexOf(" "))}`;
      return getHelpMessageData.call(this, senderID, `Hi${name}! Welcome back to Polaama. How can I help you today?`);
    }
    return sendWelcomeMessage.call(this, senderID);
  }

  if(mesg === "new trip" || mesg === "create new trip") return handlePlanningNewTrip.call(this);

  if(event.message.quick_reply && handleQuickRepliesToPlanNewTrip.call(this, event.message.quick_reply)) return;

  /*
  // At this point, if no trip exists and it's not being planned, the user has entered something we don't understand. Simply send them the Welcome message.
  if(!this.tripCount && !this.sessionState.get("planningNewTrip")) {
    logger.debug(`determineResponseType: short-circuiting. trip count is ${this.tripCount}`);
    return getHelpMessageData.call(this, senderID, "Hi, I am your new personal travel assistant. Would you like to create a new trip to get started?");
  }
  */

  // if we don't know what trip is being discussed, ask the user for this, unless the user is adding details about a new trip.
  // logger.debug(`determineResponseType: state: ${JSON.stringify(this.sessionState)}`);
  if(!this.session.doesTripContextExist() && !this.sessionState.get("planningNewTrip")) {
    logger.info("determineResponseType: no trip name in context. Asking user!");
    return sendTripButtons.call(this, true);
  }

  // New trip workflow
  if(this.sessionState.get("planningNewTrip")) {
    // 1) Extract trip details like country, start date and duration
    if(this.sessionState.get("awaitingNewTripDetails")) {
			// if we are awaiting user confirmation, handle that differently
			if(this.sessionState.get("awaitingUserConfirmation")) {
        const userResponse = event.message.quick_reply.payload;
				if(userResponse === "qr_yes") {
					// Mark that the trip has already started. This will be used in startPlanningTrip
					this.session.previouslyEnteredTripDetails.tripStarted = true;
					this.sessionState.clear("awaitingUserConfirmation");
				}
				else if(userResponse === "qr_no") {
					this.sessionState.clear("awaitingUserConfirmation");
					planNewTrip.call(this);
					return;
				}		
				else {
					logger.error(`determineResponseType: BUG! Session is in state awaitingUserConfirmation  but the mesg is not qr_yes or qr_no. It is ${userResponse}. This is unexpected`);
					sendTextMessage.call(this, this.session.fbid,"Even bots need to eat! Be back in a bit..");
					return;
				}
			}
			try {
      	const err = extractNewTripDetails.call(this, messageText);
      	if(err) {
          const param = (err[0].parameter) ? `parameter ${err[0].parameter}`: "";
        	return sendTextMessage.call(this, this.session.fbid, `Input error: ${param}:${err[0].message}`);
      	}
			}
			catch(e) {
				// Assume that the only exception being thrown now is UserConfirmation from extractNewTripDetails. Update if this changes in the future
				logger.error(`determineResponse type: error thrown ${e}; ${e.stack}`);
				this.sessionState.set("awaitingUserConfirmation");
				return sendYesNoButtons.call(this, e.message);
			}
    }

    // Step 2: Successfully parsed new trip details above. Now get the departure details.
    const depCityWorkflow = new DepartureCityWorkflow(this, messageText, event.message.quick_reply);
    const promiseOrBool = depCityWorkflow.set();
    if(typeof promiseOrBool === "object") {
      const self = this;
      // promise. If we received a promise, then, no code can execute outside of the done function (because that will be executed immediately). This is the reason for the structure of the code.
      // return promise here so that it can be used by unit tests.
      return promiseOrBool.then(function(response) {
        // this indicates workflow completed work, so proceed to do other things.
        if(response === false) return;
        return handleAdditionalCommands.call(self, event, mesg);
      },
      function(err) {
        logger.error(`determineResponseType: error in departure city workflow: ${err.stack}`);
        return Promise.reject(err);
      });
    }
    // require additional information from user. So, short-circuit
    else if(promiseOrBool === false) return;
    // continue with other aspects of travel planning.
    else if(promiseOrBool === true) {
      return handleAdditionalCommands.call(this, event, mesg);
    }
  }
  else return handleAdditionalCommands.call(this, event, mesg);
}

function handlePlanningNewTrip()
{
  if(this.sessionState.get("planningNewTrip")) {
    const messageData = {
      recipient: {
        id: this.session.fbid
      },
      message: {
        text: "Abort the current trip that is being planned?",
        quick_replies:[
          {
            content_type: "text",
            title: "Yes",
            payload: "qr_yes_plan_new_trip",
          },
          {
            content_type: "text",
            title: "No",
            payload: "qr_no_continue_current_plan",
          },
        ]
      }
    };
    recordMessage = false;
    callSendAPI.call(this, messageData);
    recordMessage = true;
    return;
  }
  return planNewTrip.call(this);
}

function handleAdditionalCommands(event, mesg) {
  const senderID = this.session.fbid;

  if(this.sessionState.get('planningNewTrip')) {
    const self = this;
    // 3) If we already asked for cities, handle that and start planning. Else, get cities for the trip.
    const destCityWorkflow = new DestinationCityWorkflow(this);
    const promise = destCityWorkflow.handleNewTrip(mesg);
    return promise.then(
      function(response) {
        if(response) {
          // End of new trip workflow. The workflow will complete when user selects cities (handled by determineCities function) and webpage-handler.js calls the startPlanningTrip method
          // TODO: Rather than let webpage-handler.js call startPlanning (and thus exposing this functionality there), consider calling startPlanningTrip from here.. The presence of tripData.data.cities can be a signal from webpage-handler.js's formParseCallback method that the cities were correctly chosen and added here.
          // logger.debug(`handleAdditionalCommands: destination city workflow promise called. result is ${response}`);
          // see if we have enough data to start planning a trip
          if(self.session.tripData().cityItinDefined()) {
            const tripData = self.session.tripData();
            logger.debug(`handleAdditionalCommands: cities available for trip ${tripData.rawTripName}. Start planning trip for customer ${self.session.fbid}`);
            // start planning the trip but do not display trip details. That will be done by TripReasonWorkflow below.
            self.startPlanningTrip(true /* return promise */);
          }
          const tripReasonWorkflow = new TripReasonWorkflow(self);
          const done = tripReasonWorkflow.handle(mesg);
          if(done) {
            // done planning the trip!
            self.sessionState.clear("planningNewTrip");
            self.session.invalidateTripData();
          }
          return self.tripPlanningPromise;
        }
        // if the response was false, then the destination city workflow needed additional information from users. So, nothing to do but return;
      },
      function(err) {
        // TODO: See if there is a way to isolate this failure and still plan a trip (rather than throw a 500 back to the user)
        logger.error(`Error calling destinationCityWorkflow.handleNewTrip: ${err}`);
        self.sendTextMessage(senderID, "Even bots need to eat. Be back in a bit.");
        return Promise.reject(err);
      }
    );
    // irrespective of the response from handleNewTrip, we are done handling this message from the user. we return the promise so that it can be used in testing.
  }
  // logger.debug(`determineResponseType: Handling message <${mesg}>. Dump of session states: ${this.sessionState.dump()}`);
  if(this.sessionState.get("awaitingCitiesForExistingTrip")) return getCityDetailsAndStartPlanningTrip.call(this, mesg, true /* existing trip */);

  if(this.session.expenseReportWorkflow) {
    const workflow = this.session.expenseReportWorkflow;
    try {
      callSendAPI.call(this, workflow.doWork(event.message));
      if(workflow.done) {
        this.session.expenseReportWorkflow = null;
      }
    }
    catch(e) {
      logger.error(`determineResponseType: Error from expense report workflow: ${e}`);
      sendTextMessage.call(this, senderID,"Even bots need to eat. Out for lunch! Be back in a bit..");
    }
    return;
  }

  if(event.message.quick_reply) { 
    if(handleQuickReplies.call(this, event.message.quick_reply)) return;
    // if it was not handled, it's possible that the quick_reply is meant for some other step below. continue on.
  }

  const tripData = this.session.tripData();
  if(mesg === "add to trip") return addSenderToTrip.call(this);
  // same as user choosing "Add" after choosing trip from "Existing trip" persistent menu
  if(mesg === "add") return sendAddButtons.call(this);
  // same as user choosing "Get" after choosing trip from "Existing trip" persistent menu
  if(mesg === "get") return displayTripDetails.call(this); 
  if(mesg === "gather data") return this.startPlanningTrip();
  // same as user clicking "existing trips" on persistent menu
  if(mesg === "existing trips" || mesg === "trips") return sendTripButtons.call(this); 
  if(mesg.startsWith("save ") || mesg.startsWith("comment ") || this.sessionState.get("awaitingComment")) {
    const returnString = tripData.storeFreeFormText(senderID, mesg);
    sendTextMessage.call(this, senderID, returnString);
    this.sessionState.clear("awaitingComment");
    return;
  }
  if(mesg.startsWith("todo") || this.sessionState.get("awaitingTodoItem")) {
    const returnString = tripData.storeTodoList(senderID, mesg);
    sendTextMessage.call(this, senderID, returnString);
    this.sessionState.clear("awaitingTodoItem");
    return;
  }
  if(mesg.startsWith("pack ") || this.sessionState.get("awaitingPacklistItem")) {
    const returnString = tripData.storePackList(mesg);
    sendTextMessage.call(this, senderID, returnString);
    this.sessionState.get("awaitingPacklistItem");
    return;
  }
  if(mesg.startsWith("get todo")) {
    sendUrlButton.call(this, "Get Todo list", tripData.todoUrlPath());
    return;
  }
  if(mesg.startsWith("get expense") || mesg.startsWith("expense")) return sendUrlButton.call(this, "Get expense report", tripData.expenseReportUrlPath());

  if(mesg.startsWith("retrieve") || mesg.startsWith("comments") || mesg.startsWith("get comments")) {
    sendUrlButton.call(this, "Get Comments", tripData.commentUrlPath());
    return;
  }
  if(mesg.startsWith("get list") || mesg.startsWith("get pack") || mesg === "packlist" || mesg === "pack") {
    sendUrlButton.call(this, "Get pack-list", tripData.packListPath());
    return;
  }
	if(mesg.startsWith("get trip details") || mesg.startsWith("trip details") || mesg.startsWith("trip calendar") || mesg.startsWith("get trip calendar") || mesg.startsWith("calendar") || mesg.startsWith("trip itinerary") || mesg.startsWith("itinerary") || mesg.startsWith("get itinerary")) return sendUrlButton.call(this, `${tripData.data.rawName} Trip calendar`, `${tripData.data.name}/calendar`);
	if(mesg.startsWith("tomorrow's plans") || mesg.startsWith("plans for tomorrow") || mesg.startsWith("get plans for tomorrow")) return sendUrlButton.call(this, `Day plan`, `${tripData.data.rawName}/day-plan`);

  if(mesg.startsWith("deals")) return retrieveDeals(senderID, mesg);
  if(mesg.startsWith("top activity list") || mesg.startsWith("top activities") || mesg.startsWith("get top activities")) {
    sendActivityList.call(this, mesg);
    return;
  }
  if(mesg.startsWith("other activity list") || mesg.startsWith("other activities") || mesg.startsWith("get other activities")) {
    sendOtherActivities.call(this, mesg);
    return;
  }
  if(mesg.startsWith("get boarding pass") || mesg.startsWith("boarding pass")) return sendBoardingPass.call(this);
  if(mesg.startsWith("get flight itinerary") || mesg.startsWith("flight ") || mesg === "flight") {
    this.showReturnFlight = true;
    return sendFlightItinerary.call(this);
  }
  if(mesg.startsWith("get return flight") || mesg.startsWith("return flight")) {
    this.showOnwardFlight = true;
    return sendReturnFlightDetails.call(this);
  }
  if(mesg.startsWith("get car details") || mesg.startsWith("car")) return sendCarReceipt.call(this);
  if(mesg.startsWith("get receipt") || mesg === "receipts") return sendGeneralReceipt.call(this);
  if(mesg.startsWith("stay") || mesg.startsWith ("get stay") || mesg.startsWith("get hotel details") || mesg.startsWith("hotel")) return sendHotelItinerary.call(this);
	// if(mesg.startsWith("get tour details") || mesg.startsWith("tour details")) return sendTourDetails.call(this);

  const commands = new Commands(tripData, this.session.fbid);
  const canHandle = commands.canHandle(mesg);
  if(canHandle) {
    // case where user entered an invalid message.
    if(typeof canHandle === "object") return callSendAPI.call(this, canHandle); 
    const itinAsList = commands.handle(mesg); 
    if(typeof itinAsList === "object") return callSendAPI.call(this, itinAsList);
    logger.warn(`determineResponseType: Could not get list template from Commands. Defaulting to sending url`);
    return sendUrlButton.call(this, `Itin for ${mesg}`, `${tripData.data.name}/${commands.getPath()}`);
  }
  if(commands.canHandleActivity(mesg)) {
    const result = commands.handleActivity(mesg);
    if(result) return callSendAPI.call(this, result);
  }

  if(commands.canHandleMealsCommand(mesg)) {
    const result = commands.handleMealsCommand(mesg);
    if(result) return callSendAPI.call(this, result);
  }
  const result = commands.handleEventCommands(mesg);
  if(result) return callSendAPI.call(this, result);

  logger.debug(`determineResponseType: Did not understand the context of message <${mesg}>. Dump of session states: ${this.sessionState.dump()}`);
  // We don't understand the text sent. Simply present the options we present on "getting started".
  return getHelpMessageData.call(this, senderID, "Hi, I did not understand what you said. I can help you with the following.");
  
  // ****** INTENTIONALLY UNREACHABLE CODE 
  intentionallyUnreachableCode.call(this, senderID);
}

function intentionallyUnreachableCode(senderID) {
  const humanContext = this.session.humanContext();
  logger.info("determineResponseType: human context: ",JSON.stringify(humanContext));
  if(senderID != humanContext.fbid) {
    // TODO: If response could not be sent to human as expected, we need to figure out what to do. One option is to wing it and send the message to bot. Another option is to simply throw an error that we are experieincing difficult. This might be a little 
    interceptMessage.call(this, humanContext,senderID,event);
    logger.info("intercepted message and updated human context: ",JSON.stringify(humanContext));
    return;
  }
  handleMessageSentByHuman.call(this, messageText, senderID);
}

function supportedCommands(moreElements) {
  const message = {
    recipient: {
      id: this.session.fbid
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "list",
          top_element_style: "compact"
        }
      }
    }
  };
  if(!moreElements) {
    message.message.attachment.payload.elements = [
      {
        "title": "To get plans for a specific day",
        "subtitle": "Type a date in the trip. Eg. '13th', '14', 'today'"
      },
      {
        "title": "To enter a recommendation request",
        "subtitle": "Type 'reco <detailed message of recommendation>'"
      },
      {
        "title": "To get flight details about your current trip",
        "subtitle": "Type 'flight' or 'return flight'"
      },
      {
        "title": "To get hotel details about your current trip",
        "subtitle": "Type 'hotel'"
      }
    ];
    message.message.attachment.payload.buttons = [{
      title: "View more",
      type: "postback",
      payload: "view_more_commands"
    }];
    return callSendAPI.call(this, message);
  }
  message.message.attachment.payload.elements = [
    {
      "title": "To get rental car details about your current trip",
      "subtitle": "Type 'car'"
    },
    {
      "title": "To see your entire trip calendar",
      "subtitle": "Type 'calendar'"
    },
    {
      "title": "To see trip dates",
      "subtitle": "Type 'dates'"
    },
    {
      "title": "To add or get details from current trip",
      "subtitle": "Type 'get' or 'add'"
    }
    /*
    {
      "title": "To see running trail recommendations",
      "subtitle": "Type 'trails' or 'running'"
    },
    {
      "title": "To see restaurant recommendations",
      "subtitle": "Type 'vegetarian reco','veg reco','vegetarian restaurants' or 'veg rest'"
    },
    */
  ];
  return callSendAPI.call(this, message);
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
  callSendAPI.call(this, messageData);
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
  callSendAPI.call(this, messageData);
}

/*
 For each trip in this user's session, find the corresponding trip data information and if the trip is still not complete, then send a notification.
*/
WebhookPostHandler.prototype.sendReminderNotification = function() {
  // get todo list
  const sessions = this.sessions.allSessions();
  Object.keys(sessions).forEach(id => {
    sessions[id].allTrips().forEach(trip => {
      try {
        let todoList = trip.getTodoList();
        if(!todoList || !todoList.todo || todoList.todo.length === 0) return;
        todoList = todoList.todo;
        logger.info(`sendReminderNotification: Trip ${trip.data.name} from session ${id} has ${todoList.length} todo items.`);
        const now = moment().tz("Etc/UTC");
        const tripEnd = moment.tz(trip.data.returnDate, "Etc/UTC");
        if(now.diff(tripEnd,'days') >= 0) {
          logger.debug(`Trip ${trip.data.name} started on ${trip.data.startDate} and has a duration of ${trip.data.duration} days. Not sending reminder because the trip is over (difference is ${now.diff(tripEnd,'days')} days).`);
          return;
        }
        // only send reminder if we are within 45 days of the trip.
        const startDate = moment.tz(trip.data.startDate, "Etc/UTC");
        const daysToTrip = startDate.diff(now, 'days');
        const daysBeforeTripStarts = 10;
        if(daysToTrip <= daysBeforeTripStarts) {
          if(todoList.length > 3) return sendTextMessage.call(this, sessions[id].fbid, `Reminder: You still have ${todoList.length} items to do for your trip to ${trip.data.name}`);
          const elements = [];
          elements.push({
            title: `Reminder for trip ${trip.rawTripName}`,
            subtitle: `You still have ${todoList.length} items to complete. Your trip starts in ${daysToTrip} days.`,
          });
          todoList.forEach(item => {
            elements.push({
              title: item,
              buttons:[{
                title: "Mark done",
                type: "postback",
                payload: `pb_mark_done ${item}`
              }]
            });
          });
          const messageData = {
            recipient: {
              id: this.session.fbid
            },
            message: {
              attachment: {
                type: "template",
                payload: {
                  template_type: "list",
                  elements: elements,
                  top_element_style: "compact",
                }
              }
            }
          };
          this.sendAnyMessage(messageData);
          // TODO: Add a button for user to get the list of todo items.
        }
        else logger.debug(`Not sending reminder because there are ${daysToTrip} days to the trip ${trip.data.name}`);
      }
      catch(e) {
        logger.error(`Error sending reminders for session with fbid ${sessions[id].fbid} for trip ${trip.tripName}: ${e.stack}`);
      }
    });
  });
}

WebhookPostHandler.prototype.notifyAdmin = function(emailId) {
  const fbid = Session.adminId;
  logger.debug(`notifyAdmin: fbid is ${fbid}, email is ${emailId}`);
  return sendTextMessage.call(this, fbid, `[ACTION REQD]: You got email from ${emailId}`);
}

WebhookPostHandler.prototype.notifyUser = function(message) {
	sendTextMessage.call(this, this.session.fbid, message);
}

WebhookPostHandler.prototype.sendBoardingPass = function(message) {
  callSendAPI.call(this, message);
}

WebhookPostHandler.prototype.pushTripDetailsJustBeforeTrip = function() {
  // logger.debug(`Type of this is ${this.constructor.name}`);
  const sessions = this.sessions.allSessions();
  this.notifier.imminentTripsList().forEach(message => {
    this.sendBoardingPass(message);
  }, this);
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
    sendTextMessage.call(this, senderID,"wrong format. correct format is <original-sender-id>-<sequence number> message text");
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
  // TODO: awaitingResponse should be reset automatically after a certain period of time.
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
  callSendAPI.call(this, messageData);
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
  callSendAPI.call(this, messageData);
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
  callSendAPI.call(this, messageData);
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
    sendTextMessage.call(this, senderID,"Even bots need to eat. Out for lunch! Be back in a bit..");
  })
}

function determineCities(existingTrip) {
	const trip = this.session.tripData();
  const country = trip.country;
  if(_.isUndefined(country.cities)) {
    // logger.warn(`determineCities: countries not defined in trip ${trip.rawTripName}. Doing nothing`);
    return false;
  }
  // logger.info(`Asking user to select from the following cities: ${JSON.stringify(country)} for country ${trip.rawTripName}.`);
  sendTextMessage.call(this, this.session.fbid,`Which cities of ${country.name} are you traveling to?`);
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
              url: sendUrl.call(this, `${trip.data.name}/${uri}`),
              title:"Cities",
              webview_height_ratio: "full",
              messenger_extensions: true,
            }]
          }]
        }
      }
    }
  };
  callSendAPI.call(this, messageData);
  return true;
}

function determineTravelCompanions() {
  const trip = this.session.findTrip();
  if(!trip) throw new Error(`Expected trip context to be present for fbid ${this.session.fbid}. Possible BUG!`);
  sendTextMessage.call(this, this.session.fbid, `Choose your travel companions`);
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
              url: sendUrl.call(this, `${trip.data.name}/friends`),
              title:"Choose Friends",
              webview_height_ratio: "full",
              messenger_extensions: true,
              fallback_url: sendUrl.call(this, `${trip.data.name}/friends`)
            }]
          }]
        }
      }
    }
  };
  callSendAPI.call(this, messageData);
}

function respondToHelp() {
  const message = {
    recipient: {
      id: this.session.fbid
    },
    message: {
      attachment: {
        "type": "template",
        payload: {
          template_type: "list",
          "top_element_style": "compact",
          elements: []
        }
      }
    }
  };
  const elements = message.message.attachment.payload.elements;
  elements.push({
    "title": `Details about your ${this.session.rawTripNameInContext} trip`,
    "subtitle": "Add, Get or see plans for specific day",
    "buttons": [{
      title: `${this.session.rawTripNameInContext} trip`,
      type: "postback",
      payload: "pb_current_trip"
    }]
  });
  elements.push(
    {
      "title": "Plan a new trip",
      "subtitle": "Let's plan a trip together",
      "buttons": [{
        title: "Plan new trip",
        type: "postback",
        payload: "new_trip"
      }]
    },
    {
      "title": "Supported commands",
      "subtitle": "commands that are currently available",
      "buttons": [{
        title: "Commands",
        "type": "postback",
        payload: "supported_commands"
      }]
    }
  );
  if(this.session.tripData().data.events) elements.push({
    "title": "Supported event commands",
    "subtitle": `Get specific details from your conferences & events`,
    "buttons": [{
      title: "Event commands",
      type: "postback",
      payload: "pb_event_supported_commands"
    }]
  });
  return this.sendAnyMessage(message);
}

// only call this method if there is a trip name in context
function sendAddOrGetOptions() {
  if(!this.session.tripData()) throw new Error(`sendAddOrGetOptions: I was called even though there is no trip in context in session ${this.session.sessionId}. Potential BUG!`);
  const messageData = {
    recipient: {
      id: this.session.fbid
    },
    message: {
      text: `What would you like to do for your ${this.session.rawTripNameInContext} trip?`,
      quick_replies:[
        {
          content_type: "text",
          title: "Add ...",
          payload: "qr_add_"
        },
        {
          content_type: "text",
          title: "Get ...",
          payload: "qr_get_"
        },
        {
          content_type: "text",
          title: "Day plan",
          payload: "qr_day_plan_"
        }
      ]
    }
  };
  callSendAPI.call(this, messageData);
}

// Typically, this should match the top level entries in Persistent Menu.
function getHelpMessageData(senderID, message) {
  // clear all awaiting states
  // this.session.clearAllAwaitingStates();
  this.sessionState.clearAll();
  if(this.session.doesTripContextOtherThanConferencesExist()) {
    sendTextMessage.call(this, this.session.fbid, message);
    return respondToHelp.call(this);
  }
  if(!message) message = "Hi! What would you like to do?";
  const messageData = {
    recipient: {
      id: this.session.fbid
    },
    message: {
      attachment: {
        "type": "template",
        payload: {
          template_type: "list",
          elements: [
            {
              "title": `${message}`,
              "image_url": "http://icons.iconarchive.com/icons/andrea-aste/torineide/256/turin-map-detail-icon.png"
            },
            {
              "title": "Plan a new trip",
              "subtitle": "Let's plan together",
              "buttons": [{
                title: "Plan new trip",
                type: "postback",
                payload: "postback_create_new_trip"
              }]
            }
          ]
        }
      }
    }
  };
  if(inFriendsTripList.call(this)) messageData.message.attachment.payload.elements.push({
    "title": "Request to be added to existing trip",
    "subtitle": "created by a friend or family",
    "buttons": [{
      title: "Request",
      type: "postback",
      payload: "postback_request_to_be_added"
    }]
  });
  return callSendAPI.call(this, messageData);
}

function inFriendsTripList() {
  const file = `${baseDir}/trips/friends.json`;
  const friends = JSON.parse(fs.readFileSync(file, 'utf8'));
  const name = this.fbidHandler.getName(this.session.fbid);
  if(!name) return null;
  let tripDetails = null;
  Object.keys(friends).forEach(friend => {
    // TODO: Matcing by first or last name is dangerous. Come up with a better approach
    if(name === friend || partialMatch(name.split(" "), friend)) {
      // logger.debug(`inFriendsTripList: Found match ${friend} for name ${name}`);
      tripDetails = friends[friend];
    }
  });
  return tripDetails;
}

function sendWelcomeMessage(senderID) {
	// logger.debug(`fbid handler: ${JSON.stringify(this.fbidHandler)}`);
  let name = this.fbidHandler.getName(senderID);
  if(!name) name = ""; else name = ` ${name.substring(0, name.indexOf(" "))}`;
  return getHelpMessageData.call(this, senderID, `Hi${name}! Welcome to Polaama, your deeply personal travel assistant`);
}

// used by workflow for planningNewTrip
function sendYesNoButtons(message) {
  const messageData = {
    recipient: {
      id: this.session.fbid
    },
    message: {
      text: message,
      quick_replies:[
        {
          content_type: "text",
          title: "Yes",
          payload: "qr_yes",
        },
				{
					content_type: "text",
					title: "Re-enter trip details",
					payload: "qr_no",
				},
			]
		}
	};
	callSendAPI.call(this, messageData);
}

function sendAddButtons() {
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
            title: "Add", // Comments, Tasks, Pack list
            buttons:[{
              type: "postback",
              title: "Comments",
              payload: "add_comments",
            },
            {
              type: "postback",
              title: "Tasks",
              payload: "add_todo",
            },
            {
              type: "postback",
              title: "Pack item",
              payload: "add_pack_item",
            }],
          }, {
            title: "Add", // cities, Expense report 
            buttons:[{
              type: "postback",
              title: "Cities",
              payload: "add_cities"
            },
            {
              type: "postback",
              title: "Expense item",
              payload: "add_expense"
            },
            {
              type: "postback",
              title: "Travelers",
              payload: "add_travelers"
            }],
          }]
        }
      }
    }
  };
  callSendAPI.call(this, messageData);
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
  callSendAPI.call(this, messageData);
}

function sendTypingAction() {
  // logger.info(`sendTypingAction: session id is ${this.session.sessionId}`);
  const messageData = {
    recipient: {
      id: this.session.fbid
    },
    sender_action:"typing_on"
  };

  callSendAPI.call(this, messageData);
}

function getTextMessageData(senderID, text) {
  return {
    recipient: {
      id: senderID
    },
    message: {
      text: text,
      metadata: "DEVELOPER_DEFINED_METADATA"
    }
  };
}

WebhookPostHandler.prototype.getTextMessageData = getTextMessageData;

/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(senderID, messageText) {
  callSendAPI.call(this, getTextMessageData(senderID, messageText));
}
WebhookPostHandler.prototype.sendTextMessage = sendTextMessage;

WebhookPostHandler.prototype.sendAnyMessage = function(message) {
  callSendAPI.call(this, message);
}

WebhookPostHandler.prototype.sendMessage = function(senderID, messageText) {
  sendTextMessage.call(this, senderID, messageText);
  logger.debug(`sendMessage: sent message ${messageText}`);
}

function textMessages(messages) {
  const fbMessages = [];
  messages.forEach(msg => {
    fbMessages.push(getTextMessageData(this.session.fbid, msg));
  });
  return fbMessages;
}

WebhookPostHandler.prototype.textMessages = textMessages;
WebhookPostHandler.prototype.sendMultipleMessages = sendMultipleMessages;

// send messages strictly one after another
function sendMultipleMessages(recipientId, messages, alreadyRecorded) {
  if(recordMessage && !alreadyRecorded) previousMessage = {
    "func": "sendMultipleMessages",
    "message": messages
  };
  // as a precaution, don't send more than 3 messages at once.
  if(messages.length > 3) {
    logger.warn(`sendMultipleMessages: The current implementation does not allow sending more than 3 messages in sequence. Not sending any message`);
    return;
  }
  if(messages.length === 0) return;
  if(TEST_MODE) {
    messages.forEach(message => {
      logger.debug(`MESSAGE TO CHAT: ${JSON.stringify(message)}`);
    });
    return;
  }
	const self = this;
	if(!pageAccessToken) pageAccessToken = this.pageHandler.getPageAccessToken(this.pageId);
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: pageAccessToken },
    method: 'POST',
    json: messages[0]
  }, function (error, response, body) {
    if (response.statusCode == 200) {
      // recursively call, but remove the first element from the array
      sendMultipleMessages.call(self, recipientId, messages.slice(1, messages.length), true /* alreadyRecorded */);
      return;
    }
    if(error) {
      logger.error(`sendMultipleMessages: Error sending message: ${error}`);
      return;
    }
    logger.error(`Unable to send message <${JSON.stringify(messages[0])}>. status code is ${response.statusCode}. Message from FB is <${response.body.error.message}>; Error type: ${response.body.error.type}. stack trace: ${new Error().stack}`);
  });  
}

function callSendAPI(messageData) {
  if(recordMessage) previousMessage = {
    "func": "callSendAPI",
    "message": messageData
  };
  if(TEST_MODE) return logger.debug(`MESSAGE TO CHAT: ${JSON.stringify(messageData)}`);
	if(!pageAccessToken) pageAccessToken = this.pageHandler.getPageAccessToken(this.pageId);
  const stack = new Error().stack;
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: pageAccessToken },
    method: 'POST',
    json: messageData
  }, function (error, response, body) {
    if(error) return logger.error(`callSendAPI: Unable to send message ${JSON.stringify(messageData)}: ${error}`);
     // TODO: If there was an error in sending an intercept message to a human, then send a push notification to the original sender that we are having some technical difficulty and will respond to them shortly.
    if(response.statusCode != 200) {
      logger.error(`Unable to send message ${JSON.stringify(messageData)}. status code is ${response.statusCode}.`);
      if(response.body && response.body.error) logger.error(`Continuation of above message: Message from FB is <${response.body.error.message}>; Error type: ${response.body.error.type}`);
      else if(response.body) logger.error(`Continuation of above message: response.body.error is undefined. response.body dump: ${JSON.stringify(response.body)}`);
      else logger.error(`Continuation of above message: response.body is undefined. response dump: ${JSON.stringify(response)}`);
      logger.error(`stack trace: ${stack}`);
    }
  });  
}

// ********************************* TESTING *************************************
WebhookPostHandler.prototype.testing_determineResponseType = determineResponseType;
WebhookPostHandler.prototype.testing_handleMessagingEvent = handleMessagingEvent;
WebhookPostHandler.prototype.testing_createNewTrip = createNewTrip;
WebhookPostHandler.prototype.testing_displayTripDetails = displayTripDetails;
WebhookPostHandler.prototype.testing_receivedPostback = receivedPostback;

WebhookPostHandler.prototype.testing_setState = function(sessionState) {
  if(!this.session) throw new Error(`testing_setState: session not defined in handler`);
  if(!sessionState) throw new Error(`testing_setState: required parameter sessionState not present`);
  this.sessions.testing_setState(this.session.sessionId, sessionState);
}

// ********************************* TESTING *************************************

module.exports = WebhookPostHandler;
