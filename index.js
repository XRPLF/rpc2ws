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
app.use(bodyParser.json())

const callTimeout = Number(process.env?.TIMEOUT || 60) || 60

app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*')
  const realip = req.headers['x-forwarded-for'] || req.socket.remoteAddress
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

      const connection = new XrplClient(null, {
        assumeOfflineAfterSeconds: callTimeout,
        maxConnectionAttempts: 2,
        connectAttemptTimeoutSeconds: 4
      })

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
    
      const command = {
        command: req.body.method,
        ...req.body.params[0]
      }
      
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
    
      const state = connection.getState()
      res.set('X-Cluster-Node', state.server.publicKey)
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
