var child_process = require('child_process');
var config;
try { config = require('/etc/spotnicc/config'); }catch(e){
      config = require(__dirname+'/../../etc/spotnicc/config'); }

var PROC_CWD = '/var/run/spotnicc';
var PROC_PROGRAM_CONFIGURE = '/var/spotnicc/bin/yeah';
var PROC_PROGRAM_VALIDATE = '/var/spotnicc/bin/collab';

var sdb = exports.sdb = new require('simpledb').SimpleDB(config.aws);

// Creates an exit handler for yeah libspotify programs that interpret the
// different exit codes and provides exitHandler with two arguments:
// (msg, httpStatus) where msg is an object with an integer "status" property,
// holding the exit code (0=success) and a string "message" property with a
// human-readable message. The httpStatus arguments holds an appropriate HTTP
// status code.
function wrapProgramExitHandler(exitHandler, okHttpStatus/*=200*/) {
  if (typeof exitHandler !== 'function')
    return function(){};
  return function (code) {
    //console.log('PROC EXIT: '+code);
    var http_status = 200;
    var msg = { status: code };
    if (code == 0) {
      http_status = typeof okHttpStatus === 'number' ? okHttpStatus : 200;
      msg.message = 'OK'
    } else if (code == 249) {
      msg.message = 'Playlist not collaborative'
    } else if (code == 243) {
      http_status = 408
      msg.message = 'libspotify timed out'
    } else if (code == 244) {
      http_status = 400
      msg.message = 'Malformed playlist URI'
    } else {
      http_status = 500
    }
    exitHandler(msg, http_status);
  }
}

// Configure a playlist by executing the appropriate libspotify tool
function execConfigurePlaylist(playlistURI, query, exitHandler) {
  var proc = child_process.spawn(PROC_PROGRAM_CONFIGURE, [playlistURI, query], {
    cwd:PROC_CWD
  });
  proc.on('exit', wrapProgramExitHandler(exitHandler, 201));
  return proc
}
exports.execConfigurePlaylist = execConfigurePlaylist;

// Validate a playlist by executing the appropriate libspotify tool
function execValidatePlaylist(playlistURI, exitHandler) {
  var proc = child_process.spawn(PROC_PROGRAM_VALIDATE, [playlistURI], {cwd:PROC_CWD});
  proc.on('exit', wrapProgramExitHandler(exitHandler));
  return proc;
}
exports.execValidatePlaylist = execValidatePlaylist;


// -----------------------------------------------------------------------------
// SimpleDB

function wrapcb(callback) {
  return function (err) {
    var args = Array.prototype.slice.call(arguments);
    if (err && !(err instanceof Error)) {
      var e = new Error(err.Message);
      e.name = err.Code;
      args[0] = e;
    }
    return callback.apply(this, args);
  }
}


function findPlaylistsForQuery(query, callback) {
  sdb.select("select * from spotnicc_playlists where query = '?' and last_updated is not null order by last_updated",
             [query], wrapcb(callback))
}
sdb.findPlaylistsForQuery = findPlaylistsForQuery;


function findPlaylistsNotUpdatedSince(timestamp, consistentRead, callback) {
  if (typeof consistentRead === 'function') {
    callback = consistentRead;
    consistentRead = false;
  }
  if (typeof timestamp !== 'number') {
    if (typeof timestamp === 'object' && timestamp instanceof Date)
      timestamp = timestamp.getTime();
    else
      timestamp = (new Date).getTime();
  }
  var override = {};
  if (consistentRead) override = {ConsistentRead:'true'};
  sdb.select("select * from spotnicc_playlists where last_updated < '?' order by last_updated",
             [String(timestamp)], override, wrapcb(callback))
}
sdb.findPlaylistsNotUpdatedSince = findPlaylistsNotUpdatedSince;


function findPlaylistWithURI(uri, callback) {
  sdb.getItem('spotnicc_playlists', uri, function(err, result) {
    if (!err && result)
      delete result['$ItemName'];
    callback(err, result);
  });
}
sdb.findPlaylistWithURI = findPlaylistWithURI;


// putPlaylist(uri, query, [last_updated=now,] callback(err))
function putPlaylist(uri, query, last_updated, callback) {
  if (typeof last_updated === 'function') {
    callback = last_updated;
    last_updated = 0;
  } else if (typeof last_updated !== 'number' || last_updated < 1) {
    last_updated = (new Date).getTime();
  }
  var attrs = {query:query, last_updated:last_updated};
  sdb.putItem('spotnicc_playlists', uri, attrs, callback);
}
sdb.putPlaylist = putPlaylist;


// removePlaylist(uri, callback(err))
function removePlaylist(uri, callback) {
  sdb.deleteItem('spotnicc_playlists', uri, callback);
}
sdb.removePlaylist = removePlaylist;


// -----------------------------------------------------------------------------
// playlist helpers

function setPlaylistLastUpdated(playlistOrPlaylistURI, timestamp, callback) {
  if (typeof timestamp !== 'number' || timestamp < 1)
    timestamp = (new Date).getTime();
  if (typeof playlistOrPlaylistURI === 'object')
    playlistOrPlaylistURI = playlistOrPlaylistURI['$ItemName'];
  if (typeof callback !== 'function') callback = function(){};
  sdb.putItem('spotnicc_playlists', playlistOrPlaylistURI,
              {last_updated:timestamp}, callback);
}
exports.setPlaylistLastUpdated = setPlaylistLastUpdated;

// RegExp matching a complete playlist URI
exports.PLAYLIST_URI_RE = /^spotify:user:([^:]+):playlist:([a-zA-Z0-9]{22})$/;

// Parse and validate a playlist URI (strict). Returns an object {username:,id:}
// on success and a false value if |uri| is invalid or malformed
function parsePlaylistURI(uri) {
  var m = exports.PLAYLIST_URI_RE.exec(String(uri));
  if (m) return {username:m[1], id:m[2]};
}
exports.parsePlaylistURI = parsePlaylistURI;
