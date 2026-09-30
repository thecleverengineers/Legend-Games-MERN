import "dotenv/config";
import connection from "../src/config/connectDB.js";
import bcrypt from "bcrypt";

const saltRounds = parseInt(process.env.SALT_ROUNDS || 5);

// Sanitized legacy schema example. The prior inline personal/account values
// were removed from the distributable package; use a local fixture if needed.
let user = {
  id: 1,
  id_user: "DEMO_USER_ID",
  phone: "0000000000",
  token: "REPLACE_WITH_LOCAL_TEST_TOKEN",
  name_user: "Example User",
  password: "",
  plain_password: "REPLACE_WITH_LOCAL_TEST_PASSWORD",
  money: 0,
  total_money: 0,
  bonus_money: 0,
  roses_f1: 0,
  roses_f: 0,
  roses_today: 0,
  level: 1,
  rank: 1,
  code: "DEMO_INVITE_CODE",
  invite: "DEMO_PARENT_CODE",
  ctv: "000000",
  veri: 1,
  otp: "000000",
  ip_address: "127.0.0.1",
  status: 1,
  today: "2023-10-04 12:00:25",
  time: "1700227388142",
  time_otp: "0",
  user_level: 3,
  avatar: "8-ea087ede.png",
};

const createUserTable = async () => {
  try {
    const db = await connection;

    await db.execute(`
        CREATE TABLE users (
            id int(11) NOT NULL AUTO_INCREMENT,
            id_user varchar(50) NOT NULL DEFAULT '0',
            phone varchar(20) NOT NULL DEFAULT '0',
            token varchar(100) NOT NULL DEFAULT '0',
            name_user varchar(50) NOT NULL DEFAULT '0',
            password varchar(300) NOT NULL DEFAULT '0',
            plain_password varchar(250) DEFAULT NULL,
            money float NOT NULL DEFAULT 0,
            total_money float NOT NULL DEFAULT 0,
            bonus_money float NOT NULL DEFAULT 0,
            roses_f1 int(11) NOT NULL DEFAULT 0,
            roses_f int(11) NOT NULL DEFAULT 0,
            roses_today int(11) NOT NULL DEFAULT 0,
            level int(11) NOT NULL DEFAULT 0,
            rank int(11) NOT NULL DEFAULT 0,
            code varchar(30) NOT NULL DEFAULT '0',
            invite varchar(30) NOT NULL DEFAULT '0',
            ctv varchar(50) NOT NULL DEFAULT '0',
            veri int(11) NOT NULL DEFAULT 0,
            otp varchar(10) NOT NULL DEFAULT '0',
            ip_address varchar(50) NOT NULL DEFAULT '0',
            status int(11) NOT NULL DEFAULT 0,
            today datetime NOT NULL DEFAULT current_timestamp(),
            time varchar(50) NOT NULL DEFAULT '0',
            time_otp varchar(50) NOT NULL DEFAULT '0',
            user_level int(11) DEFAULT 0,
            avatar varchar(50) DEFAULT '1-a6662edb.png',
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;
      `);

    console.log("Created user table successfully!");

    const hashedPassword = await bcrypt.hash(user.plain_password, saltRounds);
    user.password = hashedPassword;

    const isValid = await bcrypt.compare(user.plain_password, user.password);

    if (!isValid) {
      console.log("Password is invalid!");
      return;
    }
    const sql = `
        INSERT INTO users 
        (id, id_user, phone, token, name_user, password, plain_password, money, total_money, bonus_money, roses_f1, roses_f, roses_today, level, rank, code, invite, ctv, veri, otp, ip_address, status, today, time, time_otp, user_level, avatar) 
        VALUES 
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

    db.query(sql, Object.values(user));

    console.log("Inserted example administrator successfully!");
  } catch (error) {
    console.log(error);
    console.log("Failed to create user table!");
  }
};

createUserTable();

const test = async () => {
  // const hashedPassword = await bcrypt.hash(user.plain_password, 5);
  // const isValid = await bcrypt.compare(user.plain_password, hashedPassword);
  const isValid = await bcrypt.compare(user.plain_password, user.password);
  console.log(isValid);
};
// test();
