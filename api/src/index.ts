import express from 'express'
import cors from 'cors'
import pinoHttp from 'pino-http'
import { config } from './config'

const app = express()

app.use(cors())
app.use(express.json())
app.use(pinoHttp())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.listen(config.port, () => {
  console.log(`API listening on port ${config.port}`)
})

export default app
