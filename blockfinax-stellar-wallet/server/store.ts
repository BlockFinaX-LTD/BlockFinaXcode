import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export class Store {
  db: DatabaseSync;
  constructor(path = "data/wallet.db") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL); DROP TABLE IF EXISTS tokens; CREATE TABLE IF NOT EXISTS email_codes (email TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,digest TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL,sent INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS wallets (user_id TEXT UNIQUE NOT NULL,contract TEXT UNIQUE NOT NULL,credential TEXT UNIQUE NOT NULL,public_key TEXT NOT NULL,counter INTEGER NOT NULL,transports TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL,kind TEXT NOT NULL,hash TEXT,created INTEGER NOT NULL);`,
    );
  }
  user(id: string) {
    return this.db.prepare("SELECT * FROM users WHERE id=?").get(id) as
      { id: string; email: string } | undefined;
  }
  wallet(id: string) {
    return this.db.prepare("SELECT * FROM wallets WHERE user_id=?").get(id) as
      | {
          user_id: string;
          contract: string;
          credential: string;
          public_key: string;
          counter: number;
          transports: string;
        }
      | undefined;
  }
  events(id: string) {
    return this.db
      .prepare(
        "SELECT kind,hash,created FROM events WHERE user_id=? ORDER BY id DESC LIMIT 30",
      )
      .all(id);
  }
  event(id: string, kind: string, hash: string) {
    this.db
      .prepare("INSERT INTO events(user_id,kind,hash,created) VALUES(?,?,?,?)")
      .run(id, kind, hash, Date.now());
  }
}
