const child_process = require('child_process');
const util = require('util');
const events = require('events');   

const Mpeg1Muxer = function(options, log, debug) {
  var key;
  this.log = log;
  this.debug = debug;
  this.name = options.name;
  this.url = options.url;
  this.ffmpegOptions = options.ffmpegOptions;
  this.exitCode = undefined;
  this.additionalFlags = [];
  if (this.ffmpegOptions) {
    for (key in this.ffmpegOptions) {
      this.additionalFlags.push(key);
      if (String(this.ffmpegOptions[key]) !== '') {
        this.additionalFlags.push(String(this.ffmpegOptions[key]));
      }
    }
  }     
  this.spawnOptions = [
    '-i',
    this.url,
    '-f',
    'mpegts',
    '-codec:v',
    'mpeg1video',
    // additional ffmpeg options go here
    ...this.additionalFlags,
    '-'
  ];   
  this.stream = child_process.spawn(options.ffmpegPath, this.spawnOptions, {
    detached: false
  });
  this.inputStreamStarted = true;
  this.stream.stdout.on('data', (data) => {
    return this.emit('mpeg1data', data);
  });
  this.stream.stderr.on('data', (data) => {
    return this.emit('ffmpegStderr', data);
  });
  this.stream.on('exit', (code, signal) => {
    this.inputStreamStarted = false;
    if (code === 1) {
      this.debug('%s: RTSP stream exited with error', this.name);
      this.exitCode = 1;
      return this.emit('exitWithError');
    } else {
      this.debug('%s: Stream Exit (' + (code ? code : signal) + ')', this.name);
    }
  }); 
  return this;
};    

util.inherits(Mpeg1Muxer, events.EventEmitter);

module.exports = Mpeg1Muxer;
