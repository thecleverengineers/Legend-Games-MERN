import "dotenv/config";
import mongoose from "mongoose";
import "../models/index.js";

if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
await mongoose.connect(process.env.MONGODB_URI);
await mongoose.syncIndexes();
console.log("MongoDB indexes are synchronized.");
await mongoose.disconnect();
