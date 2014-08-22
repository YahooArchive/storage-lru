/**
 * Copyright 2014, Yahoo! Inc.
 * Copyrights licensed under the New BSD License. See the accompanying LICENSE file for terms.
 */
'use strict';

var ERR_DISABLED = {code: 1, message: 'disabled'},
    ERR_DESERIALIZE = {code: 2, message: 'cannot deserialize'},
    ERR_SERIALIZE = {code: 3, message: 'cannot serialize'},
    ERR_CACHECONTROL = {code: 4, message: 'bad cacheControl'},
    ERR_INVALIDKEY = {code: 5, message: 'invalid key'},
    ERR_NOTENOUGHSPACE = {code: 6, message: 'not enough space'},
    ERR_REVALIDATE = {code: 7, message: 'revalidate failed'},
    // cache control fields
    MAX_AGE = 'max-age',
    STALE_WHILE_REVALIDATE = 'stale-while-revalidate',
    DEFAULT_KEY_PREFIX = '',
    DEFAULT_PRIORITY = 3,
    CUR_VERSION = '1';
 
function isDefined(x) { return x !== undefined; }

function cloneError(err, moreInfo) {
    var message = err.message;
    if (moreInfo) {
        message += ': ' + moreInfo;
    }
    return {code: err.code, message: message};
}

function merge() {
    var merged = {};
    for (var i = 0, len = arguments.length; i < len; i++) {
        var obj = arguments[i];
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) {
                merged[key] = obj[key];
            }
        }
    }
    return merged;
}

function nowInSec() {
    return Math.floor(new Date().getTime() / 1000);
}

/*
 * Use this to sort meta records array.  Item to be purged first
 * should be the last in the array after sort.
 */
function defaultPurgeComparator(meta1, meta2) {
    // purge bad entries first
    if (meta1.bad !== meta2.bad) {
        return meta1.bad ? 1 : -1;
    }
    // purge truly stale one first
    var now = nowInSec();
    var stale1 = now >= (meta1.expires + meta1.stale);
    var stale2 = now >= (meta2.expires + meta2.stale);
    if (stale1 !== stale2) {
        return stale1 ? 1 : -1;
    }

    // both fetchable (not truly staled); purge lowest priority one first
    if (meta1.priority !== meta2.priority) {
        return (meta1.priority > meta2.priority) ? 1 : -1;
    }

    // same priority; purge least access one first
    if (meta1.access !== meta2.access) {
        return (meta1.access < meta2.access) ? 1 : -1;
    }
    // compare size. big ones go first.
    if (meta1.size > meta2.size) {
        return 1;
    } else if (meta1.size === meta2.size) {
        return 0;
    } else {
        return -1;
    }
}

function Meta(storageInterface, parser, options) {
    this.storage = storageInterface;
    this.parser = parser;
    this.options = options || {};
    this.records = [];
    this.init();
}
Meta.prototype.init = function () {
    // expensive operation
    // go through all items in storage, get meta data
    var storage = this.storage;
    var keyPrefix = this.options.keyPrefix;
    for (var i = 0, len = storage.length; i < len; i++) {
        var key = storage.key(i);
        if (!keyPrefix || key.indexOf(keyPrefix) === 0) {
            var item = storage.getItem(key);
            var meta;
            try {
                meta = this.parser.parse(item).meta;
                meta.key = key;
            } catch (ignore) {
                // ignore
                meta = {key: key, bad: true, size: item.length};
            }
            this.records.push(meta);
        }
    }
};
Meta.prototype.sort = function (comparator) {
    this.records.sort(comparator);
};
Meta.prototype.update = function (key, meta) {
    for (var i = 0, len = this.records.length; i < len; i++) {
        var record = this.records[i];
        if (record.key === key) {
            record.bad = false; // in case it was a bad record before
            this.records[i] = merge(record, meta);
            return this.records[i];
        }
    }
    // record does not exist. create a new one.
    meta = merge(meta, {key: key});
    this.records.push(meta);
    return meta;
};
Meta.prototype.remove = function (key) {
    for (var i = 0, len = this.records.length; i < len; i++) {
        if (this.records[i].key === key) {
            this.records.splice(i);
            return;
        }
    }
};
Meta.prototype.du = function () {
    var size = 0;
    for (var i = 0, len = this.records.length; i < len; i++) {
        size += this.records[i].size;
    }
    return {
        count: this.records.length,
        size: size
    };
};

function Parser() {}
Parser.prototype.format = function (meta, value) {
    if (meta && meta.access > 0 && meta.expires > 0 && meta.stale >= 0 && meta.priority > 0 && meta.maxAge > 0) {
        return '[' + [CUR_VERSION, meta.access, meta.expires, meta.maxAge, meta.stale, meta.priority].join(':') + ']' + value;
    }
    throw new Error('invalid meta');
};
Parser.prototype.parse = function (item) {
    // format is:
    // [<version>:<access_time_in_sec>:<expires_time_in_sec>:<max_age_in_sec>:<stale_time_in_sec>:<priority>]<value_string_can_be_very_long>
    // in the future, parse version out first; then fields depending on version
    var pos = item && item.indexOf(']');
    if (!pos) {
        throw new Error('missing meta');
    }
    var meta = item.substring(1, pos).split(':');
    if (meta.length !== 6) {
        throw new Error('invalid number of meta fields');
    }
    meta = {
        version: meta[0],
        access: parseInt(meta[1], 10),
        expires: parseInt(meta[2], 10),
        maxAge: parseInt(meta[3], 10),
        stale: parseInt(meta[4], 10),
        priority: parseInt(meta[5], 10),
        size: item.length
    };
    if (isNaN(meta.access) || isNaN(meta.expires) || isNaN(meta.maxAge) || isNaN(meta.stale) || meta.access <= 0 || meta.expires <= 0 || meta.maxAge <= 0 || meta.stale < 0 || meta.priority <= 0) {
        throw new Error('invalid meta fields');
    }
    return {
        meta: meta,
        value: item.substring(pos + 1)
    };
};

function Stats(meta) {
    this.hit = 0;
    this.miss = 0;
    this.stale = 0;
    this.error = 0;
    this.revalidateSuccess = 0;
    this.revalidateFailure = 0;
    this._meta = meta;
}
Stats.prototype.toJSON = function(options) {
    var stats = {
        hit: this.hit,
        miss: this.miss,
        stale: this.stale,
        error: this.error,
        revalidateSuccess: this.revalidateSuccess,
        revalidateFailure: this.revalidateFailure
    };
    if (options && options.du) {
        // include disk usage data
        stats.du = this._meta.du();
    }
    return stats;
};

/**
 * @class StorageLRU
 * @constructor
 * @param {Object} storageInterface  A storage object (such as window.localStorage, but not limited to localStorage)
 *                   that conforms to the localStorage API.
 * @param {Object} [options]
 * @param {Number} [options.recheckDelay=-1]  If the underline storage is disabled, this option defines the delay time interval
 *                   for re-checking whether the underline storage is re-enabled.  Default value is -1, which
 *                   means no re-checking.
 * @param {String} [options.keyPrefix=''] Storage key prefix.
 * @param {Number} [options.purgeFactor=1]  Extra space to purge. E.g. if space needed for a new item is 1000 characters, LRU will actually
 *                   try to purge (1000 + 1000 * purgeFactor) characters.
 * @param {Function} [options.purgedFn] The callback function to be executed, if an item is purged.  *Note* This function will be
 *                   asynchronously called, meaning, you won't be able to cancel the purge.
 * @param {Function} [options.purgeComparator] If you really want to, you can customize the comparator used to determine items'
 *                   purge order.  The default comparator purges in this precendence order (from high to low):
 *                      bad entry (invalid meta info),
 *                      truly stale (passed stale-while-revaliate window),
 *                      lowest priority,
 *                      least recently accessed,
 *                      bigger byte size
 * @param {Function} [options.revalidateFn] The function to be executed to refetch the item if it becomes expired but still
 *                   in the stale-while-revalidate window.
 */
function StorageLRU(storageInterface, options) {
    options = options || {};
    this.options = {};
    this.options.recheckDelay = isDefined(options.recheckDelay) ? options.recheckDelay : -1;
    this.options.keyPrefix = options.keyPrefix || DEFAULT_KEY_PREFIX;
    this.options.purgedFn = options.purgedFn;
    this._storage = storageInterface;
    this._purgeComparator = options.purgeComparator || defaultPurgeComparator;
    this._revalidateFn = options.revalidateFn;
    this._parser = new Parser(this._storage, this.options);
    this._meta = new Meta(this._storage, this._parser, this.options);
    this._stats = new Stats(this._meta);
    this._enabled = true;
}

/**
 * Reports statistics information.
 * @method stats
 * @param {Object} options
 * @param {Boolean} [options.du=false]  Whether to include disk usage data.
 * @return {Object} statistics information, including:
 *   - hit: Number of cache hits
 *   - miss: Number of cache misses
 *   - error: Number of errors occurred during getItem
 *   - stale: Number of occurrances where stale items were returned (cache hit with data that
 *            expired but still within stale-while-revalidate window)
 *   - du: Disk usage (total item count and characters used), if options.du=true
 */
StorageLRU.prototype.stats = function (options) {
    return this._stats.toJSON(options);
};

/**
 * Gets the key of the item at the given index in the underline storage
 * @method key
 * @param {Number} index  The item index
 * @return {String|Null}  The key string.
 */
StorageLRU.prototype.key = function (index) {
    var key = this._storage.key(index);
    key = key && this._deprefix(key);
    return key;
};

/**
 * Gets the item with the given key in the underline storage.  Note that if the item has exipired but
 * is still in stale-while-revalidate window, its value will be revalidated if revalidateFn is provided
 * when the StorageLRU instance was created.
 * @method getItem
 * @param {String} key  The key string
 * @param {Object} options
 * @param {Boolean} [options.json=false]  Whether the value should be deserialized to a JSON object.
 * @param {Function} callback The callback function.
 * @param {Object} callback.error The error object (an object with code, message fields) if get failed.
 * @param {String|Object} callback.value The value.
 * @param {Object} callback.meta Meta information. Containing isStale field.  isStale=true means this
 *                    item has expired (max-age reached), but still within stale-while-revalidate window.
 *                    isStale=false means this item has not reached its max-age.
 */
StorageLRU.prototype.getItem = function (key, options, callback) {
    if (!key) {
        callback && callback(cloneError(ERR_INVALIDKEY, key));
        return;
    }

    var self = this;
    var prefixedKey = self._prefix(key);
    var value = self._storage.getItem(prefixedKey);
    if (!value) {
        self._stats.miss++;
        self._meta.remove(prefixedKey);
        callback();
    } else {
        try {
            value = self._deserialize(value, options);
            var meta = value.meta,
                now = nowInSec();
            if ((meta.expires + meta.stale) < now) {
                self._stats.miss++;
                self.removeItem(key);
                callback();
                return;
            }
            self._stats.hit++;
            meta = self._meta.update(prefixedKey, {access: now});
            // update the access timestamp in the underline storage
            var serializedValue = self._serialize(value.value, meta, options);
            self._storage.setItem(prefixedKey, serializedValue);
            // is the item already expired but still in the stale-while-revalidate window?
            var isStale = meta.expires < now;
            if (isStale) {
                self._stats.stale++;
                self._revalidate(key, meta, {json: !!(options && options.json)});
            }
            callback(null, value.value, {isStale: isStale});
        } catch (e) {
            self._stats.error++;
            callback(cloneError(ERR_DESERIALIZE, e.message));
        }
    }
};

/**
 * Calls the revalidateFn to fetch a fresh copy of a stale item.
 * @method _revalidate
 * @param {String} key The item key
 * @param {Object} meta  The meta record for this item
 * @param {Object} options
 * @param {Boolean} [options.json=false]  Whether the value is a JSON object.
 * @param {Function} [callback]
 * @param {Object} callback.error The error object (an object with code, message fields) if revalidateFn failed to fetch the item.
 * @private
 */
StorageLRU.prototype._revalidate = function (key, meta, options, callback) {
    var self = this;

    // if revalidateFn is defined, refetch item and save it to storage
    if ('function' !== typeof self._revalidateFn) {
        callback && callback();
        return;
    }

    self._revalidateFn(key, function revalidated(err, value) {
        if (err) {
            self._stats.revalidateFailure++;
            callback && callback(cloneError(ERR_REVALIDATE, err.message));
            return;
        }
        try {
            var now = nowInSec();

            // update the size and expires fields, and inherit other fields.
            // Especially, do not update access timestamp.
            var newMeta = {
                access: meta.access,
                maxAge: meta.maxAge,
                expires: now + meta.maxAge,
                stale: meta.stale,
                priority: meta.priority
            };

            // save into the underline storage and update meta record
            var serializedValue = self._serialize(value, newMeta, options);
            var prefixedKey = self._prefix(key);
            self._storage.setItem(prefixedKey, serializedValue);

            newMeta.size = serializedValue.length;
            self._meta.update(prefixedKey, newMeta);

            self._stats.revalidateSuccess++;
            callback && callback();
        } catch (e) {
            self._stats.revalidateFailure++;
            callback && callback(cloneError(ERR_REVALIDATE, e.message));
        }
    });
};

/**
 * Saves the item with the given key in the underline storage
 * @method setItem
 * @param {String} key  The key string
 * @param {String|Object} value  The value string or JSON object
 * @param {Object} options
 * @param {Boolean} options.cacheControl  Required.  Use the syntax as HTTP Cache-Control header.  To be
 *                   able to use LRU, you need to have a positive "max-age" value (in seconds), e.g. "max-age=300".
 *                   Another very useful field is "stale-while-revalidate", e.g. "max-age=300,stale-while-revalidate=6000".
 *                   If an item has expired (max-age reached), but still within stale-while-revalidate window,
 *                   LRU will allow retrieval the item, but tag it with isStale=true in the callback.
 *                   **Note**:
 *                    - LRU does not try to refetch the item when it is stale-while-revaliate.
 *                    - Having "no-cache" or "no-store" will abort the operation with invalid cache control error. 
 * @param {Boolean} [options.json=false]  Whether the value should be serialized to a string before saving.
 * @param {Number} [options.priority=3]  The priority of the item.  Items with lower priority will be purged before
 *                    items with higher priority, assuming other conditions are the same.
 * @param {Function} [callback] The callback function.
 * @param {Object} callback.error The error object (an object with code, message fields) if setItem failed.
 */
StorageLRU.prototype.setItem = function (key, value, options, callback) {
    if (!key) {
        callback && callback(cloneError(ERR_INVALIDKEY, key));
        return;
    }

    var self = this;
    if (!self._enabled) {
        callback && callback(cloneError(ERR_DISABLED));
        return;
    }

    // parse cache control
    var cacheControl = self._parseCacheControl(options && options.cacheControl);
    if (cacheControl['no-cache'] || cacheControl['no-store'] || !cacheControl[MAX_AGE] || cacheControl[MAX_AGE] <= 0) {
        callback && callback(cloneError(ERR_CACHECONTROL));
        return;
    }

    // serialize value (along with meta data)
    var now = nowInSec();
    var priority = (options && options.priority) || DEFAULT_PRIORITY;
    var meta = {
        expires: now + cacheControl[MAX_AGE],
        maxAge: cacheControl[MAX_AGE],
        stale: cacheControl[STALE_WHILE_REVALIDATE] || 0,
        priority: priority,
        access: now
    };
    var serializedValue;
    try {
        serializedValue = self._serialize(value, meta, options);
    } catch (serializeError) {
        callback && callback(cloneError(ERR_SERIALIZE));
        return;
    }

    // save into the underline storage and update meta record
    var prefixedKey = self._prefix(key);
    try {
        self._storage.setItem(prefixedKey, serializedValue);
        meta.size = serializedValue.length;
        self._meta.update(prefixedKey, meta);
        callback && callback();
    } catch (e) {
        if (self.numItems() === 0) {
            // if numItems is 0, private mode is on or storage is disabled
            self._markAsDisabled();
            callback && callback(cloneError(ERR_DISABLED));
        } else {
            // try purging
            var spaceNeeded = serializedValue.length;
            self.purge(spaceNeeded, function purgeCallback(err) {
                if (err) {
                    // not enough space purged
                    callback && callback(cloneError(ERR_NOTENOUGHSPACE));
                    return;
                }
                // purged enough space, now try to save again
                try {
                    self._storage.setItem(prefixedKey, serializedValue);
                    self._meta.update(prefixedKey, meta);
                    callback && callback();
                } catch(errAfterPurge) {
                    callback && callback(cloneError(ERR_NOTENOUGHSPACE));
                }
            });
        }
    }
};

/**
 * @method removeItem
 * @param {String} key  The key string
 * @param {Function} [callback] The callback function.
 * @param {Object} callback.error The error object (an object with code, message fields) if removeItem failed.
 */
StorageLRU.prototype.removeItem = function (key, callback) {
    if (!key) {
        callback && callback(cloneError(ERR_INVALIDKEY, key));
        return;
    }
    var self = this;
    key = self._prefix(key);
    self._storage.removeItem(key);
    self._meta.remove(key);
    callback && callback();
};

/**
 * @method numItems
 * @param {Number} Number of items in the underline storage.
 */
StorageLRU.prototype.numItems = function () {
    return this._storage.length;
};

/**
 * @method _parseCacheControl
 * @param {String} str  The cache control string, following HTTP Cache-Control header syntax.
 * @return {Object} 
 * @private
 */
StorageLRU.prototype._parseCacheControl = function (str) {
    var cacheControl = {};
    if (str) {
        var parts = str.toLowerCase().split(',');
        for (var i = 0, len = parts.length; i < len; i++) {
            var kv = parts[i].split('=');
            if (kv.length === 2) {
                cacheControl[kv[0]] = kv[1];
            } else if (kv.length === 1) {
                cacheControl[kv[0]] = true;
            }
        }
        if (cacheControl[MAX_AGE]) {
            cacheControl[MAX_AGE] = parseInt(cacheControl[MAX_AGE], 10) || 0;
        }
        if (cacheControl[STALE_WHILE_REVALIDATE]) {
            cacheControl[STALE_WHILE_REVALIDATE] = parseInt(cacheControl[STALE_WHILE_REVALIDATE], 10) || 0;
        }
    }
    return cacheControl;
};

/**
 * Prefix the item key with the keyPrefix defined in "options" when LRU instance was created.
 * @method _prefix
 * @param {String} key  The item key.
 * @return {String} The prefixed key.
 * @private
 */
StorageLRU.prototype._prefix = function (key) {
    return this.options.keyPrefix + key;
};

/**
 * Remove the prefix from the prefixed item key.
 * The keyPrefix is defined in "options" when LRU instance was created.
 * @method _deprefix
 * @param {String} prefixedKey  The prefixed item key.
 * @return {String} The item key.
 * @private
 */
StorageLRU.prototype._deprefix = function (prefixedKey) {
    var prefix = this.options.keyPrefix;
    return prefix ? prefixedKey.substring(prefix.length) : prefixedKey;
};

/**
 * Mark the storage as disabled.  For example, when in Safari private mode, localStorage
 * is disabled.  During setItem(), LRU will check whether the underline storage
 * is disabled.
 * If the LRU was created with a recheckDelay option, LRU will re-check whether the underline
 * storage is disabled. after the specified delay time.
 * @method _markAsDisabled
 * @private
 */
StorageLRU.prototype._markAsDisabled = function () {
    var self = this;
    self._enabled = false;
    // set a timeout to mark the cache back to enabled so that status can be checked again
    var recheckDelay = self.options.recheckDelay;
    if (recheckDelay > 0) {
        setTimeout(function reEnable() {
            self._enabled = true;
        }, recheckDelay);
    }
};

/**
 * Serializes the item value and meta info into a string.
 * @method _serialize
 * @param {String|Object} value
 * @param {Object} meta  Meta info for this item, such as access ts, expire ts, stale-while-revalidate window size
 * @param {Object} options
 * @param {Boolean} [options.json=false]
 * @return {String} the serialized string to store in underline storage
 * @private
 * @throw Error
 */
StorageLRU.prototype._serialize = function (value, meta, options) {
    var v = (options && options.json) ? JSON.stringify(value) : value;
    return this._parser.format(meta, v);
};

/**
 * De-serializes the stored string into item value and meta info.
 * @method _deserialize
 * @param {String} str The stored string
 * @param {Object} options
 * @param {Boolean} [options.json=false]
 * @return {Object} An object containing "value" (for item value) and "meta" (Meta data object for this item, such as access ts, expire ts, stale-while-revalidate window size).
 * @private
 * @throw Error
 */
StorageLRU.prototype._deserialize = function (str, options) {
    var parsed = this._parser.parse(str);
    return {
        meta: parsed.meta,
        value: options.json? JSON.parse(parsed.value) : parsed.value
    };
};

/**
 * Purge the underline storage to make room for new data.  If options.purgedFn is defined
 * when LRU instance was created, this function will invoke it with the array if purged keys asynchronously.
 * @method purge
 * @param {Number} spaceNeeded The char count of space needed for the new data.  Note that
 *                   if options.purgeFactor is defined when LRU instance was created, extra space
 *                   will be purged. E.g. if spaceNeeded is 1000 characters, LRU will actually
 *                   try to purge (1000 + 1000 * purgeFactor) characters.
 * @param {Function} callback  
 * @param {Error} callback.error  if the space that we were able to purge was less than spaceNeeded.
 */
StorageLRU.prototype.purge = function (spaceNeeded, callback) {
    var factor = Math.max(0, this.options.purgeFactor) || 1;
    var padding = Math.round(spaceNeeded * factor);
    var size = spaceNeeded + padding;

    this._meta.sort(this._purgeComparator);

    var records = this._meta.records;
    var purged = [];
    for (var i = records.length - 1; i >= 0; i--) {
        if (size <= 0) {
            break;
        }
        var item = records[i];
        this._storage.removeItem(item.key);
        records.splice(i, 1); // remove the meta record
        purged.push(this._deprefix(item.key)); // record purged key
        size = size - item.size;
    }

    // invoke purgedFn if it is defined
    var purgedCallback = this.options.purgedFn;
    if (purgedCallback && purged.length > 0) {
        // execute the purged callback asynchronously to prevent library users
        // from potentially slow down the purge process by executing long tasks
        // in this callback.
        setTimeout(function () {
            purgedCallback(purged);
        }, 100);
    }

    // if enough space was made for spaceNeeded, consider purge as success
    if (callback) {
        if (size <= padding) {
            callback();
        } else {
            callback(new Error('still need ' + (size - padding)));
        }
    }
};

if (module) {
    module.exports = StorageLRU;
}
