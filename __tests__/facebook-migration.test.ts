import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('additive Facebook migration preserves Instagram rows, columns, old writes and independent disconnects', async () => {
  // Prisma already brings PGlite: this is real PostgreSQL SQL in memory, with
  // no DATABASE_URL, credentials, sockets, or external database involved.
  const db = new PGlite();
  try {
    const root = path.join(process.cwd(), 'prisma/migrations');
    const facebook = '20260930090000_facebook_support';
    for (const dir of readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && d.name < facebook).sort((a, b) => a.name.localeCompare(b.name))) {
      await db.exec(readFileSync(path.join(root, dir.name, 'migration.sql'), 'utf8'));
    }
    await db.exec(`
      INSERT INTO "User" (id,email,"updatedAt") VALUES ('user','local@example.test',now());
      INSERT INTO "Workspace" (id,name,"ownerId","updatedAt") VALUES ('workspace','Test','user',now());
      INSERT INTO "InstagramAccount" (id,"workspaceId","instagramId",username,"accessToken","updatedAt") VALUES ('ig','workspace','100','ig-name','encrypted-ig',now());
      INSERT INTO "Automation" (id,"workspaceId","instagramAccountId",name,keywords,"dmMessage","updatedAt") VALUES ('campaign','workspace','ig','Original','{link}','Original DM',now());
      INSERT INTO "DmLog" (id,"workspaceId","automationId","instagramAccountId","commenterId","commentText","commentId",status,"updatedAt") VALUES ('log','workspace','campaign','ig','author','link','comment','SENT',now());
    `);
    const tables = ['InstagramAccount', 'Automation', 'DmLog'];
    const before = await Promise.all(tables.map(t => db.query(`SELECT * FROM "${t}" ORDER BY id`)));
    const columns = `SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('InstagramAccount','Automation','DmLog') ORDER BY table_name,ordinal_position`;
    const beforeColumns = await db.query(columns);
    const sql = readFileSync(path.join(root, facebook, 'migration.sql'), 'utf8');
    expect(sql).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE)\s+(TABLE|FROM|"Instagram|"Automation|"DmLog)/i);
    await db.exec(sql);
    for (let i = 0; i < tables.length; i++) expect((await db.query(`SELECT * FROM "${tables[i]}" ORDER BY id`)).rows).toEqual(before[i].rows);
    expect((await db.query(columns)).rows).toEqual(beforeColumns.rows);
    await db.exec(`
      INSERT INTO "Automation" (id,"workspaceId","instagramAccountId",name,keywords,"dmMessage","updatedAt") VALUES ('legacy-write','workspace','ig','Old app','{link}','Still valid',now());
      INSERT INTO "FacebookPage" (id,"workspaceId","pageId",name,"accessToken","updatedAt") VALUES ('fb','workspace','900','Test Page','encrypted-fb',now());
      INSERT INTO "FacebookCampaign" (id,"workspaceId","facebookPageId","automationId",name,keywords,"privateReplyMessage","updatedAt") VALUES ('fb-campaign','workspace','fb','campaign','Both','{link}','Hello',now());
      UPDATE "FacebookPage" SET "accessToken"='',"disconnectedAt"=now() WHERE id='fb';
    `);
    expect((await db.query('SELECT "accessToken" FROM "InstagramAccount" WHERE id=\'ig\'')).rows).toEqual([{ accessToken: 'encrypted-ig' }]);
    await db.exec(`UPDATE "FacebookPage" SET "accessToken"='reconnected-fb',"disconnectedAt"=NULL WHERE id='fb'; DELETE FROM "InstagramAccount" WHERE id='ig';`);
    expect((await db.query('SELECT "accessToken" FROM "FacebookPage"')).rows).toEqual([{ accessToken: 'reconnected-fb' }]);
    expect((await db.query('SELECT "automationId","isActive" FROM "FacebookCampaign"')).rows).toEqual([{ automationId: null, isActive: true }]);
    const insertDelivery = `INSERT INTO "FacebookDelivery" (id,"facebookPageId","campaignId","commentId","postId","commenterId","commentText","commentCreatedAt","updatedAt") VALUES ('delivery','fb','fb-campaign','comment','post','person','link',now(),now())`;
    await db.exec(insertDelivery);
    await expect(db.exec(insertDelivery.replace("'delivery'", "'another-delivery'"))).rejects.toMatchObject({ code: '23505' });
    await db.exec(`INSERT INTO "FacebookPrivateClaim" (id) VALUES ('facebook:900:comment');`);
    await expect(db.exec(`INSERT INTO "FacebookPrivateClaim" (id) VALUES ('facebook:900:comment');`)).rejects.toMatchObject({ code: '23505' });
    const claim = `UPDATE "FacebookDelivery" SET "publicStatus"='UNCONFIRMED' WHERE id='delivery' AND "publicStatus"='PENDING' RETURNING id`;
    expect((await db.query(claim)).rows).toHaveLength(1); expect((await db.query(claim)).rows).toHaveLength(0);
  } finally { await db.close(); }
}, 60000);
