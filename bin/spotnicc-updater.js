require.paths.unshift(__dirname+'/../nodelib');

var writeError = process.binding('stdio').writeError;
var spotnicc = require('spotnicc');

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
  console.log('Updating %j', playlist);
  
  // update timestamp
  spotnicc.setPlaylistLastUpdated(playlist);
  
  //setTimeout(function(){updateNextPlaylist(playlistQueue, onUpdated, finalCallback);},1000);return;
  var proc = spotnicc.execConfigurePlaylist(playlist['$ItemName'], playlist.query, function (msg) {
    if (msg.status != 0) {
      console.error('Failed to update %j [%d] %s', playlist, msg.status, msg.message);
    } else {
      console.log('Updated %j', playlist);
    }
    if (onUpdated) onUpdated(playlist, msg);
    updateNextPlaylist(playlistQueue, onUpdated, finalCallback);
  });
  proc.stderr.on('data', function (data) {
    writeError(data.toString('utf8'));
  });
  proc.stdout.on('data', function (data) {
    process.stdout.write(data);
  });
}

function findAndUpdatePlaylists (minAge, callback) {
  if (typeof minAge !== 'number') minAge = 1000*60*60; // 1h
  var one_hour_ago = String((new Date).getTime()-minAge);
  spotnicc.sdb.findPlaylistsNotUpdatedSince(one_hour_ago, function (err, playlists, meta) {
    //console.log('meta => ', meta)
    if (err) throw err;
    console.log('playlists ->', playlists);
    // playlists => [ { '$ItemName': 'spotify:user:rasmus:playlist:0xYvy4zC1uP1GqkGYwhmGv',
    //  query: 'royksopp OR robyn',
    //  last_updated: '1296074452706' } ]
    updateNextPlaylist(playlists, null, callback);
  });
}

var scheduleTimer, lastRunDate,
    baseDelay = 1000*60*5; // every 5 minutes
function scheduleFindAndUpdatePlaylists(minAge) {
  if (scheduleTimer) {
    clearTimeout(scheduleTimer);
    scheduleTimer = null;
  }
  var timeSinceLastRun = lastRunDate ? ((new Date) - lastRunDate) : baseDelay;
  var delay = baseDelay - timeSinceLastRun;
  var start = function(){
    lastRunDate = new Date;
    findAndUpdatePlaylists(minAge, function() {
      scheduleFindAndUpdatePlaylists();
    });
  };
  if (delay > 0) {
    console.log('schedule: run in %d seconds', delay/1000);
    scheduleTimer = setTimeout(start, delay);
  } else {
    console.log('schedule: run now');
    start();
  }
}

// start
scheduleFindAndUpdatePlaylists(1000);
