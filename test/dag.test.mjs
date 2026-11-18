import test from 'node:test';
import assert from 'node:assert/strict';
import {assertTaskGraphCandidate,TeamTaskGraphError} from '../vendor/dsh/team/task-graph.mjs';
const node=(id,blockedBy=[])=>({id,status:'pending',blockedBy});
test('upstream DAG validation accepts a diamond and rejects invalid dependencies',()=>{
 const diamond=[node('a'),node('b',['a']),node('c',['a']),node('d',['b','c'])];
 assert.doesNotThrow(()=>assertTaskGraphCandidate(diamond,diamond[3]));
 const bad=[node('a',['b']),node('b',['a'])];
 assert.throws(()=>assertTaskGraphCandidate(bad,bad[0]),e=>e instanceof TeamTaskGraphError&&e.violation==='cycle');
 assert.throws(()=>assertTaskGraphCandidate([node('a')],node('a',['missing'])),e=>e.violation==='missing');
 assert.throws(()=>assertTaskGraphCandidate([node('a')],node('b',['a','a'])),e=>e.violation==='duplicate');
});
