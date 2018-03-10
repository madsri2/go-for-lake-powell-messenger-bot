'use strict';

const baseDir = "/home/ec2-user";
const WebhookPostHandler = require(`${baseDir}/webhook-post-handler`);
const TripData = require(`${baseDir}/trip-data`);
const Sessions = require(`${baseDir}/sessions`);
const Commands = require(`trip-itinerary/app/commands`);
const FbidHandler = require('fbid-handler/app/handler');
const PageHandler = require('fbid-handler/app/page-handler');
const FBTemplateCreator = require(`${baseDir}/fb-template-creator`);
const logger = require(`${baseDir}/my-logger`);
logger.setTestConfig(); // log in the test file to avoid polluting prod.

// const fbid = "1630377990366886"; // raj
// const fbid = "1311237785652279"; // divya
// const fbid = "1120615267993271"; // madhu
// const fbid = "1420839671315623"; // Aparna
// const fbid = "1428065237278275"; // Arpan
// const fbid = "1718674778147181"; // Beth
// const fbid = "1420839671315623"; // Aparna
// *** Travel SFO Page
// const fbid = "1449869371716306"; // Dhu
// const fbid = "1652003184850840"; // madhu
// let name = FbidHandler.get().getName(fbid);
// if(!name) name = ""; else name = name.substring(0, name.indexOf(" "));

function sendPackList() {
	const trip = new TripData("london", fbid);
  handler.sendMultipleMessages(fbid, [
    handler.getTextMessageData(fbid, `Don't forget "sunscreen" for your ${trip.data.rawName} trip. It is going to be sunny (around 80°F)`), 
    handler.getTextMessageData(fbid, "We have created a full pack list for you"),
    handler.urlButtonMessage("Pack list", trip.packListPath())
  ]);
}

function flightStatusAndWaitTimes() {
  handler.sendMultipleMessages(fbid, [
    handler.getTextMessageData(fbid, `Good news! Your flight UA90 is expected to be on time. Expected departure: 22:45 from Terminal C, Gate C138`),
    handler.getTextMessageData(fbid, "There is an approximate wait of 10-20 minutes at the security gate for Terminal C"),
    handler.getTextMessageData(fbid, "Bon Voyage!")
  ]);
}

function sendDayPlan() {
	const firstSet = [
    {
      "title": "Running trails in Salt Lake city",
      "subtitle": "Near your hotel",
      "image_url": "https://cdn.pixabay.com/photo/2012/04/02/12/56/exercising-24419_960_720.png"
    },
    {
      "title": "Herman Franks Park",
      "subtitle": ".3 miles from hotel",
      "image_url": "http://www.slcgov.com/sites/default/files/images/parks/2012/hermanfranks-(1)-1185.jpg",
      "default_action": {
        "type": "web_url",
        "url": "http://www.slcgov.com/cityparks/parks-herman-franks-park",
        "webview_height_ratio": "full"
      },
      "buttons": [
        {
          "title": "Directions",
          "type": "web_url",
          "url": "https://goo.gl/maps/zQvhVZGjxSx",
          "webview_height_ratio": "full"
        }
      ]
    },
    {
      "title": "Liberty Park",
      "subtitle": "1 mile from hotel",
      "image_url": "http://www.slcgov.com/sites/default/files/images/parks/2012/IMG_2859.jpg",
      "default_action": {
        "type": "web_url",
        "webview_height_ratio": "full",
        "url": "http://www.slcgov.com/cityparks/parks-liberty-park"
      },
      "buttons": [
        {
          "title": "Directions",
          "type": "web_url",
          "url": "https://goo.gl/maps/zQvhVZGjxSx",
          "webview_height_ratio": "full"
        }
      ]
    }
  ];
  // Interactive SLC: http://www.slcgov.com/cityparks/parks-wasatch-hollow-park
	const secondSet = [
    {
      "title": "Sunnyside Park",
      "subtitle": "2.2 miles from hotel",
      "image_url": "http://www.slcgov.com/sites/default/files/images/parks/2012/sunnyside-(6)-1333.jpg",
      "default_action": {
        "type": "web_url",
        "url": "http://www.slcgov.com/cityparks/parks-sunnyside-park",
        "webview_height_ratio": "full"
      },
      "buttons": [
        {
          "title": "Directions",
          "type": "web_url",
          "url": "https://goo.gl/maps/JvwRiVZnJy42",
          "webview_height_ratio": "full"
        }
      ]
    },
    {
      "title": "Wasatch Hollow park",
      "subtitle": "1.6 miles from hotel",
      "image_url": "http://www.slcgov.com/sites/default/files/images/parks/2012/wasatchhollow-(1)-1294.jpg",
      "default_action": {
        "type": "web_url",
        "webview_height_ratio": "full",
        "url": "http://www.slcgov.com/cityparks/parks-wasatch-hollow-park"
      },
      "buttons": [
        {
          "title": "Directions",
          "type": "web_url",
          "url": "https://goo.gl/maps/wah5FyTtxTy",
          "webview_height_ratio": "full"
        }
      ]
    }
	];
  const message = {
    recipient: {
      id: fbid
    },
    message: {
      attachment: {
        "type": "template",
        payload: {
          template_type: "list",
          "top_element_style": "compact",
          // elements: firstSet,
          elements: secondSet,
          buttons: [{
            title: "View more",
            "type": "postback",
            payload: "view more"
          }]
        }
      }
    }
  };
  const messageList = [];
  messageList.push(message);
  handler.sendMultipleMessages(fbid, messageList);
}

function sendCheckinMessage() {
  const message = {
    recipient: {
      id: fbid
    },
    message: {
      attachment: {
        "type": "template",
        payload: {
          "template_type": "airline_checkin",
          "intro_message": `Hi ${name}! Time to check in for your flight to Papua New Guinea`,
          "locale": "en_US",
          "pnr_number": "HNPOL6",
          "flight_info": [
            {
              "flight_number": "DL998",
              "departure_airport": {
                "airport_code": "SEA",
                "city": "Seattle",
              },
              "arrival_airport": {
                "airport_code": "LAX",
                "city": "Los Angeles",
              },
              "flight_schedule": {
                "departure_time": "2017-08-09T17:00",
                "arrival_time": "2017-07-09T19:45"
              }
            }
          ],
          "checkin_url": "https://www.delta.com/PCCOciWeb/findBy.action"
  	    }
      }
    }
	};
  handler.sendAnyMessage(message);
}

function sendSingleActivity() {
  const message = {
    recipient: {
      id: fbid
    },
    message: {
      attachment: {
        "type": "template",
        payload: {
          template_type: "generic",
          elements: [{
              "title": "Your Emirates Flight EK205 leaves at 4.10 p.m. tomorrow",
              "subtitle": "Time to check-in",
              "default_action": {
                "type": "web_url",
                "url": "https://flightaware.com/live/flight/EK205",
                "webview_height_ratio": "full"
              },
            buttons: [{
              "title": "Flight details",
              "type": "postback", 
              "payload": "flight itinerary"
            }]
          }]
        }
      }
    }
  };
  handler.sendAnyMessage(message);
}

function sendFeatureMessage() {
  const message = {
    recipient: {
      id: fbid
    },
    message: {
      attachment: {
        "type": "template",
        payload: {
          top_element_style: "compact",
          template_type: "list",
          elements: [
					{
            "title": "Feature Alert",
            "subtitle": `Add details to your itinerary with the "trip calendar" command`
          },
          {
            "title": "Feature Alert",
            "subtitle": `See a specific day's itinerary by entering a travel day. Eg. "25", "26th" etc.`
          }
					]
        }
      }
    }
  };
  handler.sendAnyMessage(message);
}

function sendRecommendationAlert() {
  const message = {
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
            "title": "Alert: We have added plans for tomorrow",
            "subtitle": `Type 20th or "tomorrow" to see our recommendations`
          },
					]
        }
      }
    }
  };
  handler.sendAnyMessage(message);
}

function sendNewFeatureMessage() {
  const message = {
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
            "title": "New Feature Alert: We have added running trail recommendations",
            "subtitle": `See trails near your Salt Lake City hotel with commands: "running" or "trails"`
          },
					]
        }
      }
    }
  };
  handler.sendAnyMessage(message);
  // handler.sendMultipleMessages(fbid, messageList);
}

function sendDailyMessage() {
	const trip = new TripData("port_moresby", fbid);
  const commands = new Commands(trip, fbid);
  const message = commands.handle("today");
  const messageList = [];
  messageList.push(handler.getTextMessageData(fbid,`Good morning ${name}! It's going to be partly sunny today at Goroka and 80°F. Your day's itinerary`));
  messageList.push(message);
  handler.sendMultipleMessages(fbid, messageList);
}

function sendGoodMorningMessage() {
	const trip = new TripData("salt_lake_city", fbid);
  const commands = new Commands(trip, fbid);
  const secondSet = [
      {
        "title": "7:00 p.m. Drive to Enterprise car rental at airport",
        "subtitle": "16 minute drive from Airbnb. Click for directions",
        "default_action": {
          "type": "web_url",
          "url": "https://goo.gl/maps/sptUmb5n6tA2",
          "webview_height_ratio": "full"
        },
        "buttons": [{
          "title": "Rental car details",
          "type": "postback", 
          "payload": "car details"
        }]
      },
      {
        "title": "Flight DL2022 departs SLC at 8:46 p.m.",
        "subtitle": "Click for flight status",
        "default_action": {
          "type": "web_url",
          "url": "https://flightaware.com/live/flight/DL2022",
          "webview_height_ratio": "full"
        },
        "buttons": [{
          "title": "Flight details",
          "type": "postback", 
          "payload": "return flight"
        }]
      }
  ];
  const messageList = [];
  messageList.push(handler.getTextMessageData(fbid,`Good evening ${name}! Good news! It's going to be mostly sunny today. Here is your day's itinerary for Port Moresby`));
  messageList.push(message);
  handler.sendMultipleMessages(fbid, messageList);
}

function sendAddedNewTripMessage() {
	const trip = new TripData("keflavik", fbid);
  const commands = new Commands(trip, fbid);
  const messageList = [];
  messageList.push(handler.getTextMessageData(fbid, `Hi ${name}, we have added your trip to "Keflavik". Check it out. Type "commands" or "help" to see supported commands.`));
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
            "title": "Trip details",
            "buttons": [
            {
              "title": "Keflavik",
              "type": "postback",
              "payload": "trip_in_context keflavik"
            }]
          }]
        }
      }
    }
  });
  handler.sendMultipleMessages(fbid, messageList);
}

function sendExpenseAndFeedbackRequest() {
  const trip = new TripData("milan", fbid);
  const messageList = [];
  messageList.push(handler.getTextMessageData(fbid, `Hope you had a great time at Milan ${name}. Your total expenses (that Polaama knows about) is $3714/-`));
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
            "title": "Can you take a quick survey?",
            "subtitle": "We appreciate your feedback. Click to begin",
            "default_action": {
              "type": "web_url",
              "url": "https://madhu85.typeform.com/to/S9SnZi",
              "webview_height_ratio": "full"
            }
          }]
        }
      }
    }
  });
  handler.sendMultipleMessages(fbid, messageList);
}

function sendTodoReminders() {
  const myHandler = new WebhookPostHandler(session);
  myHandler.sendReminderNotification();
}

const TravelSfoHandler = require('travel-sfo-handler');
function sendToTravelSfoPage() {
  const myHandler = new WebhookPostHandler(session, false, TravelSfoHandler.pageId);
  const message = new TravelSfoHandler().sendReviewRequest(fbid);
  console.log(`message is ${JSON.stringify(message)}`);
  myHandler.sendAnyMessage(message);
}

function sendMessage(fbid, message, pageId) {
  if(!fbid) throw new Error("Required parameter 'fbid' is missing");
  if(!message) throw new Error("Required parameter 'message' is missing");
  if(!pageId) throw new Error("Required parameter 'pageId' is missing");
  const readline = require('readline-sync');
  let _name = FbidHandler.get().getName(fbid);
  if(!_name) _name = ""; else _name = _name.substring(0, _name.indexOf(" "));
  const proceed = readline.question(`Send message to ${_name}? [Y/N] `);
  if(proceed !== 'Y' && proceed !== 'y') {
    console.log(`Doing nothing`);
    return process.exit(0);
  }
  console.log(`Sending message to ${_name}`);
  const session = Sessions.get().find(fbid);
  if(!session) throw new Error(`could not find session for fbid ${fbid}`);
  const handler = new WebhookPostHandler(session, false, pageId);
  if(typeof message === "string") message = handler.getTextMessageData(fbid, message);
  handler.sendAnyMessage(message);
}

function sendActionReqdMessage(fbid, pageId) {
  if(!fbid) throw new Error("Required parameter 'fbid' is missing");
  if(!pageId) throw new Error("Required parameter 'pageId' is missing");
  const mesg = `See "seaspray cruises" inbox for question.`;
  const customerFbid = "2094354410590999";
  let messageToAdmin = {
    elements: [
      {
        title: "ACTION REQD",
        subtitle: `Question from customer ${FbidHandler.get().getName(customerFbid)}`
      },
      {
        title: "Question",
        subtitle: mesg
      }
    ],
  };
  messageToAdmin.fbid = fbid;
  sendMessage(fbid, FBTemplateCreator.list(messageToAdmin), pageId);
}
// 1335132323276529 -- Madhu's SeasprayCruise PSID
const seasprayFbid = "2027049770646124"; // PSID of the "person" Sea Spray Cruises (https://www.facebook.com/profile.php?id=100002761977341&sk=friends_mutual)
sendActionReqdMessage(seasprayFbid, PageHandler.seaSprayPageId);
