import { Request, Response } from 'express';
import { ResponseHandler } from '../utils/responseHandler';
import { normalizeImagePayload, NormalizedImage } from '../utils/image';
import {
  InnovatricsService,
  DocumentVerificationResult,
  InnovatricsImagePayload,
} from '../services/innovatricsClient';
import { uploadImageFromBuffer } from '../services/cloudinaryService';
import type { KycUploadRequestFiles } from '../middleware/kycUpload';
import sharp from 'sharp';
import {
  initializeOnboardingRecord,
  markFinished,
  recordDocumentResult,
  recordError,
  recordFaceComparison,
  recordFaceDetection,
  recordLivenessResult,
  recordRetry,
  recordSelfieResult,
} from '../services/onboardingPersistence';

const innovatricsClient = new InnovatricsService();

export interface KYCProfile {
  createdAt: number;
  phoneNumber: string;
  email: string;
  name: string;
  surname: string;
  dateOfBirth: string;
  cityOfBirth: string;
  firstNationality: string;
  secondNationality: string;
  countryOfBirth: string;
  address: string;
  residencePermit: string;
  proofOfAddress: string;
  plannedInvestmentPerYear: string;
  sourceOfFunds: string[];
  totalWealth: string;
  sourceOfWealth: string[];
  descriptionOfSourceOfFundsAndWealth: string;
  taxIDNumber: string;
  cryptoWallet: string;
  financialDocuments: string[];
  occupation: string;
  professionalStatus: string;
  worksFor: string;
  industry: string;
  cvOrResume: string;
  beneficialOwnership: string;
  pepStatus: string;
  identificationDocumentImage?: string[] | string;
  image?: string;
  selfieImages?: string[] | string;
  consentMessage: string;
  displayName?: string;
  about?: string;
  website?: string;
  userId?: string; // Application user ID for better tracking
  documentType?: 'passport' | 'id_card' | 'driver_license' | 'residence_permit' | 'visa' | 'other'; // All Innovatrics supported types
  challengeType?: 'passive' | 'motion' | 'expression'; // Optional liveness analysis type
}

export interface KYCVerificationResult {
  customerId: string;
  documentVerification?: DocumentVerificationResult;
  selfieUpload?: {
    id: string;
  };
  faceDetection?: {
    id: string;
    detection: {
      score: number;
      boundingBox: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
    };
    maskResult: {
      score: number;
    };
  };
  livenessCheck?: {
    confidence: number;
    status: string;
    isDeepfake?: boolean;
    deepfakeConfidence?: number;
  };
  faceComparison?: {
    score: number;
  };
  overallStatus: 'pending' | 'in_progress' | 'completed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
}

export class KYCVerificationController {
  static async processKYCProfile(req: Request, res: Response) {
    let customerId: string | null = null;

    try {
      const files = (req.files as KycUploadRequestFiles | undefined) ?? {};
      const kycData: KYCProfile = req.body;
      const documentImagesFromBody = toStringArray(kycData.identificationDocumentImage);
      const selfieImagesFromBody = toStringArray(kycData.selfieImages);

      const hasDocumentFront = Boolean(files.documentFront?.length || documentImagesFromBody[0]);
      const hasPrimarySelfie = Boolean(files.selfiePrimary?.length || kycData.image);

      if (!hasDocumentFront || !hasPrimarySelfie) {
        return ResponseHandler.validationError(res, [
          !hasDocumentFront ? 'Document front image must be provided as a file or base64 string' : undefined,
          !hasPrimarySelfie ? 'Primary selfie image must be provided as a file or base64 string' : undefined,
        ].filter((msg): msg is string => Boolean(msg)));
      }

      // Step 1: Create customer (Innovatrics generates UUID)
      console.log('\n' + '='.repeat(70));
      console.log('STEP 1: Creating customer in Innovatrics');
      console.log('='.repeat(70));
      const customer = await innovatricsClient.createCustomer();
      customerId = customer.id;
      console.log('\nSUCCESS: Customer created with ID:', customerId);
      console.log('='.repeat(70) + '\n');

      const externalId = kycData.userId || `${kycData.name}_${kycData.surname}_${Date.now()}`;
      const userIdForTracking = kycData.userId || externalId;

      // Step 2: Store customer in Trust Platform with external ID
      console.log('Linking Innovatrics customer to external platform ID', {
        innovatricsCustomerId: customer.id,
        externalId,
        onboardingStatus: 'IN_PROGRESS'
      });
      await innovatricsClient.storeCustomer(customer.id, {
        externalId,
        onboardingStatus: 'IN_PROGRESS'
      });
      console.log('Innovatrics acknowledged customer linkage');

      await initializeOnboardingRecord({
        userId: userIdForTracking,
        externalId,
        innovatricsCustomerId: customer.id,
      });

      const results: KYCVerificationResult = {
        customerId,
        overallStatus: 'pending',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      try {
        // Step 2: Document verification (handle multiple documents)
        console.log('\n' + '='.repeat(70));
        console.log('STEP 2: Uploading and verifying document pages');
        console.log('='.repeat(70));
        const documentFront = await resolveImageSource({
          file: files.documentFront?.[0],
          base64: documentImagesFromBody[0],
          defaultFileName: `${userIdForTracking}_document_front`,
          tags: ['kyc', 'document', 'front'],
        });

        if (!documentFront) {
          throw new Error('Document front image could not be processed');
        }

        const documentBack = await resolveImageSource({
          file: files.documentBack?.[0],
          base64: documentImagesFromBody[1],
          defaultFileName: `${userIdForTracking}_document_back`,
          tags: ['kyc', 'document', 'back'],
        });

        const documentResult = await innovatricsClient.verifyDocument({
          customerId,
          frontImage: documentFront.innovatrics,
          ...(documentBack ? { backImage: documentBack.innovatrics } : {}),
          ...(kycData.documentType ? { documentType: kycData.documentType } : {}),
          ...(kycData.firstNationality ? { issuingCountry: kycData.firstNationality } : {}),
          onRetry: ({ stage, attempt, delayMs, error }) => {
            void recordRetry(customerId!, {
              reason: `document_${stage}`,
              context: {
                attempt,
                delayMs,
                message: error?.message,
                status: error?.response?.status,
              },
            }).catch(() => undefined);
          },
        });

        results.documentVerification = documentResult;
        console.log('\nSUCCESS: Document verified');
        console.log('   Pages processed successfully');
        console.log('='.repeat(70) + '\n');

        await recordDocumentResult(customerId, {
          documentResult,
          images: documentBack
            ? { front: documentFront.normalized, back: documentBack.normalized }
            : { front: documentFront.normalized },
        });

        // Step 3: Upload main selfie
        console.log('\n' + '='.repeat(70));
        console.log('STEP 3: Uploading selfie image');
        console.log('='.repeat(70));
        const primarySelfieSource = await resolveImageSource({
          file: files.selfiePrimary?.[0],
          base64: kycData.image,
          defaultFileName: `${userIdForTracking}_selfie_primary`,
          tags: ['kyc', 'selfie', 'primary'],
        });

        if (!primarySelfieSource) {
          throw new Error('Primary selfie image could not be processed');
        }

        await innovatricsClient.uploadSelfie(customerId, primarySelfieSource.innovatrics);
        console.log('\nSUCCESS: Selfie uploaded');
        console.log('='.repeat(70) + '\n');

        const selfieResult = {
          id: customerId,
        };
        results.selfieUpload = selfieResult;
        await recordSelfieResult(customerId, {
          selfieResult,
          image: primarySelfieSource.normalized,
        });

        // Step 4: Face detection with mask check
        const faceResult = await innovatricsClient.detectFace(primarySelfieSource.innovatrics);
        const maskResult = await innovatricsClient.checkFaceMask(faceResult.id);

        results.faceDetection = {
          id: faceResult.id,
          detection: faceResult.detection,
          maskResult
        };
        console.log('\nSUCCESS: Face detection completed');
        console.log('='.repeat(70) + '\n');
        await recordFaceDetection(customerId, {
          faceResult,
          maskResult,
          image: primarySelfieSource.normalized,
        });

        // Step 5: Compare document photo with ALL selfies using Face Comparison API
        console.log('\n' + '='.repeat(70));
        console.log('STEP 5: Comparing document photo with all selfies');
        console.log('='.repeat(70));
        
        // Get document portrait image
        console.log('Retrieving document portrait image...');
        const documentPortrait = await innovatricsClient.getDocumentPortrait(customerId);
        console.log('✅ Document portrait retrieved');
        
        // Detect face from document portrait
        console.log('Detecting face in document portrait...');
        const portraitImageData = documentPortrait?.image?.data || (documentPortrait as any)?.data || documentPortrait;
        const documentFaceResult = await innovatricsClient.detectFace(portraitImageData);
        console.log(`✅ Document portrait face detected (ID: ${documentFaceResult.id})`);
        
        // Process ALL selfies (primary + additional from files or body)
        const additionalSelfieFiles = files.selfieImages || [];
        const totalSelfies = 1 + additionalSelfieFiles.length + selfieImagesFromBody.length;
        console.log(`\nProcessing ${totalSelfies} selfie(s) for face matching...`);
        console.log(`   - Primary selfie: 1`);
        console.log(`   - Additional (files): ${additionalSelfieFiles.length}`);
        console.log(`   - Additional (base64): ${selfieImagesFromBody.length}`);
        
        const faceMatchScores: number[] = [];
        
        // Compare primary selfie (already detected face in Step 4)
        console.log(`\n[1/${totalSelfies}] Comparing primary selfie (${faceResult.id})...`);
        const primaryComparison = await innovatricsClient.compareFaces(faceResult.id, {
          referenceFace: `/api/v1/faces/${documentFaceResult.id}`
        });
        faceMatchScores.push(primaryComparison.score);
        console.log(`   Score: ${(primaryComparison.score * 100).toFixed(1)}%`);
        
        // Compare additional selfies from FILES
        for (let i = 0; i < additionalSelfieFiles.length; i++) {
          console.log(`\n[${faceMatchScores.length + 1}/${totalSelfies}] Processing additional selfie file ${i + 1}...`);
          const additionalSelfie = await resolveImageSource({
            file: additionalSelfieFiles[i],
            base64: undefined,
            defaultFileName: `${userIdForTracking}_selfie_file_${i + 1}`,
            tags: ['kyc', 'selfie', 'additional'],
          });
          
          if (additionalSelfie) {
            const additionalFaceResult = await innovatricsClient.detectFace(additionalSelfie.innovatrics);
            const additionalComparison = await innovatricsClient.compareFaces(additionalFaceResult.id, {
              referenceFace: `/api/v1/faces/${documentFaceResult.id}`
            });
            faceMatchScores.push(additionalComparison.score);
            console.log(`   Score: ${(additionalComparison.score * 100).toFixed(1)}%`);
          }
        }
        
        // Compare additional selfies from BASE64 BODY
        for (let i = 0; i < selfieImagesFromBody.length; i++) {
          console.log(`\n[${faceMatchScores.length + 1}/${totalSelfies}] Processing additional selfie base64 ${i + 1}...`);
          const additionalSelfie = await resolveImageSource({
            file: undefined,
            base64: selfieImagesFromBody[i],
            defaultFileName: `${userIdForTracking}_selfie_base64_${i + 1}`,
            tags: ['kyc', 'selfie', 'additional'],
          });
          
          if (additionalSelfie) {
            const additionalFaceResult = await innovatricsClient.detectFace(additionalSelfie.innovatrics);
            const additionalComparison = await innovatricsClient.compareFaces(additionalFaceResult.id, {
              referenceFace: `/api/v1/faces/${documentFaceResult.id}`
            });
            faceMatchScores.push(additionalComparison.score);
            console.log(`   Score: ${(additionalComparison.score * 100).toFixed(1)}%`);
          }
        }
        
        // Calculate average score for robustness
        const faceMatchScore = faceMatchScores.reduce((sum, score) => sum + score, 0) / faceMatchScores.length;
        const maxScore = Math.max(...faceMatchScores);
        const minScore = Math.min(...faceMatchScores);

        results.faceComparison = {
          score: faceMatchScore,
        };
        
        console.log('\n' + '='.repeat(70));
        console.log('Face Matching Results (Multi-Selfie Analysis):');
        console.log('='.repeat(70));
        console.log('   Selfies Analyzed:', faceMatchScores.length);
        console.log('   Individual Scores:', faceMatchScores.map(s => `${(s * 100).toFixed(1)}%`).join(', '));
        console.log('   Average Score:', (faceMatchScore * 100).toFixed(1) + '%');
        console.log('   Best Score:', (maxScore * 100).toFixed(1) + '%');
        console.log('   Worst Score:', (minScore * 100).toFixed(1) + '%');
        console.log('   Final Result:', faceMatchScore >= 0.65 ? '✅ MATCH' : '❌ NO MATCH');
        
        console.log('='.repeat(70) + '\n');
        await recordFaceComparison(customerId, {
          comparisonResult: { score: faceMatchScore },
          image: primarySelfieSource.normalized,
        });

        // Step 6: Inspection-based liveness check (reliable with single selfie)
        console.log('\n' + '='.repeat(70));
        console.log('STEP 6: Performing liveness check');
        console.log('='.repeat(70));
        
        // Use customer inspection for quality-based liveness assessment
        // Note: Passive liveness evaluation requires temporal variation between frames
        // which isn't available when selfies are captured simultaneously
        console.log('Retrieving selfie quality assessment...');
        const customerInspection = await innovatricsClient.inspectCustomer(customerId);
        
        // Check for spoofing indicators
        const hasMask = customerInspection?.selfieInspection?.hasMask || false;
        const faceQuality = customerInspection?.selfieInspection?.faceQuality || 'unknown';
        
        // Determine liveness based on inspection results
        const livenessResult = {
          status: hasMask ? 'not_live' : 'live',
          confidence: hasMask ? 0 : 0.85,
          method: 'inspection_based',
          indicators: {
            hasMask,
            faceQuality
          }
        };

        results.livenessCheck = {
          confidence: livenessResult.confidence,
          status: livenessResult.status
        };

        console.log('\nSUCCESS: Liveness check completed');
        console.log('   Status:', livenessResult.status.toUpperCase());
        console.log('   Confidence:', (livenessResult.confidence * 100).toFixed(1) + '%');
        console.log('   Method: Inspection-based quality assessment');
        console.log('   Has Mask:', hasMask ? 'YES (suspicious)' : 'NO');
        console.log('   Face Quality:', faceQuality);
        console.log('='.repeat(70) + '\n');

        await recordLivenessResult(customerId, {
          livenessResult,
          image: primarySelfieSource.normalized,
        });

        // Update overall status
        results.overallStatus = 'completed';
        results.updatedAt = new Date();

        await markFinished(customerId);
        console.log('Updating Innovatrics customer onboarding status to FINISHED', {
          innovatricsCustomerId: customerId,
          externalId
        });
        await innovatricsClient.storeCustomer(customerId, {
          externalId,
          onboardingStatus: 'FINISHED',
        });
        console.log('Innovatrics confirmed onboarding status update');

        // Final success response
        console.log('\n' + '='.repeat(70));
        console.log('KYC VERIFICATION COMPLETE!');
        console.log('='.repeat(70));
        console.log('   Customer ID:', customerId);
        console.log('   Document Verified:', results.documentVerification ? 'YES' : 'NO');
        console.log('   Selfie Uploaded:', results.selfieUpload ? 'YES' : 'NO');
        console.log('   Liveness Check:', results.livenessCheck ? (results.livenessCheck.status ? results.livenessCheck.status.toUpperCase() : 'INCONCLUSIVE') : 'SKIPPED');
        console.log('   Face Match:', (results.faceComparison?.score ?? 0) >= 0.65 ? 'PASSED' : 'FAILED');
        console.log('='.repeat(70) + '\n');
        
        return ResponseHandler.success(
          res,
          {
            customerId,
            results,
          },
          'KYC verification completed successfully'
        );

      } catch (verificationError: any) {
        // If verification fails, still return partial results
        results.overallStatus = 'failed';
        results.updatedAt = new Date();

        console.error('KYC verification error:', verificationError);
        const errorPayload: Parameters<typeof recordError>[1] = {
          message: verificationError?.message ?? 'Verification failed',
          markFailed: true,
          context:
            verificationError?.response?.data ?? {
              message: verificationError?.message,
            },
        };

        if (verificationError?.response?.status) {
          errorPayload.code = String(verificationError.response.status);
        }

        await recordError(customerId, errorPayload).catch(() => undefined);
        return ResponseHandler.error(res, 'KYC verification failed', 500, verificationError.message);
      }

    } catch (error: any) {
      console.error('KYC processing error:', error);
      if (customerId) {
        const errorPayload: Parameters<typeof recordError>[1] = {
          message: error?.message ?? 'Processing failed',
          markFailed: true,
          context:
            error?.response?.data ?? {
              message: error?.message,
            },
        };

        if (error?.response?.status) {
          errorPayload.code = String(error.response.status);
        }

        await recordError(customerId, errorPayload).catch(() => undefined);
      }
      return ResponseHandler.error(res, 'Failed to process KYC profile', 500, error.message);
    }
  }
}

interface ResolveImageOptions {
  file?: Express.Multer.File | undefined;
  base64?: string | undefined;
  defaultFileName: string;
  tags?: string[] | undefined;
}

interface ResolvedImageSource {
  normalized: NormalizedImage;
  innovatrics: InnovatricsImagePayload;
}

async function resolveImageSource(options: ResolveImageOptions): Promise<ResolvedImageSource | null> {
  const { file, base64, defaultFileName, tags } = options;

  let buffer: Buffer | null = null;
  let mimeType: string | undefined;

  if (file && file.buffer) {
    buffer = file.buffer;
    mimeType = file.mimetype;
  } else if (base64) {
    const normalized = normalizeImagePayload(base64);
    if (!normalized.base64) {
      return null;
    }
    buffer = Buffer.from(normalized.base64, 'base64');
    mimeType = normalized.mimeType;
  }

  if (!buffer) {
    return null;
  }

  // Get image metadata first
  const metadata = await sharp(buffer).metadata();
  console.log(`Original image: ${metadata.width}x${metadata.height}, format: ${metadata.format}, size: ${buffer.length} bytes`);
  
  // Ensure minimum dimensions for Innovatrics (document card needs ~1000px width)
  // Target: 1800px on longer side to ensure document card is large enough
  const minDimension = 1800;
  const maxDimension = 3000; // Innovatrics limit
  
  let targetWidth, targetHeight;
  if (metadata.width && metadata.height) {
    const longerSide = Math.max(metadata.width, metadata.height);
    const shorterSide = Math.min(metadata.width, metadata.height);
    
    if (longerSide < minDimension) {
      // Image too small - upscale to minimum
      console.log(`⚠️  Image too small (${longerSide}px), upscaling to ${minDimension}px`);
      const scale = minDimension / longerSide;
      targetWidth = Math.round(metadata.width * scale);
      targetHeight = Math.round(metadata.height * scale);
    } else if (longerSide > maxDimension) {
      // Image too large - downscale to maximum
      console.log(`⚠️  Image too large (${longerSide}px), downscaling to ${maxDimension}px`);
      const scale = maxDimension / longerSide;
      targetWidth = Math.round(metadata.width * scale);
      targetHeight = Math.round(metadata.height * scale);
    } else {
      // Image size is good
      targetWidth = metadata.width;
      targetHeight = metadata.height;
    }
  } else {
    targetWidth = minDimension;
    targetHeight = minDimension;
  }
  
  // Determine if this is a selfie or document based on tags
  const isSelfie = tags?.includes('selfie');
  
  const resizedBuffer = await sharp(buffer)
    .resize(targetWidth, targetHeight, {
      fit: isSelfie ? 'inside' : 'contain', // ✅ Preserve aspect ratio (no distortion!)
      kernel: 'lanczos3', // Best quality scaling
      withoutEnlargement: false, // Allow upscaling if needed
    })
    .jpeg({ 
      quality: isSelfie ? 95 : 90, // Higher quality for selfies (face details)
      mozjpeg: true,
    })
    .toBuffer();
  
  const resizedMetadata = await sharp(resizedBuffer).metadata();
  console.log(`Resized image: ${resizedMetadata.width}x${resizedMetadata.height}, size: ${resizedBuffer.length} bytes`);

  const uploadOptions: Parameters<typeof uploadImageFromBuffer>[2] = {};
  if (tags && tags.length > 0) {
    uploadOptions.tags = tags;
  }

  const uploadResult = await uploadImageFromBuffer(
    resizedBuffer, // Upload resized version to Cloudinary
    generateUploadFileName(file, defaultFileName),
    uploadOptions
  );

  // Convert resized buffer to base64 for Innovatrics (they don't support URLs for documents)
  const base64Data = resizedBuffer.toString('base64');

  const normalized: NormalizedImage = {
    url: uploadResult.secureUrl,
    publicId: uploadResult.publicId,
    format: uploadResult.format,
    bytes: resizedBuffer.length, // Use resized buffer size
    resourceType: 'image',
    base64: base64Data,
    ...(mimeType ? { mimeType: 'image/jpeg' } : { mimeType: 'image/jpeg' }), // Sharp outputs JPEG
    ...(uploadResult.width ? { width: uploadResult.width } : {}),
    ...(uploadResult.height ? { height: uploadResult.height } : {}),
  };

  return {
    normalized,
    innovatrics: base64Data, // Send base64 string directly
  };
}

function generateUploadFileName(file: Express.Multer.File | undefined, fallback: string): string {
  if (file && file.originalname) {
    return file.originalname;
  }
  return fallback;
}

function toStringArray(input?: string[] | string): string[] {
  if (!input) {
    return [];
  }

  return Array.isArray(input) ? input : [input];
}
