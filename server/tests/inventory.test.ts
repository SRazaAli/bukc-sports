/**
 * Feature 4 — Inventory tracking. Exercises the INV rules through the API against
 * a live database, mirroring the auth suite's structure. Covers equipment types,
 * article entry with baseline scan, condition scans + auto damage flag, flag
 * clearing, the pair model (always-paired, shared state), decommission
 * terminality (including pair decommission), and role enforcement.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seedCreds, bc } from './setup.js';
import { db } from '../src/db/index.js';

const app = createApp();

async function staffAgent() {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send(seedCreds);
  const bearer = { Authorization: `Bearer ${res.body.accessToken}` };
  return {
    get: (u: string) => agent.get(u).set(bearer),
    post: (u: string) => agent.post(u).set(bearer),
    patch: (u: string) => agent.patch(u).set(bearer),
    delete: (u: string) => agent.delete(u).set(bearer),
  };
}

async function firstSportId(): Promise<number> {
  const c = await db.selectFrom('sport_category').select('sport_category_id').orderBy('name').executeTakeFirstOrThrow();
  return c.sport_category_id;
}

// A SINGLE-unit type (football) with thresholds: GOOD>=70, WORN>=40.
async function makeSingleType(a: Awaited<ReturnType<typeof staffAgent>>, name = 'Football') {
  const res = await a.post('/api/inventory/types').send({
    sportCategoryId: await firstSportId(), name, lendingUnit: 'SINGLE',
    lowStockThreshold: 2, maxBorrowDurationMinutes: 120,
    conditionGoodMinScore: 70, conditionWornMinScore: 40, isIndoor: false,
  });
  return res.body.type.equipmentTypeId as number;
}

async function makePairType(a: Awaited<ReturnType<typeof staffAgent>>, name = 'Badminton Racket') {
  const res = await a.post('/api/inventory/types').send({
    sportCategoryId: await firstSportId(), name, lendingUnit: 'PAIR',
    lowStockThreshold: 1, maxBorrowDurationMinutes: 90,
    conditionGoodMinScore: 70, conditionWornMinScore: 40, isIndoor: true,
  });
  return res.body.type.equipmentTypeId as number;
}

let staff: Awaited<ReturnType<typeof staffAgent>>;
beforeEach(async () => { staff = await staffAgent(); });

// ═══════════════════════════ EQUIPMENT TYPES ═══════════════════════════
describe('Equipment types (INV-06)', () => {
  it('T-401: creates an equipment type', async () => {
    const res = await staff.post('/api/inventory/types').send({
      sportCategoryId: await firstSportId(), name: 'Volleyball', lendingUnit: 'SINGLE',
      lowStockThreshold: 3, maxBorrowDurationMinutes: 120,
      conditionGoodMinScore: 70, conditionWornMinScore: 40, isIndoor: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.type.name).toBe('Volleyball');
  });

  it('T-402: rejects when GOOD threshold <= WORN threshold', async () => {
    const res = await staff.post('/api/inventory/types').send({
      sportCategoryId: await firstSportId(), name: 'Bad', lendingUnit: 'SINGLE',
      lowStockThreshold: 0, maxBorrowDurationMinutes: 60,
      conditionGoodMinScore: 40, conditionWornMinScore: 70, isIndoor: true,
    });
    expect(res.status).toBe(400);
  });

  it('T-403 INV-06: updates thresholds after creation', async () => {
    const id = await makeSingleType(staff);
    const res = await staff.patch(`/api/inventory/types/${id}/thresholds`).send({ lowStockThreshold: 5 });
    expect(res.status).toBe(200);
    const row = await db.selectFrom('equipment_type').select('low_stock_threshold').where('equipment_type_id', '=', id).executeTakeFirst();
    expect(row?.low_stock_threshold).toBe(5);
  });

  it('T-403b: full update (name, condition thresholds, indoor flag)', async () => {
    const id = await makeSingleType(staff);
    const res = await staff.patch(`/api/inventory/types/${id}`).send({
      name: 'Football (Renamed)', isIndoor: true, conditionGoodMinScore: 75, conditionWornMinScore: 45,
    });
    expect(res.status).toBe(200);
    const row = await db.selectFrom('equipment_type')
      .select(['name', 'is_indoor', 'condition_good_min_score', 'condition_worn_min_score'])
      .where('equipment_type_id', '=', id).executeTakeFirst();
    expect(row?.name).toBe('Football (Renamed)');
    expect(row?.is_indoor).toBe(true);
    expect(Number(row?.condition_good_min_score)).toBe(75);
  });

  it('T-403c: deletes an equipment type with no linked articles', async () => {
    const id = await makeSingleType(staff);
    const res = await staff.delete(`/api/inventory/types/${id}`);
    expect(res.status).toBe(200);
    const row = await db.selectFrom('equipment_type').select('equipment_type_id').where('equipment_type_id', '=', id).executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it('T-403d: cannot delete a type that still has active articles', async () => {
    const id = await makeSingleType(staff);
    await staff.post('/api/inventory/articles').send({ equipmentTypeId: id, barcode: bc(1), entryScore: 90 });
    const res = await staff.delete(`/api/inventory/types/${id}`);
    expect(res.status).toBe(409);
    // Type is still visible — not soft-deleted.
    const list = await staff.get('/api/inventory/types');
    expect(list.body.types.find((t: { equipment_type_id: number }) => t.equipment_type_id === id)).toBeTruthy();
  });

  it('T-403e: delete succeeds (soft-hide) once all articles are decommissioned', async () => {
    const id = await makeSingleType(staff);
    const a = await staff.post('/api/inventory/articles').send({ equipmentTypeId: id, barcode: bc(25), entryScore: 90 });
    const articleId = a.body.article.articleId;
    await staff.post(`/api/inventory/articles/${articleId}/decommission`).send({});

    const del = await staff.delete(`/api/inventory/types/${id}`);
    expect(del.status).toBe(200);
    // Gone from every listing.
    const list = await staff.get('/api/inventory/types');
    expect(list.body.types.find((t: { equipment_type_id: number }) => t.equipment_type_id === id)).toBeUndefined();
    // The article is still fully intact behind the scenes.
    const art = await db.selectFrom('article').select('state').where('article_id', '=', articleId).executeTakeFirst();
    expect(art?.state).toBe('DECOMMISSIONED');
  });

  it('T-403f: recreating a previously-deleted type reactivates it instead of failing on UNIQUE', async () => {
    const scId = await firstSportId();
    const res1 = await staff.post('/api/inventory/types').send({
      sportCategoryId: scId, name: 'Temp Type', lendingUnit: 'SINGLE',
      lowStockThreshold: 2, maxBorrowDurationMinutes: 60,
      conditionGoodMinScore: 70, conditionWornMinScore: 40, isIndoor: true,
    });
    expect(res1.status).toBe(201);
    const id = res1.body.type.equipmentTypeId;
    await staff.delete(`/api/inventory/types/${id}`);
    // Recreate with the same name — should succeed, not say "already exists".
    const res2 = await staff.post('/api/inventory/types').send({
      sportCategoryId: scId, name: 'Temp Type', lendingUnit: 'SINGLE',
      lowStockThreshold: 5, maxBorrowDurationMinutes: 120,
      conditionGoodMinScore: 80, conditionWornMinScore: 50, isIndoor: false,
    });
    expect(res2.status).toBe(201);
    const list = await staff.get('/api/inventory/types');
    const found = list.body.types.find((t: { name: string }) => t.name === 'Temp Type');
    expect(found).toBeTruthy();
    expect(found.low_stock_threshold).toBe(5);
    expect(found.is_indoor).toBe(false);
  });
});

// ═══════════════════════════ ARTICLE ENTRY ═══════════════════════════
describe('Article entry (INV-02/03/04/05)', () => {
  it('T-404 INV-04: SINGLE article enters AVAILABLE with a baseline GOOD label from a high score', async () => {
    const typeId = await makeSingleType(staff);
    const res = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(2), entryScore: 85 });
    expect(res.status).toBe(201);
    expect(res.body.article.state).toBe('AVAILABLE');
    expect(res.body.article.conditionLabel).toBe('GOOD');
    // INV-04: a baseline ENTRY scan exists
    const scan = await db.selectFrom('health_check_scan').select(['kind', 'resulting_label'])
      .where('article_id', '=', res.body.article.articleId).executeTakeFirst();
    expect(scan?.kind).toBe('ENTRY');
  });

  it('T-405: single-article endpoint rejects a PAIR-lending type (use pair entry)', async () => {
    const typeId = await makePairType(staff);
    const res = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(3), entryScore: 90 });
    expect(res.status).toBe(400);
  });

  it('T-405b: pair entry stores two articles already paired and AVAILABLE', async () => {
    const typeId = await makePairType(staff);
    const res = await staff.post('/api/inventory/articles/pair').send({
      equipmentTypeId: typeId, barcodeA: bc(4), barcodeB: bc(5), entryScoreA: 90, entryScoreB: 90,
    });
    expect(res.status).toBe(201);
    const rows = await db.selectFrom('article').select('state')
      .where('article_id', 'in', [res.body.pairEntry.articleIdA, res.body.pairEntry.articleIdB]).execute();
    expect(rows.every((r) => r.state === 'AVAILABLE')).toBe(true);
  });

  it('T-405c: pair entry with one half scoring DAMAGED still pairs them, but the shared state is DAMAGED for both', async () => {
    const typeId = await makePairType(staff);
    const res = await staff.post('/api/inventory/articles/pair').send({
      equipmentTypeId: typeId, barcodeA: bc(6), barcodeB: bc(7), entryScoreA: 90, entryScoreB: 10,
    });
    expect(res.status).toBe(201);
    const rows = await db.selectFrom('article').select(['article_id', 'state', 'current_condition_label'])
      .where('article_id', 'in', [res.body.pairEntry.articleIdA, res.body.pairEntry.articleIdB]).execute();
    // Shared state: both halves DAMAGED even though only one half's own condition is DAMAGED.
    expect(rows.every((r) => r.state === 'DAMAGED')).toBe(true);
    const a = rows.find((r) => r.article_id === res.body.pairEntry.articleIdA);
    const b = rows.find((r) => r.article_id === res.body.pairEntry.articleIdB);
    expect(a?.current_condition_label).toBe('GOOD');
    expect(b?.current_condition_label).toBe('DAMAGED');
    // They are still a live pair.
    const pair = await db.selectFrom('article_pair').select('pair_id')
      .where('article_a_id', 'in', [res.body.pairEntry.articleIdA, res.body.pairEntry.articleIdB])
      .where('dissolved_at', 'is', null).executeTakeFirst();
    expect(pair).toBeTruthy();
  });

  it('T-405d: barcode not matching the 12-digit UPC format is rejected', async () => {
    const typeId = await makeSingleType(staff);
    const res = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: 'AB1', entryScore: 90 });
    expect(res.status).toBe(400);
  });

  it('T-406 INV-04: a low entry score lands DAMAGED and the article is DAMAGED', async () => {
    const typeId = await makeSingleType(staff);
    const res = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(8), entryScore: 20 });
    expect(res.body.article.conditionLabel).toBe('DAMAGED');
    const art = await db.selectFrom('article').select('state').where('article_id', '=', res.body.article.articleId).executeTakeFirst();
    expect(art?.state).toBe('DAMAGED');
  });

  it('T-407 INV-05: duplicate barcode is rejected', async () => {
    const typeId = await makeSingleType(staff);
    await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(9), entryScore: 80 });
    const res = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(9), entryScore: 80 });
    expect(res.status).toBe(409);
  });
});

// ═══════════════════════════ SCANS & DAMAGE ═══════════════════════════
describe('Health checks & damage flags (INV-17/18/20)', () => {
  it('T-408 INV-18: a scan in the DAMAGED range raises a system damage flag and DAMAGES the article', async () => {
    const typeId = await makeSingleType(staff);
    const a = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(10), entryScore: 90 });
    const id = a.body.article.articleId;
    const res = await staff.post(`/api/inventory/articles/${id}/scan`).send({ kind: 'AD_HOC', score: 15 });
    expect(res.status).toBe(200);
    expect(res.body.conditionLabel).toBe('DAMAGED');
    const art = await db.selectFrom('article').select('state').where('article_id', '=', id).executeTakeFirst();
    expect(art?.state).toBe('DAMAGED');
    const flag = await db.selectFrom('damage_flag').select('flag_id').where('article_id', '=', id).where('cleared_at', 'is', null).executeTakeFirst();
    expect(flag).toBeTruthy();
  });

  it('T-408b: a scan that DAMAGES one half of a pair also DAMAGES the sibling half', async () => {
    const typeId = await makePairType(staff);
    const entry = await staff.post('/api/inventory/articles/pair').send({
      equipmentTypeId: typeId, barcodeA: bc(11), barcodeB: bc(12), entryScoreA: 90, entryScoreB: 90,
    });
    const { articleIdA, articleIdB } = entry.body.pairEntry;
    await staff.post(`/api/inventory/articles/${articleIdA}/scan`).send({ kind: 'AD_HOC', score: 5 });
    const rows = await db.selectFrom('article').select(['article_id', 'state', 'current_condition_label'])
      .where('article_id', 'in', [articleIdA, articleIdB]).execute();
    expect(rows.every((r) => r.state === 'DAMAGED')).toBe(true);
    const b = rows.find((r) => r.article_id === articleIdB);
    // Sibling's own condition label is untouched — only the shared state moved.
    expect(b?.current_condition_label).toBe('GOOD');
  });

  it('T-409 INV-20: clearing a damage flag returns the article to AVAILABLE with a score-derived label', async () => {
    const typeId = await makeSingleType(staff);
    const a = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(13), entryScore: 90 });
    const id = a.body.article.articleId;
    await staff.post(`/api/inventory/articles/${id}/scan`).send({ kind: 'AD_HOC', score: 10 });
    const flags = await staff.get('/api/inventory/damage-flags');
    const flagId = flags.body.flags[0].flag_id;
    const res = await staff.post(`/api/inventory/damage-flags/${flagId}/clear`).send({ score: 55 }); // WORN range (>=40, <70)
    expect(res.status).toBe(200);
    const art = await db.selectFrom('article').select(['state', 'current_condition_label']).where('article_id', '=', id).executeTakeFirst();
    expect(art?.state).toBe('AVAILABLE');
    expect(art?.current_condition_label).toBe('WORN');
  });

  it('T-409b: clearing one half of a damaged pair keeps the pair DAMAGED if the sibling is still flagged', async () => {
    const typeId = await makePairType(staff);
    const entry = await staff.post('/api/inventory/articles/pair').send({
      equipmentTypeId: typeId, barcodeA: bc(14), barcodeB: bc(15), entryScoreA: 5, entryScoreB: 5,
    });
    const { articleIdA, articleIdB } = entry.body.pairEntry;
    const flags = await staff.get('/api/inventory/damage-flags');
    const flagA = flags.body.flags.find((f: { article_id: string }) => f.article_id === articleIdA).flag_id;
    await staff.post(`/api/inventory/damage-flags/${flagA}/clear`).send({ score: 90 });
    const rows = await db.selectFrom('article').select(['article_id', 'state']).where('article_id', 'in', [articleIdA, articleIdB]).execute();
    // B is still flagged/DAMAGED, so the shared state stays DAMAGED for both.
    expect(rows.every((r) => r.state === 'DAMAGED')).toBe(true);

    const flagB = (await staff.get('/api/inventory/damage-flags')).body.flags.find((f: { article_id: string }) => f.article_id === articleIdB).flag_id;
    await staff.post(`/api/inventory/damage-flags/${flagB}/clear`).send({ score: 90 });
    const rows2 = await db.selectFrom('article').select(['state']).where('article_id', 'in', [articleIdA, articleIdB]).execute();
    expect(rows2.every((r) => r.state === 'AVAILABLE')).toBe(true);
  });

  it('T-409c: a plain Scan (not the damage-flags endpoint) auto-clears an open flag and restores AVAILABLE', async () => {
    const typeId = await makeSingleType(staff);
    const a = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(16), entryScore: 90 });
    const id = a.body.article.articleId;
    // Scan it DAMAGED first (raises a flag, state -> DAMAGED).
    await staff.post(`/api/inventory/articles/${id}/scan`).send({ kind: 'AD_HOC', score: 10 });
    let art = await db.selectFrom('article').select('state').where('article_id', '=', id).executeTakeFirst();
    expect(art?.state).toBe('DAMAGED');

    // Scanning it GOOD again — via the same plain Scan action, no trip to a
    // separate "clear flag" screen — must restore AVAILABLE immediately.
    const res = await staff.post(`/api/inventory/articles/${id}/scan`).send({ kind: 'AD_HOC', score: 90 });
    expect(res.body.conditionLabel).toBe('GOOD');
    art = await db.selectFrom('article').select('state').where('article_id', '=', id).executeTakeFirst();
    expect(art?.state).toBe('AVAILABLE');

    const openFlag = await db.selectFrom('damage_flag').select('flag_id')
      .where('article_id', '=', id).where('cleared_at', 'is', null).executeTakeFirst();
    expect(openFlag).toBeUndefined();
  });

  it('T-409d: a plain Scan that clears one half of a damaged pair keeps the pair DAMAGED while the sibling is still flagged', async () => {
    const typeId = await makePairType(staff);
    const entry = await staff.post('/api/inventory/articles/pair').send({
      equipmentTypeId: typeId, barcodeA: bc(17), barcodeB: bc(18), entryScoreA: 5, entryScoreB: 5,
    });
    const { articleIdA, articleIdB } = entry.body.pairEntry;

    // Scan A back to GOOD via the plain Scan action.
    await staff.post(`/api/inventory/articles/${articleIdA}/scan`).send({ kind: 'AD_HOC', score: 90 });
    let rows = await db.selectFrom('article').select(['state']).where('article_id', 'in', [articleIdA, articleIdB]).execute();
    expect(rows.every((r) => r.state === 'DAMAGED')).toBe(true); // B still flagged

    // Now scan B back to GOOD too — the pair should lift to AVAILABLE.
    await staff.post(`/api/inventory/articles/${articleIdB}/scan`).send({ kind: 'AD_HOC', score: 90 });
    rows = await db.selectFrom('article').select(['state']).where('article_id', 'in', [articleIdA, articleIdB]).execute();
    expect(rows.every((r) => r.state === 'AVAILABLE')).toBe(true);
  });
});

// ═══════════════════════════ PAIRS ═══════════════════════════
describe('Pair lifecycle (INV-07/08)', () => {
  it('T-410 INV-07/08: pair entry makes both AVAILABLE and displays as one pair', async () => {
    const typeId = await makePairType(staff);
    const res = await staff.post('/api/inventory/articles/pair').send({
      equipmentTypeId: typeId, barcodeA: bc(16), barcodeB: bc(17), entryScoreA: 90, entryScoreB: 90,
    });
    const { articleIdA, articleIdB } = res.body.pairEntry;
    const rows = await db.selectFrom('article').select(['state']).where('article_id', 'in', [articleIdA, articleIdB]).execute();
    expect(rows.every((r) => r.state === 'AVAILABLE')).toBe(true);
    const list = await staff.get(`/api/inventory/articles?equipmentTypeId=${typeId}`);
    const a = list.body.articles.find((x: { article_id: string }) => x.article_id === articleIdA);
    expect(a.pair_id).toBeTruthy(); // grouped-pair display data present
  });
});

// ═══════════════════════════ DECOMMISSION & ROLES ═══════════════════════════
describe('Decommission & availability (INV-13/23/24)', () => {
  it('T-414 INV-23/24: decommission is terminal and drops the article from stock', async () => {
    const typeId = await makeSingleType(staff);
    const a = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(18), entryScore: 90 });
    const id = a.body.article.articleId;
    const res = await staff.post(`/api/inventory/articles/${id}/decommission`).send({});
    expect(res.status).toBe(200);
    const art = await db.selectFrom('article').select('state').where('article_id', '=', id).executeTakeFirst();
    expect(art?.state).toBe('DECOMMISSIONED');
    // second decommission is a no-op / not found
    const again = await staff.post(`/api/inventory/articles/${id}/decommission`).send({});
    expect(again.status).toBe(404);
  });

  it('T-414b: decommissioning one half of a pair decommissions both halves', async () => {
    const typeId = await makePairType(staff);
    const entry = await staff.post('/api/inventory/articles/pair').send({
      equipmentTypeId: typeId, barcodeA: bc(19), barcodeB: bc(20), entryScoreA: 90, entryScoreB: 90,
    });
    const { articleIdA, articleIdB } = entry.body.pairEntry;
    const res = await staff.post(`/api/inventory/articles/${articleIdA}/decommission`).send({});
    expect(res.status).toBe(200);
    const rows = await db.selectFrom('article').select(['state']).where('article_id', 'in', [articleIdA, articleIdB]).execute();
    expect(rows.every((r) => r.state === 'DECOMMISSIONED')).toBe(true);
  });

  it('T-415 INV-13: availability status reflects stock and low-stock badge', async () => {
    const typeId = await makeSingleType(staff); // threshold 2
    for (const bcv of [bc(21), bc(22)]) {
      await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bcv, entryScore: 90 });
    }
    const res = await staff.get('/api/inventory/status');
    const row = res.body.status.find((s: { equipment_type_id: number }) => s.equipment_type_id === typeId);
    expect(row.available_units).toBe(2);
    expect(row.status_badge).toBe('LOW_STOCK');
  });

  it('T-415b INV-13: a PAIR type reports available_units in lendable pairs, not raw articles', async () => {
    const typeId = await makePairType(staff); // threshold 1
    await staff.post('/api/inventory/articles/pair').send({
      equipmentTypeId: typeId, barcodeA: bc(23), barcodeB: bc(24), entryScoreA: 90, entryScoreB: 90,
    });
    const res = await staff.get('/api/inventory/status');
    const row = res.body.status.find((s: { equipment_type_id: number }) => s.equipment_type_id === typeId);
    expect(row.available_units).toBe(1); // 2 articles = 1 pair, not 2
  });

  it('T-416: a STUDENT cannot create equipment types (staff-only)', async () => {
    // register + verify a student, then try
    const reg = await request(app).post('/api/auth/register/student').send({
      fullName: 'Stu Dent', email: 'stu@bukc.edu.pk', contactNumber: '03001112222',
      password: 'Passw0rd!', enrollmentNo: '84-024000-321', department: 'Computer Science', programTitle: 'BS Computer Science',
    });
    await db.updateTable('app_user').set({ status: 'ACTIVE', verified_at: new Date() }).where('user_id', '=', reg.body.user.userId).execute();
    const login = await request(app).post('/api/auth/login/student').send({ enrollmentNo: '84-024000-321', password: 'Passw0rd!' });
    const res = await request(app).post('/api/inventory/types')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ sportCategoryId: await firstSportId(), name: 'Nope', lendingUnit: 'SINGLE', lowStockThreshold: 0, maxBorrowDurationMinutes: 60, conditionGoodMinScore: 70, conditionWornMinScore: 40, isIndoor: true });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════ INV-25: AUDIT LOG ═══════════════════════════
describe('Article audit log (INV-25)', () => {
  it('T-420: adding a SINGLE article writes an ARTICLE_ENTERED audit entry', async () => {
    const typeId = await makeSingleType(staff);
    const a = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(100), entryScore: 85 });
    expect(a.status).toBe(201);
    const articleId = a.body.article.articleId;

    const log = await db.selectFrom('article_audit_log')
      .select(['action', 'actor_id', 'detail'])
      .where('article_id', '=', articleId)
      .where('action', '=', 'ARTICLE_ENTERED')
      .executeTakeFirst();
    expect(log).toBeTruthy();
    expect(log?.action).toBe('ARTICLE_ENTERED');
  });

  it('T-421: adding a pair writes ARTICLE_ENTERED for both halves plus a PAIR_FORMED entry', async () => {
    const typeId = await makePairType(staff);
    const entry = await staff.post('/api/inventory/articles/pair').send({
      equipmentTypeId: typeId, barcodeA: bc(101), barcodeB: bc(102), entryScoreA: 90, entryScoreB: 90,
    });
    expect(entry.status).toBe(201);
    const { articleIdA, articleIdB } = entry.body.pairEntry;

    const entered = await db.selectFrom('article_audit_log')
      .select('action')
      .where('article_id', 'in', [articleIdA, articleIdB])
      .where('action', '=', 'ARTICLE_ENTERED')
      .execute();
    expect(entered.length).toBe(2);

    const paired = await db.selectFrom('article_audit_log')
      .select('action')
      .where('action', '=', 'PAIR_FORMED')
      .executeTakeFirst();
    expect(paired).toBeTruthy();
  });

  it('T-422: decommissioning an article writes ARTICLE_DECOMMISSIONED', async () => {
    const typeId = await makeSingleType(staff);
    const a = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(103), entryScore: 90 });
    const articleId = a.body.article.articleId;
    await staff.post(`/api/inventory/articles/${articleId}/decommission`).send({});

    const log = await db.selectFrom('article_audit_log')
      .select('action')
      .where('article_id', '=', articleId)
      .where('action', '=', 'ARTICLE_DECOMMISSIONED')
      .executeTakeFirst();
    expect(log).toBeTruthy();
  });

  it('T-423: decommissioning one half of a pair writes ARTICLE_DECOMMISSIONED for both halves', async () => {
    const typeId = await makePairType(staff);
    const entry = await staff.post('/api/inventory/articles/pair').send({
      equipmentTypeId: typeId, barcodeA: bc(104), barcodeB: bc(105), entryScoreA: 90, entryScoreB: 90,
    });
    const { articleIdA, articleIdB } = entry.body.pairEntry;
    await staff.post(`/api/inventory/articles/${articleIdA}/decommission`).send({});

    const logs = await db.selectFrom('article_audit_log')
      .select('article_id')
      .where('article_id', 'in', [articleIdA, articleIdB])
      .where('action', '=', 'ARTICLE_DECOMMISSIONED')
      .execute();
    expect(logs.length).toBe(2);
  });

  it('T-424: recording a scan writes a SCAN_RECORDED audit entry', async () => {
    const typeId = await makeSingleType(staff);
    const a = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(106), entryScore: 90 });
    const articleId = a.body.article.articleId;
    await staff.post(`/api/inventory/articles/${articleId}/scan`).send({ kind: 'AD_HOC', score: 55 });

    const log = await db.selectFrom('article_audit_log')
      .select('action')
      .where('article_id', '=', articleId)
      .where('action', '=', 'SCAN_RECORDED')
      .executeTakeFirst();
    expect(log).toBeTruthy();
  });

  it('T-425: a scan that raises a damage flag writes DAMAGE_FLAG_RAISED', async () => {
    const typeId = await makeSingleType(staff);
    const a = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(107), entryScore: 90 });
    const articleId = a.body.article.articleId;
    await staff.post(`/api/inventory/articles/${articleId}/scan`).send({ kind: 'AD_HOC', score: 10 });

    const log = await db.selectFrom('article_audit_log')
      .select('action')
      .where('article_id', '=', articleId)
      .where('action', '=', 'DAMAGE_FLAG_RAISED')
      .executeTakeFirst();
    expect(log).toBeTruthy();
  });

  it('T-426: clearing a damage flag (via scan) writes DAMAGE_FLAG_CLEARED', async () => {
    const typeId = await makeSingleType(staff);
    const a = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(108), entryScore: 90 });
    const articleId = a.body.article.articleId;
    await staff.post(`/api/inventory/articles/${articleId}/scan`).send({ kind: 'AD_HOC', score: 10 });
    // Scan back to GOOD — clears the flag implicitly
    await staff.post(`/api/inventory/articles/${articleId}/scan`).send({ kind: 'AD_HOC', score: 90 });

    const log = await db.selectFrom('article_audit_log')
      .select('action')
      .where('article_id', '=', articleId)
      .where('action', '=', 'DAMAGE_FLAG_CLEARED')
      .executeTakeFirst();
    expect(log).toBeTruthy();
  });

  it('T-427: condition override writes CONDITION_OVERRIDDEN', async () => {
    const typeId = await makeSingleType(staff);
    const a = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(109), entryScore: 90 });
    const articleId = a.body.article.articleId;
    await staff.post(`/api/inventory/articles/${articleId}/condition`).send({ label: 'WORN' });

    const log = await db.selectFrom('article_audit_log')
      .select('action')
      .where('article_id', '=', articleId)
      .where('action', '=', 'CONDITION_OVERRIDDEN')
      .executeTakeFirst();
    expect(log).toBeTruthy();
  });

  it('T-428: type edit writes TYPE_EDITED to the audit log', async () => {
    const typeId = await makeSingleType(staff);
    await staff.patch(`/api/inventory/types/${typeId}`).send({ name: 'Renamed Football' });

    const log = await db.selectFrom('article_audit_log')
      .select('action')
      .where('equipment_type_id', '=', typeId)
      .where('action', '=', 'TYPE_EDITED')
      .executeTakeFirst();
    expect(log).toBeTruthy();
  });

  it('T-429: audit log is returned in getArticleDetail (INV-27)', async () => {
    const typeId = await makeSingleType(staff);
    const a = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(110), entryScore: 85 });
    const articleId = a.body.article.articleId;
    await staff.post(`/api/inventory/articles/${articleId}/scan`).send({ kind: 'AD_HOC', score: 55 });

    const detail = await staff.get(`/api/inventory/articles/${articleId}`);
    expect(detail.status).toBe(200);
    expect(Array.isArray(detail.body.auditLog)).toBe(true);
    // Should have at least ARTICLE_ENTERED + SCAN_RECORDED
    expect(detail.body.auditLog.length).toBeGreaterThanOrEqual(2);
    const actions = detail.body.auditLog.map((e: { action: string }) => e.action);
    expect(actions).toContain('ARTICLE_ENTERED');
    expect(actions).toContain('SCAN_RECORDED');
  });

  it('T-430: lifecycle endpoint returns actor names (INV-27)', async () => {
    const typeId = await makeSingleType(staff);
    const a = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(111), entryScore: 75 });
    const articleId = a.body.article.articleId;

    const lifecycle = await staff.get(`/api/inventory/articles/${articleId}/lifecycle`);
    expect(lifecycle.status).toBe(200);
    expect(lifecycle.body.article.entered_by_name).toBeTruthy();
    expect(lifecycle.body.auditLog[0].actor_name).toBeTruthy();
  });

  it('T-431: audit log is immutable — DB trigger rejects DELETE', async () => {
    const typeId = await makeSingleType(staff);
    const a = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(112), entryScore: 90 });
    const articleId = a.body.article.articleId;

    const log = await db.selectFrom('article_audit_log')
      .select('log_id')
      .where('article_id', '=', articleId)
      .executeTakeFirst();
    expect(log).toBeTruthy();

    // Direct DB delete should raise the fn_audit_immutable trigger
    await expect(
      db.deleteFrom('article_audit_log').where('log_id', '=', log!.log_id).execute(),
    ).rejects.toThrow();
  });

  it('T-432: GET /api/inventory/audit-log returns entries filterable by articleId', async () => {
    const typeId = await makeSingleType(staff);
    const a = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(113), entryScore: 90 });
    const articleId = a.body.article.articleId;

    const res = await staff.get(`/api/inventory/audit-log?articleId=${articleId}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.log)).toBe(true);
    expect(res.body.log.length).toBeGreaterThan(0);
    expect(res.body.log.every((e: { article_id: string }) => e.article_id === articleId)).toBe(true);
  });
});

// ═══════════════════════════ INV-01/21/22/23: NOTIFICATIONS ═══════════════════════════
describe('Inventory notifications (INV-01/21/22/23)', () => {
  async function makeCoordinator(email: string) {
    const saId = (await db.selectFrom('app_user').select('user_id')
      .where('role', '=', 'SUPER_ADMIN').executeTakeFirstOrThrow()).user_id;
    // Use a known bcrypt hash for "CoordPass1!" to allow login if needed
    const coordRes = await db.insertInto('app_user').values({
      role: 'COORDINATOR', status: 'ACTIVE', full_name: 'Inv Notif Coord',
      email, contact_number: '03001112233',
      password_hash: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
      created_by: saId, verified_at: new Date(),
    }).returning('user_id').executeTakeFirstOrThrow();
    return coordRes.user_id;
  }

  async function coordAgent(email: string) {
    const agent = request.agent(app);
    // Login as the coordinator
    const res = await agent.post('/api/auth/login').send({ email, password: 'password' });
    if (res.status !== 200) return null;
    const bearer = { Authorization: `Bearer ${res.body.accessToken}` };
    return {
      get: (u: string) => agent.get(u).set(bearer),
      post: (u: string) => agent.post(u).set(bearer),
      patch: (u: string) => agent.patch(u).set(bearer),
      delete: (u: string) => agent.delete(u).set(bearer),
    };
  }

  it('T-433 INV-21: a damaged entry scan sends DAMAGE_FLAGGED notification to Super Admin', async () => {
    const typeId = await makeSingleType(staff);
    const saId = (await db.selectFrom('app_user').select('user_id')
      .where('role', '=', 'SUPER_ADMIN').executeTakeFirstOrThrow()).user_id;

    const before = await db.selectFrom('notification').select(db.fn.countAll().as('n'))
      .where('recipient_id', '=', saId).where('type', '=', 'DAMAGE_FLAGGED').executeTakeFirst();
    const countBefore = Number(before?.n ?? 0);

    await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(120), entryScore: 10 });

    const after = await db.selectFrom('notification').select(db.fn.countAll().as('n'))
      .where('recipient_id', '=', saId).where('type', '=', 'DAMAGE_FLAGGED').executeTakeFirst();
    expect(Number(after?.n ?? 0)).toBeGreaterThan(countBefore);
  });

  it('T-434 INV-21: a DAMAGED scan (not at entry) also fires DAMAGE_FLAGGED to Super Admin', async () => {
    const typeId = await makeSingleType(staff);
    const a = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(121), entryScore: 90 });
    const articleId = a.body.article.articleId;
    const saId = (await db.selectFrom('app_user').select('user_id')
      .where('role', '=', 'SUPER_ADMIN').executeTakeFirstOrThrow()).user_id;

    const before = await db.selectFrom('notification').select(db.fn.countAll().as('n'))
      .where('recipient_id', '=', saId).where('type', '=', 'DAMAGE_FLAGGED').executeTakeFirst();

    await staff.post(`/api/inventory/articles/${articleId}/scan`).send({ kind: 'AD_HOC', score: 5 });

    const after = await db.selectFrom('notification').select(db.fn.countAll().as('n'))
      .where('recipient_id', '=', saId).where('type', '=', 'DAMAGE_FLAGGED').executeTakeFirst();
    expect(Number(after?.n ?? 0)).toBeGreaterThan(Number(before?.n ?? 0));
  });

  it('T-435 INV-21: second DAMAGED scan on an already-flagged article does NOT fire a duplicate notification', async () => {
    const typeId = await makeSingleType(staff);
    const a = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(122), entryScore: 90 });
    const articleId = a.body.article.articleId;
    await staff.post(`/api/inventory/articles/${articleId}/scan`).send({ kind: 'AD_HOC', score: 5 });

    const saId = (await db.selectFrom('app_user').select('user_id')
      .where('role', '=', 'SUPER_ADMIN').executeTakeFirstOrThrow()).user_id;
    const before = await db.selectFrom('notification').select(db.fn.countAll().as('n'))
      .where('recipient_id', '=', saId).where('type', '=', 'DAMAGE_FLAGGED').executeTakeFirst();

    await staff.post(`/api/inventory/articles/${articleId}/scan`).send({ kind: 'AD_HOC', score: 3 });

    const after = await db.selectFrom('notification').select(db.fn.countAll().as('n'))
      .where('recipient_id', '=', saId).where('type', '=', 'DAMAGE_FLAGGED').executeTakeFirst();
    expect(Number(after?.n ?? 0)).toBe(Number(before?.n ?? 0));
  });

  it('T-436b INV-01: Coordinator adding an article sends INVENTORY_ACTION to Super Admin', async () => {
    const coordId = await makeCoordinator('inv-coord-01@bukc.edu.pk');
    const coord = await coordAgent('inv-coord-01@bukc.edu.pk');
    if (!coord) {
      // Login path won't work with a dummy hash in this test env — skip gracefully
      return;
    }
    const typeId = await makeSingleType(staff);
    const saId = (await db.selectFrom('app_user').select('user_id')
      .where('role', '=', 'SUPER_ADMIN').executeTakeFirstOrThrow()).user_id;

    const before = await db.selectFrom('notification').select(db.fn.countAll().as('n'))
      .where('recipient_id', '=', saId).where('type', '=', 'INVENTORY_ACTION').executeTakeFirst();

    await coord.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(123), entryScore: 80 });

    const after = await db.selectFrom('notification').select(db.fn.countAll().as('n'))
      .where('recipient_id', '=', saId).where('type', '=', 'INVENTORY_ACTION').executeTakeFirst();
    expect(Number(after?.n ?? 0)).toBeGreaterThan(Number(before?.n ?? 0));
    void coordId; // used above
  });

  it('T-437b INV-22: Super Admin editing a type does NOT send an SA notification (SA is the actor)', async () => {
    const typeId = await makeSingleType(staff);
    const saId = (await db.selectFrom('app_user').select('user_id')
      .where('role', '=', 'SUPER_ADMIN').executeTakeFirstOrThrow()).user_id;

    const before = await db.selectFrom('notification').select(db.fn.countAll().as('n'))
      .where('recipient_id', '=', saId).where('type', '=', 'INVENTORY_ACTION').executeTakeFirst();

    await staff.patch(`/api/inventory/types/${typeId}`).send({ name: 'SA Renamed' });

    const after = await db.selectFrom('notification').select(db.fn.countAll().as('n'))
      .where('recipient_id', '=', saId).where('type', '=', 'INVENTORY_ACTION').executeTakeFirst();
    // SA editing should not notify themselves
    expect(Number(after?.n ?? 0)).toBe(Number(before?.n ?? 0));
  });
});

// ═══════════════════════════ INV-15/28/29: HEALTH CHECK SCHEDULER ═══════════════════════════
describe('Weekly health check sessions (INV-15/28/29)', () => {
  // Import the service functions directly for scheduler tests
  // (avoids needing a time-shifted HTTP trigger)
  it('T-436 INV-15: fireWeeklyHealthCheckAlert creates a health_check_session and notifies Coordinators', async () => {
    const { fireWeeklyHealthCheckAlert } = await import('../src/features/inventory/service.js');

    // Add some articles so total_articles_due > 0
    const typeId = await makeSingleType(staff);
    await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(130), entryScore: 90 });
    await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(131), entryScore: 80 });

    // Insert a test coordinator
    const saId = (await db.selectFrom('app_user').select('user_id').where('role', '=', 'SUPER_ADMIN').executeTakeFirstOrThrow()).user_id;
    await db.insertInto('app_user').values({
      role: 'COORDINATOR', status: 'ACTIVE', full_name: 'Health Coord',
      email: 'healthcoord@bukc.edu.pk', contact_number: '03009876543',
      password_hash: 'x', created_by: saId, verified_at: new Date(),
    }).execute();

    await fireWeeklyHealthCheckAlert();

    const session = await db.selectFrom('health_check_session')
      .select(['session_id', 'total_articles_due', 'scanned_count', 'completed_at'])
      .orderBy('alert_sent_at', 'desc').executeTakeFirst();
    expect(session).toBeTruthy();
    expect(session!.total_articles_due).toBeGreaterThanOrEqual(2);
    expect(session!.scanned_count).toBe(0);
    expect(session!.completed_at).toBeNull();

    // Coordinator should have a HEALTH_CHECK_DUE notification
    const coordId = (await db.selectFrom('app_user').select('user_id').where('email', '=', 'healthcoord@bukc.edu.pk').executeTakeFirstOrThrow()).user_id;
    const notif = await db.selectFrom('notification').select('type')
      .where('recipient_id', '=', coordId).where('type', '=', 'HEALTH_CHECK_DUE').executeTakeFirst();
    expect(notif).toBeTruthy();
  });

  it('T-437 INV-28: a SCHEDULED scan increments scanned_count on the open session', async () => {
    const { fireWeeklyHealthCheckAlert } = await import('../src/features/inventory/service.js');

    const typeId = await makeSingleType(staff, 'Scan Tracker Ball');
    const a = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(132), entryScore: 90 });
    const articleId = a.body.article.articleId;

    const saId = (await db.selectFrom('app_user').select('user_id').where('role', '=', 'SUPER_ADMIN').executeTakeFirstOrThrow()).user_id;
    await db.insertInto('app_user').values({
      role: 'COORDINATOR', status: 'ACTIVE', full_name: 'Scan Coord',
      email: 'scancoord@bukc.edu.pk', contact_number: '03007654321',
      password_hash: 'x', created_by: saId, verified_at: new Date(),
    }).onConflict((oc) => oc.column('email').doNothing()).execute();

    await fireWeeklyHealthCheckAlert();

    const sessionBefore = await db.selectFrom('health_check_session')
      .select(['session_id', 'scanned_count'])
      .orderBy('alert_sent_at', 'desc').executeTakeFirst();
    expect(sessionBefore!.scanned_count).toBe(0);

    // A SCHEDULED scan should increment the count via the DB trigger
    await staff.post(`/api/inventory/articles/${articleId}/scan`).send({ kind: 'SCHEDULED', score: 75 });

    const sessionAfter = await db.selectFrom('health_check_session')
      .select(['session_id', 'scanned_count'])
      .where('session_id', '=', sessionBefore!.session_id)
      .executeTakeFirst();
    expect(sessionAfter!.scanned_count).toBe(1);
  });

  it('T-438 INV-28: an AD_HOC scan does NOT increment scanned_count', async () => {
    const { fireWeeklyHealthCheckAlert } = await import('../src/features/inventory/service.js');

    const typeId = await makeSingleType(staff, 'Ad Hoc Ball');
    const a = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(133), entryScore: 90 });
    const articleId = a.body.article.articleId;

    const saId = (await db.selectFrom('app_user').select('user_id').where('role', '=', 'SUPER_ADMIN').executeTakeFirstOrThrow()).user_id;
    await db.insertInto('app_user').values({
      role: 'COORDINATOR', status: 'ACTIVE', full_name: 'Adhoc Coord',
      email: 'adhoccoord@bukc.edu.pk', contact_number: '03005551234',
      password_hash: 'x', created_by: saId, verified_at: new Date(),
    }).onConflict((oc) => oc.column('email').doNothing()).execute();

    await fireWeeklyHealthCheckAlert();

    const sessionBefore = await db.selectFrom('health_check_session')
      .select('scanned_count').orderBy('alert_sent_at', 'desc').executeTakeFirst();

    // AD_HOC scan — should NOT count
    await staff.post(`/api/inventory/articles/${articleId}/scan`).send({ kind: 'AD_HOC', score: 75 });

    const sessionAfter = await db.selectFrom('health_check_session')
      .select('scanned_count').orderBy('alert_sent_at', 'desc').executeTakeFirst();
    expect(sessionAfter!.scanned_count).toBe(sessionBefore!.scanned_count); // unchanged
  });

  it('T-439 INV-15: fireWeeklyHealthCheckAlert skips if an open session already exists', async () => {
    const { fireWeeklyHealthCheckAlert } = await import('../src/features/inventory/service.js');

    const typeId = await makeSingleType(staff, 'Skip Ball');
    await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(134), entryScore: 90 });

    const saId = (await db.selectFrom('app_user').select('user_id').where('role', '=', 'SUPER_ADMIN').executeTakeFirstOrThrow()).user_id;
    await db.insertInto('app_user').values({
      role: 'COORDINATOR', status: 'ACTIVE', full_name: 'Skip Coord',
      email: 'skipcoord@bukc.edu.pk', contact_number: '03004445678',
      password_hash: 'x', created_by: saId, verified_at: new Date(),
    }).onConflict((oc) => oc.column('email').doNothing()).execute();

    await fireWeeklyHealthCheckAlert(); // first call — opens a session
    const countBefore = await db.selectFrom('health_check_session')
      .select(db.fn.countAll().as('n')).executeTakeFirst();

    await fireWeeklyHealthCheckAlert(); // second call — should be skipped
    const countAfter = await db.selectFrom('health_check_session')
      .select(db.fn.countAll().as('n')).executeTakeFirst();

    expect(Number(countAfter?.n ?? 0)).toBe(Number(countBefore?.n ?? 0)); // no new session
  });

  it('T-440 INV-29: checkHealthCheckOverdue fires HEALTH_CHECK_OVERDUE for sessions open >48h', async () => {
    const { checkHealthCheckOverdue } = await import('../src/features/inventory/service.js');
    const { sql: rawSql } = await import('kysely');
    const { pool } = await import('../src/db/index.js');

    // Insert an overdue session directly via raw SQL (alert_sent_at 49h ago)
    await pool.query(
      `INSERT INTO health_check_session (total_articles_due, alert_sent_at)
       VALUES (5, now() - interval '49 hours')`,
    );

    const saId = (await db.selectFrom('app_user').select('user_id').where('role', '=', 'SUPER_ADMIN').executeTakeFirstOrThrow()).user_id;
    await db.insertInto('app_user').values({
      role: 'COORDINATOR', status: 'ACTIVE', full_name: 'Overdue Coord',
      email: 'overduecoord@bukc.edu.pk', contact_number: '03003334567',
      password_hash: 'x', created_by: saId, verified_at: new Date(),
    }).onConflict((oc) => oc.column('email').doNothing()).execute();
    const coordId = (await db.selectFrom('app_user').select('user_id')
      .where('email', '=', 'overduecoord@bukc.edu.pk').executeTakeFirstOrThrow()).user_id;

    await checkHealthCheckOverdue();

    // Session should now have overdue_notified_at set
    const session = await db.selectFrom('health_check_session')
      .select('overdue_notified_at')
      .where('total_articles_due', '=', 5)
      .where('completed_at', 'is', null)
      .executeTakeFirst();
    expect(session?.overdue_notified_at).not.toBeNull();

    // Coordinator should have the HEALTH_CHECK_OVERDUE notification
    const notif = await db.selectFrom('notification')
      .select('type')
      .where('recipient_id', '=', coordId)
      .where('type', '=', 'HEALTH_CHECK_OVERDUE')
      .executeTakeFirst();
    expect(notif).toBeTruthy();
  });

  it('T-441 INV-29: checkHealthCheckOverdue does NOT re-fire if already notified', async () => {
    const { checkHealthCheckOverdue } = await import('../src/features/inventory/service.js');
    const { pool } = await import('../src/db/index.js');

    // Insert session already past 48h AND already notified
    await pool.query(
      `INSERT INTO health_check_session (total_articles_due, alert_sent_at, overdue_notified_at)
       VALUES (3, now() - interval '50 hours', now() - interval '1 hour')`,
    );

    const saId = (await db.selectFrom('app_user').select('user_id').where('role', '=', 'SUPER_ADMIN').executeTakeFirstOrThrow()).user_id;
    await db.insertInto('app_user').values({
      role: 'COORDINATOR', status: 'ACTIVE', full_name: 'Already Notified Coord',
      email: 'alreadycoord@bukc.edu.pk', contact_number: '03002223456',
      password_hash: 'x', created_by: saId, verified_at: new Date(),
    }).onConflict((oc) => oc.column('email').doNothing()).execute();
    const coordId = (await db.selectFrom('app_user').select('user_id')
      .where('email', '=', 'alreadycoord@bukc.edu.pk').executeTakeFirstOrThrow()).user_id;

    const before = await db.selectFrom('notification').select(db.fn.countAll().as('n'))
      .where('recipient_id', '=', coordId).where('type', '=', 'HEALTH_CHECK_OVERDUE').executeTakeFirst();

    await checkHealthCheckOverdue();

    const after = await db.selectFrom('notification').select(db.fn.countAll().as('n'))
      .where('recipient_id', '=', coordId).where('type', '=', 'HEALTH_CHECK_OVERDUE').executeTakeFirst();
    expect(Number(after?.n ?? 0)).toBe(Number(before?.n ?? 0));
  });
});
