'use strict';

const child_process = require('child_process');
const events = require('events');   
const util = require('util');

const Mpeg1Muxer = function(options, Logger, streamSessions) {
  
  this.Logger = Logger;
  this.options = options;
  this.cameraName = options.name;
  this.streamSessions = streamSessions;
  
  //this.exitCode; 
  this.additionalFlags = [];
  
  if(this.options.ffmpegOptions) {
    for(const key of Object.keys(this.options.ffmpegOptions)){
      this.additionalFlags.push(key, this.options.ffmpegOptions[key]);
    }
  }     
  
  this.spawnOptions = [
    this.options.url,
    '-f',
    'mpegts',
    '-codec:v',
    'mpeg1video',
    ...this.additionalFlags,
    '-'
  ].flat();
  
  this.Logger.ui.debug('Stream command: ' + this.options.ffmpegPath + ' ' + this.spawnOptions.toString().replace(/,/g, ' '), this.cameraName);
  
  this.stream = child_process.spawn(this.options.ffmpegPath, this.spawnOptions, {
    detached: false
  });
  
  this.Logger.ui.debug('Streaming started - Stream from ' + this.options.url, this.cameraName);
  
  this.stream.stdout.on('data', (data) => {
    return this.emit('mpeg1data', data);
  });
  
  this.stream.stderr.on('data', (data) => {
    return this.emit('ffmpegStderr', data);
  });
  
  this.stream.on('exit', (code, signal) => {
  
    if (code === 1) {
      this.Logger.ui.error('RTSP stream exited with error! (' + signal + ')', this.cameraName);
    } else {
      this.Logger.ui.debug('Stream Exit (expected)', this.cameraName);
    }
  
    return this.emit('streamExit', {
      code: code,
      signal: signal
    });
    
  }); 
  
  return this;

};    

util.inherits(Mpeg1Muxer, events.EventEmitter);

module.exports = Mpeg1Muxer;
