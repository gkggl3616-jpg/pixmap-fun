'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanName, pixels, ranks } = require('../server');

test('player names are cleaned and limited', () => {
  assert.equal(cleanName('  <b>Oyuncu</b>  '), 'bOyuncu/b');
  assert.equal(cleanName(''), 'Misafir');
  assert.equal(cleanName('123456789012345678901234'), '12345678901234567890');
});

test('canvas has the expected compact size', () => {
  assert.equal(pixels.length, 256 * 256);
});

test('empty ranking is valid', () => {
  assert.ok(Array.isArray(ranks()));
});
