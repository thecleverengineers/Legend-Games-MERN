import "dotenv/config";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { User } from "../models/index.js";

if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD in your untracked .env file before seeding");
if (process.env.ADMIN_PASSWORD.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters long");

await mongoose.connect(process.env.MONGODB_URI);
const email = process.env.ADMIN_EMAIL.toLowerCase();
const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
const user = await User.findOneAndUpdate(
  { email },
  { $set: { name: "Platform Administrator", passwordHash, role: "admin", status: "active", mustResetPassword: false }, $setOnInsert: { referralCode: `LGADMIN${Date.now().toString(36).toUpperCase()}` } },
  { new: true, upsert: true, setDefaultsOnInsert: true },
);
console.log(`Administrator ready: ${user.email}`);
await mongoose.disconnect();
