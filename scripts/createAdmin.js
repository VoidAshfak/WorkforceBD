// Creates (or updates) the platform admin account for the dashboard portal.
// The admin signs in with username + password and a 2FA code mailed to `email`,
// so all four values are required.
//
// Usage:
//   node scripts/createAdmin.js --phone +8801XXXXXXXXX --email admin@gmail.com --username admin --password "StrongPass123"
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db/index.js";

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
}

const { phone, email, username, password } = args;
if (!phone || !email || !username || !password) {
  console.error("Usage: node scripts/createAdmin.js --phone +8801XXXXXXXXX --email you@gmail.com --username admin --password <password>");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters");
  process.exit(1);
}

const password_hash = await bcrypt.hash(password, 12);

const existing = await prisma.users.findUnique({ where: { phone } });
const user = existing
  ? await prisma.users.update({
      where: { id: existing.id },
      data: {
        email,
        username,
        password_hash,
        roles: existing.roles.includes("admin") ? existing.roles : [...existing.roles, "admin"],
        is_active: true,
      },
    })
  : await prisma.users.create({
      data: { phone, email, username, password_hash, roles: ["admin"], is_phone_verified: true },
    });

console.log(`Admin ready | id=${user.id} username=${user.username} email=${user.email} roles=${user.roles}`);
await prisma.$disconnect();
