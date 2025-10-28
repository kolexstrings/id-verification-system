import swaggerJSDoc from 'swagger-jsdoc';
import path from 'path';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ID Verification System',
      version: '1.0.0',
      description:
        'ID Verification System with Innovatrics DIS session-based verification',
      contact: {
        name: 'API Support',
        email: 'support@id-verification.com',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
    ],
    components: {
      schemas: {
        ApiResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              description: 'Indicates if the request was successful',
            },
            data: {
              type: 'object',
              description: 'Response data (varies by endpoint)',
            },
            message: {
              type: 'string',
              description: 'Success or error message',
            },
            error: {
              type: 'string',
              description: 'Detailed error information',
            },
          },
        },
        SessionResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                sessionId: { type: 'string' },
                status: { type: 'string' },
                createdAt: { type: 'string', format: 'date-time' },
                userId: { type: 'string' },
              },
            },
            message: { type: 'string' },
          },
        },
        DocumentUploadRequest: {
          type: 'object',
          required: ['frontImage'],
          properties: {
            frontImage: {
              type: 'string',
              description: 'Base64 encoded front side of document',
            },
            backImage: {
              type: 'string',
              description: 'Base64 encoded back side of document (optional)',
            },
            documentType: {
              type: 'string',
              enum: ['passport', 'id_card', 'driver_license'],
              description: 'Type of document being uploaded',
            },
          },
        },
        LivenessRequest: {
          type: 'object',
          required: ['image'],
          properties: {
            image: {
              type: 'string',
              description: 'Base64 encoded selfie/liveness image',
            },
          },
        },
        SessionStatusResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                sessionId: { type: 'string' },
                status: { type: 'string' },
                documentResult: {
                  type: 'object',
                  properties: {
                    documentType: { type: 'string' },
                    issuingCountry: { type: 'string' },
                    documentNumber: { type: 'string' },
                    expirationDate: { type: 'string' },
                    verificationStatus: { type: 'string' },
                  },
                },
                livenessResult: {
                  type: 'object',
                  properties: {
                    confidence: { type: 'number' },
                    verificationStatus: { type: 'string' },
                  },
                },
                faceMatchResult: {
                  type: 'object',
                  properties: {
                    confidence: { type: 'number' },
                    verificationStatus: { type: 'string' },
                  },
                },
                overallStatus: { type: 'string' },
              },
            },
            message: { type: 'string' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
            error: { type: 'string' },
          },
        },
        ValidationErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Validation failed' },
            errors: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [],
  },
  apis: [
    path.join(__dirname, '../routes/*.ts'),
    path.join(__dirname, '../app.ts'),
  ],
};

export const swaggerSpec = swaggerJSDoc(options);
