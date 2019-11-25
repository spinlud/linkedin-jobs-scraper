const wait = ms => new Promise(resolve => setTimeout(resolve.bind(null, ms), ms));

module.exports = {
    wait,
}
