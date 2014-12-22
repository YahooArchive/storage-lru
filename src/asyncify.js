/**
 * 
 * A simple mixin to go around syncronous storage interfaces (such as html5 local storage).
 * 
 * @param {Object} syncObject The syncronous storage object.
 */
function asyncify (syncObject) {
    var retval = {
        getItem: function (key, callback) {
            callback(null, syncObject.getItem(key));
        },
        setItem: function (key, value, callback) {
            try {
                syncObject.setItem(key, value);
            } catch (e) {
                callback(e);
                return;
            }
            callback(null, value);
        },
        removeItem: function (key, callback) {
            syncObject.removeItem(key);
            callback();
        }
    };
     // be smart about wrapping local storage
    if (!syncObject.keys && (typeof syncObject.length === 'number')) {
        retval.keys = function getKeylistFromIndices (num, callback) {
            var arr = [];
            var limit = (num > syncObject.length) ? syncObject.length : num;
            for (var i = 0, len = limit; i < len; i++) {
                arr.push(syncObject.key(i));
            }
            callback(null, arr);
        };
    }
    return retval;
}

module.exports = asyncify;