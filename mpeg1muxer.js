const child_process = require('child_process');
const util = require('util');
const events = require('events');   

const Mpeg1Muxer = function(options, Logger, streamSessions) {
  var key;
  this.name = options.name;
  this.url = options.url;
  this.width = options.width;
  this.height = options.height;
  this.ffmpegOptions = options.ffmpegOptions;
  this.wsPort = options.wsPort;
  this.exitCode = undefined;
  this.additionalFlags = [];
  this.Logger = Logger;
  this.streamSessions = streamSessions;
  if (this.ffmpegOptions) {
    for (key in this.ffmpegOptions) {
      this.additionalFlags.push(key);
      if (String(this.ffmpegOptions[key]) !== '') {
        this.additionalFlags.push(String(this.ffmpegOptions[key]));
      }
    }
  }     
  this.spawnOptions = [
    this.url,
    '-f',
    'mpegts',
    '-codec:v',
    'mpeg1video',
    ...this.additionalFlags,
    '-'
  ].flat();
  
  this.Logger.ui.debug('Stream command: ' + options.ffmpegPath + ' ' + this.spawnOptions.toString().replace(/,/g, ' '), this.name);
  this.stream = child_process.spawn(options.ffmpegPath, this.spawnOptions, {
    detached: false
  });
  this.Logger.ui.debug('Streaming started - Stream from ' + this.url, this.name);
  this.inputStreamStarted = true;
  this.stream.stdout.on('data', (data) => {
    return this.emit('mpeg1data', data);
  });
  this.stream.stderr.on('data', (data) => {
    return this.emit('ffmpegStderr', data);
  });
  this.stream.on('exit', (code, signal) => {
    this.inputStreamStarted = false;
    this.streamSessions.closeSession(this.name);
    if (code === 1) {
      this.Logger.ui.error('RTSP stream exited with error! (' + signal + ')', this.name);
      this.exitCode = 1;
      return this.emit('exitWithError');
    } else {
      this.Logger.ui.debug('Stream Exit (' + (code ? code : signal) + ')', this.name);
    }
  }); 
  return this;
};    

util.inherits(Mpeg1Muxer, events.EventEmitter);

module.exports = Mpeg1Muxer;
