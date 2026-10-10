import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {bulkExportState,setExcludeBulkExports,recordBulkExport,backup,restore,reprocess,annotate,annotations} from '../src/core/store';

test('bulk export history merges concurrent downloads and survives reprocessing independently of notes',async()=>{
  assert.deepEqual(await bulkExportState(),{ids:[],exclude:false});
  await setExcludeBulkExports(true);
  await Promise.all([recordBulkExport(['hand-a','hand-b']),recordBulkExport(['hand-b','hand-c'])]);
  await annotate({id:'hand-a',note:'keep note',bookmark:true});
  await reprocess();
  const state=await bulkExportState();assert.deepEqual(new Set(state.ids),new Set(['hand-a','hand-b','hand-c']));assert.equal(state.exclude,true);
  assert.equal((await annotations())[0].note,'keep note');
});

test('backups restore export history as a union and legacy backups do not clear it',async()=>{
  const b=await backup();assert.ok(b.bulkExports.includes('hand-a'));
  await restore({...b,bulkExports:['hand-d']});
  const {bulkExports,...legacy}=b;await restore(legacy);
  assert.deepEqual(new Set((await bulkExportState()).ids),new Set(['hand-a','hand-b','hand-c','hand-d']));
  assert.equal((await bulkExportState()).exclude,true);
  await setExcludeBulkExports(false);assert.equal((await bulkExportState()).ids.length,4);
});

test('invalid export history rejects the entire backup without partial writes',async()=>{
  const before=await backup();
  await assert.rejects(restore({...before,bulkExports:[null],annotations:[{id:'bad-import',note:'must not save',bookmark:false}]}));
  assert.deepEqual(await annotations(),before.annotations);
  assert.deepEqual((await bulkExportState()).ids,before.bulkExports);
  await assert.rejects(recordBulkExport(['valid','']));
  assert.deepEqual((await bulkExportState()).ids,before.bulkExports);
});

test('clearing a canceled legacy export preserves other exports and notes',async()=>{
  const {clearBulkExports}=await import('../src/core/store');
  await clearBulkExports(['hand-a','unknown']);
  assert.deepEqual(new Set((await bulkExportState()).ids),new Set(['hand-b','hand-c','hand-d']));
  assert.equal((await annotations())[0].note,'keep note');
});
