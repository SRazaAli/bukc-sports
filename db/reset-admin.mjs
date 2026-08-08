import bcrypt from 'bcryptjs';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const hash = await bcrypt.hash('AdminPass123!', 12);
await c.query(
  "UPDATE app_user SET password_hash=$1, failed_login_count=0, locked_until=NULL WHERE email='admin@bukc.edu.pk'",
  [hash]
);
console.log('admin password reset');
await c.end();