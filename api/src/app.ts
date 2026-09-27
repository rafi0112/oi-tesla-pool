import express from 'express'
import cors from 'cors'
import pinoHttp from 'pino-http'
import { config } from './config'
import { errorHandler } from './middleware/errorHandler'
import authRoutes from './routes/auth.routes'
import rideRoutes from './routes/ride.routes'
import poolRoutes from './routes/pool.routes'
import driverRoutes from './routes/driver.routes'
import passengerRoutes from './routes/passenger.routes'

export function createApp() {
  const app = express()

  app.use(cors())
  app.use(express.json())
  // Request logging is noise in the test output.
  if (config.nodeEnv !== 'test') app.use(pinoHttp())

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.use('/auth', authRoutes)
  app.use('/pools', poolRoutes)
  app.use('/drivers', driverRoutes)
  app.use('/passengers', passengerRoutes)
  app.use('/', rideRoutes)

  // error handler must be last
  app.use(errorHandler)

  return app
}

export const app = createApp()
