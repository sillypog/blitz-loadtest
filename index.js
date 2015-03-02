#!/usr/bin/env node

/****
* A script to help load test the app.
*
* It has 2 execution modes:
* 1) Produce a command to call blitz-io testing.
*   `node index.js ./config`
*   Will create a command for blitz to load test against 'iterations' number of
*   tags and their parents.
*   Output is written to stdout and can be piped to a file.
*
* 2) Generate http calls to the app at specified intervals:
*   `node index.js ./config 100`
*   Will send a request every 100 ms, testing against 'iterations' number of
*   tags and their parents.
*   To view output run as:
*   `DEBUG=loadtest node index.js ./config 100`
*   To stop sending requests but keep waiting for responses hit the `s` key.
*
*
* Tag groups are prepared by choosing a tag of the configured type at random and grouping it
* with all its parent tags, so a set of 5 tags might look like:
*
* ```
* [
*   78060,
*   77427,
*   8782%2C8781%2C22%2C10,
*   12494%2C8445%2C9011,
*   5078%2C58%2C20%2C15
* ]
* ```
*/

var _ = require('underscore'),
    async = require('async'),
    debug = require('debug')('loadtest'),
    http = require('http'),
    keypress = require('keypress'),
    mysql = require('mysql'),
    util = require('util');

var config = require(process.argv[2]),
    iterations = config.tags.iterations,
    interval = process.argv[3];

var stopCalling = false;

debug('Run for', iterations);

function connectToDB(callback) {
	debug('connectToDB');

	var connection = mysql.createConnection(config.tag_db);

	connection.connect(function(err){
		if (err){
			console.error('error connecting to tag database: '+err.stack);
			callback(err);
		}

		debug('connected as id ' + connection.threadId);
		callback(null, connection);
	});
}

function selectTagsOfType(type, connection, callback){
	debug('selectTagsOfType');
	connection.query('SELECT id, name, parent_id FROM tags WHERE type="'+type+'"', function(err, results){
		if (err) {
			debug('error getting tags of type');
			callback(err);
		}
		debug('got tags of type');
		callback(null, connection, results);
	});
}

function generateTagLists(connection, baseTags, callback){
	// Call generateTagList [iteration] times
	// Store results in an array (of arrays)
	// Present results

	var count = 0,
	    lists = [];

	async.whilst(
		function(){ return count < iterations; },
		function(callback){
			generateTagList(connection, baseTags, function(err, result){
				if (err){
					debug('failure on list generation');
					callback(err);
				}

				lists.push(result);
				count++;

				callback();
			});
		},
		function(err){
			if (err){
				callback(err);
			}
			callback(null, lists);
		}
	);
}

function generateTagList(connection, baseTags, callback){
	debug('generateTagList');

	// Pick a tag at random
	var currentTag = _.sample(baseTags),
	    tags = [currentTag.id];

	debug('Picked base tag: ' + util.inspect(tags));

	// Keep calling getParent until null, then return the results

	async.whilst(
		function(){ return currentTag && currentTag.id != undefined; },
		function(callback){
			getParent(connection, currentTag, function(err, result){
				if (err){
					debug('iteration failed');
					callback(err);
				}

				if (result && result.id){
					tags.push(result.id);
				}
				currentTag = result;

				callback();
			});
		},
		function(err){
			if (err){
				debug('error during iterations');
				callback(err);
			}

			debug('Got all the parents for this tag');
			callback(null, tags);
		}
	);
}

function getParent(connection, tag, callback) {
	debug('Getting parent of ' + tag.name + ', which will have id '+tag.parent_id);
	connection.query('SELECT id, name, parent_id FROM tags WHERE id="'+tag.parent_id+'"', function(err, result){
		if (err){
			debug('Error getting parent for ' + tag.id);
			callback(err);
		}
		debug('Parent of '+tag.name+' is '+ util.inspect(result));
		callback(null, result[0]);
	});
}

function formatOutput(lists, callback) {
	var formattedLists = lists.map(function(list){
		return list.join('%2C');
	});

	var command = util.format("blitz curl -b %d-%d:%d -T %d -v:tags 'list[%s]' 'http://%s%s#{tags}'",
		config.blitz.min,
		config.blitz.max,
		config.blitz.duration,
		config.blitz.timeout,
		formattedLists.join(','),
		config.endpoint.hostname,
		config.endpoint.path
	);

	callback(null, command);
}

function startCalling(lists, callback) {
	var calls = 0,
	    responses = 0;

	var agent = new http.Agent({
		keepAlive: false,
		maxSockets: Infinity
	});

	async.whilst(
		function(){ return !(stopCalling == true && calls == responses); },
		function(callback){
			// choose random tags
			var tags = _.sample(lists),
			    timestamp = new Date();

			if (stopCalling == false){
				calls++;
				debug(timestamp,'tags', tags.join(','),'Calls:',calls,'Responses:',responses);
				http.get({
					agent: agent,
					hostname: config.endpoint.hostname,
					path: config.endpoint.path + tags.join('%2C')
				}, function(res){
					responses++;
					debug(timestamp, 'Server responded with ' + res.statusCode);
				}).on('error', function(e){
					debug(timestamp, 'Server error: ' + e.message);
				});
			} else {
				debug(timestamp,'waiting for responses.','Calls:',calls,'Responses:',responses);
			}


			setTimeout(callback, interval);
		},
		function(err){
			if (err){
				debug('error with calling');
			}
			debug('done with calls');
			callback(null, 'success');
		}
	);
}

function getTaskList(){
	var tasks = [connectToDB, selectTagsOfType.bind(null, config.tags.type), generateTagLists];
	if (interval) {
		tasks.push(startCalling);
	} else {
		tasks.push(formatOutput);
	}
	return tasks;
}

// make `process.stdin` begin emitting "keypress" events
keypress(process.stdin);

// listen for the "keypress" event
process.stdin.on('keypress', function (ch, key) {
	debug('got "keypress"', key);
	if (key && key.ctrl && key.name == 'c') {
		process.exit();
	}

	if (key && key.name == 's') {
		debug('stopping calling');
		stopCalling = true;
	}
});

process.stdin.setRawMode(true);
process.stdin.resume();

async.waterfall(getTaskList(), function(err, results){
	if (err) {
		console.log('There was an error: ' + err.stack);
	}
	console.log(results);

	process.exit();
});
