'use strict';
const baseDir = "/home/ec2-user";
const Sessions = require(`${baseDir}/sessions`);
const WebhookPostHandler = require(`${baseDir}/webhook-post-handler`);
const TripData = require(`${baseDir}/trip-data`);
const TripInfoProvider = require(`${baseDir}/trip-info-provider`);
const logger = require(`${baseDir}/my-logger`);
logger.setTestConfig(); // indicate that we are logging for a test
const FbidHandler = require('fbid-handler/app/handler');
const SessionState = require('session-state/app/state');
const fs = require('fs');
const PageHandler = require('fbid-handler/app/page-handler');

const moment = require('moment');
const Promise = require('promise');
let myFbid = "1234";

function testGatheringDetailsForNewTrip() {
  const dtdCallback = function() { 
    logger.debug("All callbacks successfully called");
  }
  // Iceland
  const td = new TripData("san_francisco", "1234");
  td.addTripDetailsAndPersist({
    startDate: "9/11/2017",
    destination: "san_francisco",
    duration: 4,
  });
  td.addPortOfEntry("san_francisco");
  const tip = new TripInfoProvider(td, "ewr");
  
  const activities = Promise.denodeify(tip.getActivities.bind(tip));
  // const flightDetails = Promise.denodeify(tip.getFlightDetails.bind(tip));
  // const flightQuote = tip.getFlightQuotes();
  const weatherDetails = Promise.denodeify(tip.getWeatherInformation.bind(tip));
  
  activities()
    // .then(flightDetails())
    .then(
      function(response) {
        return tip.getFlightQuotes();
      },
      function(err) {
        logger.error(`Activities promise returned error: ${err.stack}`);
        return Promise.reject(err);
      }
    )
    .then(
      function(response) {
        return weatherDetails();
      },
      function(err) {
        logger.error(`FlightQuotes promise returned error: ${err.stack}`);
        return Promise.reject(err);
      }
    )
    .done(
      function(response) {
        console.log(`all functions called. response type is ${typeof response}`);
      }, function(err) {
        console.log(`test-webhook-post-handler error: ${err.stack}`);
      }
    );
}

function setup() {
  // set up
  const myFbid = "1234";
  const tripName = "test-extractCityDetails";
  const sessions = Sessions.get();
  // first clean up previous test state
  sessions.testing_delete(myFbid);
  new TripData(tripName, myFbid).testing_delete();
  const session = sessions.findOrCreate(myFbid);
  // create new trip
  const handler = new WebhookPostHandler(session, true /* testing */);
  const state = new SessionState();
  state.set("awaitingNewTripDetails");
  handler.testing_setState(state);
  handler.testing_createNewTrip({
    destination: tripName,
    startDate: moment().add(7, 'days').format("MM/DD/YYYY"), // 05/10/2017,
    duration: 10
  });
  session.persistHometown("san francisco");
  return handler;
}

function receivedPostbackEvent(payload) {
  let event = { 
    message: {
      text: ""
    },
    sender: {
      id: myFbid
    }, 
    recipient: {
      id: myFbid
    }, 
    timestamp: "12345",
    postback: { 
      payload: payload
    } 
  };
  return event;
}

function determineResponseTypeEvent(mesg, fbid) {
  let fbidToUse;
  if(fbid) fbidToUse = fbid;
  else fbidToUse = myFbid;
  const event = { 
    message: { text: mesg }, 
    postback: {},
    sender: {
      id: fbidToUse
    }, 
    recipient: {
      id: fbidToUse
    }, 
    timestamp: "12345"
  };
  return event;
}

function setupTelAvivTrip() {
  // set up
  const myFbid = "1234";
  const tripName = "test-tel-aviv";
  const sessions = Sessions.get();
  // first clean up previous test state
  sessions.testing_delete(myFbid);
  new TripData(tripName, myFbid).testing_delete();
  const session = sessions.findOrCreate(myFbid);
  // create new trip
  const handler = new WebhookPostHandler(session, true /* testing */);
  handler.testing_createNewTrip({
    destination: tripName,
    startDate: "06/10/2017",
    duration: 8,
    leavingFrom: "san francisco",
    portOfEntry: "tel aviv"
  });
  session.persistHometown("san francisco");
  // create the necessary files
  const itin = {
    "6/10/2017": {
      city: ["san_francisco", "tel_aviv"]
    },
    "6/19/2017": {
      city: "tel_aviv"
    }
  };
  const trip = session.tripData();
  const fs = require('fs');
  fs.writeFileSync(trip.tripItinFile(), JSON.stringify(itin), "utf8");
  const dayItin = {
    "firstSet": [
      {
        title: "First Item",
        subtitle: "First subtitle"
      },
      {
        "title": "09:30 Program with KamaTech at WIX",
        "subtitle": "Meet at WIX office",
        "default_action": {
          "type": "web_url",
          "url": "https://polaama.com/aeXf/tel_aviv/itin-detail/tel-aviv-2017-06-13-item-2",
          "webview_height_ratio": "full"
        }
      }
    ],
    "secondSet": [
      {
        title: "Second set First item",
        subtitle: "Second subtitle"
      },
      {
        "title": "Overnight at Nir Etzion",
        "image_url": "https://www.nirezion-hotel.com/octopus/Upload/images/Resorts/home6.jpg",
        "default_action": {
          "type": "web_ur",
          "url": "https://www.nirezion-hotel.com/",
          "webview_height_ratio": "full"
        }
      }
    ]
  };
  fs.writeFileSync(trip.dayItineraryFile(new Date("6/13/2017")), JSON.stringify(dayItin), "utf8");
  return handler;
}

let globalHandler;
function testStartPlanningTrip() {
  const sessions = Sessions.get();
  const myFbid = "1234";
  const tripName = "san_francisco";
  // set up
  // first clean up previous test state
  sessions.testing_delete(myFbid);
  new TripData(tripName, myFbid).testing_delete();
  const session = sessions.findOrCreate(myFbid);
  // create new trip
  session.persistHometown("ewr");
  const handler = new WebhookPostHandler(session, true /* testing */);
  handler.testing_createNewTrip({
    destination: tripName,
    startDate: "09/10/2017",
    duration: 4
  });
  const sessionState = handler.sessionState;
  // setup state
  sessionState.set("planningNewTrip");
  sessionState.set("awaitingUseHometownAsDepartureCity");
  let event = { message: { text: "", quick_reply : { payload: "qr_use_hometown_as_dep_city_yes" }}};
  // test
  const fulfil = function(result) {
    logger.debug(`done: result is ${JSON.stringify(result)}`);
    handler.handleDisplayTripDetailsPromise();
    return Promise.resolve(true);
  };
  const reject = function(err) {
    logger.warn(`promise returned error: ${err.stack}`);
    return Promise.reject(true);
  };
  globalHandler = handler;
  const promises = handler.testing_determineResponseType(event);
  if(!promises) logger.error(`determineResponseType returned undefined promise`);
  else if(Array.isArray(promises)) return Promise.all(promises).then(fulfil, reject);
  else return promises.then(fulfil, reject);
}

function testRequestToBeAddedToTrip() {
  const sessions = Sessions.get();
  const myFbid = "1234";
  const tripName = "ewr-sfo";
  // set up
  // first clean up previous test state
  sessions.testing_delete(myFbid);
  sessions.testing_delete("2");
  const session = sessions.findOrCreate("2");
  // create new trip
  const handler = new WebhookPostHandler(session, true /* testing */);
  handler.testing_createNewTrip({
    destination: "san_francisco",
    startDate: "09/11/2017",
    leavingFrom: "ewr",
    duration: 4
  });
  session.persistHometown("ewr");
  const event = { message: { text: "invalid" }, sender: { id: "2"} };
  event.message.quick_reply = { payload: "qr_request_to_be_added" };
  // test
  handler.testing_determineResponseType(event);
}

function testExtractingCityDetails() {
  const handler = setup();
  handler.session.tripData().data.leavingFrom = "san_francisco";
  const sessionState = handler.sessionState;
  // setup state
  sessionState.set("planningNewTrip");
  sessionState.set("awaitingCitiesForNewTrip");
  // test
  const event = { message: { text: "city(1)" } };
  handler.testing_determineResponseType(event);
}

function testAddingCityToExistingTrip() {
  const handler = setup();
  const session = handler.session;
  // first add three cities.
  // setup state
  const state = handler.sessionState;
  state.set("planningNewTrip");
  state.set("awaitingCitiesForNewTrip");
  // test
  {
    const event = { message: { text: "city(1),cityx(2),cityy(3)" } };
    handler.testing_setState(state);
    handler.testing_determineResponseType(event);
  }
  logger.debug(`*************** Existing Trip *****************`);
  // setup state
  state.set("awaitingCitiesForExistingTrip");
  // now test adding 4th city
  const event = { message: { text: "another city(6)" } };
  handler.testing_determineResponseType(event);
}

function testDisplayTripDetails() {
  // create new trip
  const handler = setup();
  handler.testing_displayTripDetails();
  // create a fake boarding pass file
  require('fs').writeFileSync(handler.session.findTrip().boardingPassFile(), "empty"); 
  handler.testing_displayTripDetails();
}

function testDayPlanCommand() {
  // create new trip
  const handler = setupTelAvivTrip();
  const session = handler.session;
  // set up state
  session.planningNewTrip = false;
  const event = { message: { text: "13th" } };
  logger.debug(`testDayPlanCommand: ****** About to start test ********`); 
  handler.testing_determineResponseType(event);
}

function testDayPlanSecondSetCommand() {
  // create new trip
  const handler = setupTelAvivTrip();
  const session = handler.session;
  // set up state
  session.planningNewTrip = false;
  let event = { message: { text: "13th" } };
  // const message = handler.testing_determineResponseType(event);
  // const postback = message.message.attachment.payload.buttons[0].payload;
  const postback = "2017-5-13-itin_second_set";
  event = { 
    sender: {
      id: session.fbid
    }, 
    recipient: {
      id: session.fbid
    }, 
    timestamp: "12345",
    postback: { 
      payload: postback 
    } 
  };
  logger.debug(`testDayPlanCommand: ****** About to start test ********`); 
  handler.testing_receivedPostback(event);
}

function testHotelItinerarySingleHotel() {
  const handler = setup();
  // update with hotel details
  const hotels = {"port_moresby":{"receipt":{"template_type":"receipt","recipient_name":"Madhuvanesh Parthasarathy","order_number":"65786645","merchant_name":"Holiday Inn","payment_method":"Unknown","currency":"USD","order_url":"http://tinyurl.com/yb6uvywg","elements":[{"title":"Confirmation #:65786645","price":"177.73","currency":"USD"}],"address":{"street_1":"Cnr Waigani Drive & Wards Rd, Boroko","city":"Port Moresby","state":"National Capital District","country":"Papua New Guinea","postal_code":"121"},"summary":{"total_cost":"177.73"}},"receipt_ext":{"template_type":"generic","elements":[{"title":"Phone: 675-303-2000","buttons":[{"type":"web_url","url":"http://tinyurl.com/yb6uvywg","title":"Hotel rental"}],"subtitle":"CHECK-IN: Aug 11 2017 02:00 PM; CHECK-OUT: Aug 12 2017 11:00 AM"}]}}};
  const session = handler.session;
  const trip = session.findTrip(); 
  fs.writeFileSync(trip.hotelRentalReceiptFile(), JSON.stringify(hotels), 'utf8');
  const event = { 
    sender: {
      id: session.fbid
    }, 
    recipient: {
      id: session.fbid
    }, 
    timestamp: "12345",
    postback: { 
      payload: "hotel details" 
    } 
  };
  handler.testing_receivedPostback(event);
}

function testHotelItineraryMultipleHotels() {
  const handler = setup();
  // update with hotel details
  const hotels = {"port_moresby":{"receipt":{"template_type":"receipt","recipient_name":"Madhuvanesh Parthasarathy","order_number":"65786645","merchant_name":"Holiday Inn","payment_method":"Unknown","currency":"USD","order_url":"http://tinyurl.com/yb6uvywg","elements":[{"title":"Confirmation #:65786645","price":"177.73","currency":"USD"}],"address":{"street_1":"Cnr Waigani Drive & Wards Rd, Boroko","city":"Port Moresby","state":"National Capital District","country":"Papua New Guinea","postal_code":"121"},"summary":{"total_cost":"177.73"}},"receipt_ext":{"template_type":"generic","elements":[{"title":"Phone: 675-303-2000","buttons":[{"type":"web_url","url":"http://tinyurl.com/yb6uvywg","title":"Hotel rental"}],"subtitle":"CHECK-IN: Aug 11 2017 02:00 PM; CHECK-OUT: Aug 12 2017 11:00 AM"}]}},"brisbane":{"receipt":{"template_type":"receipt","recipient_name":"Madhuvanesh Parthasarathy","order_number":"BB1706166422446","merchant_name":"Novotel Brisbane Airport","payment_method":"Unknown","currency":"AUD","order_url":"http://www.novotelbrisbaneairport.com.au/guest-rooms/standard-room/","elements":[{"title":"Confirmation #:BB1706166422446","price":"333.00","currency":"AUD"}],"address":{"street_1":"6-8 The Circuit, Brisbane Airport","city":"Brisbane","state":"QLD","country":"Australia","postal_code":"4008"},"summary":{"total_cost":"333.00"}},"receipt_ext":{"template_type":"generic","elements":[{"title":"Phone: +61 7 3175 3100","buttons":[{"type":"web_url","url":"http://www.novotelbrisbaneairport.com.au/guest-rooms/standard-room/","title":"Hotel rental"}],"subtitle":"CHECK-IN: Aug 24 2017 02:00 PM; CHECK-OUT: Aug 25 2017 11:00 AM"}]}}};
  const session = handler.session;
  const trip = session.findTrip(); 
  fs.writeFileSync(trip.hotelRentalReceiptFile(), JSON.stringify(hotels), 'utf8');
  const event = { 
    sender: {
      id: session.fbid
    }, 
    recipient: {
      id: session.fbid
    }, 
    timestamp: "12345",
    postback: { 
      payload: "hotel details" 
    } 
  };
  handler.testing_receivedPostback(event);
  event.postback.payload = "port_moresby-hotel-receipt";
  handler.testing_receivedPostback(event);
  event.postback.payload = "brisbane-hotel-receipt";
  handler.testing_receivedPostback(event);
}

function testAddingDepartureCityThatIsNotHometown() {
  const handler = setup();
  const trip = handler.session.findTrip();
  handler.sessionState.set("planningNewTrip");
  handler.sessionState.set("awaitingUseHometownAsDepartureCity");
  const event = { message: { text: "", quick_reply: { payload: "qr_use_hometown_as_dep_city_no" }}};
  let response = handler.testing_determineResponseType(event);
  console.log(`testAddingDepartureCityThatIsNotHometown: response from determineResponseType is ${response}`);
  event.message.quick_reply = null;
  event.message.text = "newark";
  response = handler.testing_determineResponseType(event);
  console.log(`testAddingDepartureCityThatIsNotHometown: response from determineResponseType is ${response}`);
}

function testAddingDepartureCityNoHometownSet() {
  const handler = setup();
  handler.session.hometown = null;
  handler.sessionState.set("planningNewTrip");
  handler.sessionState.set("awaitingDepartureCityDetails");
  const event = { message: { text: "newark" }};
  let response = handler.testing_determineResponseType(event);
  console.log(`testAddingDepartureCityNoHometownSet: response from determineResponseType is ${response}`);
  event.message.quick_reply = { payload: "qr_use_as_hometown_yes" };
  response = handler.testing_determineResponseType(event);
  console.log(`testAddingDepartureCityNoHometownSet: response from determineResponseType is ${response}; hometown: ${handler.session.hometown}`);
}

function createHandler(fbid) {
	if(!fbid) fbid = myFbid;
  const sessions = Sessions.get();
  const tripName = "san_francisco";
  // set up
  // first clean up previous test state
  sessions.testing_delete(fbid);
  new TripData(tripName, fbid).testing_delete();
  const session = sessions.findOrCreate(fbid);
  // create new trip
  return new WebhookPostHandler(session, true /* testing */);
}

function setupForSfoEventPlanning(fbid) {
  const handler = createHandler(fbid);
  handler.testing_createNewTrip({
    destination: "san_francisco",
    startDate: "09/10/2017",
    duration: 4,
    leavingFrom: "ewr",
    portOfEntry: "sfo",
    ownerId: "ZDdz"
  });
  return handler;
}

function testGettingEventItinerary() {
  const handler = setupForSfoEventPlanning();
  const postback = "pb_event_details_day arival oct_11";
  const event = { 
    message: {
      text: ""
    },
    sender: {
      id: myFbid
    }, 
    recipient: {
      id: myFbid
    }, 
    timestamp: "12345",
    postback: { 
      payload: postback 
    } 
  };
  logger.debug(`testGettingEventItinerary: ****** About to test getting event itinerary ********`);
  handler.testing_receivedPostback(event);
}

function testChoosingConference() {
  const handler = setupForSfoEventPlanning();
  handler.sessionState.set("awaitingTripReason");
  handler.sessionState.set("planningNewTrip");
  const event = receivedPostbackEvent("pb_event");
  handler.testing_receivedPostback(event);
  handler.session.tripData().addEvent("phocuswright");
  handler.testing_determineResponseType(determineResponseTypeEvent("phocus"));
  const promises = handler.tripPlanningPromise;
  if(!promises) return logger.debug("tripPlanningPromise is null");
  const fulfil = function(result) {
      logger.debug(`done: result is ${JSON.stringify(result)}`);
  };
  const reject = function(err) {
      logger.warn(`promise returned error: ${err.stack}`);
  };
  if(Array.isArray(promises)) Promise.all(promises).done(fulfil, reject);
  else promises.done(fulfil, reject);
}

function testConferenceViewMore() {
  const handler = setupForSfoEventPlanning();
  handler.session.tripData().addEvent("phocuswright");
  const event = receivedPostbackEvent("phocuswright-1-recommendation_next_set");
  handler.testing_receivedPostback(event);
}

function testSpecifyingValidConference() {
  const handler = setupForSfoEventPlanning();
  // start planning trip
  handler.startPlanningTrip(true /* return promise */);
  handler.sessionState.set("awaitingTripReason");
  handler.sessionState.set("awaitingConferenceName");
  handler.sessionState.set("planningNewTrip");
  const event = receivedPostbackEvent("phocuswright");
  handler.testing_receivedPostback(event);
  event.postback.payload = "phocuswright-1-recommendation_next_set";
  handler.testing_receivedPostback(event);
}


function testSendingHelp() {
  const handler = setupForSfoEventPlanning();
  handler.testing_determineResponseType(determineResponseTypeEvent("help"));
  event.postback.payload = "pb_event_supported_commands";
  event.message.text = "";
  handler.testing_receivedPostback(event);
}

// TODO: This does not work. Get it working if needed again.
/*
function testHandleMessagingEventGetFacebookData() {
	// FbidHandler.testing_delete_file();
	new FbidHandler.get("fbid-test.txt");
	testHandleMessagingEvent();
}
*/

function testHandleMessagingEvent() {
	const arthaFbid = "1280537748676473";
  const messagingEvent = {
    sender: { id: arthaFbid },
    recipient: { id: arthaFbid }, 
    timestamp: "12345",
    message: { text: "get" }
  };
  // const handler = setupForSfoEventPlanning(arthaFbid);
  const handler = createHandler();
  handler.testing_handleMessagingEvent(messagingEvent);
  handler.testing_createNewTrip({
    destination: "san_francisco",
    startDate: "09/10/2017",
    duration: 4,
    leavingFrom: "ewr",
    portOfEntry: "sfo",
    ownerId: "ZDdz"
  });
}

function testSendingConferenceMessage() {
  const handler = setupForSfoEventPlanning();
  handler.session.tripData().addEvent("test-phocuswright");
  const event = determineResponseTypeEvent("event details");
  handler.testing_determineResponseType(event);
}

function testEventNoTrip() {
  const sessions = Sessions.get();
  const session = sessions.findOrCreate(myFbid);
  // create new trip
  const handler = new WebhookPostHandler(session, true /* testing */);
  const event = determineResponseTypeEvent("arival");
  handler.testing_determineResponseType(event);
}

function testAddingComments() {
  const handler = setupForSfoEventPlanning();
  const event = { 
    sender: {
      id: myFbid
    }, 
    recipient: {
      id: myFbid
    }, 
    timestamp: "12345",
    postback: { 
      payload: "add_comments" 
    } 
  };
  logger.debug(`testDayPlanCommand: ****** About to send receivedPostback ********`); 
  handler.testing_receivedPostback(event);
  event.postback.payload = "add_expense";
  handler.testing_receivedPostback(event);
  event.postback.payload = "car details";
  handler.testing_receivedPostback(event);
}

function testEventAfterAnotherTripInContext() {
  const handler = setupForSfoEventPlanning();
  handler.sessionState.clearAll();
  handler.testing_determineResponseType(determineResponseTypeEvent("get"));
  logger.debug(`session context: ${globalHandler.session.tripNameInContext}`);
  handler.testing_determineResponseType(determineResponseTypeEvent("test-phocuswright"));
  handler.testing_determineResponseType(determineResponseTypeEvent("Mike"));
}

function testOverlappingSessions() {
	const arthaFbid = "1280537748676473";
  const messagingEvent = {
    sender: { id: arthaFbid },
    recipient: { id: arthaFbid }, 
    timestamp: "12345",
    message: { text: "get" }
  };
  // const handler = setupForSfoEventPlanning(arthaFbid);
  const handler = createHandler();
  handler.testing_handleMessagingEvent(messagingEvent);
  handler.testing_createNewTrip({
    destination: "san_francisco",
    startDate: "09/10/2017",
    duration: 4,
    leavingFrom: "ewr",
    portOfEntry: "sfo",
    ownerId: "ZDdz"
  });
}

function testEnterNewPlanDetails() {
  // set up
  const myFbid = "1234";
  const sessions = Sessions.get();
  // first clean up previous test state
  sessions.testing_delete(myFbid);
  const session = sessions.findOrCreate(myFbid);
  // create new trip
  const handler = new WebhookPostHandler(session, true /* testing */);
  const state = new SessionState();
  state.set("planningNewTrip");
  state.set("awaitingNewTripDetails");
  handler.testing_setState(state);
  handler.testing_handleMessagingEvent(determineResponseTypeEvent("san deigo,12/1,5"));
  const trip = handler.session.tripData();
  logger.debug(`testEnterNewPlanDetails: trip details: ${JSON.stringify(trip)}`);
}

function testMarkDone() {
  // set up
  myFbid = "1120615267993271";
  const sessions = Sessions.get();
  // first clean up previous test state
  const session = sessions.find(myFbid);
  const handler = new WebhookPostHandler(session, true /* testing */);
  handler.testing_receivedPostback(receivedPostbackEvent("pb_mark_done Hello World"));
  myFbid = "1234";
}

function testSpearFishing() {
  const session = Sessions.get().find(myFbid);
  let handler = new WebhookPostHandler(session, true /* testing */);
  handler.testing_determineResponseType(determineResponseTypeEvent("spear fishing"));
  const state = new SessionState();
  state.set("awaitingPSBQuestion");
  handler.testing_setState(state);
  handler.testing_receivedPostback(receivedPostbackEvent("message_psb"));
  handler.testing_determineResponseType(determineResponseTypeEvent("abalone"));
  state.set("awaitingPSBQuestion");
  handler = new WebhookPostHandler(session, true /* testing */);
  handler.testing_setState(state);
  handler.testing_determineResponseType(determineResponseTypeEvent("something other"));
  handler.testing_determineResponseType(determineResponseTypeEvent("existing trips"));
}

function testSeaSpray(pageId) {
  const session = Sessions.get().find(myFbid);
  let handler = new WebhookPostHandler(session, true /* testing */, pageId);
  handler.testing_determineResponseType(determineResponseTypeEvent("hi"));
}

function testSeaSprayPostback(pageId) {
  const session = Sessions.get().find(myFbid);
  let handler = new WebhookPostHandler(session, true /* testing */, pageId);
  handler.testing_receivedPostback(receivedPostbackEvent("sea_spray_contact"));
}

function testSeaSprayGettingStarted(pageId) {
  const session = Sessions.get().find(myFbid);
  let handler = new WebhookPostHandler(session, true /* testing */, pageId);
  handler.testing_receivedPostback(receivedPostbackEvent("GET_STARTED_PAYLOAD"));
}

function testHackshaw(pageId) {
  const session = Sessions.get().find(myFbid);
  let handler = new WebhookPostHandler(session, true /* testing */, pageId);
  handler.testing_determineResponseType(determineResponseTypeEvent("hi"));
}

function testHackshawGettingStarted(pageId) {
  const session = Sessions.get().find(myFbid);
  let handler = new WebhookPostHandler(session, true /* testing */, pageId);
  handler.testing_receivedPostback(receivedPostbackEvent("GET_STARTED_PAYLOAD"));
}

function testHackshawPostback(pageId) {
  const session = Sessions.get().find(myFbid);
  let handler = new WebhookPostHandler(session, true /* testing */, pageId);
  handler.testing_receivedPostback(receivedPostbackEvent("hackshaw_contact"));
}

const pageId = PageHandler.mySeaSprayPageId;
// testSeaSpray(pageId);
// testSeaSprayPostback(pageId);
// testSeaSprayGettingStarted(pageId);

// testHackshawGettingStarted(PageHandler.myHackshawPageId);
testHackshaw(PageHandler.myHackshawPageId);
// testHackshawPostback(PageHandler.myHackshawPageId);

/*
function testMySeaSprayTalkToHuman() {
  const session = Sessions.get().find(myFbid);
  let handler = new WebhookPostHandler(session, true, PageHandler.mySeaSprayPageId);
  const promise = new Promise(
    function() {
      handler.testing_determineResponseType(determineResponseTypeEvent("talk to a human"));
      return 
    },
    function() {
    }
  );
  handler.testing_determineResponseType(determineResponseTypeEvent("done talk to human"));
}
*/
// testMySeaSprayTalkToHuman();

// testHackshaw();
// testHackshawGettingStarted();

// testSpearFishing();
// testMarkDone();

// testEnterNewPlanDetails();

// testHandleMessagingEvent();

// testEventAfterAnotherTripInContext();

// testAddingComments();

// testEventAfterAnotherTripInContext();

// testEventNoTrip();

// testSendingConferenceMessage();

// testHandleMessagingEventGetFacebookData();

// testSendingHelp();

// testSpecifyingValidConference();
// testConferenceViewMore();
// testChoosingConference();

// testGettingEventItinerary();

// testStartPlanningTrip();

// testRequestToBeAddedToTrip();

// testAddingDepartureCityNoHometownSet();

// testAddingDepartureCityThatIsNotHometown();

// testHotelItinerarySingleHotel();
// testHotelItineraryMultipleHotels();

// testDayPlanSecondSetCommand();

// testDayPlanCommand();

// testDisplayTripDetails();

// testAddingCityToExistingTrip();

// testExtractingCityDetails();

// testGatheringDetailsForNewTrip();

// testAddingDepartureCity();
