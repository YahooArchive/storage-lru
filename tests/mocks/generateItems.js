function nowInSec() {
    return Math.floor(new Date().getTime() / 1000);
}

module.exports = function (keyPrefix, records) {
    var items = {};
    var now = nowInSec();
    for (var i = 0, len = records.length; i < len; i++) {
        var record = records[i];
        var key = record.key || i;
        if (record.bad) {
            items[keyPrefix + key] = 'noMetaJunk' + record.value;
        } else {
            var metaFields = [
                '1',
                now + record.accessDelta,
                now + record.expiresDelta,
                record.maxAge || 600,
                record.stale,
                record.priority || 3
            ];
            items[keyPrefix + key] = '[' + metaFields.join(':') + ']' + record.value;
        }
    }
    return items;
};
