import { Request, Response } from 'express';
import { ResponseHandler } from '../utils/responseHandler';
import { InnovatricsService } from '../services/innovatricsClient';

const innovatricsClient = new InnovatricsService();

export class VerificationController {
  static async createCustomer(req: Request, res: Response) {
    try {
      const { userId } = req.body;

      if (!userId) {
        return ResponseHandler.validationError(res, ['userId is required']);
      }

      // Create customer in Innovatrics
      const customer = await innovatricsClient.createCustomer({
        externalId: userId,
        onboardingStatus: 'IN_PROGRESS'
      });

      return ResponseHandler.success(res, {
        customerId: customer.id,
        status: 'created',
        createdAt: new Date(),
        userId,
      }, 'Customer created successfully');
    } catch (error: any) {
      console.error('Customer creation error:', error);
      return ResponseHandler.error(res, 'Failed to create customer', 500, error.message);
    }
  }

  static async uploadDocument(req: Request, res: Response) {
    try {
      const { customerId } = req.params;
      const { frontImage, backImage, documentType } = req.body;

      if (!frontImage) {
        return ResponseHandler.validationError(res, ['frontImage is required']);
      }

      // Verify document using Innovatrics
      const documentResult = await innovatricsClient.verifyDocument({
        frontImage,
        backImage,
        documentType
      });

      return ResponseHandler.success(res, {
        customerId,
        documentResult,
        status: 'document_verified'
      }, 'Document verified successfully');
    } catch (error: any) {
      console.error('Document verification error:', error);
      return ResponseHandler.error(res, 'Failed to verify document', 500, error.message);
    }
  }

  static async performLivenessCheck(req: Request, res: Response) {
    try {
      const { customerId } = req.params;
      const { image, challengeId, challengeType } = req.body;

      if (!image) {
        return ResponseHandler.validationError(res, ['image is required']);
      }

      // Submit liveness data (use provided challengeId or create new challenge)
      let finalChallengeId = challengeId;

      if (!finalChallengeId) {
        const challenge = await innovatricsClient.createLivenessChallenge(customerId, {
          challengeType: challengeType || 'passive' // Frontend choice or default
        });
        finalChallengeId = challenge.challengeId;
      }

      const livenessResult = await innovatricsClient.submitLivenessData(customerId, {
        image,
        challengeId: finalChallengeId
      });

      return ResponseHandler.success(res, {
        customerId,
        livenessResult,
        status: 'liveness_checked'
      }, 'Liveness check performed successfully');
    } catch (error: any) {
      console.error('Liveness check error:', error);
      return ResponseHandler.error(res, 'Failed to perform liveness check', 500, error.message);
    }
  }

  static async performFaceDetection(req: Request, res: Response) {
    try {
      const { customerId } = req.params;
      const { image } = req.body;

      if (!image) {
        return ResponseHandler.validationError(res, ['image is required']);
      }

      // Detect face
      const faceResult = await innovatricsClient.detectFace(image);

      // Check for face mask
      const maskResult = await innovatricsClient.checkFaceMask(faceResult.id);

      return ResponseHandler.success(res, {
        customerId,
        faceResult,
        maskResult,
        status: 'face_detected'
      }, 'Face detection and mask check performed successfully');
    } catch (error: any) {
      console.error('Face detection error:', error);
      return ResponseHandler.error(res, 'Failed to detect face', 500, error.message);
    }
  }

  static async compareFaces(req: Request, res: Response) {
    try {
      const { customerId } = req.params;
      const { probeFaceId, referenceFace, referenceFaceTemplate } = req.body;

      if (!probeFaceId) {
        return ResponseHandler.validationError(res, ['probeFaceId is required']);
      }

      if (!referenceFace && !referenceFaceTemplate) {
        return ResponseHandler.validationError(res, ['Either referenceFace or referenceFaceTemplate is required']);
      }

      // Compare faces
      const similarityResult = await innovatricsClient.compareFaces(probeFaceId, {
        referenceFace,
        referenceFaceTemplate
      });

      return ResponseHandler.success(res, {
        customerId,
        similarityResult,
        status: 'faces_compared'
      }, 'Face comparison performed successfully');
    } catch (error: any) {
      console.error('Face comparison error:', error);
      return ResponseHandler.error(res, 'Failed to compare faces', 500, error.message);
    }
  }

  static async createLivenessChallenge(req: Request, res: Response) {
    try {
      const { customerId } = req.params;
      const { challengeType } = req.body;

      // Create liveness challenge
      const challenge = await innovatricsClient.createLivenessChallenge(customerId, {
        challengeType
      });

      return ResponseHandler.success(res, {
        customerId,
        challenge,
        status: 'challenge_created'
      }, 'Liveness challenge created successfully');
    } catch (error: any) {
      console.error('Liveness challenge creation error:', error);
      return ResponseHandler.error(res, 'Failed to create liveness challenge', 500, error.message);
    }
  }

  static async uploadSelfie(req: Request, res: Response) {
    try {
      const { customerId } = req.params;
      const { image } = req.body;

      if (!image) {
        return ResponseHandler.validationError(res, ['image is required']);
      }

      // Upload selfie
      const selfieResult = await innovatricsClient.uploadSelfie(customerId, image);

      return ResponseHandler.success(res, {
        customerId,
        selfieResult,
        status: 'selfie_uploaded'
      }, 'Selfie uploaded successfully');
    } catch (error: any) {
      console.error('Selfie upload error:', error);
      return ResponseHandler.error(res, 'Failed to upload selfie', 500, error.message);
    }
  }

  static async getSelfie(req: Request, res: Response) {
    try {
      const { customerId } = req.params;

      // Get selfie
      const selfie = await innovatricsClient.getSelfie(customerId);

      return ResponseHandler.success(res, {
        customerId,
        selfie,
        status: 'selfie_retrieved'
      }, 'Selfie retrieved successfully');
    } catch (error: any) {
      console.error('Selfie retrieval error:', error);
      return ResponseHandler.error(res, 'Failed to retrieve selfie', 500, error.message);
    }
  }

  static async getCustomerStatus(req: Request, res: Response) {
    try {
      const { customerId } = req.params;

      // Get customer info (you might need to implement this in InnovatricsService)
      // For now, return a basic status
      return ResponseHandler.success(res, {
        customerId,
        status: 'active',
        onboardingStatus: 'IN_PROGRESS'
      }, 'Customer status retrieved successfully');
    } catch (error: any) {
      console.error('Customer status error:', error);
      return ResponseHandler.error(res, 'Failed to get customer status', 500, error.message);
    }
  }

  static async deleteCustomer(req: Request, res: Response) {
    try {
      const { customerId } = req.params;

      // Delete customer data (selfies, liveness, etc.)
      await innovatricsClient.deleteSelfie(customerId);
      await innovatricsClient.deleteLivenessData(customerId);

      return ResponseHandler.success(res, {
        customerId,
        deleted: true
      }, 'Customer data deleted successfully');
    } catch (error: any) {
      console.error('Customer deletion error:', error);
      return ResponseHandler.error(res, 'Failed to delete customer data', 500, error.message);
    }
  }
}
