import "dotenv/config";
import connection from "../src/config/connectDB.js";

// Sanitized legacy fixture. No production account, password, token or personal
// data is retained in this reference schema file.
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

const updateUserTable = async () => {
  try {
    const db = await connection;

    const [users] = await db.query("SELECT `id`, `id_user`, `code` FROM users");

    for (let i = 0; i < users.length; i++) {
      const id_user = users[i].id_user;
      const previousCode = users[i].code;
      const newCode = users[i].code.toString().slice(0, 5) + id_user;

      db.query(`UPDATE users SET code = ? WHERE code = ?`, [newCode, previousCode]);
      db.query(`UPDATE users SET invite = ? WHERE invite = ?`, [newCode, previousCode]);

      console.log("user code and invite successfully updated!", users[i].id, id_user, previousCode, newCode);
    }

    // const id_user = user.id_user;
    // const previousCode = user.code;
    // const newCode = user.code.toString().slice(0, 5) + id_user;
    // db.query(`UPDATE users SET money = money + ?, total_money = total_money + ? WHERE phone`);

    console.log("user code and invite successfully updated!");
  } catch (error) {
    console.log(error);
    console.log("Failed to update user invite codes!");
  }
};

updateUserTable();
