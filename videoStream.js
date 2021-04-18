'use strict';

const events = require('events');
const https = require('https');
const util = require('util');
const ws = require('ws');

const Mpeg1Muxer = require('./mpeg1muxer');  

const STREAM_MAGIC_BYTES = 'jsmp'; // Must be 4 bytes   

const VideoStream = function(options, logger, streamSessions) {
  
  this.logger = logger;
  
  this.options = options;
  this.cameraName = options.name;
  this.reloadTimer = options.reloadTimer * 1000 || 30000;

  this.streamSessions = streamSessions; 
  
  return this;

};

util.inherits(VideoStream, events.EventEmitter);

VideoStream.prototype = {

  ping: function(){},  
  
  heartbeat: function(socket, msg){ 
  
    if(msg && msg === '--heartbeat--'){ //from client    
      //this.logger.debug('received heartbeat from client', this.cameraName + ' (' + socket.remoteAddress + ')');
      socket.send('--ping--');
    } else {
      this.logger.debug(`WebSocket: received heartbeat from socket ${socket.remoteAddress}`, this.cameraName, true);
    }  
    
    socket.isAlive = true;            
  
  },
  
  pipeStreamToServer: function(){
                                                         
    if(this.options.ssl){ 
      
      const server = https.createServer({
        cert: this.options.ssl.cert,
        key: this.options.ssl.key
      }).listen(this.options.wsPort);
          
      this.WebSocket = new ws.Server({ server: server, perMessageDeflate:false });
      
      this.logger.debug(`WebSocket: Awaiting WebSocket connections on wss://localhost:${this.options.wsPort}`, this.cameraName, true);
    
    } else {    
    
      this.WebSocket = new ws.Server({
        port: this.options.wsPort,
        perMessageDeflate:false 
      });
      
      this.logger.debug(`WebSocket: Awaiting WebSocket connections on ws://localhost:${this.options.wsPort}`, this.cameraName, true);
    
    }

    this.WebSocket.on('error', (error) => {
      let err;
   
      if (error.syscall !== 'listen'){
        logger.error(error, false, true);
      }

      let bind = typeof port === 'string'
        ? 'Pipe ' + this.options.wsPort
        : 'Socket port ' + this.options.wsPort;

      switch (error.code) {
        case 'EACCES':
          err = `Can not connect to stream server! ${bind} requires elevated privileges`;
          break;
        case 'EADDRINUSE':
          err = `Can not connect to stream server! ${bind} is already in use`;
          break;
        default:
          err = error;
      }

      this.logger.error(err, false,true);
    });
    
    this.WebSocket.on('connection', (socket, request) => {
      return this.onConnection(socket, request);
    });
  
    this.pingInterval = setInterval(() => {
    
      if(this.WebSocket.clients.size)
        this.logger.debug(`WebSocket: Pinging sockets..`, this.cameraName, true);
    
      this.WebSocket.clients.forEach(socket => {
        
        if (socket.isAlive === false)
          return socket.terminate();
        
        socket.isAlive = false;
        socket.ping(this.ping.bind(this));
      
      });
    
    }, 10000);
    
    return;
  
  },
  
  onConnection: function(socket, request) {
  
    let streamHeader, allowStream;
    
    // Send magic bytes and video size to the newly connected socket
    // struct { char magic[4]; unsigned short width, height;}
    streamHeader = new Buffer(8);
    streamHeader.write(STREAM_MAGIC_BYTES);
    streamHeader.writeUInt16BE(this.options.width, 4);
    streamHeader.writeUInt16BE(this.options.height, 6);
    
    socket.send(streamHeader, {
      binary: true
    });
    
    socket.isAlive = true; 
    socket.remoteAddress = request.connection.remoteAddress;
    socket.on('pong', this.heartbeat.bind(this, socket));
    socket.on('message', this.heartbeat.bind(this, socket));
    
    this.logger.debug(`WebSocket: New WebSocket connection from ${socket.remoteAddress} (${this.WebSocket.clients.size} total)`, this.cameraName, true);
      
    if(this.streamTimeout){
      clearTimeout(this.streamTimeout);
      this.streamTimeout = null;
    }
  
    if(this.WebSocket.clients.size && !this.mpeg1Muxer){
      
      allowStream = this.streamSessions.requestSession(this.cameraName);
      
      if(allowStream)
        this.startStream();
    
    }
    
    socket.on('close', () => {
      
      this.logger.debug(`WebSocket: ${socket.remoteAddress} disconnected or closed from WebSocket (${this.WebSocket.clients.size} total)`, this.cameraName, true);
      
      if(!this.WebSocket.clients.size){
      
        this.logger.debug(`WebSocket: If no clients connects to the Websocket, the stream will be closed in ${this.reloadTimer/1000}s`, this.cameraName, true);
        
        this.streamTimeout = setTimeout(() => {  //check if user just reload page
           
          if(!this.WebSocket.clients.size)
            this.stopStream();
          
          this.streamTimeout = null;            
        
        }, this.reloadTimer);
      
      } 
    
    });
    
    return;
  
  },
  
  onBroadcast: function(data, opts) {
  
    const results = [];

    for (const client of this.WebSocket.clients) {
      if (client.readyState === 1) {
        results.push(client.send(data, opts));
      } else {
        results.push((`${this.cameraName}: WebSocket: Error: Client from remoteAddress ${client.remoteAddress} not connected.`));
      }
    }
    
    return results;
  
  },
  
  startStream: function(){
  
    let gettingInputData = false;
    //let gettingOutputData = false;
    
    const inputData = [];
    //const outputData = [];
    
    const mpegOptions = {
      name: this.cameraName,
      width: this.options.width,
      height: this.options.height,
      ffmpegOptions: this.options.ffmpegOptions,
      url: this.options.streamUrl,
      ffmpegPath: !this.options.ffmpegPath
        ? 'ffmpeg' 
        : this.options.ffmpegPath,
      ssl: this.options.ssl
    };
    
    this.mpeg1Muxer = new Mpeg1Muxer(mpegOptions, this.logger, this.streamSessions);
    
    this.mpeg1Muxer.on('mpeg1data', (data) => {
      return this.onBroadcast(data);
    });

    this.mpeg1Muxer.on('ffmpegStderr', (data) => {
      
      let size;
      data = data.toString();
      
      if(data.indexOf('Input #') !== -1){
        gettingInputData = true;
      }
      
      if(data.indexOf('Output #') !== -1){
        gettingInputData = false;
        //gettingOutputData = true;
      }
      
      /*if(data.indexOf('frame') === 0){
        gettingOutputData = false;
      }*/
      
      if(gettingInputData){
        
        inputData.push(data);
        
        size = data.match(/\d+x\d+/);
        
        if(size != null){
          
          size = size[0].split('x');
          
          if(this.options.width == null){
            this.options.width = parseInt(size[0], 10);
          }
          
          if(this.options.height == null){
            this.options.height = parseInt(size[1], 10);
          }
        
        }
      
      }
      
      return;
    
    });
    
    this.mpeg1Muxer.on('streamExit', () => {
      this.mpeg1Muxer = false;
      this.streamSessions.closeSession(this.cameraName);
      return;
    });
    
    return;
  
  },
  
  stopStream: function(){
  
    if(this.mpeg1Muxer && this.mpeg1Muxer.stream){
      this.logger.debug('WebSocket: Closing Stream..', this.cameraName, true);
      this.mpeg1Muxer.stream.kill();
    }
      
    return;

  },
  
  destroy: function(){

    this.logger.debug(`WebSocket: Closing WebSocket and Stream..`, this.cameraName, true);
    
    if(this.WebSocket)
      this.WebSocket.close();
    
    if(this.mpeg1Muxer && this.mpeg1Muxer.stream)
      this.mpeg1Muxer.stream.kill();
  
    return;
  
  }
  
};

module.exports = VideoStream;
