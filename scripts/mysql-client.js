'use strict';

var mysql      = require('mysql');
var connection = mysql.createConnection({
  host     : '127.0.0.1',
  port     : '3308',
  user     : 'polaamauser',
  password : 'polaamapassword',
  database : 'polaama'
});

connection.connect();

/*
connection.query('DESC Answers', function (error, results, fields) {
  if (error) throw error;
  console.log('The solution is: ', results);
});
*/

connection.query('select * from Answers', function (error, results, fields) {
// connection.query('show tables', function (error, results, fields) {
const values = {
	AccountId: 1,
	questionIndex: "{\"intent\":\"greeting\"}",
	answerIndex: "[{\"type\": \"Text\",\"content\": {\"textIndex\": \"Hello world!\"}}]",
	createdAt: "2/2/18 0:00",
	updatedAt: "2/2/18 0:00",
};
// connection.query('INSERT INTO Answers SET ?', values, function (error, results, fields) {
  if (error) throw error;
  console.log('The solution is: ', results);
});

connection.end();
