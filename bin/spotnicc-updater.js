require.paths.unshift(__dirname+'/../nodelib');

var writeError = process.binding('stdio').writeError;
var spotnicc = require('spotnicc');

var scheduleTimer, lastRunDate,
    running = false,
    pendingExplicitDate,
    baseDelay = 1000*60*30; // every 30 minutes

/*spotnicc.sdb.putItem('spotnicc_playlists', 'spotify:user:rasmus:playlist:0xYvy4zC1uP1GqkGYwhmGv',
            {query:'royksopp OR robyn', last_updated:(new Date).getTime()}, function(error) {
  spotnicc.sdb.getItem('spotnicc_playlists', 'spotify:user:rasmus:playlist:0xYvy4zC1uP1GqkGYwhmGv', function(error, result) {
    console.log('=> ', result)
  })
}); return;*/

function updateNextPlaylist(playlistQueue, onUpdated, finalCallback) {
  var playlist = playlistQueue.shift();
  if (!playlist) {
    finalCallback();
    return;
  }
  console.log('updating %j', playlist);
  
  // update timestamp
  spotnicc.setPlaylistLastUpdated(playlist);
  var uri = playlist['$ItemName'];
  var proc = spotnicc.refreshPlaylist(uri, playlist.query, function (err, msg) {
    if (err) {
      console.error('failed to update %s [%d] %s', uri, msg.status, err.message);
    } else {
      console.log('updated %s', uri);
    }
    if (onUpdated) onUpdated(playlist, msg);
    updateNextPlaylist(playlistQueue, onUpdated, finalCallback);
  });
  var fwdout = function (data) { process.stdout.write(data); }
  proc.stderr.on('data', fwdout);
  proc.stdout.on('data', fwdout);
}

function findAndUpdatePlaylists (minAge, callback) {
  if (typeof minAge !== 'number')
    minAge = 1000*60*60; // 1h
  var minTime = String((new Date).getTime()-minAge);
  if (minAge < 0) {
    // special case
    minTime = -minAge;
  }
  running = true;
  var finalCallback = function() {
    running = false;
    if (callback) callback();
  }
  spotnicc.sdb.findPlaylistsNotUpdatedSince(minTime, true, function(err, playlists, meta) {
    //console.log('meta => ', meta)
    if (err) throw err;
    console.log('found %d playlists not updated in %d seconds',
                playlists.length, Math.round(minAge/1000));
    // playlists => [ { '$ItemName': 'spotify:user:rasmus:playlist:0xYvy4zC1uP1GqkGYwhmGv',
    //  query: 'royksopp OR robyn',
    //  last_updated: '1296074452706' } ]
    updateNextPlaylist(playlists, null, finalCallback);
  });
}

function findAndUpdatePlaylistsAndReschedule(minAge) {
  clearTimeout(scheduleTimer);
  lastRunDate = new Date;
  findAndUpdatePlaylists(minAge, function() {
    if (pendingExplicitDate) {
      // looks like we received some pending explicit updates during last run.
      // re-schedule immediately
      console.log('rescheduling immediately (pending explicit updates)');
      pendingExplicitDate = null;
      findAndUpdatePlaylistsAndReschedule(-1);
    } else {
      scheduleFindAndUpdatePlaylists();
    }
  });
}

function scheduleFindAndUpdatePlaylists(minAge) {
  clearTimeout(scheduleTimer);
  var timeSinceLastRun = lastRunDate ? ((new Date) - lastRunDate) : baseDelay;
  var delay = baseDelay - timeSinceLastRun;
  if (delay > 0) {
    console.log('schedule: run in %d seconds', delay/1000);
    scheduleTimer = setTimeout(function(){ findAndUpdatePlaylistsAndReschedule(minAge) }, delay);
  } else {
    //console.log('schedule: run now');
    findAndUpdatePlaylistsAndReschedule(minAge);
  }
}

// signal handler for "explicit update" event
process.on('SIGUSR1', function () {
  console.log('Got SIGUSR1 for "explict update"');
  pendingExplicitDate = new Date;
  if (!running) {
    findAndUpdatePlaylistsAndReschedule(-1);
    pendingExplicitDate = null;
  }
});

// start
console.log('starting')
scheduleFindAndUpdatePlaylists();
