import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import { config } from './config/env';
import { swaggerSpec } from './config/swagger';
import verificationRoutes from './routes/verificationRoutes';
import kycRoutes from './routes/kycRoutes';

// Load environment variables
dotenv.config();

const app = express();
const PORT = config.port;

// Security middleware
app.use(helmet());

// Rate limiting (more permissive for testing)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Increased limit for testing
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
  },
});
app.use(limiter);

// CORS configuration (more permissive for testing)
app.use(
  cors({
    origin:
      process.env.NODE_ENV === 'production'
        ? process.env.FRONTEND_URL?.split(',')
        : true, // Allow all origins in development
    credentials: true,
  })
);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Swagger UI documentation - serve OpenAPI spec as JSON for external tools
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Swagger UI documentation - serve static files
app.use('/api-docs', swaggerUi.serve as any);

// Swagger UI documentation - setup and serve
app.get(
  '/api-docs',
  swaggerUi.setup(swaggerSpec, {
    explorer: true,
    swaggerOptions: {
      persistAuthorization: true,
    },
  }) as any
);

// Health check endpoint
/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Check if the API server is running and responsive
 *     tags: [System]
 *     responses:
 *       200:
 *         description: API is healthy and running
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "ID Verification System is running"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2023-01-01T12:00:00.000Z"
 *                 version:
 *                   type: string
 *                   example: "1.0.0"
 *                 docs:
 *                   type: object
 *                   properties:
 *                     json:
 *                       type: string
 *                       example: "/api-docs.json"
 *                     ui:
 *                       type: string
 *                       example: "/api-docs"
 */
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'ID Verification System is running',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    docs: {
      json: '/api-docs.json',
      ui: '/api-docs',
    },
  });
});

// API routes (no authentication required)
app.use('/api/verification', verificationRoutes);
app.use('/api/kyc', kycRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// Global error handler
app.use(
  (
    error: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error('Unhandled error:', error);

    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
    });
  }
);

// Start server
app.listen(PORT, () => {
  console.log(` ID Verification System running on port ${PORT}`);
  console.log(` Health check available at: http://localhost:${PORT}/health`);
  console.log(
    ` API Documentation available at: http://localhost:${PORT}/api-docs`
  );
  console.log(` API base URL: http://localhost:${PORT}/api`);
  console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(` Authentication: None required (for testing)`);
});

export default app;
