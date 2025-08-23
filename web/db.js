import { Pool } from 'pg';
import 'dotenv/config';
import dotenv from "dotenv";
dotenv.config({ path: '../.env' });
// console.log(process.env.DATABASE_URL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // e.g. postgres://user:password@host:port/dbname
  // You can add more config here if needed
});

export default {
  query: (text, params) => pool.query(text, params),
  pool,
};  