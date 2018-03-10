'use strict';
const expect = require('chai').expect;
const SeaSprayPrototypeHandler = require('sea-spray-handler/app/prototype-handler');
const SeaSprayHandler = require('sea-spray-handler/app/handler');
const PageHandler = require('fbid-handler/app/page-handler');
const baseDir = '/home/ec2-user';
const logger = require(`${baseDir}/my-logger`);
logger.setTestConfig(); // indicate that we are logging for a test
const BaseHandler = require('business-pages-handler/app/base-handler');

const myFbid = "1234";
let handler;
let pageId;
function commonBeforeEach() {
  handler = new BaseHandler(new SeaSprayPrototypeHandler(true /* testing */));
  pageId = handler.businessPageId;
}

function handlePromise(promise, expectedCategory, done, customVerification, last) {
    promise.done(
      function(response) {
        try {
          // logger.debug(`verifying  category: ${expectedCategory}`);
          // logger.debug(JSON.stringify(response));
          expect(response.category).to.equal(expectedCategory);
          expect(response.message).is.not.undefined;
          // logger.debug(JSON.stringify(response.message));
          if(customVerification && typeof customVerification === "function") customVerification(response);
          if(customVerification && typeof customVerification === "boolean") done();
          if(last) done();
          // logger.debug(`session state: ${handler.adminMessageSender.sentMessageToAdmin[myFbid]}`);
        }
        catch(e) {
          logger.error(`handlePromise: Error ${e.stack}`);
          // TODO: Even if we call done(e) here, this test will pass as long as the "done()" above gets called. Fix it.
          done(e);
        }
      },
      function(err) {
        done(err);
      }
    );
}

function verifyState(promise, expectedValue, done) {
  promise.done(
    (value) => {
      try { 
        if(!expectedValue) expect(value).to.be.undefined;
        if(typeof expectedValue === "boolean") expect(value).to.be.true;
        if(typeof expectedValue === "object") expect(value).not.be.undefined;
      }
      catch(e) {
        done(e);
      }
    },
    (err) => {
      done(err);
  });
}


describe("sea spray categories", function() {
  beforeEach(function() {
    commonBeforeEach();
  });

  it("greeting", function(done) {
    let response = handler.handleText("Hi", pageId, myFbid);
    const verify = function(response) {
      expect(response.message.length).to.equal(3);
      expect(response.message[0].message.attachment.payload.template_type).to.equal("generic");
    }
    handlePromise(response, "greeting", done, verify);
    // logger.debug(JSON.stringify(response.message));
    response = handler.handleText("Hola", pageId, myFbid);
    handlePromise(response, "greeting", done, verify);
    response = handler.handleText("Hiya", pageId, myFbid);
    handlePromise(response, "greeting", done, verify);
    response = handler.handleText("Howdy", pageId, myFbid);
    handlePromise(response, "greeting", done, verify);
    response = handler.handleText("Hi. How are you?", pageId, myFbid);
    handlePromise(response, "greeting", done, verify);
    response = handler.handleText("Hi. How do you do?", pageId, myFbid);
    handlePromise(response, "greeting", done, verify, true);
  });

  it("farewell", function(done) {
    let response = handler.handleText("Bye", pageId, myFbid);
    handlePromise(response, "farewell", done);
    response = handler.handleText("ok. talk to you later", pageId, myFbid);
    handlePromise(response, "farewell", done);
    response = handler.handleText("ok. talk to you later", pageId, myFbid);
    handlePromise(response, "farewell", done);
    response = handler.handleText("see you later", pageId, myFbid);
    handlePromise(response, "farewell", done);
    response = handler.handleText("ok. talk to you later", pageId, myFbid);
    response = handler.handleText("later", pageId, myFbid);
    handlePromise(response, "farewell", done);
    response = handler.handleText("ok. talk to you later", pageId, myFbid);
    handlePromise(response, "farewell", done, true);
  });

  it("operating hours", function(done) {
    let response = handler.handleText("Are you open now?", pageId, myFbid);
    const verify = function(response) {
      const message = response.message;
      expect(message.message.attachment.payload.template_type).to.equal("list");
      expect(message.message.attachment.payload.elements[0].title).to.contain("Our office is open");
      expect(message.message.attachment.payload.elements[2].title).to.contain("Our phone numbers");
    };
    handlePromise(response, "operating-hours", done, verify, true);
  });

  it("operating days no tour", function(done) {
    let promise = handler.handleText("what time does the tour operate?", pageId, myFbid);
    promise.then(
      function(result) {
        expect(result.category).to.equal("operating-days");
        const mesgList = result.message;
        expect(mesgList.length).to.equal(2);
        // logger.debug(JSON.stringify(mesgList));
        expect(mesgList[0].message.text).is.not.undefined;
        return handler.handlePostback("select_tour:sunset_cruise:operating-days", pageId, myFbid);
      },
      function(err) {
        return Promise.reject(err);
      }
    ).then(
      (message) => {
        expect(message.message.attachment.payload.template_type).to.equal("list");
        expect(message.message.attachment.payload.elements[0].title).to.contain("Sunset Cruise");
        return handler.handleText("when do tours operate?", pageId, myFbid);
      },
      (err) => {
        return Promise.reject(err);
    }).done(
      function(result) {
        expect(result.category).to.equal("operating-days");
        const mesgList = result.message;
        expect(mesgList.length).to.equal(2);
        done();
      },
      function(err) {
        done(err);
      }
    );
  });

  it("sunset operating days", function(done) {
    const verifier = function verifier(response) {
      const message = response.message;
      expect(message.message.attachment.payload.elements[0].title).to.contain("Sunset Cruise");
    };
    let response = handler.handleText("sunset cruise operating days", pageId, myFbid);
    handlePromise(response, "operating-days", done, verifier);
    response = handler.handleText("does sunset cruise run year-round", pageId, myFbid);
    handlePromise(response, "operating-days", done, verifier);
    response = handler.handleText("When do you operate sunset cruise", pageId, myFbid);
    handlePromise(response, "operating-days", done, verifier, true);
  });

  it("private charter operating days", function(done) {
    const verifier = function verifier(response) {
      const message = response.message;
      expect(message.message.attachment.payload.elements[0].title).to.contain("Private charters can be customized");
      expect(message.message.attachment.payload.elements[0].buttons[0].title).to.contain("Contact details");
    };
    let response = handler.handleText("When do you operate Private charters?", pageId, myFbid);
    handlePromise(response, "operating-days", done, verifier, true);
  });

  it("tout bagay operating days", function(done) {
    const verifier = function verifier(response) {
      const message = response.message;
      expect(message.message.attachment.payload.elements[0].title).to.contain("Tout Bagay Cruise");
    };
    let response = handler.handleText("tout bagay cruise operating season", pageId, myFbid);
    handlePromise(response, "operating-days", done, verifier);
    response = handler.handleText("tout bagay cruise operating days", pageId, myFbid);
    handlePromise(response, "operating-days", done, verifier);
    response = handler.handleText("does tout bagay cruise run year-round", pageId, myFbid);
    handlePromise(response, "operating-days", done, verifier);
    response = handler.handleText("When are you open for tout bagay tour?", pageId, myFbid);
    handlePromise(response, "operating-days", done, verifier, true);
  });

  it("pirate days operating days", function(done) {
    const verifier = function verifier(response) {
      const message = response.message;
      expect(message.message.attachment.payload.elements[0].title).to.contain("Pirate Day's Adventure");
    };
    let response = handler.handleText("When are you open for pirate's adventure cruise", pageId, myFbid);
    handlePromise(response, "operating-days", done, verifier);
    response = handler.handleText("pirate days adventure cruise operating hours", pageId, myFbid);
    handlePromise(response, "operating-days", done, verifier);
    response = handler.handleText("what days does the pirate cruise operate", pageId, myFbid);
    handlePromise(response, "operating-days", done, verifier, true);
  });

  it("bad weather", function(done) {
    let response = handler.handleText("bad weather", pageId, myFbid);
    handlePromise(response, "bad-weather", done);
    response = handler.handleText("how's the weather", pageId, myFbid);
    handlePromise(response, "bad-weather", done, true);
  });

  it("discounts", function(done) {
    const response = handler.handleText("large group discount", pageId, myFbid);
    handlePromise(response, "large-group-discounts", done, true);
  });

  it("hotel transfers", function(done) {
    let response = handler.handleText("i have a question about hotels", pageId, myFbid);
    handlePromise(response, "hotel-transfers", done);
    response = handler.handleText("which hotel do you transfer from", pageId, myFbid);
    handlePromise(response, "hotel-transfers", done, true);
  });

  it("advance booking", function(done) {
    const response = handler.handleText("do we have to reserve in advance", pageId, myFbid);
    handlePromise(response, "advance-booking", done, true);
  });

  it("passenger count", function(done) {
    let response = handler.handleText("passengers per boat", pageId, myFbid);
    handlePromise(response, "passenger-count", done);
    response = handler.handleText("how many people can go on sunset cruise", pageId, myFbid);
    handlePromise(response, "passenger-count", done);
    response = handler.handleText("maximum passengers in pirate's day", pageId, myFbid);
    handlePromise(response, "passenger-count", done, true);
  });

  it("good morning", function(done) {
    let promise = handler.handleText("good morning", pageId, myFbid);
    promise.done(
      (response) => {
        expect(response.message.message.text).to.equal("good morning");
        done();
      },
      (err) => {
        done(err);
    });
  });

  it("really long message greater than 255 characters", function(done) {
    const customerFbid = 432;
    let message = "a";
    for(let i = 0; i < 255; i++) {
      message = "a".concat(message);
    }
    let promise = handler.handleText(message, pageId, customerFbid);
    promise.then(
      (response) => {
        expect(response.message).is.not.undefined;
        verifyState(handler.adminMessageSender.stateManager.get(["messageSentToAdmin", customerFbid, message]), true, done);
        const mesgList = response.message;
        // logger.debug(`mesgList: ${JSON.stringify(mesgList)}`);
        expect(mesgList[0].message.text).to.equal("I have asked one of our crew members to help. We will get back to you asap.");
        return handler.handleText("second message", pageId, customerFbid);
      }, 
      (err) => {
        done(err);
    }).done(
      // verify that the second message sent by the same user is also sent to admin and the user does not see any message from the bot.
      (response) => {
        expect(response.message).is.not.undefined;
        verifyState(handler.adminMessageSender.stateManager.get(["messageSentToAdmin", customerFbid, "second message"]), true, done);
        const mesgList = response.message;
        expect(mesgList[0].message.attachment.payload.elements[1].title).to.include("Question");
        expect(mesgList[0].message.attachment.payload.elements[1].subtitle).to.include("second message");
        done();
      }, 
      (err) => {
        done(err);
    });
  });

  it("human", function(done) {
    let response = handler.handleText("want to talk to human", pageId, myFbid);
    handlePromise(response, "talk-to-human", done, true);
  });

  it("frustration", function(done) {
    let response = handler.handleText("You are not helping me!", pageId, myFbid);
    handlePromise(response, "frustration", done, true);
  });

  it("customer service", function(done) {
    let response = handler.handleText("contact details", pageId, myFbid);
    handlePromise(response, "customer-service", done);
    response = handler.handleText("customer contact details", pageId, myFbid);
    handlePromise(response, "customer-service", done);
    response = handler.handleText("customer service", pageId, myFbid);
    handlePromise(response, "customer-service", done);
    response = handler.handleText("i want to talk to customer service", pageId, myFbid);
    handlePromise(response, "customer-service", done);
    response = handler.handleText("contact customer service", pageId, myFbid);
    handlePromise(response, "customer-service", done, true);
  });

  it("input.unknown", function(done) {
    let response = handler.handleText("un understable message", pageId, myFbid);
    handlePromise(response, "input.unknown", done);

    response = handler.handleText("I lost my camera", pageId, myFbid);
    handlePromise(response, "input.unknown", done);
    response = handler.handleText("blah blee", pageId, myFbid);
    handlePromise(response, "input.unknown", done, true);
  });

  it("location", function(done) {
    let response = handler.handleText("where are you located", pageId, myFbid);
    handlePromise(response, "location", done);
    response = handler.handleText("are you located in the island", pageId, myFbid);
    handlePromise(response, "location", done, true);
  });

  it("operating season", function(done) {
    let response = handler.handleText("do you operate year round", pageId, myFbid);
    handlePromise(response, "operating-season", done);
    response = handler.handleText("do you close for any season", pageId, myFbid);
    handlePromise(response, "operating-season", done, true);
  });

  it("customized tour", function(done) {
    let response = handler.handleText("Can we customize tours based on our needs", pageId, myFbid);
    handlePromise(response, "customized-tour", done);
    response = handler.handleText("Do you offer private tours?", pageId, myFbid);
    handlePromise(response, "customized-tour", done);
    response = handler.handleText("Can we customize tours?", pageId, myFbid);
    handlePromise(response, "customized-tour", done, true);
  });

  it("kids allowed", function(done) {
    let response = handler.handleText("Can we bring kids of any age on the trip?", pageId, myFbid);
    handlePromise(response, "kids-allowed", done);
    // expect(response.message.message.attachment.payload.template_type).to.equal('generic');
    response = handler.handleText("Can we bring kids of all ages on the trip?", pageId, myFbid);
    handlePromise(response, "kids-allowed", done);
    // expect(response.message.message.attachment.payload.template_type).to.equal('generic');
    response = handler.handleText("Can I bring my 10 year old on the boat", pageId, myFbid);
    handlePromise(response, "kids-allowed", done);
    // expect(response.message.message.attachment.payload.template_type).to.equal('generic');
    response = handler.handleText("Are kids of all ages allowed?", pageId, myFbid);
    handlePromise(response, "kids-allowed", done, true);
    // expect(response.message.message.attachment.payload.template_type).to.equal('generic');
  });

  it("operating tours", function(done) {
    let response = handler.handleText("What tours do you operate?", pageId, myFbid);
    handlePromise(response, "operating-tours", done);
    response = handler.handleText("tours", pageId, myFbid);
    handlePromise(response, "operating-tours", done);
    response = handler.handleText("supported tours", pageId, myFbid);
    handlePromise(response, "operating-tours", done);
    response = handler.handleText("what tours are available", pageId, myFbid);
    handlePromise(response, "operating-tours", done, true);
  });

  it("infant charges", function(done) {
    let response = handler.handleText("I have a 2 year old. How much should I pay", pageId, myFbid);
    handlePromise(response, "infant-charges", done);
    response = handler.handleText("Do 2 year olds pay", pageId, myFbid);
    handlePromise(response, "infant-charges", done);
    response = handler.handleText("Do two year olds pay", pageId, myFbid);
    handlePromise(response, "infant-charges", done, true);
  });

  it("test appreciation", function(done) {
    const message = "Nice job..";
    let promise = handler.handleText(message, pageId, myFbid);
    // ensure that this is not a message that was sent to human being
    const verifier = function(response) {
        verifyState(handler.adminMessageSender.stateManager.get(["messageSentToAdmin", myFbid, message]), undefined, done);
        expect(response.message.message.text).to.include("Thanks! We are happy to answer any other questions you might have.");
    }
    handlePromise(promise, "appreciation", done, verifier, true);
  });

  it("test talk to human", function(done) {
    let response = handler.handleText("talk to human", pageId, myFbid);
    handlePromise(response, "talk-to-human", done, true);
  });

  it("test food options", function(done) {
    let response = handler.handleText("what food options do you have for pirate's day cruise?", pageId, myFbid);
    let verify = function(response) {
      expect(response.message.message.attachment.payload.elements[0].title).to.contain("buffet lunch and drinks on the Pirate's cruise");
    }
    handlePromise(response, "food-options", done, verify);
    response = handler.handleText("what food options do you have for tout bagay cruise?", pageId, myFbid);
    verify = function(response) {
      expect(response.message.message.attachment.payload.elements[0].title).to.contain("buffet lunch and drinks at the Tout Bagay cruise");
    }
    handlePromise(response, "food-options", done, verify);
    response = handler.handleText("what food options do you have for private charter?", pageId, myFbid);
    verify = function(response) {
      expect(response.message.message.attachment.payload.elements[0].title).to.contain("Buffet lunch can be requested");
    }
    handlePromise(response, "food-options", done, verify);
    response = handler.handleText("what food options do you have for sunset cruise?", pageId, myFbid);
    verify = function(response) {
      expect(response.message.message.attachment.payload.elements[0].title).to.contain("finger food and drinks");
    }
    handlePromise(response, "food-options", done, verify, true);
  });

  it("test details", function(done) {
    let response = handler.handleText("tout bagay details", pageId, myFbid);
    let verify = function(response) {
      expect(response.message.message.attachment.payload.template_type).to.equal("list");
      expect(response.message.message.attachment.payload.elements[0].title).to.contain("Tout Bagay cruise operates from 8.30 a.m. - 5.00 p.m.");
      expect(response.message.message.attachment.payload.elements[3].title).to.contain("Local Creole buffet lunch served at Morne Coubaril Estate");
    }
    handlePromise(response, "cruise-details", done, verify);
    response = handler.handleText("What does the pirate's day cruise entail?", pageId, myFbid);
    verify = function(response) {
      expect(response.message.message.attachment.payload.template_type).to.equal("list");
      expect(response.message.message.attachment.payload.elements[0].title).to.contain("Pirate's Day cruise operates from");
      expect(response.message.message.attachment.payload.elements[3].title).to.contain("Local Buffet Lunch for Adults,");
    }
    handlePromise(response, "cruise-details", done, verify);
    response = handler.handleText("details of private tours?", pageId, myFbid);
    verify = function(response) {
      // logger.debug(`response is ${JSON.stringify(response)}`);
      expect(response.message.message.attachment.payload.template_type).to.equal("list");
      expect(response.message.message.attachment.payload.elements[0].title).to.contain("Have a special reason to celebrate? Or just looking to explore the island privately?");
      expect(response.message.message.attachment.payload.elements[2].subtitle).to.contain("Just contact us and we will arrange it for you!");
    }
    handlePromise(response, "cruise-details", done, verify);
    response = handler.handleText("What does the sunset cruise include?", pageId, myFbid);
    verify = function(response) {
      expect(response.message.message.attachment.payload.template_type).to.equal("list");
      expect(response.message.message.attachment.payload.elements[0].title).to.contain("Sunset cruise operates from 5.00 - 7.00 p.m.");
      expect(response.message.message.attachment.payload.elements[3].title).to.contain("We serve drinks (like Champagne, Rum punch/mixes) and Hors d’oeuvres");
    }
    handlePromise(response, "cruise-details", done, verify, true);
  });

  it("test details no tour name present", function(done) {
    let promise = handler.handleText("Can you provide details of your tours?", pageId, myFbid);
    promise.then(
      function(result) {
        expect(result.category).to.equal("cruise-details");
        const mesgList = result.message;
        expect(mesgList.length).to.equal(2);
        expect(mesgList[0].message.text).is.not.undefined;
        return handler.handlePostback("select_tour:sunset_cruise:cruise-details", pageId, myFbid);
      },
      function(err) {
        return Promise.reject(err);
      }
    ).done(
      (message) => {
        expect(message.message.attachment.payload.template_type).to.equal("list");
        expect(message.message.attachment.payload.elements[0].title).to.contain("Sunset cruise operates from 5.00 - 7.00 p.m.");
        expect(message.message.attachment.payload.elements[3].title).to.contain("We serve drinks (like Champagne, Rum punch/mixes) and Hors d’oeuvres");
        done();
      },
      (err) => {
        done(err);
    });
  });

  it("test cost", function(done) {
    let response = handler.handleText("tout bagay cost", pageId, myFbid);
    let verify = function(response) {
      expect(response.message.message.attachment.payload.template_type).to.equal("generic");
      expect(response.message.message.attachment.payload.elements[0].title).to.contain("Cost: Adults US $110; Children (2 to 12) US $55");
    }
    handlePromise(response, "cost-of-tour", done, verify);
    response = handler.handleText("What's the cost of the sunset cruise?", pageId, myFbid);
    verify = function(response) {
      expect(response.message.message.attachment.payload.template_type).to.equal("generic");
      expect(response.message.message.attachment.payload.elements[0].title).to.contain("Adults: US $60; Children (2 to 12): US $30");
    }
    handlePromise(response, "cost-of-tour", done, verify);
    response = handler.handleText("Price of Pirate's day cruise", pageId, myFbid);
    verify = function(response) {
      expect(response.message.message.attachment.payload.template_type).to.equal("generic");
      expect(response.message.message.attachment.payload.elements[0].title).to.contain("Cost: Adults US $110; Children (2 to 12) US $50");
    }
    handlePromise(response, "cost-of-tour", done, verify, true);
  });

  it("test cost no tour name present", function(done) {
    let promise = handler.handleText("cost of tour", pageId, myFbid);
    promise.then(
      function(result) {
        expect(result.category).to.equal("cost-of-tour");
        const mesgList = result.message;
        expect(mesgList.length).to.equal(2);
        expect(mesgList[0].message.text).is.not.undefined;
        return handler.handlePostback("select_tour:tout_bagay:cost-of-tour", pageId, myFbid);
      },
      function(err) {
        return Promise.reject(err);
      }
    ).done(
      (message) => {
        expect(message.message.attachment.payload.template_type).to.equal("generic");
        expect(message.message.attachment.payload.elements[0].title).to.contain("Cost: Adults US $110; Children (2 to 12) US $55. 10% VAT tax applies");
        done();
      },
      (err) => {
        done(err);
    });
  });

  it("tour start time", function(done) {
    let response = handler.handleText("tout bagay start time", pageId, myFbid);
    let verify = function(response) {
      expect(response.message.message.attachment.payload.template_type).to.equal("list");
      expect(response.message.message.attachment.payload.elements[0].title).to.contain("Tout Bagay cruise operates from 8.30 a.m. - 5.00 p.m.");
      expect(response.message.message.attachment.payload.elements[3].title).to.contain("Local Creole buffet lunch served at Morne Coubaril Estate");
    }
    handlePromise(response, "tour-start-time", done, verify);
    response = handler.handleText("When does the Pirate's day cruise start?", pageId, myFbid);
    verify = function(response) {
      expect(response.message.message.attachment.payload.template_type).to.equal("list");
      expect(response.message.message.attachment.payload.elements[0].title).to.contain("Pirate's Day cruise operates from");
      expect(response.message.message.attachment.payload.elements[3].title).to.contain("Local Buffet Lunch for Adults,");
    }
    handlePromise(response, "tour-start-time", done, verify, true);
  });

  it("things to do and see", function(done) {
    let response = handler.handleText("what can we see in private tours?", pageId, myFbid);
    let verify = function(response) {
      // logger.debug(`response is ${JSON.stringify(response)}`);
      expect(response.message.message.attachment.payload.template_type).to.equal("list");
      expect(response.message.message.attachment.payload.elements[0].title).to.contain("Have a special reason to celebrate? Or just looking to explore the island privately?");
      expect(response.message.message.attachment.payload.elements[2].subtitle).to.contain("Just contact us and we will arrange it for you!");
    }
    handlePromise(response, "things-to-do-and-see", done, verify);
    response = handler.handleText("What can we see in the sunset cruise?", pageId, myFbid);
    verify = function(response) {
      expect(response.message.message.attachment.payload.template_type).to.equal("list");
      expect(response.message.message.attachment.payload.elements[0].title).to.contain("Sunset cruise operates from 5.00 - 7.00 p.m.");
      expect(response.message.message.attachment.payload.elements[3].title).to.contain("We serve drinks (like Champagne, Rum punch/mixes) and Hors d’oeuvres");
    }
    handlePromise(response, "things-to-do-and-see", done, verify, true);
  });

  it("test tour recommendation", function(done) {
    let response = handler.handleText("what tours would you recommend?", pageId, myFbid);
    let verify = function(response) {
      expect(response.message.message.attachment.payload.template_type).to.equal("generic");
      expect(response.message.message.attachment.payload.elements[0].title).to.contain("We recommend Tout Bagay, our most popular cruise");
    }
    handlePromise(response, "tour-recommendation", done, verify, true);
  });

  it("entity name", function(done) {
    let response = handler.handleText("tout bagay", pageId, myFbid);
    let verify = function(response) {
      // logger.debug(`response is ${JSON.stringify(response)}`);
      expect(response.message.message.attachment.payload.template_type).to.equal("list");
      expect(response.message.message.attachment.payload.elements[0].title).to.contain("Tout Bagay cruise operates from 8.30 a.m. - 5.00 p.m.");
      expect(response.message.message.attachment.payload.elements[2].subtitle).to.contain("Marigot, West Coast Beach for swimming or snorkelling");
    }
    handlePromise(response, "entity-name", done, verify);
    response = handler.handleText("sunset cruise?", pageId, myFbid);
    verify = function(response) {
      expect(response.message.message.attachment.payload.template_type).to.equal("list");
      expect(response.message.message.attachment.payload.elements[0].title).to.contain("Sunset cruise operates from 5.00 - 7.00 p.m.");
      expect(response.message.message.attachment.payload.elements[3].title).to.contain("We serve drinks (like Champagne, Rum punch/mixes) and Hors d’oeuvres");
    }
    handlePromise(response, "entity-name", done, verify, true);
  });

  // NOTE: FOR THIS TO WORK, GO TO dialogflow/app/main.js and uncomment the "reject(..)" line.
  it.skip("manual test: dialogflow failing", function(done) {
    let promise = handler.handleText("Hi", pageId, myFbid);
    promise.done(
      function(response) {
        logger.debug(JSON.stringify(response.message));
        done();
      },
      function(err) {
        logger.error("Error!!");
        done(err);
      }
    );
  });
});


describe("sea spray postback", function() {
  beforeEach(function() {
    commonBeforeEach();
  });

  function verifyPostbackMessage(promise, tourName, verifier, done, last) {
    promise.then(
      (message) => {
        expect(message.message.attachment.payload.template_type).to.equal("list");
        expect(message.message.attachment.payload.elements[0].title).to.contain(tourName);
        if(verifier) verifier(message);
        logger.debug(`verifyPostbackMessage: true is ${last}`);
        if(last) done();
      },
      (err) => {
        done(err);
    });
  }

  it("book all tours", function(done) {
    const promise = handler.handlePostback("sea_spray_book_tour", pageId, myFbid);
    promise.done(
      (message) => {
        expect(message.message.attachment.payload.elements.length).to.equal(4);
        expect(message.message.attachment.payload.template_type).to.equal("generic");
        // logger.debug(JSON.stringify(message));
        done();
      },
      (err) => {
        done(err);
    });
  });

  it("customer service postback", function(done) {
    const promise = handler.handlePostback("sea_spray_contact", pageId, myFbid);
    promise.done(
      (message) => {
      expect(message.message.attachment.payload.elements.length).to.equal(4);
      expect(message.message.attachment.payload.template_type).to.equal("list");
      expect(message.message.attachment.payload.elements[0].title).to.contain("Sea Spray cruises");
      // logger.debug(JSON.stringify(message));
      done();
    },
    (err) => {
      done(err);
    });
  });

  it("multiple admins", function(done) {
    const customerFbid = "432";
    const adminFbid = myFbid;
    const anotherAdmin = "789";
    const question = "random message to someone";
    const responseToQuestion = "response to message";
    const promise = handler.handleText(question, pageId, customerFbid);
    promise.then(
      (result) => {
        expect(result.category).to.equal("input.unknown");
        verifyState(handler.adminMessageSender.stateManager.get(["messageSentToAdmin", customerFbid, question]), true, done);
        // logger.debug(JSON.stringify(message));
        return handler.handlePostback(`respond_to_customer_${customerFbid}-_${question}`, pageId, adminFbid);
      },
      (err) => {
        return Promise.reject(err);
    }).then(
      (message) => {
        verifyState(handler.adminMessageSender.stateManager.get(["awaitingResponseFromAdmin", adminFbid]), {}, done);
        expect(message.recipient.id).to.equal(adminFbid);
        expect(message.message.text).to.include(`Enter your response for customer '${customerFbid}'. Question is `); 
        return handler.handlePostback(`respond_to_customer_${customerFbid}-_${question}`, pageId, anotherAdmin);
      },
      (err) => {
        return Promise.reject(err);
    }).then(
      (message) => {
        verifyState(handler.adminMessageSender.stateManager.get(["awaitingResponseFromAdmin", adminFbid]), {}, done);
        expect(message.recipient.id).to.equal(anotherAdmin);
        expect(message.message.text).to.include("Another admin");
        return handler.handleText(responseToQuestion, pageId, adminFbid);
      },
      (err) => {
        return Promise.reject(err);
    }).then(
      (response) => {
        // logger.debug(`response is ${JSON.stringify(response)}`);
        const mesgList = response.message;
        expect(mesgList[0].recipient.id).to.equal(customerFbid);
        expect(mesgList[0].message.attachment.payload.elements[1].subtitle).to.include(question);
        expect(mesgList[0].message.attachment.payload.elements[1].title).to.include("Your question");
        expect(mesgList[0].message.attachment.payload.elements[2].title).to.include("Our response");
        expect(mesgList[0].message.attachment.payload.elements[2].subtitle.toLowerCase()).to.include(responseToQuestion.toLowerCase());
        expect(mesgList[1].recipient.id).to.equal(adminFbid);
        verifyState(handler.adminMessageSender.stateManager.get(["messageSentToAdmin", customerFbid, question]), undefined, done);
        verifyState(handler.adminMessageSender.stateManager.get(["awaitingResponseFromAdmin",adminFbid]), undefined, done);
      },
      (err) => {
        return Promise.reject(err);
    }).then(
      () => {
        // test case where admin tries to "respond" to the message again but is told that there is already a response!
        return handler.handlePostback(`respond_to_customer_${customerFbid}-_${question}`, pageId, adminFbid);
      },
      (err) => {
        return Promise.reject(err);
    }).done(
      (message) => {
        expect(message).to.not.be.undefined;
        expect(message.recipient.id).to.equal(adminFbid);
        expect(message.message.text).to.include("Looks like you or some other admin already responded to customer");
        done();
      },
      (err) => {
        return done(err);
    });
  });

  it("single admin", function(done) {
    const customerFbid = "432";
    const adminFbid = myFbid;
    const question = "random message to someone";
    const responseToQuestion = "response to message";
    const promise = handler.handleText(question, pageId, customerFbid);
    promise.then(
      (result) => {
        expect(result.category).to.equal("input.unknown");
        verifyState(handler.adminMessageSender.stateManager.get(["messageSentToAdmin", customerFbid, question]), true, done);
        // logger.debug(JSON.stringify(message));
        return handler.handlePostback(`respond_to_customer_${customerFbid}-_${question}`, pageId, adminFbid);
      },
      (err) => {
        return Promise.reject(err);
    }).then(
      (message) => {
        verifyState(handler.adminMessageSender.stateManager.get(["awaitingResponseFromAdmin", adminFbid]), {}, done);
        expect(message.recipient.id).to.equal(adminFbid);
        expect(message.message.text).to.include(`Enter your response for customer '${customerFbid}'. Question is `); 
        return handler.handleText(responseToQuestion, pageId, adminFbid);
      },
      (err) => {
        return Promise.reject(err);
    }).then(
      (response) => {
        // logger.debug(`response is ${JSON.stringify(response)}`);
        const mesgList = response.message;
        expect(mesgList[0].recipient.id).to.equal(customerFbid);
        expect(mesgList[0].message.attachment.payload.elements[1].subtitle).to.include(question);
        expect(mesgList[0].message.attachment.payload.elements[1].title).to.include("Your question");
        expect(mesgList[0].message.attachment.payload.elements[2].title).to.include("Our response");
        expect(mesgList[0].message.attachment.payload.elements[2].subtitle.toLowerCase()).to.include(responseToQuestion.toLowerCase());
        expect(mesgList[1].recipient.id).to.equal(adminFbid);
        verifyState(handler.adminMessageSender.stateManager.get(["messageSentToAdmin", customerFbid, question]), undefined, done);
        verifyState(handler.adminMessageSender.stateManager.get(["awaitingResponseFromAdmin",adminFbid]), undefined, done);
        return handler.handleText("follow up question", pageId, customerFbid);
      },
      (err) => {
        return Promise.reject(err);
    }).done(
      (response) => {
        // logger.debug(`response is ${JSON.stringify(response)}`);
        const mesgList = response.message;
        // verify state
        verifyState(handler.adminMessageSender.stateManager.get(["messageSentToAdmin", customerFbid, question]), undefined, done);
        verifyState(handler.adminMessageSender.stateManager.get(["messageSentToAdmin", customerFbid, "follow up question"]), true, done);
        // first message
        expect(mesgList[0].message.attachment.payload.elements[1].title).to.include("Question");
        expect(mesgList[0].message.attachment.payload.elements[1].subtitle).to.include("follow up question");
        done();
      },
      (err) => {
        return done(err);
    });
  });

  it("postback failure", function(done) {
    const customerFbid = "436";
    const promise = handler.handlePostback("select_tour some invalid message", pageId, customerFbid);
    promise.done(
      (response) => {
        expect(response.message).is.not.undefined;
        verifyState(handler.adminMessageSender.stateManager.get(["messageSentToAdmin", customerFbid, "postback payload: select_tour some invalid message"]), true, done);
        const mesgList = response.message;
        expect(mesgList[0].message.text).to.equal("We have received your message and will get back to you asap.");
        done();
      },
      (err) => {
        done(err);
    });
  });
});

describe("anthony hackshaw", function() {
  it.skip("real", function(done) {
    message = handler.handleText("what is the biggest boat", pageId, myFbid);
    message = handler.handleText("what's the cost of the pirate cruise", pageId, myFbid);
  });
});
