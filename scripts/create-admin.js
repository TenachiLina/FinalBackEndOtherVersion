// Creates the first admin account (or any admin) directly in the database.
//
// Usage (reads MONGODB_URI from .env):
//   npm run create-admin
// You will be asked for the email, name and password. Or pass them as
// environment variables: ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD.

const dns = require('dns');
const readline = require('readline');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

dns.setServers(['1.1.1.1', '8.8.8.8']);

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    if (hidden) {
      // Print the prompt, then swallow the typed characters.
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set (check your .env file)');

  const email = (
    process.env.ADMIN_EMAIL || (await ask('Admin email: '))
  ).toLowerCase();
  const name = process.env.ADMIN_NAME || (await ask('Admin name: '));
  const password =
    process.env.ADMIN_PASSWORD || (await ask('Password (min 8 chars): ', true));

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('Invalid email');
  if (!name) throw new Error('Name is required');
  if (password.length < 8)
    throw new Error('Password must be at least 8 characters');

  await mongoose.connect(uri);
  const users = mongoose.connection.collection('users');
  if (await users.findOne({ email }))
    throw new Error(`A user with email ${email} already exists`);

  const now = new Date();
  await users.insertOne({
    email,
    name,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'admin',
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  console.log(
    `Admin ${email} created in database "${mongoose.connection.name}".`,
  );
}

main()
  .catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
