/**
 * @class  SyncWrapper
 * @constructor
 * A simple wrapper class to go around syncronous storage interfaces (such as html5 local storage).
 * 
 * @param {Object} storage The syncronous storage object.  It should implement the localStorage API.
 */
function SyncWrapper (storage) {
    this.storage = storage;
    Object.defineProperties(this, {
        length: {
             get: function() {return this.storage.length}
        }
    });
}

SyncWrapper.prototype.getItem = function (key, callback) {
    var item;
    try {
        item = this.storage.getItem(key);
    } catch (e) {
        callback(e);
        return;
    }
    callback(null, item);
};
SyncWrapper.prototype.setItem = function (key, value, callback) {
    try {
        this.storage.setItem(key, value);
    } catch (e) {
        callback(e);
        return;
    }
    callback(null, value);
};
SyncWrapper.prototype.removeItem =function (key, callback) {
    try {
        this.storage.removeItem(key);
    } catch (e) {
        callback(e);
        return;
    }
    callback();
};

SyncWrapper.prototype.key = function (index) {
    return this.storage.key(index);
};

module.exports = SyncWrapper;