import assert from 'node:assert/strict';
import test from 'node:test';

import { tagPromptWithChannel } from '../src/channels/shared/workspace-session.mjs';

test('tagPromptWithChannel prefixes plain text prompts with the source channel', () => {
  const { text, content } = tagPromptWithChannel('查一下天气', undefined, '飞书');
  assert.equal(text, '[来源渠道:飞书]\n查一下天气');
  assert.equal(content, undefined);
});

test('tagPromptWithChannel produces a tag-only prompt when the text is empty', () => {
  const { text } = tagPromptWithChannel('', undefined, '钉钉');
  assert.equal(text, '[来源渠道:钉钉]');
});

test('tagPromptWithChannel prefixes the first text part of structured content', () => {
  const image = { type: 'image', mediaType: 'image/png', data: 'Zm9v' };
  const { content } = tagPromptWithChannel('请分析这张图片。', [
    { type: 'text', text: '请分析这张图片。' },
    image,
  ], '企微');
  assert.equal(content[0].text, '[来源渠道:企微]\n请分析这张图片。');
  assert.equal(content[1], image);
});

test('tagPromptWithChannel inserts a text part when structured content has none', () => {
  const image = { type: 'image', mediaType: 'image/png', data: 'Zm9v' };
  const { content } = tagPromptWithChannel(undefined, [image], '微信');
  assert.equal(content[0].type, 'text');
  assert.equal(content[0].text, '[来源渠道:微信]');
  assert.equal(content[1], image);
});

test('tagPromptWithChannel leaves the prompt untouched without a channel label', () => {
  const content = [{ type: 'text', text: 'hello' }];
  const tagged = tagPromptWithChannel('hello', content, undefined);
  assert.equal(tagged.text, 'hello');
  assert.equal(tagged.content, content);
  assert.deepEqual(tagPromptWithChannel('hello', undefined, '  '), { text: 'hello', content: undefined });
});
