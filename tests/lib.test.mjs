import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhone, whatsappLink, formatPhone, slugify, validateSlug, normalizeBackup, backupInfo,
  matchRoute, groupContacts, initials,
} from '../src/js/lib.js';

test('normalizePhone accepts international formats and strips punctuation', () => {
  for (const [input, digits] of [
    ['+44 7700 900123', '447700900123'],
    ['(44) 7700-900123', '447700900123'],
    ['0044 7700 900123', '447700900123'],
    ['+1 (555) 010-0101', '15550100101'],
    ['919876543210', '919876543210'],
  ]) {
    assert.deepEqual(normalizePhone(input), { ok: true, value: digits }, input);
  }
});

test('normalizePhone rejects bad input', () => {
  for (const input of ['', '   ', 'abc', '07700 900123', '+44', '12345', '+1234567890123456', '44+7700900123', '++447700900123', '+44 7700 <script>']) {
    assert.equal(normalizePhone(input).ok, false, JSON.stringify(input));
  }
});

test('whatsappLink has no spaces or special characters', () => {
  assert.equal(whatsappLink('447700900123'), 'https://wa.me/447700900123');
  assert.equal(whatsappLink('+44 7700-900123'), 'https://wa.me/447700900123');
  assert.equal(formatPhone('447700900123'), '+447700900123');
});

test('slugify and validateSlug', () => {
  assert.equal(slugify('  My Brand! Café  '), 'my-brand-cafe');
  assert.equal(slugify('!!!'), '');
  assert.equal(validateSlug('my-brand'), null);
  for (const bad of ['', 'a', 'My-Brand', '-x', 'x-', 'a--b', 'a b', 'a'.repeat(61)]) {
    assert.notEqual(validateSlug(bad), null, bad);
  }
});

test('normalizeBackup', () => {
  assert.deepEqual(normalizeBackup('none', 'x'), { ok: true, type: 'none', value: null });
  assert.equal(normalizeBackup('email', 'a@b.co').ok, true);
  assert.equal(normalizeBackup('email', 'nope').ok, false);
  assert.deepEqual(normalizeBackup('telegram', '@my_brand'), { ok: true, type: 'telegram', value: 'my_brand' });
  assert.deepEqual(normalizeBackup('telegram', 'https://t.me/my_brand/'), { ok: true, type: 'telegram', value: 'my_brand' });
  assert.equal(normalizeBackup('telegram', 'ab').ok, false);
  assert.equal(normalizeBackup('fax', '1').ok, false);
});

test('backupInfo builds safe links', () => {
  assert.equal(backupInfo('email', 'a@b.co').href, 'mailto:a@b.co');
  assert.equal(backupInfo('telegram', 'my_brand').href, 'https://t.me/my_brand');
  assert.equal(backupInfo('none', null), null);
});

test('matchRoute', () => {
  assert.deepEqual(matchRoute('/'), { name: 'home' });
  assert.deepEqual(matchRoute('/brand/my-brand/'), { name: 'brand', slug: 'my-brand' });
  assert.equal(matchRoute('/brand/Bad Slug').name, 'notfound');
  assert.equal(matchRoute('/other').name, 'notfound');
});

test('groupContacts keeps category order, sorts, and drops empty groups', () => {
  const groups = groupContacts([
    { category: 'withdrawals', sort_order: 2, phone: '3' },
    { category: 'customer_support', sort_order: 2, phone: '2' },
    { category: 'customer_support', sort_order: 1, phone: '1' },
  ]);
  assert.deepEqual(groups.map((g) => g.value), ['customer_support', 'withdrawals']);
  assert.deepEqual(groups[0].contacts.map((c) => c.phone), ['1', '2']);
});

test('initials', () => {
  assert.equal(initials('Sample Brand One'), 'SB');
  assert.equal(initials(''), '?');
});
