# StorageLRU [![Build Status](https://travis-ci.org/yahoo/storage-lru.svg?branch=master)](https://travis-ci.org/yahoo/storage-lru) [![Dependency Status](https://david-dm.org/yahoo/storage-lru.svg)](https://david-dm.org/yahoo/storage-lru) [![Coverage Status](https://coveralls.io/repos/yahoo/storage-lru/badge.png?branch=master)](https://coveralls.io/r/yahoo/storage-lru?branch=master)

StorageLRU is a LRU implementation that can be used with local storage, or other storage mechanisms that support a similar interface.

**Note:** This library is written in CommonJS style.  To use it in browser, please use tools like [Browserify](http://browserify.org/) and [Webpack](http://webpack.github.io/).

## Features

### Pluggable Underline Storage
You can use your own storage of choice with StorageLRU, as long as it conforms to localStorage API.
```js
var lru = new StorageLRU(localStorage);
```

### Max-Age and Stale-While-Revalidate
When you save an item to the StorageLRU, you are required to specify a cache control string with HTTP Cache-Control header syntax, in which `max-age` is required and `stale-while-revalidate` is optional.

The `max-age` defines when the item will expire.  The `stale-while-revalidate` defines a time window after expiration, in which the item is marked as stale but still usable. If the time has passed this time window as well, this item will not be fetchable, and be purged.

If `getItem()` is called on an item when it is in the `stale-while-revalidate` time window, StorageLRU will try to refresh the data during this time window, assuming a `revalidateFn` was passed when the StorageLRU instance was created.  The `revalidateFn` function will be used to fetch the stale item.  If a fresh value is fetched successfully, StorageLRU will save the new value to the underline storage.

The revalidate success/failure count will be recorded in [the Stats](#stats).

Example:
```js
var lru = new StorageLRU(localStorage);
// Saving item 'fooJSON', which expires in 5 minutes and has a stale-while-revalidate time window of 1 day after expiration.
lru.setItem(
    'fooJSON',    // key
    {             // value
        foo: 'bar'
    },
    {             // options
        json: true,
        cacheControl:'max-age=300,stale-while-revalidate=86400',
        revalidateFn: function(key, callback) {
            var newValue = someFunctionToRefetchFromSomewhere(key); // most likely be async
            callback(null, newValue); // make sure callback is invoked
        }
    }, function (err) {
        if (err) {
            // something went wrong. Item not saved.
            console.log('Failed to save item: err=', err);
            return;
        }
    }
);
```

### Priority
When you save an item to StorageLRU, you can assign a priority.  Lower priority items get purged first, if all other conditions are the same.

| Priority | Description              |
|----------|--------------------------|
| 1        | Critical - Last to purge |
| 2        | Important                |
| 3        | Normal                   |
| 4        | Low - First to purge     |

Example:
```js
var lru = new StorageLRU(localStorage);
lru.setItem('fooJSON', {foo: 'bar'}, {json: true, priority: 1}, function (err) {
    if (err) {
        // something went wrong. Item not saved.
        console.log('Failed to save item: err=', err);
    }
});
```


### Automatic Purging
When the storage becomes full, StorageLRU will purge the existing items to make enough space.  The default purging precendence order is as following:

 * bad entry (invalid meta info),
 * truly stale (passed stale-while-revaliate window),
 * lowest priority,
 * least recently accessed,
 * bigger byte size

Basically, the bad items will be purged first; next will be the items that have expired and passed stale-while-revaliate window; then the lowest priority items; then the least recently accessed items; if there happen to the two items with the same access time, the one takes more space will be purged first.

### Customizable PurgeComparator
You can replace the default purging algorithm with your own, by specifying a purgeComparator function when creating the StorageLRU instance.

```js
var lru = new StorageLRU(localStorage, {
    // always purge the largest item first
    purgeComparator: function (meta1, meta2) {
        if (meta1.size > meta2.size) {
            return 1;
        } else if (meta1.size === meta2.size){
            return 0;
        } else {
            return -1;
        }
    }
});
```

### Configurable Purge Factor
You can configure how much extra space to purge, by providing a `purgeFactor` param when instantiating the StorageLRU instance.  It should be a positive float number.

```js
var lru = new StorageLRU(localStorage, {
    // purgeFactor controls amount of extra space to purge.
    // E.g. if space needed for a new item is 1000 characters, StorageLRU will actually
    //      try to purge (1000 + 1000 * purgeFactor) characters.
    purgeFactor: 0.5
});
```

### Purge Notification
If you want to be notified when items get purged from the storage, you can register a callback function when creating the StorageLRU instance.

```js
var lru = new StorageLRU(localStorage, {
    // purgeFactor controls amount of extra space to purge.
    // E.g. if space needed for a new item is 1000 characters, StorageLRU will actually
    //      try to purge (1000 + 1000 * purgeFactor) characters.
    purgeFactor: 0.5,
    purgedFn: function (purgedKeys) {
        console.log('These keys were purged:', purgedKeys);
    }
});
```



### Stats

StorageLRU collects statistics data for you to tune the LRU to work efficiently with the specific characteristics of your app data.  For example, you can customize `purgeFactor` to be a bigger number if your app saves several items in a short time interval.

Currently stats data collected include the following:

| Name | Description |
|-------|-------------------------------------------------------------------------------------------------------------------------------------|
| hit | Number of cache hits |
| miss | Number of cache misses |
| stale | Number of times where stale items were returned (cache hit with data that expired but still within stale-while-revalidate window) |
| error | Number of errors occurred during getItem |
| revalidateSuccess | Success count for revalidating a stale item, if `revalidateFn` is provided when the StorageLRU instance is instantiated. |
| revalidateFailure | Failure count for revalidating a stale item, if `revalidateFn` is provided when the StorageLRU instance is instantiated. |
| du | Disk usage: item count and total character size used. This will only be included if `options.du` is true. |

Example:
```js
var stats;

// does not include du info
stats = lru.stats();

// output du info
stats = lru.stats({du: true});
```


## Usage
```
var lru = new StorageLRU(localStorage, {
    purgeFactor: 0.5,  // this controls amount of extra space to purge.
    purgedFn: function (purgedKeys) {
        console.log('These keys were purged:', purgedKeys);
    }
});
console.log(lru.numItems()); // output 0, assuming the storage is clear

lru.setItem('foo', 'bar', {}, function (err) {
    if (err) {
        // something went wrong. Item not saved.
        console.log('Failed to save item: err=', err);
    }
});

lru.setItem('fooJSON', {foo: 'bar'}, {json: true}, function (err) {
    if (err) {
        // something went wrong. Item not saved.
        console.log('Failed to save item: err=', err);
    }
});

lru.getItem('foo', function (err, value) {
    if (err) {
        // something went wrong, for example, can't deserialize
        console.log('Failed to fetch item: err=', err);
        return;
    }
    console.log('The value of "foo" is: ', value);
});

lru.removeItem('foo', function (err) {
    if (err) {
        // something went wrong. Item not removed.
    }
});

var stats = lru.stats({du: true});
```

## Error Codes

| Code | Message | Description | Sources |
|------|--------------------|---------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------|
| 1 | disabled | The underline storage (storage instance passed to StorageLRU) is disabled. | StorageLRU.setItem() |
| 2 | cannot deserialize | Not able to deserialize the stored value. |  |
| 3 | cannot serialize | Not able to serialize the value for storage. | StorageLRU.setItem() |
| 4 | bad cacheControl | Invalid cache control string was passed to StorageLRU.setItem().  For example, containing no-store, no-cache, negative max-age. | StorageLRU.setItem() |
| 5 | invalid key | Invalid key was provided, e.g. empty string | StorageLRU.setItem(), StorageLRU.getItem(), StorageLRU.removeItem() |
| 6 | not enough space | The underline storage does not have enough space for the item being saved, even after purging old items. | StorageLRU.setItem() |
| 7 | revalidate failed | Revalidating a stale item failed. (Internal error, not exposed via public API.) | StorageLRU._revalidate() |


## Polyfills

This library requires the following Polyfill:

* JSON - See [Modernizr Polyfill Doc](https://github.com/Modernizr/Modernizr/wiki/HTML5-Cross-browser-Polyfills#ecmascript-5) for available JSON polyfills.


## License
This software is free to use under the Yahoo! Inc. BSD license.
See the [LICENSE file][] for license text and copyright information.

[LICENSE file]: https://github.com/yahoo/storage-lru/blob/master/LICENSE.md

Third-pary open source code used are listed in our [package.json file]( https://github.com/yahoo/storage-lru/blob/master/package.json).
