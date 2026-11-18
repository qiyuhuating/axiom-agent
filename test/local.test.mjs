import { test } from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { RpcClient, SessionManager } from '@earendil-works/pi-coding-agent';

test('uses installed Pi RPC and persistent session APIs', () => {
  assert.equal(typeof RpcClient.prototype.prompt, 'function');
  assert.equal(typeof SessionManager.list, 'function');
});

test('Markdown renders code without accepting raw HTML or script links', () => {
  const md = new MarkdownIt({html:false,linkify:true}).disable('image');
  assert.match(md.render('~~~js\nconst x = 1;\n~~~'), /<pre><code/);
  assert.doesNotMatch(md.render('<script>alert(1)</script>'), /<script>/);
  assert.doesNotMatch(md.render('[bad](javascript:alert%281%29)'), /href="javascript:/);
});
