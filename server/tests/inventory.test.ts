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
