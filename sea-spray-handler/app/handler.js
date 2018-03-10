'use strict';
const baseDir = '/home/ec2-user';
const logger = require(`${baseDir}/my-logger`);
const FBTemplateCreator = require(`${baseDir}/fb-template-creator`);
const Classifier = require('sea-spray-handler/app/dialogflow-classifier');
const moment = require('moment');
const PageHandler = require('fbid-handler/app/page-handler');
const Promise = require('promise');

const year = moment().year();
const month = moment().month() + 1;

/* 
  A business-logic class that holds all business logic associated with the "Sea Spray" business. This is a prototype for all future businesses, which should implement the methods implemented by this class and return business specific information.
  This class will be passed to ~/business-pages-handler/app/base-handler.js, which will then call the methods implemented here as needed. 
  NOTE: ALL BUSINESS SPECIFIC CLASSES WILL HAVE TO IMPLEMENT THE instance METHODS IMPLEMENTED BY THIS CLASS.
*/

function SeaSprayHandler(testing) {
  this.classifier = new Classifier();
  this.name = "Sea Spray";
  const seasprayAdminId = "2027049770646124"; // id of the "person" Sea Spray Cruises (https://www.facebook.com/profile.php?id=100002761977341)
  this.adminIds = [this.madhusPageScopedFbid(), seasprayAdminId];
  this.businessPageId = PageHandler.seaSprayPageId;
  this.testing = testing;
}

SeaSprayHandler.prototype.handleBusinessSpecificCategories = function(fbid, category, tourName) {
  if(category === "passenger-count") return passengerCount(fbid);
  if(category === "location") return location(fbid);
  if(category === "hotel-transfers") return hotelTransfer(fbid);
  if(category === "available-tours") return bookTours(fbid);
  if(category === "customer-service") return customerService(fbid);
  if(category === "large-group-discounts") return largeGroupDiscounts(fbid);
  if(category === "operating-season") return operatingSeason(fbid);
  if(category === "kids-allowed") return kidsAllowed(fbid);
  if(category === "infant-charges") return infantCharges(fbid);
  if(category === "customized-tour") return customizedTours(fbid);
  if(category === "book-tour") return bookTours(fbid);
  if(category === "bad-weather") return badWeatherPolicy(fbid);
  if(category === "advance-booking") return advanceBooking(fbid);
  if(category === "operating-tours") return bookTours(fbid);
  if(category === "operating-hours") return operatingHours(fbid);
  if(category === "tour-recommendation") return tourRecommendation(fbid);
  if(category === "entity-name") return selectResponseForTour(tourName, category, fbid);
  // if response is still null, handle categories that have information based on tour type: "operating-days", "food-options", "cruise-details", "cost-of-tour"
  return selectResponseForTour(tourName, category, fbid);
}

SeaSprayHandler.prototype.greeting = function(fbid) {
  let messageList = [];
  messageList.push(FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "Welcome to Sea Spray cruises. How can I help you today?",
      subtitle: "I am a chat bot who can answer questions about our awesome cruises at St.Lucia",
      image_url: "http://tinyurl.com/y8v9ral5"
    }]
  }));
  messageList = messageList.concat(commonQuestionsButtons(fbid));
  return messageList;
}

SeaSprayHandler.prototype.pageDetails = function() {
  return {
    title: "Message from Sea Spray",
    image_url: "http://tinyurl.com/y8v9ral5",
    buttons: [{
      title: "Contact details",
      type: "postback",
      payload: "sea_spray_contact"
    }]
  };
}

SeaSprayHandler.prototype.handleBusinessSpecificPayload = function(payload, fbid) {
  if(payload === "sea_spray_contact") return customerService(fbid);
  if(payload === "sea_spray_book_tour") return bookTours(fbid);
  if(payload === "sea_spray_tout_bagay_operating_days") return toutBagayDays(fbid);
  if(payload === "sea_spray_pirate_days_operating_days") return piratesDay(fbid);
  if(payload === "sea_spray_sunset_cruise_operating_days") return sunsetCruiseDays(fbid);
  if(payload === "sea_spray_bad_weather") return badWeatherPolicy(fbid);
  if(payload === "sea_spray_advance_booking") return advanceBooking(fbid);
  if(payload === "sea_spray_group_discount") return largeGroupDiscounts(fbid);
  if(payload === "sea_spray_hotel_transfer") return hotelTransfer(fbid);
  if(payload === "sea_spray_common_questions") return commonQuestionsButtons(fbid);
  if(payload.startsWith("select_tour")) return selectResponseForTour(payload, null, fbid);
  // no business logic to handle this payload.
  return null;
}

SeaSprayHandler.prototype.madhusPageScopedFbid = function() {
  return "1335132323276529";
}

// convenience function that handles selecting the right functions given a tour and the category. This is used in cases where a particular categories' response depends on the tour selected. This also handles the case where no tour is selected (setting state, calling chooseTour) and handling case where state might be set.
function selectResponseForTour(tour, category, fbid) {
  const functions = {
    'tout_bagay': {
      'food-options': toutBagayFood,
      'operating-days': toutBagayDays,
      'cruise-details': toutBagayDetails,
      'cost-of-tour': toutBagayCost,
      'tour-start-time': toutBagayDetails,
      'things-to-do-and-see': toutBagayDetails,
      'entity-name': toutBagayDetails,
    },
    'sunset_cruise': {
      'food-options': sunsetCruiseFood,
      'operating-days': sunsetCruiseDays,
      'cruise-details': sunsetCruiseDetails,
      'cost-of-tour': sunsetCruiseCost,
      'tour-start-time': sunsetCruiseDetails,
      'things-to-do-and-see': sunsetCruiseDetails,
      'entity-name': sunsetCruiseDetails,
    },
    'pirate_day': {
      'food-options': piratesDayFood,
      'operating-days': piratesDay,
      'cruise-details': piratesDayDetails,
      'cost-of-tour': piratesDayCost,
      'tour-start-time': piratesDayDetails,
      'things-to-do-and-see': piratesDayDetails,
      'entity-name': piratesDayDetails,
    },
    'private_charter': {
      'food-options': privateCharterFood,
      'operating-days': privateCharterOperatingDays,
      'cruise-details': privateCharterDetails,
      'cost-of-tour': privateCharterCost,
      'tour-start-time': privateCharterDetails,
      'things-to-do-and-see': privateCharterDetails,
      'entity-name': privateCharterDetails,
    }
  };
  functions["Pirate Day's Cruise"] = functions.pirate_day;
  functions["Sunset cruise"] = functions.sunset_cruise;
  functions["Tout Bagay Cruise"] = functions.tout_bagay;
  functions["Private charter"] = functions.private_charter;

  // if no tour was provided, ask for that information.
  if(!tour || tour.length === 0) {
    // this might be because of two reasons. Either the user did not enter the right entity for a given category or we don't yet support that category. If it's the latter, return null.
    const categoryKeys = Object.keys(functions.tout_bagay); // We assume that Tout Bagay will always be a super-set for the categories
    if(categoryKeys.includes(category)) return chooseTours(fbid, category);
    return null;
  }
  if(tour.includes(":")) {
    // this is passed from handlePostback. Assert invariants before proceeding.
    if(category) throw new Error(`selectResponseForTour: Potential BUG: tour contains a ":" (${tour}), but category is also present (${category}). Confused!`);
    const list = tour.split(":");
    if(!list || list.length !== 3) throw new Error(`selectResponseForTour: invalid tour name passed. Expected it to be a real tour name passed by dialog flow or of the form <tourName>:<category>. But the value is <${tour}>`);
    tour = list[1]; // list[0] is "select_tour"
    category = list[2];
  }
  // logger.debug(`selectResponseForTour: tour ${tour} & category ${category}`);
  if(tour && category && functions[tour][category]) return functions[tour][category](fbid);
  // The base-handler class will correctly handle this error and send an appropriate message to the customer. 
  throw new Error(`selectResponseForTour: Potential BUG: Cannot find the right function to call for tour ${tour} & category <${category}>`);
}

function sunsetCruiseFood(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "We serve finger food and drinks in the Sunset cruise",
      subtitle: "Beer is available for purchase",
      image_url: "http://tinyurl.com/y8cfqjla",
      buttons: bookSunsetCruiseButton()
    }]
  });
}

function piratesDayFood(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "We serve buffet lunch and drinks on the Pirate's cruise",
      subtitle: "Beer is available for purchase",
      image_url: "http://tinyurl.com/ybxwcufb",
      buttons: bookPiratesDayButton()
    }]
  });
}

function privateCharterFood(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "Buffet lunch can be requested on Private charters",
      subtitle: "We serve drinks and beer at no extra charge",
      image_url: "https://seaspraycruises.com/wp-content/uploads/2016/12/fishing02-560x460.jpg",
      buttons: bookPrivateCharterButton()
    }]
  });
}

function toutBagayFood(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "We serve buffet lunch and drinks at the Tout Bagay cruise",
      subtitle: "Beer is available at no extra charge!",
      image_url: "http://tinyurl.com/y8486a92",
      buttons: bookToutBagayButton()
    }]
  });
}

function customizedTours(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "We are flexible and can customize tours to suit your requests",
      subtitle: "Do let us know beforehand so we can plan accordingly",
      buttons: [{
        title: "Contact details",
        type: "postback",
        payload: "sea_spray_contact"
      }]
    }],
  });
}

function kidsAllowed(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "Kids of all ages can enjoy our tours",
      subtitle: "Children under 2 travel for free",
      buttons: [{
        title: "Tour options",
        type: "postback",
        payload: "sea_spray_book_tour"
      }]
    }],
  });
}

function infantCharges(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "There is no charge for children under 2",
      subtitle: "They participate for free",
      buttons: [{
        title: "Tour options",
        type: "postback",
        payload: "sea_spray_book_tour"
      }]
    }],
  });
}

function operatingSeason(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "We operate year round.",
      subtitle: "St. Lucia is beautiful year round. So, visit us anytime!",
      buttons: [{
        title: "Tour options",
        type: "postback",
        payload: "sea_spray_book_tour"
      }]
    }],
  });
}

function customerService(fbid) {
  return FBTemplateCreator.list({
    fbid: fbid,
    elements: [{
      title: "Sea Spray cruises",
      subtitle: "Contact details",
      image_url: "http://tinyurl.com/y8v9ral5"
    }, {
      title: "Our phone numbers: +1-758-458-0123, +1-758-452-8644",
      subtitle: "US residents: +1-321-220-9423",
      buttons: [{
          type: "phone_number",
          title: "Call us",
          payload: "+13212209423"
      }]
    }, {
      title: "Hours (UTC-04:00 timezone)",
      subtitle: "Mon-Sat: 8 a.m. - 5 p.m."
    }, {
      title: "Email",
      subtitle: "info@seaspraycruises.com"
    }]
  });
}

function sunsetCruiseDays(fbid) {
    const year = moment().year();
    const month = moment().month() + 1;
    return FBTemplateCreator.list({
      fbid: fbid,
      elements: [{
        title: "Sunset Cruise",
        subtitle: "Operating hours",
        image_url: "http://tinyurl.com/y8cfqjla"
      }, {
        title: "Operates every Tuesday and Friday", 
        subtitle: "Email us. We sometimes add extra days",
      },{
        title: "Hotel pickup times vary",
        subtitle: "When booking, tell us your stay details"
      }],
      buttons: [{
        title: "Book Sunset cruise",
        type: "web_url",
        webview_height_ratio: "full",
        url: `https://fareharbor.com/embeds/book/seaspraycruises/items/35419/calendar/${year}/${month}/?full-items=yes`
      }]
    });
}

function piratesDay(fbid) {
    return FBTemplateCreator.list({
      fbid: fbid,
      elements: [{
        title: "Pirate Day's Adventure Cruise",
        subtitle: "Operating hours",
        image_url: "http://tinyurl.com/ybxwcufb",
      }, {
        title: "Every Tuesday and Friday, 5 p.m. - 7 p.m.", 
        subtitle: "Email us. We sometimes add extra days",
      },{
        title: "Hotel pickup times vary",
        subtitle: "When booking, tell us your stay details"
      }],
      buttons: [{
        title: "Book Pirate Day's cruise",
        type: "web_url",
        webview_height_ratio: "full",
        url: `https://fareharbor.com/embeds/book/seaspraycruises/items/35420/calendar/${year}/${month}/?full-items=yes`
      }]
    });
}

function toutBagayDays(fbid) {
    return FBTemplateCreator.list({
      fbid: fbid,
      elements: [{
        title: "Tout Bagay Cruise",
        subtitle: "Our MOST popular tour",
        image_url: "http://tinyurl.com/y8486a92",
      }, {
        title: "Operates every Monday, Wednesday and Saturday 8.30 a.m. - 5.00 p.m.",
        subtitle: "Email us. We sometimes add extra days",
      },{
        title: "Hotel pickup times vary",
        subtitle: "When booking, tell us your stay details"
      }],
      buttons: [{
        title: "Book Tout Bagay",
        type: "web_url",
        webview_height_ratio: "full",
        url: `https://fareharbor.com/embeds/book/seaspraycruises/items/35423/calendar/${year}/${month}/?full-items=yes`
      }]
    });
}

function chooseTours(fbid, category) {
  const list = [];
  list.push(FBTemplateCreator.text({
    fbid: fbid,
    text: "Which tour are you referring to?"
  }));
  list.push(FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "Tout Bagay Cruise",
      subtitle: "Our MOST popular tour. A guided historical tour along the west coast",
      image_url: "http://tinyurl.com/y8486a92",
      buttons: [{
        title: "Tout Bagay",
        type: "postback",
        payload: `select_tour:tout_bagay:${category}`
      }]
    }, {
      title: "Pirate Day's Adventure Cruise",
      subtitle: "Join Captain John-T and his buccaneers crew as they set sail for Soufriere, along the west coast",
      image_url: "http://tinyurl.com/ybxwcufb",
      buttons: [{
        title: "Pirate's Day",
        type: "postback",
        payload: `select_tour:pirate_day:${category}`
      }]
    }, {
      title: "Sunset Cruise",
      subtitle: "Come, seek the green flash",
      image_url: "http://tinyurl.com/y8cfqjla",
      buttons: [{
        title: "Sunset Cruise",
        type: "postback",
        // payload: "select_tour_sunset_cruise"
        payload: `select_tour:sunset_cruise:${category}`
      }]
    }, {
      title: "Private charter",
      subtitle: "Specially customized tours, just for you",
      image_url: "https://seaspraycruises.com/wp-content/uploads/2016/12/fishing02-560x460.jpg",
      buttons: [{
        title: "Private charter",
        type: "postback",
        // payload: "select_tour_private_charter"
        payload: `select_tour:private_charter:${category}`
      }]
    }]
  }));
  return list;
}

function operatingHours(fbid) {
  return FBTemplateCreator.list({
    fbid: fbid,
    compact_top_element_style: true,
    elements: [{
      title: "Our office is open Monday-Saturday 8 a.m - 5 p.m.",
      subtitle: "At the Rodney Bay marina. Click for google maps",
      image_url: "http://tinyurl.com/y8486a92",
      default_action: {
        type: "web_url",
        webview_height_ratio: "full",
        url: "https://goo.gl/maps/oR9zuaicnX92"
      },
    }, {
      title: "Email: info@seaspraycruises.com",
      subtitle: "Email us if you have any questions",
    }, {
      title: "Our phone numbers: +1-758-458-0123, +1-758-452-8644",
      subtitle: "US residents: +1-321-220-9423",
      buttons: [{
          type: "phone_number",
          title: "Call us",
          payload: "+13212209423"
      }]
    }],
    buttons:[{
      title: "Available tours",
      type: "postback",
      payload: "sea_spray_book_tour"
    }]
  });
}

function tourRecommendation(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "We recommend Tout Bagay, our most popular cruise",
      subtitle: "This is a guided historical tour along the west coast",
      image_url: "http://tinyurl.com/y8486a92",
      buttons: [{
        payload: "select_tour:tout_bagay:things-to-do-and-see",
        type: "postback",
        title: "Tout Bagay Details"
      }]
    }]
  });
}

function bookTours(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "Tout Bagay Cruise",
      subtitle: "Our MOST popular tour. A guided historical tour along the west coast",
      image_url: "http://tinyurl.com/y8486a92",
      buttons: bookToutBagayButton(fbid)
    }, {
      title: "Pirate Day's Adventure Cruise",
      subtitle: "Join Captain John-T and his buccaneers crew as they set sail for Soufriere, along the west coast",
      image_url: "http://tinyurl.com/ybxwcufb",
      buttons: bookPiratesDayButton()
    }, {
      title: "Sunset Cruise",
      subtitle: "Come, seek the green flash",
      image_url: "http://tinyurl.com/y8cfqjla",
      buttons: bookSunsetCruiseButton()
    }, {
      title: "All tours",
      subtitle: "Click to see all tours. We offer a variety of tours for everyone",
      image_url: "http://tinyurl.com/y8v9ral5",
      default_action: {
        type: "web_url",
        url: "https://seaspraycruises.com/st-lucia-tours/",
        webview_height_ratio: "full",
      },
      buttons: [{
        title: "Book tours",
        type: "web_url",
        webview_height_ratio: "full",
        url: "https://fareharbor.com/embeds/book/seaspraycruises/items/?full-items=yes"
      }]
    }]
  });
}

function badWeatherPolicy(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "In case of bad weather, you can reschedule",
      subtitle: "Or cancel at no charge",
      image_url: "http://tinyurl.com/y8ykdh4g",
      buttons: [{
        title: "Book cruises",
        type: "postback",
        payload: "sea_spray_book_tour"
      }]
    }]
  });
}

function largeGroupDiscounts(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "Each situation is different, so email or call us",
      subtitle: "We will do our best to meet your requests",
      image_url: "http://tinyurl.com/y8v9ral5",
      buttons: [{
        title: "Contact details",
        type: "postback",
        payload: "sea_spray_contact"
      }]
    }],
  });
}

function hotelTransfer(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "We offer transfers for all hotels in the NORTH of the island",
      image_url: "http://tinyurl.com/y8v9ral5",
      buttons: [{
        title: "Book cruises",
        type: "postback",
        payload: "sea_spray_book_tour"
      }]
    }],
  });
}

function advanceBooking(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "We recommend booking as early as possible",
      subtitle: "Popular cruises sell out fast. Tours are sold on a first-come first-serve basis",
      image_url: "http://tinyurl.com/y8v9ral5",
      buttons: [{
        title: "Book cruises",
        type: "postback",
        payload: "sea_spray_book_tour"
      }]
    }],
  });
}

function passengerCount(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "The number varies depending on the time of year",
      subtitle: "Bulk bookings can happen anytime, so it's difficult to predict an exact number",
      image_url: "http://tinyurl.com/y8v9ral5",
      buttons: [{
        title: "Book cruises",
        type: "postback",
        payload: "sea_spray_book_tour"
      }]
    }],
  });
}

function commonQuestionsButtons(fbid) {
  const messageList = [];
  messageList.push(FBTemplateCreator.text({
    fbid: fbid,
    text: "Here's a list of some commonly asked questions"
  }));
  messageList.push(FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "What tours do you operate?",
      image_url: "https://seaspraycruises.com/wp-content/uploads/2016/02/02-560x400.jpg",
      buttons: [{
        title: "Tour options",
        type: "postback",
        payload: "sea_spray_book_tour",
      }]
    },{
      title: "What days does the Tout Bagay tour operate?",
      image_url: "http://tinyurl.com/y8486a92",
      buttons: [{
        title: "Operating days",
        type: "postback",
        payload: "sea_spray_tout_bagay_operating_days"
      }]
    },{
      title: "What days does the Pirate Days tour operate?",
      image_url: "http://tinyurl.com/ybxwcufb",
      buttons: [{
        title: "Operating days",
        type: "postback",
        payload: "sea_spray_pirate_days_operating_days"
      }]
    },{
      title: "What days does the Sunset cruise operate?",
      image_url: "http://tinyurl.com/y8cfqjla",
      buttons: [{
        title: "Operating days",
        type: "postback",
        payload: "sea_spray_sunset_cruise_operating_days"
      }]
     },{
        title: "What is your Bad weather policy?",
        image_url: "http://tinyurl.com/y8ykdh4g",
        buttons: [{
          title: "Bad Weather details",
          type: "postback",
          payload: "sea_spray_bad_weather"
       }]
     },{
        title: "Is Advance booking required?",
        image_url: "http://tinyurl.com/yd7oa8uj",
        buttons: [{
          title: "Our recommendation",
          type: "postback",
          payload: "sea_spray_advance_booking"
       }]
     },{
        title: "Which hotels do you transfer from?",
        image_url: "http://tinyurl.com/y942m5w5",
        buttons: [{
          title: "Hotel transfer",
          type: "postback",
          payload: "sea_spray_hotel_transfer"
       }]
    }]
  }));
  return messageList;
}

function location(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "We are located at Rodney Bay Marina",
      subtitle: "click to see us on google maps",
      image_url: "http://tinyurl.com/yd7oa8uj",
      default_action: {
        type: "web_url",
        webview_height_ratio: "full",
        url: "https://goo.gl/maps/oR9zuaicnX92"
      },
      buttons: [{
          title: "All tours",
          type: "postback",
          payload: "sea_spray_book_tour"
      }]
    }]
  });
}

function bookToutBagayButton(fbid) {
  return [{
    title: "Book Tout Bagay",
    type: "web_url",
    webview_height_ratio: "full",
    url: `https://fareharbor.com/embeds/book/seaspraycruises/items/35423/calendar/${year}/${month}/?full-items=yes`
  }];
}

function toutBagayDetails(fbid) {
  return FBTemplateCreator.list({
    fbid: fbid,
    compact_top_element_style: true,
    elements: [{
      title: "Tout Bagay cruise operates from 8.30 a.m. - 5.00 p.m.",
      subtitle: "Monday, Wednesday and Friday",
      image_url: "http://tinyurl.com/y8486a92",
    }, {
      title: "Cost: Adults US $110; Children (2 to 12) US $55. 10% VAT tax applies",
      subtitle: "Add US $55 for ziplining or horse riding (optional)",
    }, {
      title: "Mud Baths, Soufriere Waterfall, Sulphur Springs, Morne Coubaril Estate", 
      subtitle: "Marigot, West Coast Beach for swimming or snorkelling",
      default_action: {
        type: "web_url",
        webview_height_ratio: "full",
        url: "https://seaspraycruises.com/tours/tout-bagay/"
      },
    }, {
      title: "Local Creole buffet lunch served at Morne Coubaril Estate",
      subtitle: "Beer, rum punch, rum mixes, fruit-punch, sodas, water"
    }],
    buttons: bookToutBagayButton()
  });
}

function bookPrivateCharterButton() {
  return [{
    title: "Book Private cruise",
    type: "web_url",
    webview_height_ratio: "full",
    url: `https://fareharbor.com/embeds/book/seaspraycruises/items/35425/calendar/${year}/${month}/?flow=4916`
  }];
}

function privateCharterOperatingDays(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "Private charters can be customized according to your needs",
      subtitle: "Contact us so we can create an amazing experience for you!",
      image_url: "https://seaspraycruises.com/wp-content/uploads/2016/12/fishing02-560x460.jpg",
      buttons: [{
        title: "Contact details",
        type: "postback",
        payload: "sea_spray_contact"
      }]
    }]
  });
}

function privateCharterDetails(fbid) {
  return FBTemplateCreator.list({
    fbid: fbid,
    compact_top_element_style: true,
    elements: [{
      title: "Have a special reason to celebrate? Or just looking to explore the island privately?",
      subtitle: "We can plan an engaging & exciting trip just for you",
      image_url: "https://seaspraycruises.com/wp-content/uploads/2016/12/fishing02-560x460.jpg",
    },
    {
      title: "Our options include Speedboat Bar hop, Piton hike & Sail",
      subtitle: "Full day private west coast sail, Private sunset cruise etc.",
      buttons: [{
        title: "See all options",
        type: "web_url",
        url: "https://seaspraycruises.com/st-lucia-private-tours/",
        webview_height_ratio: "full",
      }],
    },
    {
      title: "Dont find what you are looking for",
      subtitle: "Just contact us and we will arrange it for you!",
    }, {
      title: "Private charters start times vary",
      subtitle: "We will provide all the details when you book a charter",
    }],
    buttons: [{
      title: "Contact details",
      type: "postback",
      payload: "sea_spray_contact"
    }]
  });
}

function privateCharterCost(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "Individual and group pricings varies on our customizable private tours",
      subtitle: "Contact us with details and we will send you a quote",
      image_url: "https://seaspraycruises.com/wp-content/uploads/2016/12/fishing02-560x460.jpg",
      buttons: [{
        title: "Contact details",
        type: "postback",
        payload: "sea_spray_contact"
      }]
    }]
  });
}

function toutBagayCost(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "Cost: Adults US $110; Children (2 to 12) US $55. 10% VAT tax applies",
      subtitle: "Add US $55 for ziplining or horse riding (optional)",
      image_url: "http://tinyurl.com/y8486a92",
      buttons: bookToutBagayButton()
    }]
  });
}

function bookPiratesDayButton() {
  return [{
    title: "Book Pirate's day cruise",
    type: "web_url",
    webview_height_ratio: "full",
    url: `https://fareharbor.com/embeds/book/seaspraycruises/items/35420/calendar/${year}/${month}/?full-items=yes`
  }];
}

function piratesDayCost(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "Cost: Adults US $110; Children (2 to 12) US $50",
      subtitle: "A 10% VAT tax applies. Children under 2 travel for free",
      image_url: "http://tinyurl.com/ybxwcufb",
      buttons: bookPiratesDayButton()
    }]
  });
}

function piratesDayDetails(fbid) {
  return FBTemplateCreator.list({
    fbid: fbid,
    compact_top_element_style: true,
    elements: [{
      title: "Pirate's Day cruise operates from 8.30 a.m. - 4.00 p.m.",
      subtitle: "Suitable for the whole family",
      image_url: "http://tinyurl.com/ybxwcufb",
    }, {
      title: "Cost: Adults US $110; Children (2 to 12) US $50",
      subtitle: "A 10% VAT tax applies. Children under 2 travel for free",
    }, {
      title: "Diamond Waterfall & Botanical Gardens, Drive-in Volcano, Marigot Bay",
      subtitle: "Face painting, games and cannon-firing. Pirate kits available.",
      default_action: {
        type: "web_url",
        webview_height_ratio: "full",
        url: "https://seaspraycruises.com/tours/pirates-day/",
      },
    }, {
      title: "Local Buffet Lunch for Adults, Hot Dogs and chips for Kids",
      subtitle: "Rum punch, fruit-punch, sodas, water. Beer available for sale"
    }],
    buttons: bookPiratesDayButton()
  });
}

function bookSunsetCruiseButton() {
  return [{
    title: "Book Sunset cruise",
    type: "web_url",
    webview_height_ratio: "full",
    url: `https://fareharbor.com/embeds/book/seaspraycruises/items/35419/calendar/${year}/${month}/?full-items=yes`
  }];
}

function sunsetCruiseCost(fbid) {
  return FBTemplateCreator.generic({
    fbid: fbid,
    elements: [{
      title: "Adults: US $60; Children (2 to 12): US $30",
      subtitle: "A 10% VAT tax applies. Children under 2 travel for free",
      image_url: "http://tinyurl.com/y8cfqjla",
      buttons: bookSunsetCruiseButton()
    }]
  });
}

function sunsetCruiseDetails(fbid) {
  return FBTemplateCreator.list({
    fbid: fbid,
    compact_top_element_style: true,
    elements: [{
      title: "Sunset cruise operates Tuesday and Friday",
      subtitle: "At 5.00 - 7.00 p.m.",
      image_url: "http://tinyurl.com/y8cfqjla",
    }, {
      title: "Cost: Adults US $60; Children (2 to 12) US $30",
      subtitle: "A 10% VAT tax applies. Children under 2 travel for free",
    }, {
      title: "You will see Various sites of interest on the western coast line",
      subtitle: "such as Pigeon Island and other attractions",
      image_url: "https://slunatrust.org/assets/content/site/slnt-site-DUMMY-1.png",
      default_action: {
        type: "web_url",
        webview_height_ratio: "full",
        url: "https://seaspraycruises.com/tours/sunset-cruise/"
      },
    }, {
      title: "We serve drinks (like Champagne, Rum punch/mixes) and Hors d’oeuvres",
      subtitle: "Other drinks: Fruit-punch, sodas, water. Beer is available for sale"
    }],
    buttons: bookSunsetCruiseButton()
  });
}

module.exports = SeaSprayHandler;
