const ws = require('ws');
const util = require('util');
const events = require('events');
const https = require('https');

const Mpeg1Muxer = require('./mpeg1muxer');  

const STREAM_MAGIC_BYTES = 'jsmp'; // Must be 4 bytes   

const VideoStream = function(options, log, debug, api) {
  this.options = options;
  this.name = options.name;
  this.streamUrl = options.streamUrl;
  this.width = options.width;
  this.height = options.height;
  this.wsPort = options.wsPort;
  this.reloadTimer = options.reloadTimer * 1000 | 30000;
  this.stream = undefined;
  this.log = log;
  this.debug = debug;
  
  this.ssl = options.ssl;
  
  this.quit = false;
  
  api.on('shutdown', () => {
    this.stopAll();
  });
  
  return this;
};

util.inherits(VideoStream, events.EventEmitter);

VideoStream.prototype.stopAll = function() {
  
  this.debug('%s: Closing streaming server..', this.name);
  this.quit = true;
  
  if(this.wsServer)
    this.wsServer.close();
  
  if(this.stream)
    this.stream.kill();

  return this;
};

VideoStream.prototype.stopStream = function() {
  
  if(this.stream)
    this.stream.kill();

  return this;
};

VideoStream.prototype.startMpeg1Stream = function() {
  var gettingInputData, gettingOutputData, inputData, outputData;
  this.mpeg1Muxer = new Mpeg1Muxer({
    name: this.name,
    wsPort: this.wsPort,
    ffmpegOptions: this.options.ffmpegOptions,
    preArgs: this.options.preArgs,
    url: this.streamUrl,
    ffmpegPath: this.options.ffmpegPath == undefined ? 'ffmpeg' : this.options.ffmpegPath,
    ssl: this.ssl
  }, this.log, this.debug);
  this.stream = this.mpeg1Muxer.stream;
  if (!this.mpeg1Muxer.inputStreamStarted) {
    return;
  }
  this.mpeg1Muxer.on('mpeg1data', (data) => {
    return this.emit('camdata', data);
  });
  gettingInputData = false;
  inputData = [];
  gettingOutputData = false;
  outputData = [];
  this.mpeg1Muxer.on('ffmpegStderr', (data) => {
    var size;
    data = data.toString();
    if (data.indexOf('Input #') !== -1) {
      gettingInputData = true;
    }
    if (data.indexOf('Output #') !== -1) {
      gettingInputData = false;
      gettingOutputData = true;
    }
    if (data.indexOf('frame') === 0) {
      gettingOutputData = false;
    }
    if (gettingInputData) {
      inputData.push(data.toString());
      size = data.match(/\d+x\d+/);
      if (size != null) {
        size = size[0].split('x');
        if (this.width == null) {
          this.width = parseInt(size[0], 10);
        }
        if (this.height == null) {
          return this.height = parseInt(size[1], 10);
        }
      }
    }
  });
  this.mpeg1Muxer.on('ffmpegStderr', function(data) {
    return global.process.stderr.write(data);
  });
  this.mpeg1Muxer.on('exitWithError', () => {
    return this.emit('exitWithError');
  });
  return this;
};

VideoStream.prototype.pipeStreamToSocketServer = function() {
  
  if(this.ssl){
  
    const server = https.createServer({
      cert: this.ssl.cert,
      key: this.ssl.key
    });
  
    this.wsServer = new ws.Server({ server });
    
    server.listen(this.wsPort);
    
    this.log('%s Awaiting WebSocket connections on wss://localhost:' + this.wsPort + '/', this.name);
  
  } else {
  
    this.wsServer = new ws.Server({
      port: this.wsPort
    });
    
    this.log('%s Awaiting WebSocket connections on ws://localhost:' + this.wsPort + '/', this.name);
  
  }
  
  this.wsServer.on('connection', (socket, request) => {
    return this.onSocketConnect(socket, request);
  });
  this.wsServer.broadcast = function(data, opts) {
    var results;
    results = [];
    for (let client of this.clients) {
      if (client.readyState === 1) {
        results.push(client.send(data, opts));
      } else {
        results.push((this.name + ': Error: Client from remoteAddress ' + client.remoteAddress + ' not connected.'));
      }
    }
    return results;
  };
  return this.on('camdata', (data) => {
    return this.wsServer.broadcast(data);
  });
};

VideoStream.prototype.onSocketConnect = function(socket, request) {
  var streamHeader;
  // Send magic bytes and video size to the newly connected socket
  // struct { char magic[4]; unsigned short width, height;}
  streamHeader = new Buffer(8);
  streamHeader.write(STREAM_MAGIC_BYTES);
  streamHeader.writeUInt16BE(this.width, 4);
  streamHeader.writeUInt16BE(this.height, 6);
  socket.send(streamHeader, {
    binary: true
  });
  this.debug(`${this.name}: New WebSocket Connection (` + this.wsServer.clients.size + ' total)');
  
  if(this.wsServer.clients.size && (this.mpeg1Muxer && !this.mpeg1Muxer.inputStreamStarted) || !this.mpeg1Muxer)
    this.startMpeg1Stream();

  if(this.reload)
    clearTimeout(this.reload);

  socket.remoteAddress = request.connection.remoteAddress;

  return socket.on('close', (code, message) => {   
    
    if(!this.wsServer.clients.size && !this.quit)
      this.debug('%s: If no clients connects to the Websocket, the stream will be closed in ' + this.reloadTimer/1000 + 's', this.name);
    
    this.reload = setTimeout(() => {  //check if user just reload page
       
      if(!this.wsServer.clients.size)
        this.stopStream();
      
      this.reload = false;            
    
    }, this.reloadTimer);     
    
    return this.debug(`${this.name}: Disconnected WebSocket (` + this.wsServer.clients.size + ' total)');
  });
};

module.exports = VideoStream;
