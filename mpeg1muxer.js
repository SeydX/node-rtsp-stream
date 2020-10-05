const debug = require('debug')('CameraUIStream');

const child_process = require('child_process');
const util = require('util');
const events = require('events');   

const Mpeg1Muxer = function(options) {
  var key;
  this.name = options.name;
  this.url = options.url;
  this.width = options.width;
  this.height = options.height;
  this.ffmpegOptions = options.ffmpegOptions;
  this.wsPort = options.wsPort;
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
    this.url,
    '-f',
    'mpegts',
    '-codec:v',
    'mpeg1video',
    ...this.additionalFlags,
    '-'
  ].flat();
  
  debug('%s: Stream command: %s %s', this.name, options.ffmpegPath, this.spawnOptions.toString().replace(/,/g, ' '));
  this.stream = child_process.spawn(options.ffmpegPath, this.spawnOptions, {
    detached: false
  });
  debug('%s: Streaming started - Stream from ' + this.url + ' to localhost:' + this.wsPort + '/', this.name);
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
      debug('%s: RTSP stream exited with error! (%s)', this.name, signal);
      this.exitCode = 1;
      return this.emit('exitWithError');
    } else {
      debug('%s: Stream Exit (' + (code ? code : signal) + ')', this.name);
    }
  }); 
  return this;
};    

util.inherits(Mpeg1Muxer, events.EventEmitter);

module.exports = Mpeg1Muxer;
