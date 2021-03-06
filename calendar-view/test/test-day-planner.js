'use strict';
const expect = require('chai').expect;
const DayPlanner = require('calendar-view/app/day-planner');
const fs = require('fs-extra');

const baseDir = "/home/ec2-user";
const logger = require(`${baseDir}/my-logger`);
logger.setTestConfig();
const TripData = require(`${baseDir}/trip-data`);

let trip;
let fbid = "1234";

describe("DayPlanner tests", function() {
  function copyFile(date) {
    // logger.debug(`copyFile: now copying file ${date}`);
    const base = `${baseDir}/trips/ZDdz`;
    const filePrefix = `test-mobile-view-${date}-itinerary.json`;
    fs.copySync(`${base}/forTestingPurposes/${filePrefix}`, `${base}/${filePrefix}`);
    if(!fs.existsSync(`${base}/${filePrefix}`)) throw new Error(`file ${filePrefix} not present`);
  }

  beforeEach(function() {
    trip = new TripData('test-mobile-view', fbid);
    trip.addTripDetailsAndPersist({
      ownerId: "ZDdz"
    });
    // set up
    copyFile("2017-6-13");
  });

  afterEach(function() {
    trip.testing_delete();
  });

  function testMealActivity(dateStr, exceptionList) {
    const date = new Date(dateStr)
    copyFile(`${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`);
    const dp = new DayPlanner(date, trip, fbid);
    dp.setActivityList();
    if(!exceptionList) exceptionList = [];
    exceptionList.forEach(meal => {
      expect(dp.getMealElement(meal).message.text).to.not.be.null;
    });
    ["breakfast", "lunch", "dinner"].forEach(meal => {
      if(exceptionList.includes(meal)) return;
      expect(dp.getMealElement(meal).message.attachment.payload.template_type).to.equal("generic");
    });
  }

  it("meal activity", function() {
    logger.debug(`********** Testing ********`);
    testMealActivity("6/18/2017", ["dinner"]);
    logger.debug(`********** Testing ********`);
    testMealActivity("6/19/2017");
    logger.debug(`********** Testing ********`);
    testMealActivity("6/20/2017");
    logger.debug(`********** Testing ********`);
    testMealActivity("6/21/2017");
    logger.debug(`********** Testing ********`);
    testMealActivity("6/22/2017");
    logger.debug(`********** Testing ********`);
    testMealActivity("6/23/2017");
    logger.debug(`********** Testing ********`);
    testMealActivity("6/24/2017");
    logger.debug(`********** Testing ********`);
    testMealActivity("6/25/2017", ["lunch"]);
  });

  it("test getting event plans for a given day", function() {
    trip.addEvent("test-phocuswright");
    const date = new Date("9/12/2017");
    const dp = new DayPlanner(date, trip, fbid);
    const message = dp.getPlanAsList(0);
    expect(message).to.not.be.null;
    logger.debug(`message is ${JSON.stringify(message)}`);
  });

  it("get event breakdown details", function() {
    trip.addEvent("test-arival");
    const date = new Date("10/12/2017");
    const dp = new DayPlanner(date, trip, fbid);
    const payload = "pb_event_details_breakdown test-arival details-oct-12";
    const message = dp.getEventItinerary(payload.split(" "));
    expect(message).to.not.be.null;
    logger.debug(`message is ${JSON.stringify(message)}`);
  });

  it("get event details", function() {
    trip.addEvent("test-arival");
    const date = new Date("10/12/2017");
    const dp = new DayPlanner("invalid", trip, fbid);
    const payload = "pb_event_details_breakdown test-arival details-oct-12";
    const message = dp.getEventItinerary(payload.split(" "));
    expect(message).to.not.be.null;
    logger.debug(`message is ${JSON.stringify(message)}`);
    
  });
});
