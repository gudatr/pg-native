let Libpq = require('libpq')
let EventEmitter = require('events').EventEmitter
let typeParsers = require('pg-types');
let util = require('util')

//Reduces the lookup timefor the parser
let typesFlat = [];

for (let type in typeParsers.builtins) {
    let parser = typeParsers.getTypeParser(type, 'text');
    let parserId = typeParsers.builtins[type];

    typesFlat[parserId] = parser;
}

const types = typesFlat;
const NOTIFICATION = 'notification'

let Client = module.exports = function (config) {
    if (!(this instanceof Client)) {
        return new Client(config)
    }

    config = config || {}

    EventEmitter.call(this)
    this.pq = new Libpq()
    this._reading = false
    this._read = this._read.bind(this)
    this._rows = []
    this._queryResolve = (_rows) => { }
    this._queryReject = (_err) => { }
    this._queryError = undefined
    this.nfields = 0
    this.fieldNames = []
    this.fieldTypes = []

    // lazy start the reader if notifications are listened for
    // this way if you only run sync queries you wont block
    // the event loop artificially
    this.pq.on('readable', this._read)
    this.on('newListener', (event) => {
        if (event !== NOTIFICATION) return
        this._startReading()
    })
}

util.inherits(Client, EventEmitter)

Client.prototype.readValue = function (rowIndex, fieldIndex) {
    let rawValue = this.pq.$getvalue(rowIndex, fieldIndex)
    if (rawValue === '' && this.pq.$getisnull(rowIndex, fieldIndex)) return null
    let parser = this.fieldTypes[fieldIndex]
    if (parser) return parser(rawValue)
    return rawValue
}

Client.prototype.consumeRowAsObject = function (rowIndex) {
    let row = {}
    for (let fieldIndex = 0; fieldIndex < this.nfields; fieldIndex++) {
        row[this.fieldNames[fieldIndex]] = this.readValue(rowIndex, fieldIndex)
    }
    return row
}

Client.prototype.consumeFields = function () {
    this.nfields = this.pq.$nfields()
    for (let x = 0; x < this.nfields; x++) {
        this.fieldNames[x] = this.pq.$fname(x)
        this.fieldTypes[x] = types[this.pq.$ftype(x)]
    }

    let tupleCount = this.pq.$ntuples()
    this._rows = new Array(tupleCount)
    for (let i = 0; i < tupleCount; i++) {
        this._rows[i] = this.consumeRowAsObject(i)
    }
}

Client.prototype.connect = function (params, cb) {
    this.fieldNames = []
    this.fieldTypes = []
    this.pq.connectSync(params)
    if (!this.pq.$setNonBlocking(1)) return cb(new Error('Unable to set non-blocking to true'))
}

Client.prototype.query = function (text, reject, resolve) {
    this._stopReading()
    if (!this.pq.$sendQuery(text)) return reject(new Error(this.pq.$getLastErrorMessage() || 'Something went wrong dispatching the query'))
    this._queryResolve = resolve
    this._queryReject = reject
    this._waitForDrain()
}

Client.prototype.prepare = function (statementName, text, nParams, reject, resolve) {
    this._stopReading()
    if (!this.pq.$sendPrepare(statementName, text, nParams)) return reject(new Error(this.pq.$getLastErrorMessage() || 'Something went wrong dispatching the query'))
    this._queryResolve = resolve
    this._queryReject = reject
    this._waitForDrain()
}

Client.prototype.execute = function (statementName, parameters, reject, resolve) {
    this._stopReading()
    if (!this.pq.$sendQueryPrepared(statementName, parameters)) return reject(new Error(this.pq.$getLastErrorMessage() || 'Something went wrong dispatching the query'))
    this._queryResolve = resolve
    this._queryReject = reject
    this._waitForDrain()
}

// wait for the writable socket to drain
Client.prototype._waitForDrain = function () {
    let res = this.pq.$flush()
    // res of 0 is success
    if (res === 0) return this._startReading()
    // res of -1 is failure
    if (res === -1) return this._queryReject(this.pq.$getLastErrorMessage())
    // otherwise outgoing message didn't flush to socket, wait again
    return this.pq.writable(this._waitForDrain)
}

Client.prototype.escapeLiteral = function (value) {
    return this.pq.$escapeLiteral(value)
}

Client.prototype.escapeIdentifier = function (value) {
    return this.pq.$escapeIdentifier(value)
}

Client.prototype._readError = function (message) {
    this.emit('error', new Error(message || this.pq.$getLastErrorMessage()))
}

Client.prototype._stopReading = function () {
    if (!this._reading) return
    this._reading = false
    this.pq.$stopRead()
}

Client.prototype._emitResult = function () {
    let status = this.pq.$resultStatus()
    switch (status) {
        case 'PGRES_TUPLES_OK':
        case 'PGRES_COMMAND_OK':
        case 'PGRES_EMPTY_QUERY':
            this.consumeFields()
            break
        case 'PGRES_FATAL_ERROR':
            this._queryError = new Error(this.pq.$resultErrorMessage())
            break
        case 'PGRES_COPY_OUT':
        case 'PGRES_COPY_BOTH': {
            break
        }
        default:
            this._readError('unrecognized command status: ' + status)
            break
    }
    return status
}

// called when libpq is readable
Client.prototype._read = function () {
    // read waiting data from the socket
    // e.g. clear the pending 'select'
    if (!this.pq.$consumeInput()) {
        // if consumeInput returns false a read error has been encountered
        return this._readError()
    }

    // check if there is still outstanding data and wait for it
    if (this.pq.$isBusy()) {
        return
    }

    // load result object
    while (this.pq.$getResult()) {
        let resultStatus = this._emitResult(this.pq)

        // if the command initiated copy mode we need to break out of the read loop
        // so a substream can begin to read copy data
        if (resultStatus === 'PGRES_COPY_BOTH' || resultStatus === 'PGRES_COPY_OUT') {
            break
        }

        // if reading multiple results, sometimes the following results might cause
        // a blocking read. in this scenario yield back off the reader until libpq is readable
        if (this.pq.$isBusy()) {
            return
        }
    }

    if (this._queryError) {
        let err = this._queryError
        this._queryError = undefined
        return this._queryReject(err)
    }

    let rows = this._rows
    this._queryError = undefined
    this._rows = undefined

    this._queryResolve(rows)
}

// ensures the client is reading and
// everything is set up for async io
Client.prototype._startReading = function () {
    if (this._reading) return
    this._reading = true
    this.pq.$startRead()
}
