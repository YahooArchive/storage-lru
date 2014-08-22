function StorageMock(mockData) {
    if (mockData) {
        this.data = JSON.parse(JSON.stringify(mockData));
    } else {
        this.data = {};
    }
    // this.data = mockData || {};
    this.length = Object.keys(this.data).length;
}

StorageMock.prototype.getItem = function (key) {
    return this.data[key] || null;
};

StorageMock.prototype.setItem = function (key, value) {
    if (key.indexOf('throw_max_quota_error') >= 0) {
        throw 'max quota error';
    }
    this.data[key] = value;
    this.length = Object.keys(this.data).length;
};

StorageMock.prototype.removeItem = function (key, value) {
    delete this.data[key];
    this.length = Object.keys(this.data).length;
};

StorageMock.prototype.key = function (index) {
    var keys = Object.keys(this.data);
    return (keys && keys[index]) || null;
};

module.exports = StorageMock;