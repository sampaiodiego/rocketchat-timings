const EventEmitter = require('events');
const WebSocket = require('faye-websocket');
const { randomBytes } = require('crypto');
const https = require('https');
const { timeStamp } = require('console');

const {
	HOST_URL,
	AUTH_TOKEN,
	ROOM_ID,
	SEND_INTERVAL_MS = '20000',
	DEBUG = 'no',
} = process.env;

const random = () => randomBytes(16).toString('base64').replace(/[^A-Za-z0-9]+/g, '');

class RocketChat extends EventEmitter {
	constructor(host) {
		super();

		this.host = host;

		this.debug = ['yes', 'true'].includes(DEBUG);

		this.methodCount = 1;

		this._state = 'NOT_CONNECTED';

		this.ws = new WebSocket.Client(`wss://${ host }/sockjs/${ Math.floor(Math.random() * 1000) }/${ random() }/websocket`);

		this.ws.on('data', (frame) => {
			this.log('receive', frame);

			const [, char, msg] = frame.match(/([a-z])(\[.*\])?/);
			if (char === 'o') {
				return this.emit('open');
			}
			this.emit(char, msg);
		});
		this.ws.on('close', this.emit.bind(this, 'close'));


		this.on('ping', () => this.pong());
		this.on('open', () => this.send({"msg":"connect","version":"1","support":["1","pre2","pre1"]}));
		this.on('a', (msg) => {
			const data = this.parseIncoming(msg);

			if (data.msg === 'ping') {
				return this.emit('ping');
			}

			this.emit('data', data);
		});
		this.on('c', this.emit.bind(this, 'close'));
		this.on('data', (data) => {
			if (data.msg === 'connected') {
				this._state = 'CONNECTED';
				this.emit('connected', this.emit.bind(this, 'connected'));
			}

			if (data.msg === 'changed' && data.id === 'id' && data.collection.startsWith('stream')) {
				this.emit(`${ data.collection }::${ data.fields.eventName }`, data.fields.args[0]);
			}

			if (data.msg === 'result') {
				if (typeof data.error !== 'undefined') {
					return this.emit(`method-error::${ data.id }`, data.error);
				}
				return this.emit(`method-result::${ data.id }`, data.result);
			}
		});
	}

	log(action, log) {
		if (!this.debug) return;

		console.log(`[${ action }]`, new Date(), log);
	}

	parseIncoming(msg) {
		return JSON.parse(JSON.parse(msg));
	}
	parseOutgoing(msg) {
		return JSON.stringify([JSON.stringify(msg)]);
	}

	pong() {
		return this.send({msg:'pong'});
	}

	send(data) {
		const msg = this.parseOutgoing(data);
		this.log('sending', msg);
		return this.ws.send(msg);
	}

	method(name, ...params) {
		const method = this.methodCount++;
		const call = () => {
			this.send({"msg":"method","method": name,"params":params,"id": String(method)});
		};
		if (this._state !== 'CONNECTED') {
			this.once('connected', call);
		} else {
			call();
		}
		return new Promise((resolve, reject) => {
			this.once(`method-result::${ method }`, resolve);
			this.once(`method-error::${ method }`, reject);
		});
	}

	onStream(name, param, cb) {
		this.send({"msg":"sub","id": random(),name,"params":[param,{"useCollection":false,"args":[]}]});

		this.on(`${ name }::${ param }`, cb);
	}

	async login(token) {
		const result = await this.method('login', {"resume":token});

		this.authToken = result.token;
		this.userId = result.id;
		return result;
	}

	sendMessage(_id, rid, msg) {
		return new Promise((resolve, reject) => {
			const req = https.request({
				host: this.host,
				port: 443,
				path: '/api/v1/chat.sendMessage',
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'X-Auth-Token': this.authToken,
					'X-User-Id': this.userId,
				}
			}, (res) => {
				let result = '';

				res.on('data', (chunk) => { result += chunk; });
				res.on('end', () => resolve(JSON.parse(result)));
				res.on('error', reject);
			});

			req.write(JSON.stringify({
				message: {
					_id,
					rid,
					msg,
				},
			}));

			req.end();
		});
	}
}

const timings = new Map();

const showTimings = (msgId) => {
	if (!timings.has(`start-${ msgId }`) || !timings.has(`sent-${ msgId }`) || !timings.has(`received-${ msgId }`)) {
		return;
	}
	const start = timings.get(`start-${ msgId }`);
	const sent = timings.get(`sent-${ msgId }`);
	const received = timings.get(`received-${ msgId }`);

	timings.delete(`start-${ msgId }`);
	timings.delete(`sent-${ msgId }`);
	timings.delete(`received-${ msgId }`);

	// console.log('done    ', msgId, 'send:', sent - start, 'receive:', received - start);
	console.log(new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '')+','+(sent - start)+','+(received - start));
}

(async () => {
	const client = new RocketChat(HOST_URL);

	// client.on('data', (data) => console.log('data ->', data));
	client.on('close', (close) => console.log('close ->', close));

	const login = await client.login(AUTH_TOKEN);
	// console.log('login', login);

	client.onStream('stream-room-messages', ROOM_ID, (data) => {
		// console.log('msg ->', data);
		timings.set(`received-${ data._id }`, Date.now());

		// console.log('received', data._id);

		showTimings(data._id);
	});

	const sendMessage = async () => {
		const msgId = random();

		const start = Date.now();

		// const timing = { start };
		timings.set(`start-${ msgId }`, start);
		// console.log('sending ', msgId);

		const result = await client.sendMessage(msgId, ROOM_ID, `random simple message ${ msgId } - ${ start }`);
		timings.set(`sent-${ msgId }`, Date.now());

		// console.log('sent    ', msgId);
		showTimings(msgId);
	};

	await sendMessage();

	setInterval(sendMessage, parseInt(SEND_INTERVAL_MS));
})();
