require.paths.unshift(__dirname+'/../nodelib');
var yeah = require('yeah');

yeah.sdb.findPlaylistsNotUpdatedSince((new Date).getTime(), function (err, playlists, meta) {
  //console.log(meta);
  console.log('%d entries:', playlists ? playlists.length : 0);
  playlists.forEach(function (playlist) {
    var uri = playlist['$ItemName'];
    delete playlist['$ItemName'];
    console.log('%s\t%j', uri, playlist);
  })
});
