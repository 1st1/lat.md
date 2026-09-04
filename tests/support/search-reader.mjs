import { SearchDb } from '../../dist/src/search/db.js';
const db = new SearchDb(process.argv[2]);
const query =
  "SELECT body,fts_score(body,heading,path,'needl') AS score FROM lexical_chunks ORDER BY score DESC LIMIT 5";
try {
  await db.execute(query);
  process.send('ready');
  process.once('message', async () => {
    try {
      process.send((await db.execute(query)).rows);
      await db.close();
      process.exit(0);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });
} catch (error) {
  console.error(error);
  process.exit(1);
}
