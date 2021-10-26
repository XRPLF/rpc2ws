const {XrplClient} = require('xrpl-client')
const {v4} = require('uuid')

const log = require('debug')('post2ws')
const logRequest = log.extend('request')
const logResponse = log.extend('response')
const logError = log.extend('error')
const logTimeout = log.extend('timeout')

const express = require('express')
const bodyParser = require('body-parser')

const app = express()
app.use(bodyParser.json({type: '*/*'}))

const nonFhNodes = typeof process.env?.NONFHNODES === 'string' && process.env.NONFHNODES.trim() !== ''
  ? (process.env?.NONFHNODES).replace(/[ \t]+/, ' ').trim().split(' ')
  : []

const nonFhCommand = data => {
  // Mock to keep code below (edge) drop in compatible
  const clientState = { uplinkType: 'mock' }

  // For RPC, accept server_info to non-fh as well
  if ((data.messageObject?.command || '').toLowerCase() === 'server_info') {
    return true
  }

  // https://github.com/XRPLF/xrpl.ws-Edge-Proxy/blob/master/src/filtering/SubmitFilter.ts#L409
  if (
    (data.messageObject?.command || '').toLowerCase()
      .match(/^(.*subscr.+|account_.+|ledger|ledger_cl.+|ledger_cu.+|book_of.+|deposit_auth.+|.*path_.+)$/)
    && ([undefined, 'current', 'validated'].indexOf(data.messageObject?.ledger_index) > -1)
    && (data.messageObject?.command.toLowerCase() !== 'account_tx')
    && (typeof data.messageObject?.ledger_hash === 'undefined')
    && (typeof data.messageObject?.ledger_index_min === 'undefined')
    && (typeof data.messageObject?.ledger_index_max === 'undefined')
    && (typeof data.messageObject?.forward === 'undefined')
    && (typeof data.messageObject?.marker === 'undefined')
    // Don't apply logic if connection is already of submit type (prevent endless recursion)
    && clientState?.uplinkType !== 'submit' && clientState?.uplinkType !== 'nonfh'
  ) {
    return true
  }

  return false
}

const callTimeout = Number(process.env?.TIMEOUT || 60) || 60

app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*')
  const realip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress)
    .replace(/[, ]+/g, ',')
    .replace(',127.0.0.1', '')
  const callid = v4()
  Object.assign(req, {realip, callid})
  next()
})

app.post('/', async (req, res) => {
  if (typeof req.body === 'object' && req.body !== null && Object.keys(req.body).length > 0) {
    if (Object.keys(req.body).indexOf('method') > -1) {
      const startTime = new Date()
      let replied = false

      logRequest(req.realip, req.callid, req.body.method.trim())

      const command = {
        command: req.body.method,
        ...req.body.params[0]
      }

      const nodes = nonFhCommand({messageObject: command})
        ? nonFhNodes
        : []

      const connection = new XrplClient(
        nodes.map(value => ({ value, sort: Math.random() })).sort((a, b) => a.sort - b.sort).map(({ value }) => value),
        {
          assumeOfflineAfterSeconds: callTimeout,
          maxConnectionAttempts: 2,
          connectAttemptTimeoutSeconds: 4
        }
      )

      connection.on('error', e => {
        if (!replied) {
          replied = true
          logError(req.realip, req.callid, connection.getState()?.server?.publicKey, e.message)
          return res.json({
            error: 'ConnectionError',
            message: e.message
          })
        }
      })
      
      const timeout = setTimeout(() => {
        logTimeout(req.realip, req.callid, 'Timeout', JSON.stringify(command))
        connection.close()
        if (!replied) {
          replied = true
          return res.json({
            error: 'UpstreamTimeout',
            message: 'The command timed out (no response from upstream in ' + callTimeout + ' seconds)'
          })
        }
      }, callTimeout * 1000)

      const result = await connection.send(command)
      clearTimeout(timeout)

      if (command.command === 'server_info') {
        if (result?.info?.complete_ledgers) {
          Object.assign(result.info, {
            complete_ledgers: '32570-' + result.info.complete_ledgers.split(',').reverse()[0].split('-').reverse()[0]
          })
        }
      }
    
      const state = connection.getState()
      res.set('X-Cluster-Node', state.server.publicKey)
      res.set('X-FH', nodes.length === 0 ? 1 : 0)

      logResponse(
        req.realip,
        req.callid,
        req.body.method.trim(),
        connection.getState()?.server?.publicKey,
        (new Date() - startTime) / 1000,
        JSON.stringify(result).length
      )
    
      connection.close()

      if (!replied) {
        return res.json({result})
      }
    } else {
      return res.json({
        error: 'InvalidCommand',
        message: 'JSON body: expecting `method` and `params` keys'
      })
    }
  }

  res.json({
    error: 'InvalidBody',
    message: 'JSON body expected'
  })
})

app.all('*', (req, res) => {
  res.status(501).json({
    error: 'NotImplemented',
    message: 'HTTP POST with JSON body expected'
  })
})

app.use(function (err, req, res, next) {
  if (err.type === 'entity.parse.failed' && err.constructor.name === 'SyntaxError') {
    return res.status(400).json({
      error: err.constructor.name,
      message: err.message
    })
  }

  logError(req.realip, req.callid, err.constructor.name, '»', err.message, err.stack.split("\n")[1])

  res.status(500).json({
    error: 'FatalError',
    message: 'Unknown / Unspecified'
  })
})

app.listen(Number(process.env?.PORT || 3000) || 3000)
