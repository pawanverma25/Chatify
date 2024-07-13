import express from "express";
import { db, connectionToDB } from "./db.js";
import admin from "firebase-admin";
import path from "path";
import "dotenv/config";
import { fileURLToPath } from "url";
import { uid } from "uid/secure";
import { createServer } from "http";
import { Server } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "./build")));

const httpServer = createServer(app);
const io = new Server(httpServer, {
	cors: {
		origins: [],
	},
});

const credentials = {
	type: process.env.FIREBASE_TYPE,
	project_id: process.env.FIREBASE_PROJECT_ID,
	private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
	private_key: process.env.FIREBASE_PRIVATE_KEY,
	client_email: process.env.FIREBASE_CLIENT_EMAIL,
	client_id: process.env.FIREBASE_CLIENT_ID,
	auth_uri: process.env.FIREBASE_AUTH_URI,
	token_uri: process.env.FIREBASE_TOKEN_URI,
	auth_provider_x509_cert_url:
		process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
	client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
	universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
};

admin.initializeApp({
	credential: admin.credential.cert(credentials),
});

io.on("connection", (socket) => {
	socket.on("join-chat", (chat_id) => {
		socket.join(chat_id);
		socket.to(chat_id).emit("new-chat", {});
	});

	socket.on("send-message", async (message) => {
		socket.to(message.chat_id).emit("recieve-message", message);
		await db.collection("messages").insertOne(message);
		await db.collection("chats").updateOne(
			{
				chat_id: message.chat_id,
			},
			{
				$set: { last_message: message.time },
			}
		);
	});

	socket.on("clear-chat", async ({ dateUpdateMessage, message }) => {
		socket
			.to(message.chat_id)
			.emit("chat-cleared", [dateUpdateMessage, message]);
		await db
			.collection("messages")
			.deleteMany({ chat_id: message.chat_id });
		await db
			.collection("messages")
			.insertMany([dateUpdateMessage, message]);
	});

	socket.on("disconnect", () => {
		console.log("disconnected ", socket.id);
	});
});

app.use(async (req, res, next) => {
	const { authtoken } = req.headers;
	if (authtoken) {
		try {
			const { uid } = await admin.auth().verifyIdToken(authtoken);
			req.user = await admin.auth().getUser(uid);
		} catch (e) {
			return res.sendStatus(400);
		}
	}
	req.user = req.user || {};
	next();
});

app.get("/api/search/", async (req, res) => {
	var re = new RegExp("^" + req.query.query + ".*");
	var response = await db
		.collection("users")
		.find(
			{
				username: re,
			},
			{
				projection: { chathistory: 0, _id: 0 },
			}
		)
		.sort({ username: 1 })
		.toArray();
	res.send([response, []]);
	res.end();
});

app.get("/api/check/", async (req, res) => {
	var response = await db.collection("users").findOne({
		username: req.query.username,
	});
	res.send(response === null);
	res.end();
});

app.get("/api/user/", async (req, res) => {
	var userData = await db.collection("users").findOne(
		{
			u_id: req.user.uid,
		},
		{
			projection: { _id: 0 },
		}
	);
	if (userData === null) {
		res.sendStatus(404);
		return;
	}
	for (var i = 0; i < userData.chathistory.length; i++) {
		let { chat_id, u_id } = userData.chathistory[i];
		let chat = await db.collection("chats").findOne({
			chat_id: chat_id,
		});
		let reciever = await db.collection("users").findOne(
			{
				u_id: u_id,
			},
			{
				projection: { _id: 0, email: 0, chathistory: 0 },
			}
		);
		userData.chathistory[i] = {
			chat_id,
			last_message: chat.last_message,
			...reciever,
		};
	}
	res.send(userData);
	res.end();
});

app.put("/api/setup/", async (req, res) => {
	await db
		.collection("users")
		.insertOne({ u_id: req.user.uid, ...req.body.userData });
	res.end();
});

app.put("/api/edit/", async (req, res) => {
	const response = await db.collection("users").replaceOne(
		{
			u_id: req.user.uid,
		},
		req.body.userData
	);
	res.end();
});

app.get("/api/messages/", async (req, res) => {
	var response = await db
		.collection("messages")
		.find({
			chat_id: req.query.chat_id,
		})
		.sort({ time: 1 })
		.toArray();
	res.send(response);
	res.end();
});

app.put("/api/startchat/", async (req, res) => {
	const user1 = req.body.users[0],
		user2 = req.body.users[1];
	const users = [user1.u_id, user2.u_id].sort();
	var chat = await db.collection("chats").findOne({
		users: users,
	});
	var response = {
		chat_id: null,
		found: chat !== null,
	};
	if (!chat) {
		chat = {
			chat_id: uid(16),
		};
		const firstMessage = {
			chat_id: chat.chat_id,
			type: 0,
			text: "happy chatting",
			time: Date.now() + 330 * 60000,
		};
		await db.collection("users").updateOne(
			{
				username: user1.username,
			},
			{
				$push: {
					chathistory: {
						$each: [{ chat_id: chat.chat_id, u_id: user2.u_id }],
					},
				},
			}
		);
		await db.collection("users").updateOne(
			{
				username: user2.username,
			},
			{
				$push: {
					chathistory: {
						$each: [{ chat_id: chat.chat_id, u_id: user1.u_id }],
					},
				},
			}
		);
		response.last_message = firstMessage.time;
		await db.collection("messages").insertOne(firstMessage);
		await db.collection("chats").insertOne({
			chat_id: chat.chat_id,
			users: users,
			last_message: firstMessage.time,
		});
	}
	response.chat_id = chat.chat_id;
	res.send(response);
	res.end();
});

app.get("*", (req, res) => {
	res.sendFile(path.join(__dirname + "/build/index.html"));
});

app.set("port", process.env.PORT || 8000);

connectionToDB(() => {
	console.log("successfully connected to databases");
	httpServer.listen(app.get("port"), function () {
		console.log("Running on : ", httpServer.address().port);
	});
});
