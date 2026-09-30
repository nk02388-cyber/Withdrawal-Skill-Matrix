import test from 'node:test';import assert from 'node:assert/strict';import {photoFileError} from '../staff-photo.mjs';
test('staff photos allow supported nonempty images up to 10 MB',()=>{for(const type of ['image/jpeg','image/png','image/webp'])assert.equal(photoFileError({type,size:10*1024*1024}),'');assert.equal(photoFileError(null),'');});
test('staff photos reject unsupported, empty and oversized files',()=>{for(const file of [{type:'image/svg+xml',size:100},{type:'text/html',size:100},{type:'image/jpeg',size:0},{type:'image/png',size:10*1024*1024+1}])assert.ok(photoFileError(file));});
