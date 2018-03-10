'use strict';

const SecretManager = require('/home/ec2-user/secret-manager/app/manager');
// https://www.npmjs.com/package/command-line-args
const cmdLineArgs = require('command-line-args');

const optionsDefn = [
  {name: 'encrypt', alias: 'e'}, // default type: String
  {name: 'decrypt', alias: 'd'},
  {name: 'pat', type: Boolean},
  {name: 'apat', type: Boolean},
  {name: 'travel_sfo', type: Boolean},
  {name: 'sea_spray', type: Boolean},
  {name: 'my_hackshaw', type: Boolean},
];

const options = cmdLineArgs(optionsDefn);
const manager = new SecretManager();
if(options.encrypt) return console.log(manager.encrypt(options.encrypt));
if(options.decrypt) return console.log(manager.decrypt(options.decrypt));
if(options.pat) { return console.log(manager.getPolaamaBotPageAccessToken()); }
if(options.apat) { return console.log(manager.getPolaamaPageAccessToken()); }
if(options.travel_sfo) { return console.log(manager.getTravelSfoPageAccessToken()); }
if(options.my_sea_spray) { return console.log(manager.getMySeaSprayPageAccessToken()); }
if(options.sea_spray) { return console.log(manager.getSeaSprayPageAccessToken()); }
if(options.my_hackshaw) { return console.log(manager.getMyHackshawPageAccessToken()); }

console.log(`usage: node crypto.js [-e data | -d <data> | -pat]`);
/*
if(process.argv.length < 4) {
  console.log(`usage: node crypto.js <-e|-d> <data>`);
  return;
}

const manager = new SecretManager();
if(process.argv[2] === "-e") {
  console.log(manager.encrypt(process.argv[3]));
  return;
}

if(process.argv[2] === "-d") {
  console.log(manager.decrypt(process.argv[3]));
  return;
}
*/
