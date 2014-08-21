/**
 * Copyright 2014, Yahoo! Inc.
 * Copyrights licensed under the New BSD License. See the accompanying LICENSE file for terms.
 */
/*globals describe,it,beforeEach */
"use strict";

var expect = require('chai').expect,
    StorageLRU = require('../../src/StorageLRU'),
    StorageMock =require('../mocks/StorageMock'),
    generateItems = require('../mocks/generateItems');

function findMetaRecord(records, key) {
    var record;
    for (var i = 0, len = records.length; i < len; i++) {
        if (records[i].key === key) {
            record = records[i];
        }
    }
    return record;
}

describe('StorageLRU', function () {
    var storage;

    beforeEach(function () {
        var mockData = generateItems('TEST_', [
            {
                key: 'fresh-lastAccessed',
                expiresDelta: 60,
                stale: 0,
                accessDelta: -30,
                value: 'expires in 1min, stale=0, last accessed 30secs ago'
            },
            {
                key: 'fresh',
                expiresDelta: 60,
                stale: 0,
                accessDelta: -300,
                value: 'expires in 1min, stale=0, last accessed 5mins ago'
            },
            {
                key: 'fresh-lastAccessed-biggerrecord',
                expiresDelta: 60,
                stale: 0,
                accessDelta: -30,
                value: 'expires in 1min, stale=0, last accessed 30secs ago, blahblahblah'
            },
            {
                key: 'stale-lowpriority',
                expiresDelta: -60,
                stale: 300,
                accessDelta: -600,
                priority: 5,
                value: 'expired 1min ago, stale=5, last accessed 10mins ago, priority=5'
            },
            {
                key: 'stale',
                expiresDelta: -60,
                stale: 300,
                accessDelta: -600,
                value: 'expired 1min ago, stale=5, last accessed 10mins ago'
            },
            {
                key: 'trulyStale',
                expiresDelta: -60,
                stale: 0,
                accessDelta: -30,
                value: 'expired 1min ago, stale=0, last accessed 30secs ago'
            },
            {
                key: 'bad',
                bad: true,
                value: 'invalid format'
            }
        ]);
        storage = new StorageMock(mockData);
    });

    it('constructor', function () {
        var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
        expect(lru._storage === storage).to.equal(true, '_storage assigned');
        expect(lru.options.recheckDelay).to.equal(-1, 'options.recheckDelay');
        expect(lru.options.keyPrefix).to.equal('TEST_', 'options.keyPrefix');
        expect(lru._purgeComparator).to.be.a('function', '_purgeComparator assigned');
    });

    it('stats', function () {
        var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
        var stats = lru.stats();
        expect(stats).to.eql({hit: 0, miss: 0, stale: 0, error: 0, revalidateSuccess: 0, revalidateFailure: 0}, 'stats inited');
        stats = lru.stats({du: true});
        expect(stats.hit).to.eql(0, 'stats.hit');
        expect(stats.miss).to.eql(0, 'stats.miss');
        expect(stats.stale).to.eql(0, 'stats.stale');
        expect(stats.error).to.eql(0, 'stats.error');
        expect(stats.error).to.eql(0, 'stats.revalidateSuccess');
        expect(stats.error).to.eql(0, 'stats.revalidateFailure');
        expect(stats.du.count).to.eql(7, 'stats.du.count');
        expect(stats.du.size > 0).to.eql(true, 'stats.du.size');
    });

    it('key', function () {
        var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
        expect(lru.key(0)).to.equal('fresh-lastAccessed', 'first key');
        expect(lru.key(1)).to.equal('fresh', 'second key');
    });

    it('numItems', function () {
        var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
        expect(lru.numItems()).to.equal(7);
    });

    it('_parseCacheControl', function () {
        var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
        var cc = lru._parseCacheControl('max-age=300,stale-while-revalidate=60');
        expect(cc['max-age']).to.equal(300);
        expect(cc['stale-while-revalidate']).to.equal(60);
        cc = lru._parseCacheControl('no-cache,no-store');
        expect(cc['no-cache']).to.equal(true);
        expect(cc['no-store']).to.equal(true);
        cc = lru._parseCacheControl('');
        expect(cc).to.eql({});
    });

    describe('#getItem', function () {
        it('invalid key', function () {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            lru.getItem('', {}, function (err, value) {
                expect(err.code).to.equal(5, 'expect "invalid key" error');
            });
        });
        it('cache miss - key does not exist', function (done) {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            lru.getItem('key_does_not_exist', {}, function(err, value) {
                expect(lru.stats()).to.include({hit: 0, miss: 1, stale: 0, error: 0}, 'cache miss');
                done();
            });
        });
        it('cache miss - truly stale', function (done) {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            var size = lru.numItems();
            lru.getItem('trulyStale', {}, function(err, value) {
                expect(!err).to.equal(true, 'no error');
                expect(!value).to.equal(true, 'no value');
                expect(lru.stats()).to.include({hit: 0, miss: 1, stale: 0, error: 0}, 'cache miss - truly stale');
                expect(lru.numItems()).to.equal(size - 1, 'truly stale item removed');
                done();
            });
        });
        it('cache hit - fresh', function (done) {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            var oldMeta = lru._deserialize(storage.getItem('TEST_fresh'), {}).meta;
            lru.getItem('fresh', {json: false}, function(err, value, meta) {
                expect(err).to.equal(null);
                expect(value).to.equal('expires in 1min, stale=0, last accessed 5mins ago');
                expect(meta.isStale).to.equal(false);
                expect(lru.stats()).to.include({hit: 1, miss: 0, stale: 0, error: 0}, 'cache hit');
                // make sure access timestamp is updated
                var newMeta = lru._deserialize(storage.getItem('TEST_fresh'), {}).meta;
                expect(newMeta.access > oldMeta.access).to.equal(true, 'access ts updated');
                expect(newMeta.expires).to.equal(oldMeta.expires, 'expires not changed');
                expect(newMeta.stale).to.equal(oldMeta.stale, 'stale not changed');
                expect(newMeta.priority).to.equal(oldMeta.priority, 'priority not changed');
                done();
            });
        });
        it('cache hit - stale', function (done) {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            lru.getItem('stale', {json: false}, function(err, value, meta) {
                expect(err).to.equal(null);
                expect(meta.isStale).to.equal(true);
                expect(value).to.equal('expired 1min ago, stale=5, last accessed 10mins ago');
                expect(lru.stats()).to.include({hit: 1, miss: 0, stale: 1, error: 0}, 'cache hit - stale');
                done();
            });
        });
        it('cache hit - stale - revalidate success', function (done) {
            var lru = new StorageLRU(storage, {
                keyPrefix: 'TEST_',
                revalidateFn: function (key, callback) {
                    callback(null, 'revalidated value');
                }
            });
            var size = lru.numItems();
            var record = findMetaRecord(lru._meta.records, 'TEST_stale');
            expect(record.key).to.equal('TEST_stale');
            expect(record.size).to.equal(86);
            expect(record.stale).to.equal(300);

            lru.getItem('stale', {json: false}, function(err, value, meta) {
                expect(!err).to.equal(true, 'no error, but getting: ' + (err && err.message));
                expect(meta.isStale).to.equal(true);
                expect(value).to.equal('expired 1min ago, stale=5, last accessed 10mins ago');
                expect(lru.stats()).to.include({hit: 1, miss: 0, stale: 1, error: 0, revalidateSuccess:1, revalidateFailure: 0}, 'cache hit,stale,revalidateSuccess');

                var updatedRecord = findMetaRecord(lru._meta.records, 'TEST_stale');
                expect(updatedRecord.key).to.equal(record.key, 'key remains the same');
                expect(updatedRecord.size).to.equal(52, 'size is updated');
                expect(updatedRecord.access).to.be.above(record.access, 'access timestamp is updated');
                expect(updatedRecord.expires).to.be.above(record.expires, 'expires timestamp is extended');
                expect(updatedRecord.maxAge).to.equal(record.maxAge, 'maxAge remains the same');
                expect(updatedRecord.stale).to.equal(record.stale, 'stale window size remains the same');
                expect(updatedRecord.priority).to.equal(record.priority, 'priority remains the same');
                done();
            });
        });
        it('cache hit - stale - revalidate failure', function (done) {
            var lru = new StorageLRU(storage, {
                keyPrefix: 'TEST_',
                revalidateFn: function (key, callback) {
                    callback('not able to revalidate "' + key + '"');
                }
            });
            var size = lru.numItems();
            var record = findMetaRecord(lru._meta.records, 'TEST_stale');
            expect(record.key).to.equal('TEST_stale');
            expect(record.size).to.equal(86);
            expect(record.stale).to.equal(300);

            lru.getItem('stale', {json: false}, function(err, value, meta) {
                expect(!err).to.equal(true, 'no error, but getting: ' + (err && err.message));
                expect(meta.isStale).to.equal(true);
                expect(value).to.equal('expired 1min ago, stale=5, last accessed 10mins ago');
                expect(lru.stats()).to.include({hit: 1, miss: 0, stale: 1, error: 0, revalidateSuccess:0, revalidateFailure: 1}, 'cache hit,stale,revalidateFailure');

                var updatedRecord = findMetaRecord(lru._meta.records, 'TEST_stale');
                expect(updatedRecord.key).to.equal(record.key, 'key remains the same');
                expect(updatedRecord.size).to.equal(record.size, 'size remains the same');
                expect(updatedRecord.access).to.be.above(record.access, 'access timestamp is updated');
                expect(updatedRecord.expires).to.equal(record.expires, 'expires timestamp remains the same');
                expect(updatedRecord.maxAge).to.equal(record.maxAge, 'maxAge remains the same');
                expect(updatedRecord.stale).to.equal(record.stale, 'stale window size remains the same');
                expect(updatedRecord.priority).to.equal(record.priority, 'priority remains the same');
                done();
            });
        });
        it('bad item', function (done) {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            lru.getItem('bad', {json: false}, function(err, value, meta) {
                expect(err.code).to.equal(2, 'expect "cannot deserialize" error');
                expect(lru.stats()).to.include({hit: 0, miss: 0, stale: 0, error: 1}, 'cache hit - stale');
                done();
            });
        });
    });

    describe('#setItem', function () {
        it('invalid key', function () {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            var size = lru.numItems();
            lru.setItem('', {foo: 'bar'}, {json: true, cacheControl: 'max-age=300'}, function (err, value) {
                expect(err.code).to.equal(5, 'expect "invalid key" error');
                expect(lru.numItems()).to.equal(size, 'numItems remains the same');
            });
        });
        it('new item, json=true', function (done) {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            var size = lru.numItems();
            lru.setItem('new_item', {foo: 'bar'}, {json: true, cacheControl: 'max-age=300'}, function (err) {
                expect(lru.numItems()).to.equal(size + 1, 'numItems should increase by 1');
                var record = findMetaRecord(lru._meta.records, 'TEST_new_item');
                expect(record.key).to.equal('TEST_new_item');
                expect(record.size).to.equal(46);
                expect(record.stale).to.equal(0);
                lru.getItem('new_item', {}, function (err, value, meta) {
                    expect(value).to.equal('{"foo":"bar"}');
                    expect(meta.isStale).to.equal(false);
                    done();
                });
            });
        });
        it('new item, json=false', function (done) {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            var size = lru.numItems();
            lru.setItem('new_item', 'foobar', {json: false, cacheControl: 'max-age=300'}, function (err) {
                expect(lru.numItems()).to.equal(size + 1);
                lru.getItem('new_item', {json: false}, function (err, value, meta) {
                    expect(value).to.equal('foobar');
                    expect(meta.isStale).to.equal(false);
                    done();
                });
            });
        });
        it('new item, json default is false', function (done) {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            var size = lru.numItems();
            lru.setItem('new_item', '{foo:"bar"}', {cacheControl: 'max-age=300'}, function (err) {
                expect(lru.numItems()).to.equal(size + 1);
                lru.getItem('new_item', {}, function (err, value, meta) {
                    expect(value).to.equal('{foo:"bar"}');
                    expect(meta.isStale).to.equal(false);
                    done();
                });
            });
        });
        it('existing item, json=false', function (done) {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            var numItems = lru.numItems();
            var record = findMetaRecord(lru._meta.records, 'TEST_fresh');
            var access = record.access;
            var size = record.size;
            lru.setItem('fresh', 'foobar', {json: false, cacheControl: 'max-age=300'}, function (err) {
                expect(lru.numItems()).to.equal(numItems, 'numItems is correct');
                var updatedRecord = findMetaRecord(lru._meta.records, 'TEST_fresh');
                expect(updatedRecord.access > access).to.equal(true, 'access timestamp updated');
                expect(updatedRecord.size < size).to.equal(true, 'size timestamp updated');
                lru.getItem('fresh', {json: false}, function (err, value, meta) {
                    expect(value).to.equal('foobar');
                    expect(meta.isStale).to.equal(false);
                    done();
                });
            });
        });
        it('disabled', function (done) {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            lru._enabled = false;
            lru.setItem('new_item', 'foobar', {json: false, cacheControl: 'max-age=300'}, function (err) {
                expect(err.code).to.equal(1);
                done();
            });
        });
        it('no-cache', function (done) {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            lru.setItem('new_item', 'foobar', {json: false, cacheControl: 'no-cache'}, function (err) {
                expect(err.code).to.equal(4);
                done();
            });
        });
        it('no-store', function (done) {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            lru.setItem('new_item', 'foobar', {json: false, cacheControl: 'no-store'}, function (err) {
                expect(err.code).to.equal(4);
                done();
            });
        });
        it('invalid max-age', function (done) {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            lru.setItem('new_item', 'foobar', {json: false, cacheControl: 'max-age=-1'}, function (err) {
                expect(err.code).to.equal(4);
                done();
            });
        });
        it('missing cacehControl', function (done) {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            lru.setItem('new_item', 'foobar', {json: false}, function (err) {
                expect(err.code).to.equal(4);
                done();
            });
        });
        it('disable mode', function (done) {
            var emptyStorage = new StorageMock();
            var lru = new StorageLRU(emptyStorage, {keyPrefix: 'TEST_'});
            lru.setItem('throw_max_quota_error', 'foobar', {json: false, cacheControl: 'max-age=300'}, function (err) {
                expect(err.code).to.equal(1);
                done();
            });
        });
        it('disable mode - re-enable', function (done) {
            var emptyStorage = new StorageMock();
            var lru = new StorageLRU(emptyStorage, {keyPrefix: 'TEST_', recheckDelay: 10});
            lru.setItem('throw_max_quota_error', 'foobar', {json: false, cacheControl: 'max-age=300'}, function (err) {
                expect(err.code).to.equal(1);
                setTimeout(function () {
                    expect(lru._enabled).to.equal(true, 'renabled');
                    done();
                }, 10);
            });
        });
        it('try purge', function (done) {
            var emptyStorage = new StorageMock(generateItems('TEST_', [
                {
                    key: 'fresh',
                    expiresDelta: 60,
                    stale: 0,
                    accessDelta: -300,
                    value: 'foobar'
                }
            ]));
            var lru = new StorageLRU(emptyStorage, {keyPrefix: 'TEST_'});
            lru.setItem('throw_max_quota_error', 'foobarrrrrrr', {json: false, cacheControl: 'max-age=300'}, function (err) {
                expect(err.code).to.equal(6, 'expected "not enough space" error');
                done();
            });
        });
    });

    describe('#purge', function () {
        it('all purged spacedNeeded=100000', function (done) {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_', purgedFn: function (purged) {
                setTimeout(function () {
                    expect(purged).to.eql(['bad', 'trulyStale', 'stale-lowpriority', 'stale', 'fresh', 'fresh-lastAccessed-biggerrecord', 'fresh-lastAccessed']);
                    done();
                }, 1);
            }});
            var size = lru.numItems();
            lru.purge(10000, function (err) {
                expect(!!err).to.equal(true, 'not enough space');
                expect(lru.numItems()).to.equal(0);
            });
        });
        it('1 purged spacedNeeded=3', function (done) {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_', purgedFn: function (purged) {
                setTimeout(function () {
                    expect(purged).to.eql(['bad']);
                }, 1);
            }});
            var size = lru.numItems();
            lru.purge(3, function (err) {
                expect(!err).to.eql(true);
                expect(lru.numItems()).to.equal(size - 1);
                done();
            });
        });
        it('2 purged spacedNeeded=50', function (done) {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_', purgedFn: function (purged) {
                setTimeout(function () {
                    expect(purged).to.eql(['bad', 'trulyStale']);
                }, 1);
            }});
            var size = lru.numItems();
            lru.purge(50, function (err) {
                expect(!err).to.eql(true);
                expect(lru.numItems()).to.equal(size - 2);
                done();
            });
        });
    });

    describe('#_parser.format', function () {
        it('valid meta', function () {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            var parser = lru._parser;
            expect(parser.format).to.throw('invalid meta');
            var value = parser.format({
                access: 1000,
                expires: 1000,
                maxAge: 300,
                stale: 0,
                priority: 4
            }, 'aaa');
            expect(value).to.equal('[1:1000:1000:300:0:4]aaa');
        });
        it('negative access', function () {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            var parser = lru._parser;
            try {
                parser.format({
                    access: -1,
                    expires: 1000,
                    maxAge: 300,
                    stale: 1000
                }, 'aaa');
            } catch (e) {
                expect(e.message).to.equal('invalid meta');
            }
        });
        it('negative stale', function () {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            var parser = lru._parser;
            try {
                parser.format({
                    access: 1000,
                    expires: 1000,
                    maxAge: 300,
                    stale: -1
                }, 'aaa');
            } catch (e) {
                expect(e.message).to.equal('invalid meta');
            }
        });
        it('negative expires', function () {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            var parser = lru._parser;
            try {
                parser.format({
                    access: 1000,
                    expires: -1,
                    maxAge: 300,
                    stale: 0
                }, 'aaa');
            } catch (e) {
                expect(e.message).to.equal('invalid meta');
            }
        });
        it('bad priority', function () {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            var parser = lru._parser;
            try {
                parser.format({
                    access: 1000,
                    expires: 1000,
                    maxAge: 300,
                    stale: 0,
                    priority: 0
                }, 'aaa');
            } catch (e) {
                expect(e.message).to.equal('invalid meta');
            }
        });
    });

    describe('#_parser.parse', function () {
        it('valid format', function () {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            var parser = lru._parser;
            expect(parser.parse).to.throw('missing meta');
            var parsed = parser.parse('[1:2000:1000:300:0:1]aaa');
            expect(parsed.meta.version).to.equal('1');
            expect(parsed.meta.access).to.equal(2000);
            expect(parsed.meta.expires).to.equal(1000);
            expect(parsed.meta.stale).to.equal(0);
            expect(parsed.meta.priority).to.equal(1);
            expect(parsed.meta.size).to.equal(24);
            expect(parsed.value).to.equal('aaa');
        });
        it('negative access field', function () {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            var parser = lru._parser;
            try {
                parser.parse('[1:-2000:1000:300:0:1]aaa');
            } catch(e) {
                expect(e.message).to.equal('invalid meta fields');
            }
        });
    });

    describe('#removeItem', function () {
        it('valid key', function () {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            var size = lru.numItems();
            lru.removeItem('fresh', function (err) {
                expect(!err).to.equal(true, 'expect no error');
                expect(lru.numItems()).to.equal(size - 1, 'numItems should decrease by 1');
            });
        });
        it('invalid key', function () {
            var lru = new StorageLRU(storage, {keyPrefix: 'TEST_'});
            var size = lru.numItems();
            lru.removeItem('', function (err) {
                expect(err.code).to.equal(5, 'expect "invalid key" error');
                expect(lru.numItems()).to.equal(size, 'numItems should not change');
            });
        });
    });

});
