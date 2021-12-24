const WebSocket = require('faye-websocket');

const {
	SERVER_URL = 'ws://localhost:8010',
	INTERVAL_MS = '20000',
} = process.env;

const ws = new WebSocket.Client(SERVER_URL);

const log = (...args) => console.log(new Date().toISOString(), ...args);

ws.on('data', (frame) => {
	log('<', frame);
});

ws.on('close', () => {
	console.log('close');
});

const ping = () => {
	log('> ping');
	ws.send('ping');

	setTimeout(ping, parseInt(INTERVAL_MS));
};

ping();
