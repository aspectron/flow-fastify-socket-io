const fp = require('fastify-plugin');
const IO = require('socket.io');
const EventEmitter = require("events");

class IOHelper extends EventEmitter{

	static init(server, options){
		return new this(server, options)
	}
	static METHODS = Object.freeze({
		PUBLISH : 1,
		REQUEST : 2,
		SUBSCRIBE : 3
	})

	constructor(server, options){
		super();
		this.io = IO(server, options.ioConfig||{});
		this.initHandler(options.path||"/rpc")
	}
	initHandler(websocketPath) {
		const NAX_SUBSCRIPTIONS = 64;
		let socketsOpen = 0;
		this.websocketMap = new Map();
		this.tokenToSocketMap = new Map();

		this.websockets = this.io.of(websocketPath).on('connection', async (socket)=>{
			let session = {};
			/*
			let session = await this.getSocketSession(socket)
			.catch(err=>{
				this.log("getSocketSession:error", err)
			});

			session = session || {};
			socket.session = session;
			if(!session.user)
				session.user = { token : null }

			console.log("#### socket:init", socket.id, session)

			if(session.user.token)
				this.addSocketIdToTokenSocketMap(session.user.token, socket.id);
			*/


			socketsOpen++;
			let rids = 0;
			this.websocketMap.set(socket.id, socket);

			socket.emit('message', {subject:'init'});
	  		//socket.emit('message', {subject:'grpc.proto', data:{proto:this.grpcProto}});
	  		socket.on('grpc.proto.get', ()=>{
				//console.log("grpc.proto.get", this.grpcProto)
				socket.emit('message', {subject:'grpc.proto', data:{proto:this.grpcProto}});
			})

	  		this.emit("websocket.connect", {socket});

	  		socket.on('disconnect', ()=>{
	  			if(session.user?.token) {
	  				let socket_id_set = this.tokenToSocketMap.get(session.user.token);
	  				if(socket_id_set) {
	  					socket_id_set.delete(socket.id);
	  					if(!socket_id_set.size)
	  						this.tokenToSocketMap.delete(session.user.token);
	  				}
	  			}
	  			this.websocketMap.delete(socket.id);
	  			socketsOpen--;
	  		});


	  		socket.on('message', (msg, callback)=>{
	  			try {
	  				let { subject, data } = msg;
	  				this.emit(subject, data, { subject, socket, rpc : this });
	  			}
	  			catch(ex) {
	  				console.error(ex.stack);
	  			}
	  		});

	  		socket.on('rpc.req', async (msg) => {
	  			let { req : { subject, data }, rid } = msg;

	  			if(!data)
	  				data = { };
	  			if( !this.checkAuth(session.user, subject, data, IOHelper.METHODS.REQUEST) ){
	  				socket.emit('rpc.resp', {
	  					rid,
	  					error: "Access Denied"
	  				});
	  				return;
	  			}

	  			try {
	  				if(!subject || subject == 'init-http') {
	  					socket.emit('rpc.resp', {
	  						rid,
	  						error: "Malformed request"
	  					});
	  				}else{
	  					let listeners = this.listeners(subject);
	  					if(listeners.length == 1) {
	  						let callback = (error, data) => {

	  							socket.emit('rpc::response', {
	  								rid, error, data
	  							});
	  						}
	  						let p = listeners[0](data, callback, { subject, socket, rpc : this });
	  						if(p && typeof(p.then == 'function')) {
	  							let data = null;
	  							try {
	  								data = await p;
	  							} catch(ex) { 
	  								console.log(ex);
	  								return callback(ex); 
	  							}
	  							callback(null, data);
	  						}
	  					}else if(listeners.length){
	  						socket.emit('rpc::response', {
	  							rid,
	  							error: `Too many handlers for ${subject}`
	  						});
	  					}else{
	  						socket.emit('rpc::response', {
	  							rid,
	  							error : `No such handler ${JSON.stringify(subject)}`
	  						});
	  					}
	  				}
	  			}
	  			catch(ex) { console.error(ex.stack); }
	  		});

	  	});
	}
	checkAuth(user, subject, data, method){
		return true;
	}
}

/**
 * Creates a new Socket.io server and decorate Fastify with its instance.
 * @param {Object} fastify - Fastify instance
 * @param {Object} options - Plugin's options that will be sent to Socket.io contructor
 * @param {Function} next - Fastify next callback
 */
 function fastiySocketIo(fastify, options, next) {
 	try {
 		let instance = options?.init?.(fastify.server, options, fastify)||IOHelper.init(fastify.server, options, fastify);

		//use io wherever you want to use socketio, just provide it in the registration context
		fastify.decorate('io', instance);
		fastify.decorate('socket-io-instance', instance.io);

		next();
	} catch (error) {
		next(error);
	}
}

let fpFn = fp(fastiySocketIo, {
	name: 'fastify-socket.io',
});

fpFn.IOHelper = IOHelper;


module.exports = fpFn;