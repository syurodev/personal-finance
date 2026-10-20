import { pool } from '../db/index.js';
import { asUser, createTestUser } from '../../test/fixtures.js';
import {
  categoryTree,
  createCategory,
  descendantIds,
  resolveCategory,
  seedDefaultCategories,
  updateCategory,
} from './categories.js';

describe('categories', () => {
  let alice: string;

  beforeAll(async () => {
    alice = await createTestUser();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('seeds 15 defaults once', async () => {
    const tree = await asUser(alice, () => categoryTree());
    expect(tree).toHaveLength(15);
    expect(await asUser(alice, () => seedDefaultCategories())).toBe(0);
  });

  it('resolves by accent-insensitive name within a kind', async () => {
    const row = await asUser(alice, () => resolveCategory('an uong', 'expense'));
    expect(row.name).toBe('Ăn uống');
  });

  it('reports a kind mismatch instead of not found', async () => {
    await expect(asUser(alice, () => resolveCategory('Lương', 'expense'))).rejects.toMatchObject({
      code: 'CATEGORY_KIND_MISMATCH',
    });
  });

  it('creates a child category and includes it in descendants', async () => {
    const child = await asUser(alice, () => createCategory({ name: 'Cà phê', kind: 'expense', parent: 'Ăn uống' }));
    const parent = await asUser(alice, () => resolveCategory('Ăn uống', 'expense'));
    expect(child.parent_id).toBe(parent.id);
    const ids = await asUser(alice, () => descendantIds(parent.id));
    expect(ids).toEqual(expect.arrayContaining([parent.id, child.id]));
  });

  it('allows only two levels', async () => {
    await expect(
      asUser(alice, () => createCategory({ name: 'Espresso', kind: 'expense', parent: 'Cà phê' })),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a duplicate sibling name', async () => {
    await expect(asUser(alice, () => createCategory({ name: 'an uong', kind: 'expense' }))).rejects.toMatchObject({
      code: 'DUPLICATE_NAME',
    });
  });

  it('renames, moves to top level and archives', async () => {
    const moved = await asUser(alice, () => updateCategory('Cà phê', { name: 'Cafe', parent: null }));
    expect(moved).toMatchObject({ name: 'Cafe', parent_id: null });
    const archived = await asUser(alice, () => updateCategory('Cafe', { archived: true }));
    expect(archived.archived).toBe(true);
    await expect(asUser(alice, () => resolveCategory('Cafe'))).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
  });
});
