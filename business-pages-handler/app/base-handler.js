'use strict';
const baseDir = '/home/ec2-user';
const logger = require(`${baseDir}/my-logger`);
const FBTemplateCreator = require(`${baseDir}/fb-template-creator`);
const AdminMessageSender = require('business-pages-handler');
const Promise = require('promise');
const StateManager = require('state-manager');
const FbidHandler = require('fbid-handler/app/handler');
const Encoder = require(`${baseDir}/encoder`);

/*
  This class handles the logic of responding to messages from customers for a particular business, both as a text message or as a postback. handleText & handlePostback are the critical methods. 
  A business-logic class object is passed to this class, which is used to handle information specific to a particular business. See ~/sea-spray-handler/app/handler.js for an example of business logic implementation.
  NOTE: There are no unit tests for this class. It's tested as part of unit tests for the sea-spray-handler package.
*/
function BaseHandler(businessHandler) {
  this.businessHandler = businessHandler;
  this.classifier = businessHandler.classifier;
  if(!this.classifier) throw new Error("Required property classifier missing from businessHandler object");
  this.adminIds = businessHandler.adminIds;
  if(!this.adminIds) throw new Error("Required property adminIds missing from businessHandler object");
  this.businessPageId = businessHandler.businessPageId;
  // TODO: Temporarily commenting it until the hackshaw page's id can be added. Doing this so the code for hackshawHandler can still be done
  // if(!this.businessPageId) throw new Error("Required property businessPageId missing from businessHandler object");
  this.testing = businessHandler.testing;
  this.adminMessageSender = new AdminMessageSender(this.businessHandler.name, this.adminIds, this.testing);
  // List of users who only want to talk to a human operator.
  this.dontRespondState = new StateManager(`${Encoder.encode(this.businessHandler.name)}-dont-respond.txt`, this.testing);
}

BaseHandler.prototype.greeting = function(pageId, fbid) {
  if(!supportedPages.call(this, pageId)) return null;
  try { 
    return this.businessHandler.greeting(fbid);
  }
  catch(err) {
    return handleUnknownError.call(this, err, "greeting message", fbid);
  }
}

// If the user says something like "good morning" or "good evening", respond with the same message. We can't let dialogflow handle this because it's hard to distinguish between this message as a "greeting" or a farewell. One way this can be handled is to specify context (if there is no context, its a greeting, if not its a farewell), but this means that dialogflow needs to use context to determine intent. Not sure if it has this feature.
function echoGreeting(mesg) {
  if(mesg === "good morning" || mesg === "morning" || mesg === "'morning" ||
     mesg === "good afternoon" || mesg === "afternoon" || mesg === "'aftnoon" ||
     mesg === "good evening" || mesg === "evening" || mesg === "'evening" ||
     mesg === "good night" || mesg === "night" || mesg === "'night")
     return mesg;
  return null;
}

BaseHandler.prototype.handleText = function(mesg, pageId, fbid) {
  this.adminMessageSender.setAdminIds(this.adminIds);
  const pageDetails = this.businessHandler.pageDetails();

  const self = this;
  return this.adminMessageSender.handleResponseFromAdmin(fbid, mesg, pageDetails).then(
    (response) => {
      if(response) return Promise.resolve({
        _done: true,
        message: response
      });
      // if this customer had expressed interest in chatting with a human in the past, treat all subsequent messages the same way
      return alwaysSendMessageToHuman.call(self, mesg, pageId, fbid);
    },
    (err) => {
      return Promise.reject(err);
  }).then(
    (response) => {
      if(echoGreeting(mesg)) return Promise.resolve({
        _done: true,
        message: FBTemplateCreator.text({
          fbid: fbid,
          text: mesg
        })
      });
      // perform actual classification if message should be handled by bot and not human
      if(!response) return self.classifier.classify(mesg);
      return Promise.resolve({
        _done: true,
        message: response.message
      });
    },
    (err) => {
      return Promise.reject(err);
  }).then(
    function(result) {
      try {
        // short-circuit if we already have a result from the previous promise.
        if(result._done) {
          // TODO: Why are we deleting this key? Is it critical to get rid of? Madhu: 1/8/18
          delete result._done;
          // logger.debug(`short-circuiting since we have result from previous promise`);
          return Promise.resolve(result);
        }
        const category = result.category;
        // logger.debug(`handleText: category is ${category}`);
        if(category === "frustration" || category === "talk-to-human" || category === "input.unknown") return sendMessageToAdmin.call(self, pageId, fbid, mesg, category);
        let response;
        if(category === "greeting") return resolvedPromise(category, self.greeting(pageId, fbid));
        if(category === "farewell") return resolvedPromise(category, farewell(fbid));
        response = self.businessHandler.handleBusinessSpecificCategories(fbid, result.category, result.tourName);
        if(response) return resolvedPromise(category, response);
        // if it's a category we don't understand and if there is a fulfilment, use it. This is to handle cases where the Intent and a default response exists in Dialogflow (Examples: Appreciation
        logger.info(`handleText: Unknown category: ${category}. Figuring out what to do...`);
        if(result.defaultResponse) {
          logger.info(`handleText: default response <${result.defaultResponse}> present. Returning that.`);
          response = FBTemplateCreator.text({
            fbid: fbid,
            text: result.defaultResponse
          });
        }
        else {
          logger.info("handleText: We don't know what to send. Send the message to human and have them take over");
          return sendMessageToAdmin.call(self, pageId, fbid, mesg);
        }
        return resolvedPromise(category, response);
      }
      catch(err) {
        return handleUnknownError.call(self, err, mesg, fbid);
      }
    },
    (err) => {
      return Promise.reject(err);
  }).then(
    (response) => {
      return Promise.resolve(response);
    },
    function(error) {
      return handleUnknownError.call(self, error, mesg, fbid);
    }
  );
}

function resolvedPromise(category, response) {
  return Promise.resolve({
    'category': category,
    'message': response
  });
}

function farewell(fbid) {
  return FBTemplateCreator.text({
    fbid: fbid,
    text: "See you later! Remember, we are always available to answer your questions!",
  });
}


BaseHandler.prototype.handlePostback = function(payload, pageId, fbid) {
  if(!supportedPages.call(this, pageId)) return Promise.resolve(null);
  const self = this;
  return this.adminMessageSender.handleWaitingForAdminResponse(fbid, payload).then(
    (value) => {
      try {
        if(value) return Promise.resolve(value);
        let response = self.businessHandler.handleBusinessSpecificPayload(payload, fbid);
        // we need to respond one way or another here. TODO: See if there is better way to handle this.
        if(!response) {
          logger.error(`Dont know how to handle payload '${payload}' of fbid ${fbid} for ${self.businessHandler.name} bot. Asking help from admin`);
          return self.adminMessageSender.sendMessageToAdmin(fbid, mesg, "input.unknown");
        }
        // logger.debug(`response is ${JSON.stringify(response)}`);
        return Promise.resolve(response);
      }
      catch(err) {
        return handleUnknownError.call(self, err, `postback payload: ${payload}`, fbid);
      }
    },
    (err) => {
      return handleUnknownError.call(self, err, `postback payload: ${payload}`, fbid);
    }
  );
}

function handleUnknownError(err, mesg, fbid) {
  logger.error(`handleText: Error in categoryPromise: ${err}; ${err.stack}`);
  logger.info(`handleText: Sending message '${mesg}' to admin so they can take over`);
  return this.adminMessageSender.sendMessageToAdmin(fbid, mesg, "handle-error");
}

function supportedPages(pageId) {
  if(pageId !== this.businessPageId) return false;
  this.adminMessageSender.setAdminIds(this.adminIds);
  return true;
}

function sendMessageToAdmin(pageId, fbid, mesg, category) {
  const self = this;
  return this.dontRespondState.set([pageId, fbid]).then(
    () => {
      return self.adminMessageSender.sendMessageToAdmin(fbid, mesg, category);
    },
    (err) => {
      return Promise.reject(err);
  });
}

function alwaysSendMessageToHuman(mesg, pageId, fbid) {
  const self = this;
  // if the message is longer than 255 characters, Dialog flow throws an error. For now, have human operators handle responses > 255 characters
  let name = FbidHandler.get().getName(fbid);
  if(!name) name = fbid;
  if(mesg.length >= 255) {
    logger.warn(`alwaysSendMessageToHuman: Message from person "${name}" (with fbid ${fbid} who is chatting with page '${self.businessHandler.name}') is greater than 255 characters. Since dialogflow only accepts shorter messages, asking human operator to take over this conversation`);
    return sendMessageToAdmin.call(self, pageId, fbid, mesg, "talk-to-human");
  }
  return this.dontRespondState.get([pageId, fbid]).then(
    (value) => {
      // if there is no state recorded before, bot needs to handle this message from user
      if(!value) return Promise.resolve(null);
      logger.debug(`For person "${name}" with fbid ${fbid} who is chatting with SeaSpray page, we will always ask the human operator to respond`);
      return self.adminMessageSender.sendMessageToAdmin(fbid, mesg, "dont-respond-to-user");
    },
    (err) => {
      return Promise.reject(err);
  });
}

module.exports = BaseHandler;
