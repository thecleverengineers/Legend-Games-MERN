import "dotenv/config";
import mongoose from "mongoose";
import { startGameClock } from "./services/games.js";

if (!process.env.MONGODB_URI)
  throw new Error(
    "MONGODB_URI is required. Copy .env.example to an untracked .env file.",
  );

await mongoose.connect(process.env.MONGODB_URI, {
  autoIndex: process.env.NODE_ENV !== "production",
});
const clock = startGameClock();
console.log("Legend Games settlement worker is running.");

const close = async () => {
  clearInterval(clock);
  await mongoose.disconnect();
  process.exit(0);
};

process.on("SIGTERM", close);
process.on("SIGINT", close);
