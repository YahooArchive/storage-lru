function getItem (key, callback) {
    var item;
    try {
        item = this._getItem(key);
    } catch (e) {
        callback(e);
        return;
    }
    callback(null, item);
}

function setItem (key, value, callback) {
    try {
        this._setItem(key, value);
    } catch (e) {
        callback(e);
        return;
    }
    callback(null, value);
};

function removeItem (key, callback) {
    try {
        this._removeItem(key);
    } catch (e) {
        callback(e);
        return;
    }
    callback();
};

function lengthToSize (callback) {
    callback(null, this.length);
}

function getKeylistFromIndices (callback) {
    var arr = [];
    for (var i = 0, len = this.length; i < len; i++) {
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
function Asyncify (syncObject) {
    syncObject._getItem = syncObject.getItem;
    syncObject._setItem = syncObject.setItem;
    syncObject._removeItem = syncObject.removeItem;
    syncObject.getItem = getItem;
    syncObject.setItem = setItem;
    syncObject.removeItem = removeItem;

    //be smart about wrapping local storage
    if ((typeof syncObject.length === 'number') && (syncObject.length % 1 === 0)) {
        syncObject.getSize = lengthToSize;
        syncObject.getKeys = getKeylistFromIndices;
    }
    return syncObject;
}

module.exports = Asyncify;