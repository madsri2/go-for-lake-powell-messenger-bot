'use strict';
// https://www.npmjs.com/package/command-line-args
const cmdLineArgs = require('command-line-args');
const HotelReceiptManager = require('receipt-manager/app/hotel-receipt-manager');

const optionsDefn = [
  {name: 'trip_name', defaultOption: ''},
  {name: 'image_url'},
  {name: 'recipient_name'}, //default String
  {name: 'order_number'},
  {name: 'merchant_name'},
  {name: 'payment_method'},
  {name: 'currency', defaultValue: 'USD'},
  {name: 'order_url'},
  {name: 'hotel_type'},
  {name: 'total_price'},
  {name: 'street_1'},
  {name: 'city'},
  {name: 'state'},
  {name: 'country'},
  {name: 'postal_code'},
  {name: 'phone'},
  {name: 'check_in_date'},
  {name: 'check_out_date'},
];

// TODO: Start here and add departure time
const options = cmdLineArgs(optionsDefn);
console.log(`options: ${JSON.stringify(options)}`);
const receiptMgr = new HotelReceiptManager(options);
receiptMgr.handle();
