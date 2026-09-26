import express from 'express'
import cors from 'cors'
import pinoHttp from 'pino-http'
import { config } from './config'
import { errorHandler } from './middleware/errorHandler'
import authRoutes from './routes/auth.routes'
import rideRoutes from './routes/ride.routes'

const app = express()

app.use(cors())
app.use(express.json())
app.use(pinoHttp())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/auth', authRoutes)
app.use('/', rideRoutes)

// error handler must be last
app.use(errorHandler)

app.listen(config.port, () => {
  console.log(`API listening on port ${config.port}`)
})

export default app
