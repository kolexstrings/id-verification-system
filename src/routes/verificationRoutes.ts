import { Router } from 'express';
import { body, param } from 'express-validator';
import { VerificationController } from '../controllers/verificationController';

// Validation middleware
const validateCreateCustomer = [
  body('userId')
    .isString()
    .isLength({ min: 1, max: 100 })
    .withMessage('userId must be a non-empty string with max 100 characters'),
];

const validateDocumentVerification = [
  param('customerId')
    .isString()
    .isLength({ min: 1, max: 100 })
    .withMessage('customerId must be a valid string'),
  body('frontImage')
    .isString()
    .isLength({ min: 1 })
    .withMessage('frontImage is required and must be a non-empty string'),
  body('backImage')
    .optional()
    .isString()
    .isLength({ min: 1 })
    .withMessage('backImage must be a non-empty string if provided'),
  body('documentType')
    .optional()
    .isIn(['passport', 'id_card', 'driver_license', 'residence_permit', 'visa', 'other'])
    .withMessage('documentType must be one of: passport, id_card, driver_license, residence_permit, visa, other'),
];

const validateLivenessCheck = [
  param('customerId')
    .isString()
    .isLength({ min: 1, max: 100 })
    .withMessage('customerId must be a valid string'),
  body('image')
    .isString()
    .isLength({ min: 1 })
    .withMessage('image is required'),
  body('challengeId')
    .optional()
    .isString()
    .withMessage('challengeId must be a valid string if provided'),
  body('challengeType')
    .optional()
    .isIn(['passive', 'motion', 'expression'])
    .withMessage('challengeType must be one of: passive, motion, expression if provided'),
];

const validateFaceDetection = [
  param('customerId')
    .isString()
    .isLength({ min: 1, max: 100 })
    .withMessage('customerId must be a valid string'),
  body('image')
    .isString()
    .isLength({ min: 1 })
    .withMessage('image is required and must be a non-empty string'),
];

const validateFaceComparison = [
  param('customerId')
    .isString()
    .isLength({ min: 1, max: 100 })
    .withMessage('customerId must be a valid string'),
  body('probeFaceId')
    .isString()
    .isLength({ min: 1 })
    .withMessage('probeFaceId is required'),
  body().custom((value, { req }) => {
    const { referenceFace, referenceFaceTemplate } = req.body;
    if (!referenceFace && !referenceFaceTemplate) {
      throw new Error(
        'Either referenceFace or referenceFaceTemplate is required'
      );
    }
    return true;
  }),
];

const validateLivenessChallenge = [
  param('customerId')
    .isString()
    .isLength({ min: 1, max: 100 })
    .withMessage('customerId must be a valid string'),
  body('challengeType')
    .optional()
    .isIn(['passive', 'motion', 'expression'])
    .withMessage('challengeType must be one of: passive, motion, expression'),
];

const validateSelfieUpload = [
  param('customerId')
    .isString()
    .isLength({ min: 1, max: 100 })
    .withMessage('customerId must be a valid string'),
  body('image')
    .isString()
    .isLength({ min: 1 })
    .withMessage('image is required and must be a non-empty string'),
];

const validateGetCustomerStatus = [
  param('customerId')
    .isString()
    .isLength({ min: 1, max: 100 })
    .withMessage('customerId must be a valid string'),
];

const validateDeleteCustomer = [
  param('customerId')
    .isString()
    .isLength({ min: 1, max: 100 })
    .withMessage('customerId must be a valid string'),
];

// Helper function to handle validation errors
const handleValidationErrors = (req: any, res: any, next: any) => {
  const errors = req.validationErrors || [];
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.map((error: any) => error.msg),
    });
  }
  next();
};

const router = Router();

/**
 * @swagger
 * /api/verification/customer:
 *   post:
 *     summary: Create a new customer
 *     description: Initialize a new customer for identity verification with Innovatrics DIS
 *     tags: [Verification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *                 description: Unique identifier for the user
 *                 example: "user123"
 *     responses:
 *       200:
 *         description: Customer created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     customerId:
 *                       type: string
 *                       example: "cust_abc123"
 *                     status:
 *                       type: string
 *                       example: "created"
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                       example: "2023-01-01T12:00:00.000Z"
 *                     userId:
 *                       type: string
 *                       example: "user123"
 *                 message:
 *                   type: string
 *                   example: "Customer created successfully"
 */
router.post(
  '/customer',
  validateCreateCustomer,
  handleValidationErrors,
  VerificationController.createCustomer
);

/**
 * @swagger
 * /api/verification/{customerId}/document:
 *   post:
 *     summary: Verify document images
 *     description: Upload and verify document images for identity verification
 *     tags: [Verification]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *         description: The customer ID
 *         example: "cust_abc123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - frontImage
 *             properties:
 *               frontImage:
 *                 type: string
 *                 description: Base64 encoded front side of document
 *                 example: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
 *               backImage:
 *                 type: string
 *                 description: Base64 encoded back side of document (optional)
 *                 example: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
 *               documentType:
 *                 type: string
 *                 enum: [passport, id_card, driver_license, residence_permit, visa, other]
 *                 description: Type of document being uploaded
 *                 example: "passport"
 *     responses:
 *       200:
 *         description: Document verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     customerId:
 *                       type: string
 *                       example: "cust_abc123"
 *                     documentResult:
 *                       type: object
 *                       properties:
 *                         documentType:
 *                           type: string
 *                           example: "passport"
 *                         issuingCountry:
 *                           type: string
 *                           example: "USA"
 *                         verificationStatus:
 *                           type: string
 *                           example: "verified"
 *                 message:
 *                   type: string
 *                   example: "Document verified successfully"
 */
router.post(
  '/:customerId/document',
  validateDocumentVerification,
  handleValidationErrors,
  VerificationController.uploadDocument
);

/**
 * @swagger
 * /api/verification/{customerId}/liveness:
 *   post:
 *     summary: Perform passive liveness analysis
 *     description: Submit selfie image for AI-based liveness detection (analyzes for natural human characteristics)
 *     tags: [Verification]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *         description: The customer ID
 *         example: "cust_abc123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - image
 *             properties:
 *               image:
 *                 type: string
 *                 description: Base64 encoded liveness image
 *                 example: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
 *               challengeId:
 *                 type: string
 *                 description: Existing challenge ID (optional, will create new challenge if not provided)
 *                 example: "challenge_abc123"
 *               challengeType:
 *                 type: string
 *                 enum: [passive, motion, expression]
 *                 description: Type of liveness analysis (optional, defaults to passive if creating new challenge)
 *                 example: "passive"
 *     responses:
 *       200:
 *         description: Liveness check completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     customerId:
 *                       type: string
 *                       example: "cust_abc123"
 *                     livenessResult:
 *                       type: object
 *                       properties:
 *                         confidence:
 *                           type: number
 *                           example: 0.95
 *                         status:
 *                           type: string
 *                           example: "live"
 *                       description: AI analysis result (live person vs photo/spoof)
 *                 message:
 *                   type: string
 *                   example: "Liveness check performed successfully"
 */
router.post(
  '/:customerId/liveness',
  validateLivenessCheck,
  handleValidationErrors,
  VerificationController.performLivenessCheck
);

/**
 * @swagger
 * /api/verification/{customerId}/face-detect:
 *   post:
 *     summary: Detect face in image and check for masks
 *     description: Detect and analyze a face in the provided image, including mask detection
 *     tags: [Verification]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *         description: The customer ID
 *         example: "cust_abc123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - image
 *             properties:
 *               image:
 *                 type: string
 *                 description: Base64 encoded image for face detection
 *                 example: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
 *     responses:
 *       200:
 *         description: Face detection completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     customerId:
 *                       type: string
 *                       example: "cust_abc123"
 *                     faceResult:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                           example: "face_123"
 *                         detection:
 *                           type: object
 *                           properties:
 *                             score:
 *                               type: number
 *                               example: 0.98
 *                     maskResult:
 *                       type: object
 *                       properties:
 *                         score:
 *                           type: number
 *                           example: 0.95
 *                 message:
 *                   type: string
 *                   example: "Face detection and mask check performed successfully"
 */
router.post(
  '/:customerId/face-detect',
  validateFaceDetection,
  handleValidationErrors,
  VerificationController.performFaceDetection
);

/**
 * @swagger
 * /api/verification/{customerId}/face-compare:
 *   post:
 *     summary: Compare faces for similarity
 *     description: Compare a probe face with a reference face or template
 *     tags: [Verification]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *         description: The customer ID
 *         example: "cust_abc123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - probeFaceId
 *             properties:
 *               probeFaceId:
 *                 type: string
 *                 description: ID of the face to compare (probe)
 *                 example: "face_123"
 *               referenceFace:
 *                 type: string
 *                 description: URL or path to reference face image
 *                 example: "/api/v1/faces/ref_456"
 *               referenceFaceTemplate:
 *                 type: string
 *                 description: Base64 encoded reference face template
 *                 example: "dGVtcGxhdGU="
 *     responses:
 *       200:
 *         description: Face comparison completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     customerId:
 *                       type: string
 *                       example: "cust_abc123"
 *                     similarityResult:
 *                       type: object
 *                       properties:
 *                         score:
 *                           type: number
 *                           example: 0.85
 *                 message:
 *                   type: string
 *                   example: "Face comparison performed successfully"
 */
router.post(
  '/:customerId/face-compare',
  validateFaceComparison,
  handleValidationErrors,
  VerificationController.compareFaces
);

/**
 * @swagger
 * /api/verification/{customerId}/liveness-challenge:
 *   post:
 *     summary: Configure liveness analysis type
 *     description: Create a challenge record to define the type of liveness analysis to perform (passive, motion-based, or expression-based)
 *     tags: [Verification]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *         description: The customer ID
 *         example: "cust_abc123"
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               challengeType:
 *                 type: string
 *                 enum: [passive, motion, expression]
 *                 description: Type of liveness analysis approach (passive = basic detection, motion = movement analysis, expression = facial expression analysis)
 *                 example: "passive"
 *     responses:
 *       200:
 *         description: Liveness challenge created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     customerId:
 *                       type: string
 *                       example: "cust_abc123"
 *                     challenge:
 *                       type: object
 *                       properties:
 *                         challengeId:
 *                           type: string
 *                           example: "challenge_123"
 *                         challengeType:
 *                           type: string
 *                           example: "blink"
 *                         instructions:
 *                           type: string
 *                           example: "Please blink your eyes"
 *                 message:
 *                   type: string
 *                   example: "Liveness challenge created successfully"
 */
router.post(
  '/:customerId/liveness-challenge',
  validateLivenessChallenge,
  handleValidationErrors,
  VerificationController.createLivenessChallenge
);

/**
 * @swagger
 * /api/verification/{customerId}/selfie:
 *   post:
 *     summary: Upload selfie image
 *     description: Upload a selfie image associated with the customer
 *     tags: [Verification]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *         description: The customer ID
 *         example: "cust_abc123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - image
 *             properties:
 *               image:
 *                 type: string
 *                 description: Base64 encoded selfie image
 *                 example: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
 *     responses:
 *       200:
 *         description: Selfie uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     customerId:
 *                       type: string
 *                       example: "cust_abc123"
 *                     selfieResult:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                           example: "selfie_123"
 *                 message:
 *                   type: string
 *                   example: "Selfie uploaded successfully"
 */
router.post(
  '/:customerId/selfie',
  validateSelfieUpload,
  handleValidationErrors,
  VerificationController.uploadSelfie
);

/**
 * @swagger
 * /api/verification/{customerId}/selfie:
 *   get:
 *     summary: Get customer selfie
 *     description: Retrieve the selfie image associated with the customer
 *     tags: [Verification]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *         description: The customer ID
 *         example: "cust_abc123"
 *     responses:
 *       200:
 *         description: Selfie retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     customerId:
 *                       type: string
 *                       example: "cust_abc123"
 *                     selfie:
 *                       type: object
 *                       properties:
 *                         image:
 *                           type: string
 *                           description: Base64 encoded selfie image
 *                 message:
 *                   type: string
 *                   example: "Selfie retrieved successfully"
 */
router.get(
  '/:customerId/selfie',
  validateGetCustomerStatus,
  handleValidationErrors,
  VerificationController.getSelfie
);

/**
 * @swagger
 * /api/verification/{customerId}/status:
 *   get:
 *     summary: Get customer verification status
 *     description: Retrieve the current verification status of a customer
 *     tags: [Verification]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *         description: The customer ID
 *         example: "cust_abc123"
 *     responses:
 *       200:
 *         description: Customer status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     customerId:
 *                       type: string
 *                       example: "cust_abc123"
 *                     status:
 *                       type: string
 *                       example: "active"
 *                     onboardingStatus:
 *                       type: string
 *                       example: "IN_PROGRESS"
 *                 message:
 *                   type: string
 *                   example: "Customer status retrieved successfully"
 */
router.get(
  '/:customerId/status',
  validateGetCustomerStatus,
  handleValidationErrors,
  VerificationController.getCustomerStatus
);

/**
 * @swagger
 * /api/verification/{customerId}:
 *   delete:
 *     summary: Delete customer and associated data
 *     description: Permanently delete a customer and all associated verification data
 *     tags: [Verification]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *         description: The customer ID
 *         example: "cust_abc123"
 *     responses:
 *       200:
 *         description: Customer deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     customerId:
 *                       type: string
 *                       example: "cust_abc123"
 *                     deleted:
 *                       type: boolean
 *                       example: true
 *                 message:
 *                   type: string
 *                   example: "Customer data deleted successfully"
 */
router.delete(
  '/:customerId',
  validateDeleteCustomer,
  handleValidationErrors,
  VerificationController.deleteCustomer
);

export default router;
