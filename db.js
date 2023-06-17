import { MongoClient } from "mongodb";

let db;

async function connectionToDB(cb) {
	const client = new MongoClient(
		`mongodb+srv://${process.env.MONGO_USERNAME}:${process.env.MONGO_PASSWORD}@cluster0.jckonjc.mongodb.net/?retryWrites=true&w=majority`
	);
	await client.connect();
	db = client.db("chatify");
	cb();
}
export { db, connectionToDB };
