require.paths.unshift(__dirname+'/../nodelib');

var BIND_ADDR = '127.0.0.1';
var BIND_PORT = 8124;
var API_PREFIX = '/api';
var ALLOW_CORS = true;

var http = require('http');
var parse_url = require('url').parse;
var parse_qs = require('querystring').parse;
var spotnicc = require('spotnicc');
var proc_exec = require('child_process').exec;

var api = {};

http.createServer(function (req, res) {
  console.log('HTTP/%s %s %s', req.httpVersion, req.method, req.url);
  req.url = parse_url(req.url, true);
  res.respond = function (status, obj) {
    if (obj && typeof obj !== 'object') obj = {message:obj};
    var body = obj ? JSON.stringify(obj) : '';
    res.headers = {
      'Content-Type': 'application/json',
      'Content-Length': String(body.length)
    }
    if (ALLOW_CORS)
      res.headers['Access-Control-Allow-Origin'] = '*';
    res.writeHead(status, res.headers);
    res.end(body.length ? body : null);
  }
  try {
    var path = req.url.pathname;
    if (path.indexOf(API_PREFIX) === 0)
      path = path.substr(API_PREFIX.length);
    var handler = api[path];
    if (!handler) {
      res.respond(400, 'Unknown service '+JSON.stringify(path));
    } else if (req.method === 'POST' || req.method === 'PUT') {
      // collect and buffer data
      req.contentLength = parseInt(req.headers['content-length']);
      if (!isNaN(req.contentLength) && req.contentLength > 0 ) {
        if (req.setEncoding) req.setEncoding('utf8');
        req.body = '';
        req.on('data', function(chunk) {
          if (req.body.length + chunk.length > req.contentLength) {
            req.removeListener('data', arguments.callee);
            return;
          }
          req.body += chunk;
        });
      } else {
        req.contentLength = 0;
      }
      req.on('end', function() {
        //console.log('req.headers', req.headers);
        req.contentType = req.headers['content-type'];
        if (req.contentLength && req.contentType) {
          if (req.contentType.indexOf('application/x-www-form-urlencoded') !== -1) {
            try { req.message = parse_qs(req.body); }catch(e){}
          }
        }
        try {
          handler(req, res);
        } catch (e) {
          res.respond(500, {message:e.stack||String(e)});
        }
      });
    } else {
      req.on('end', function() {
        try {
          handler(req, res);
        } catch (e) {
          res.respond(500, {message:e.stack||String(e)});
        }
      });
    }
  } catch (err) {
    res.respond(500, err.stack || err);
  }
}).listen(BIND_PORT, BIND_ADDR, function () {
  console.log('listening on %s:%d', BIND_ADDR, BIND_PORT);
});

// ----------------------------------------------------------------------------
// request handler helpers

function setupToKillProcessOnConnectionAbort(req, proc) {
  var killed = false;
  var onAbort = function() {
    if (proc.pid > 0 && !killed) {
      console.log('request aborted. SIGKILL #%d', proc.pid);
      killed = true;
      try { proc.kill(9); }catch(e){}
    }
  };
  req.connection.on('end', onAbort);
  req.connection.on('close', onAbort)
  req.connection.on('timeout', onAbort)
  req.connection.on('error', onAbort)
}

function requireURIParam(req, res) {
  var uri = req.url.query.uri;
  if (!uri && req.message && typeof req.message === 'object')
    uri = req.message.uri;
  if (!spotnicc.parsePlaylistURI(uri)) {
    res.respond(400, 'Malformed or missing playlist URI');
    return false;
  }
  return uri;
}

function notifyUpdater(callback) {
  var cmd = "kill -USR1 `"+
            "ps xU www-data | "+
            "grep '/var/spotnicc/bin/spotnicc-updater.js' | "+
            "grep -v grep | "+
            "awk '{print $1}' | "+
            "tail -n1`";
  proc_exec(cmd, function (err, stdout, stderr) {
      if (err) console.error('failed to notify updater: '+err+' -- '+cmd);
      else console.log('notified updater');
      if (callback) callback(err, stdout, stderr);
  });
}

// ----------------------------------------------------------------------------

// add or update a playlist
// ?uri=<playlist-uri>&query=<string>
api['/playlist/put'] = function (req, res) {
  // only accept POST requests
  if (req.method !== 'POST')
    return res.respond(405, 'Only accepting POST requests');

  // shorthand for GET params
  var uri = requireURIParam(req, res),
      query = req.message.query;

  // 400 bad request if bad URI (response handled by requireURIParam)
  if (!uri) return;

  // 400 bad request if empty query
  if (query) query = String(query).trim();
  if (!query || query.length === 0) {
    return res.respond(400, 'Missing "query" parameter');
  }

  // Validate the playlist
  var proc = spotnicc.execValidatePlaylist(uri, function (msg, httpStatus) {
    if (msg.status === 0) {
      // Add or update the database
      var timestamp = 0;
      spotnicc.sdb.putPlaylist(uri, query, timestamp, function (err) {
        if (err) {
          httpStatus = 500;
          msg.status = 1;
          msg.message = String(err.stack || err);
        } else {
          // notify the updater that there are fresh playlists
          notifyUpdater();
        }
        res.respond(httpStatus, msg);
      })
    } else {
      res.respond(httpStatus, msg);
    }
  });
  setupToKillProcessOnConnectionAbort(req, proc);
}

// ----------------------------------------------------------------------------

// Read info associated with a registered playlist
// ?uri=<playlist-uri>
api['/playlist/get'] = function (req, res) {
  var uri = requireURIParam(req, res); if (!uri) return;
  spotnicc.sdb.findPlaylistWithURI(uri, function (err, info) {
    if (err) {
      res.respond(400, err.stack || err);
    } else {
      res.respond(200, info);
    }
  });
}

// ----------------------------------------------------------------------------

// Remove a registered playlist
// ?uri=<playlist-uri>
api['/playlist/remove'] = function (req, res) {
  var uri = requireURIParam(req, res); if (!uri) return;
  spotnicc.sdb.removePlaylist(uri, function (err, x, y) {
    console.log(x, y)
    if (err) res.respond(400, {message:err.stack || err});
    else res.respond(200, {message:'ok'});
  });
}

// ----------------------------------------------------------------------------

// Check validity and confirm collaborative status of the playlist
// ?uri=<playlist-uri>
api['/playlist/validate'] = function (req, res) {
  // shorthand for GET params
  var uri = requireURIParam(req, res); if (!uri) return;
  var proc = spotnicc.execValidatePlaylist(uri, function (msg, httpStatus) {
    //console.log('proc exited %d', msg.status)
    if (msg.status === 0) {
      // also lookup info (if we are already tracking this playlist)
      spotnicc.sdb.findPlaylistWithURI(uri, function (err, info) {
        if (!err && info)
          msg.info = info;
        res.respond(httpStatus, msg);
      })
    } else {
      res.respond(httpStatus, msg);
    }
  });
  setupToKillProcessOnConnectionAbort(req, proc);
  proc.stderr.on('data', function (data) {
    console.error('[validate:stderr] '+data.toString('utf8').replace(/\n$/,''));
  });
  proc.stdout.on('data', function (data) {
    console.error('[validate:stdout] '+data.toString('utf8').replace(/\n$/,''));
  });
}
