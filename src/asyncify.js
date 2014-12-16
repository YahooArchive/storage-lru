
function getItem (key, callback) {
    callback(null, this._getItem(key));
}

function setItem (key, value, callback) {
    try {
        this._setItem(key, value);
    } catch (e) {
        callback(e);
        return;
    }
    callback(null, value);
}

function removeItem (key, callback) {
    this._removeItem(key);
    callback();
}

function getKeylistFromIndices (num, callback) {
    var arr = [];
    var limit = (num > this.length) ? this.length : num;
    for (var i = 0, len = limit; i < len; i++) {
        arr.push(this.key(i));
    }
    callback(null, arr);
}

/**
 * 
 * A simple mixin to go around syncronous storage interfaces (such as html5 local storage).
 * 
 * @param {Object} syncObject The syncronous storage object.
 */
function asyncify (syncObject) {
    syncObject._getItem = syncObject.getItem;
    syncObject._setItem = syncObject.setItem;
    syncObject._removeItem = syncObject.removeItem;
    syncObject.getItem = getItem;
    syncObject.setItem = setItem;
    syncObject.removeItem = removeItem;

    //be smart about wrapping local storage
    if (!syncObject.keys && (typeof syncObject.length === 'number')) {
        syncObject.keys = getKeylistFromIndices;
    }
    return syncObject;
}

module.exports = asyncify;