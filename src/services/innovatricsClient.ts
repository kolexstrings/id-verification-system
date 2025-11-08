import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { config } from '../config/env';
import { withRetry, RetryOptions } from '../utils/retry';

export type InnovatricsImagePayload = string | { url: string };

const INNOVATRICS_DOCUMENT_TYPE_MAP: Record<string, string> = {
  passport: 'PASSPORT',
  id_card: 'ID_CARD',
  driver_license: 'DRIVER_LICENSE',
  residence_permit: 'RESIDENCE_PERMIT',
  visa: 'VISA',
};

const INNOVATRICS_ERROR_MAP: Record<
  string,
  {
    summary: string;
    remediation?: string;
  }
> = {
  INVALID_REQUEST_BODY: {
    summary: 'Innovatrics rejected the request payload',
    remediation:
      'Check document advice (types/countries/pageTypes) and required fields.',
  },
  INVALID_IMAGE_FORMAT: {
    summary: 'Image format not supported',
    remediation: 'Ensure JPEG or PNG images are provided.',
  },
  INVALID_IMAGE: {
    summary: 'Image validation failed',
    remediation: 'Verify base64 payload and make sure image is not corrupted.',
  },
  INVALID_IMAGE_RESOLUTION: {
    summary: 'Image resolution outside allowed range',
    remediation:
      'Resize images so the longer side is <= 3000px and facial region is clear.',
  },
  IMAGE_TOO_SMALL: {
    summary: 'Image is too small for processing',
    remediation: 'Upload higher-resolution document or selfie image.',
  },
  DOCUMENT_NOT_SUPPORTED: {
    summary: 'Document not supported by Innovatrics',
    remediation: 'Use a supported document type for the selected country.',
  },
  NO_DOCUMENT_MATCH: {
    summary: 'No document matched the provided advice',
    remediation:
      'Verify document type/country advice values align with Innovatrics catalogue.',
  },
  DOCUMENT_ALREADY_PROCESSED: {
    summary: 'Document was already processed for this customer',
    remediation:
      'Inspect existing document state or reset before reprocessing.',
  },
  NOT_ENOUGH_DATA: {
    summary: 'Liveness evaluation lacks sufficient data',
    remediation: 'Upload higher-quality selfie frames or additional selfies.',
  },
  LIVENESS_NOT_READY: {
    summary: 'Liveness resources not ready yet',
    remediation: 'Wait and retry evaluation after required data is uploaded.',
  },
  CUSTOMER_NOT_FOUND: {
    summary: 'Innovatrics customer not found',
    remediation: 'Ensure customer creation succeeded and IDs are correct.',
  },
};

const INNOVATRICS_ADVICE_GUIDANCE: Array<{
  matcher: (advice: any) => boolean;
  summary: string;
  remediation?: string;
}> = [
  {
    matcher: advice =>
      !!advice?.classification?.message &&
      advice.classification.message
        .toLowerCase()
        .includes('no document matches'),
    summary: 'Provided document type/country combination is not recognized.',
    remediation:
      'Double-check classification advice types/countries sent to Innovatrics.',
  },
  {
    matcher: advice => advice?.quality?.reason === 'IMAGE_TOO_SMALL',
    summary: 'Document image too small to extract data.',
    remediation:
      'Provide higher-resolution scans (longer side at least 1000px, preferred 1800px).',
  },
  {
    matcher: advice => advice?.quality?.reason === 'FACE_NOT_FOUND',
    summary: 'Face region not detected on the provided image.',
    remediation: 'Ensure document portrait is visible and unobstructed.',
  },
];

export interface InnovatricsErrorContext {
  operation: string;
  status?: number;
  errorCode?: string;
  errorMessage?: string;
  adviceSummary?: string;
  remediation?: string;
  advice?: any;
  headers?: Record<string, any>;
  request?: {
    method?: string;
    url?: string;
    stage?: string;
  };
  raw?: any;
}

export class InnovatricsApiError extends Error {
  readonly context: InnovatricsErrorContext;

  constructor(message: string, context: InnovatricsErrorContext) {
    super(message);
    this.name = 'InnovatricsApiError';
    this.context = context;
  }

  get userMessage(): string {
    const parts: string[] = [];
    if (this.context.errorCode) {
      parts.push(`[${this.context.errorCode}]`);
    }
    if (this.context.adviceSummary) {
      parts.push(this.context.adviceSummary);
    }
    if (
      this.context.errorMessage &&
      !parts.includes(this.context.errorMessage)
    ) {
      parts.push(this.context.errorMessage);
    }
    if (this.context.remediation) {
      parts.push(this.context.remediation);
    }

    const message = parts.join(' ');
    return message.length > 0 ? message : this.message;
  }

  serialize() {
    return {
      message: this.message,
      context: this.context,
    };
  }
}

export interface CustomerStoreRequest {
  externalId?: string;
  onboardingStatus: 'IN_PROGRESS' | 'FINISHED';
}

export interface CreateCustomerResponse {
  id: string;
  links: {
    self: string;
  };
}

export interface CreateFaceRequest {
  image: InnovatricsImagePayload;
}

export interface CreateFaceResponse {
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
  links: {
    self: string;
    template: string;
  };
}

export interface FaceSimilarityRequest {
  referenceFace: string; // URL to reference face
  referenceFaceTemplate?: string; // base64 template
}

export interface FaceSimilarityResponse {
  score: number; // 0-1 similarity score
}

export interface LivenessCheckOptions {
  deepfakeCheck?: boolean | undefined;
  // Add other liveness options as needed
}

export type LivenessChallengeType =
  | 'EYE_GAZE_LIVENESS'
  | 'SMILE_LIVENESS'
  | 'MAGNIFEYE_LIVENESS';

export interface CreateLivenessRequest {
  type?: LivenessChallengeType; // Analysis approach, not user interaction
  options?: LivenessCheckOptions;
}

export const DEFAULT_LIVENESS_CHALLENGE: LivenessChallengeType =
  'EYE_GAZE_LIVENESS';

export function normalizeLivenessChallengeType(
  rawType?: string | null
): LivenessChallengeType {
  const normalized = (rawType ?? '').trim().toUpperCase();

  switch (normalized) {
    case 'PASSIVE_LIVENESS':
    case 'PASSIVE':
      return 'EYE_GAZE_LIVENESS';
    case 'EYE_GAZE_LIVENESS':
    case 'EYE_GAZE':
    case 'MOTION':
      return 'EYE_GAZE_LIVENESS';
    case 'SMILE_LIVENESS':
    case 'SMILE':
    case 'EXPRESSION':
      return 'SMILE_LIVENESS';
    case 'MAGNIFEYE_LIVENESS':
    case 'MAGNIFEYE':
      return 'MAGNIFEYE_LIVENESS';
    default:
      return DEFAULT_LIVENESS_CHALLENGE;
  }
}

export interface LivenessChallengeResponse {
  challengeId: string;
  challengeType: string;
  instructions: string;
}

export interface DocumentVerificationRequest {
  customerId: string;
  frontImage: InnovatricsImagePayload;
  backImage?: InnovatricsImagePayload;
  documentType?: string;
  issuingCountry?: string;
  onRetry?: (params: {
    stage:
      | 'create_document'
      | 'upload_page_front'
      | 'upload_page_back'
      | 'inspect_document'
      | 'disclose_inspection';
    attempt: number;
    delayMs: number;
    error: any;
  }) => void;
}

export interface DocumentPageResult {
  documentType?: {
    type?: string;
    issuingCountry?: string;
    edition?: string;
  };
  pageType?: 'front' | 'back' | 'unknown';
  detection?: any;
  errorCode?: string;
  warnings?: string[];
  links?: any;
}

export interface DocumentVerificationSummary {
  documentType?: string;
  issuingCountry?: string;
  warnings?: string[];
  errors?: string[];
}

export interface DocumentVerificationResult {
  document?: any;
  summary: DocumentVerificationSummary;
  pages: DocumentPageResult[];
  inspection?: any;
  disclosedInspection?: any;
}

export class InnovatricsService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.innovatrics.baseUrl,
      headers: {
        Authorization: `Bearer ${config.innovatrics.bearerToken}`,
        'Content-Type': 'application/json',
        Host: config.innovatrics.host,
      },
      timeout: 120000, // Increased to 2 minutes for large images
      maxBodyLength: 50 * 1024 * 1024, // 50MB
      maxContentLength: 50 * 1024 * 1024, // 50MB
      proxy: false,
      httpsAgent: new https.Agent({
        keepAlive: true,
      }),
    });

    this.client.interceptors.response.use(
      response => response,
      error => {
        const normalized = this.normalizeAxiosError(error, {
          operation: 'request',
        });
        console.error('Innovatrics API error:', normalized.logPayload);
        return Promise.reject(normalized.error);
      }
    );
  }

  // Customer Management

  private normalizeDocumentTypeForAdvice(
    documentType?: string
  ): string | undefined {
    if (!documentType) {
      return undefined;
    }

    const normalized = documentType.trim().toLowerCase();
    const mapped = INNOVATRICS_DOCUMENT_TYPE_MAP[normalized];
    if (mapped) {
      return mapped;
    }

    const sanitized = normalized
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();

    return sanitized.length ? sanitized : undefined;
  }

  private normalizeCountryForAdvice(country?: string): string | undefined {
    if (!country) {
      return undefined;
    }

    const trimmed = country.trim();
    if (!trimmed) {
      return undefined;
    }

    const upper = trimmed.toUpperCase();

    if (/^[A-Z]{2}$/.test(upper) || /^[A-Z]{3}$/.test(upper)) {
      return upper;
    }

    const sanitized = trimmed
      .toLowerCase()
      .replace(/[^a-z]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Basic fallback for common variations
    const COMMON_COUNTRY_MAP: Record<string, string> = {
      nigeria: 'NGA',
      'nigeria (ng)': 'NGA',
      'federal republic of nigeria': 'NGA',
      ghana: 'GHA',
      kenya: 'KEN',
      uganda: 'UGA',
      'south africa': 'ZAF',
      'united states': 'USA',
      'united states of america': 'USA',
      'united kingdom': 'GBR',
      england: 'GBR',
      scotland: 'GBR',
      wales: 'GBR',
      'northern ireland': 'GBR',
      canada: 'CAN',
      germany: 'DEU',
      france: 'FRA',
      italy: 'ITA',
      spain: 'ESP',
      portugal: 'PRT',
      netherlands: 'NLD',
      belgium: 'BEL',
      switzerland: 'CHE',
      'czech republic': 'CZE',
      poland: 'POL',
      india: 'IND',
      china: 'CHN',
      japan: 'JPN',
      singapore: 'SGP',
      australia: 'AUS',
      'new zealand': 'NZL',
    };

    return COMMON_COUNTRY_MAP[sanitized];
  }

  private redactPayload(payload: unknown): unknown {
    if (!payload || typeof payload !== 'object') {
      if (typeof payload === 'string' && payload.length > 200) {
        return `[string:${payload.length}]`;
      }
      return payload;
    }

    if (Array.isArray(payload)) {
      return payload.map(item => this.redactPayload(item));
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (!value) {
        result[key] = value;
        continue;
      }

      if (typeof value === 'string') {
        const trimmed = value.trim();
        const looksLikeBase64 =
          /^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length > 80;
        if (
          looksLikeBase64 ||
          key.toLowerCase().includes('data') ||
          key.toLowerCase().includes('image')
        ) {
          result[key] = `[base64:${trimmed.length}]`;
        } else if (trimmed.length > 300) {
          result[key] = `[string:${trimmed.length}]`;
        } else {
          result[key] = trimmed;
        }
        continue;
      }

      result[key] = this.redactPayload(value);
    }

    return result;
  }

  private summarizeAdvice(advice: any): {
    summary?: string;
    remediation?: string;
  } {
    if (!advice) {
      return {};
    }

    if (Array.isArray(advice)) {
      const aggregated = advice
        .map(item => this.summarizeAdvice(item))
        .filter(item => item.summary || item.remediation);
      const summary = aggregated
        .map(item => item.summary)
        .filter(Boolean)
        .join(' | ');
      const remediation = aggregated
        .map(item => item.remediation)
        .filter(Boolean)
        .join(' | ');

      const result: { summary?: string; remediation?: string } = {};
      if (summary.length) {
        result.summary = summary;
      }
      if (remediation.length) {
        result.remediation = remediation;
      }

      return result;
    }

    if (typeof advice === 'string') {
      return { summary: advice };
    }

    const matched = INNOVATRICS_ADVICE_GUIDANCE.find(entry =>
      entry.matcher(advice)
    );

    const parts: string[] = [];

    if (advice.message) {
      parts.push(advice.message);
    }

    if (advice.details) {
      parts.push(advice.details);
    }

    const classification = advice.classification;
    if (classification) {
      const classificationParts: string[] = [];
      if (classification.message) {
        classificationParts.push(classification.message);
      }
      if (classification.types?.length) {
        classificationParts.push(`types=${classification.types.join(',')}`);
      }
      if (classification.countries?.length) {
        classificationParts.push(
          `countries=${classification.countries.join(',')}`
        );
      }
      if (classification.pageTypes?.length) {
        classificationParts.push(
          `pageTypes=${classification.pageTypes.join(',')}`
        );
      }
      if (classificationParts.length) {
        parts.push(`classification(${classificationParts.join(' | ')})`);
      }
    }

    const quality = advice.quality;
    if (quality) {
      const qualityParts: string[] = [];
      if (quality.reason) {
        qualityParts.push(quality.reason);
      }
      if (quality.score) {
        qualityParts.push(`score=${quality.score}`);
      }
      if (qualityParts.length) {
        parts.push(`quality(${qualityParts.join(' | ')})`);
      }
    }

    const summary = parts.length ? parts.join(' | ') : undefined;

    const result: { summary?: string; remediation?: string } = {};
    if (matched?.summary) {
      result.summary = matched.summary;
    } else if (summary) {
      result.summary = summary;
    }

    if (matched?.remediation) {
      result.remediation = matched.remediation;
    }

    return result;
  }

  private normalizeAxiosError(
    error: any,
    context: { operation: string; stage?: string }
  ): { error: InnovatricsApiError; logPayload: Record<string, unknown> } {
    if (error instanceof InnovatricsApiError) {
      return {
        error,
        logPayload: error.serialize(),
      };
    }

    const status = error.response?.status;
    const data = error.response?.data ?? {};
    const errorCode = data.errorCode ?? data.code;
    const errorMessage = data.errorMessage ?? data.message ?? error.message;
    const advice = data.advice ?? data.details;
    const adviceSummary = this.summarizeAdvice(advice);
    const knownError = errorCode ? INNOVATRICS_ERROR_MAP[errorCode] : undefined;

    const requestData = (() => {
      if (!error.config?.data) {
        return undefined;
      }

      try {
        const parsed =
          typeof error.config.data === 'string'
            ? JSON.parse(error.config.data)
            : error.config.data;
        return this.redactPayload(parsed);
      } catch {
        return this.redactPayload(error.config.data);
      }
    })();

    const messageParts: string[] = [
      `Innovatrics ${context.operation} failed`,
      status ? `status ${status}` : undefined,
      errorCode ? `code ${errorCode}` : undefined,
      knownError?.summary,
      adviceSummary?.summary,
    ].filter(Boolean) as string[];

    const finalMessage =
      messageParts.join(' - ') || errorMessage || error.message;

    const requestContext: { method?: string; url?: string; stage?: string } =
      {};
    if (error.config?.method) {
      requestContext.method = error.config.method;
    }
    if (error.config?.url) {
      requestContext.url = error.config.url;
    }
    if (context.stage) {
      requestContext.stage = context.stage;
    }

    const errorContext: InnovatricsErrorContext = {
      operation: context.operation,
    };
    if (typeof status === 'number') {
      errorContext.status = status;
    }
    if (errorCode) {
      errorContext.errorCode = errorCode;
    }
    if (errorMessage) {
      errorContext.errorMessage = errorMessage;
    }
    const adviceSummaryText = adviceSummary?.summary;
    if (typeof adviceSummaryText === 'string' && adviceSummaryText.length > 0) {
      errorContext.adviceSummary = adviceSummaryText;
    }
    const remediationHint =
      adviceSummary?.remediation ?? knownError?.remediation;
    if (typeof remediationHint === 'string' && remediationHint.length > 0) {
      errorContext.remediation = remediationHint;
    }
    if (advice !== undefined) {
      errorContext.advice = advice;
    }
    if (error.response?.headers) {
      errorContext.headers = error.response.headers;
    }
    if (Object.keys(requestContext).length > 0) {
      errorContext.request = requestContext;
    }
    if (data !== undefined) {
      errorContext.raw = data;
    }

    const innovatricsError = new InnovatricsApiError(
      finalMessage,
      errorContext
    );

    const logPayload: Record<string, unknown> = {
      error: innovatricsError.serialize(),
      status,
      errorCode,
      errorMessage,
      advice: this.redactPayload(advice),
      headers: {
        requestId: error.response?.headers?.['x-request-id'] ?? 'N/A',
        traceId: error.response?.headers?.['x-trace-id'] ?? 'N/A',
        correlationId: error.response?.headers?.['x-correlation-id'] ?? 'N/A',
      },
      request: {
        ...(error.config?.method ? { method: error.config.method } : {}),
        ...(error.config?.url ? { url: error.config.url } : {}),
        ...(error.config?.timeout ? { timeout: error.config.timeout } : {}),
        ...(context.stage ? { stage: context.stage } : {}),
        ...(requestData !== undefined ? { data: requestData } : {}),
      },
    };

    return {
      error: innovatricsError,
      logPayload,
    };
  }

  private throwInnovatricsError(
    error: any,
    context: { operation: string; stage?: string }
  ): never {
    const normalized = this.normalizeAxiosError(error, context);
    console.error(
      `Innovatrics ${context.operation} error:`,
      normalized.logPayload
    );
    throw normalized.error;
  }

  private isClassificationAdviceError(error: any): boolean {
    const err = error instanceof InnovatricsApiError ? error : undefined;
    const errorCode =
      err?.context.errorCode ?? error?.response?.data?.errorCode;
    const errorMessage =
      err?.context.errorMessage ?? error?.response?.data?.errorMessage ?? '';

    if (errorCode !== 'INVALID_REQUEST_BODY') {
      return false;
    }

    return /advice\.classification/i.test(errorMessage || '');
  }

  async createCustomer(): Promise<CreateCustomerResponse> {
    try {
      console.log('Creating customer in Innovatrics');
      console.log('Using base URL:', config.innovatrics.baseUrl);
      console.log('Bearer token configured:', !!config.innovatrics.bearerToken);

      const response = await this.client.post('/customers');
      console.log('Customer creation successful:', response.data);
      return response.data;
    } catch (error: any) {
      this.throwInnovatricsError(error, { operation: 'create customer' });
    }
  }

  private buildImagePayload(image: InnovatricsImagePayload) {
    if (typeof image === 'string') {
      return {
        data: this.normalizeBase64Image(image),
      };
    }

    return image;
  }

  async storeCustomer(
    customerId: string,
    payload: CustomerStoreRequest
  ): Promise<void> {
    try {
      await this.client.post(`/customers/${customerId}/store`, payload);
    } catch (error: any) {
      this.throwInnovatricsError(error, {
        operation: 'store customer',
      });
    }
  }

  async updateCustomerOnboardingStatus(
    customerId: string,
    status: 'IN_PROGRESS' | 'FINISHED',
    externalId?: string
  ): Promise<void> {
    return this.storeCustomer(customerId, {
      onboardingStatus: status,
      ...(externalId ? { externalId } : {}),
    });
  }

  // Face Biometrics
  async detectFace(
    imageData: InnovatricsImagePayload
  ): Promise<CreateFaceResponse> {
    try {
      const response = await this.client.post('/faces', {
        image: this.buildImagePayload(imageData),
      });
      return response.data;
    } catch (error: any) {
      throw new Error(
        `Failed to detect face: ${error.response?.data?.message || error.message}`
      );
    }
  }

  async compareFaces(
    probeFaceId: string,
    referenceData: { referenceFace?: string; referenceFaceTemplate?: string }
  ): Promise<FaceSimilarityResponse> {
    try {
      const response = await this.client.post(
        `/faces/${probeFaceId}/similarity`,
        referenceData
      );
      return response.data;
    } catch (error: any) {
      throw new Error(
        `Failed to compare faces: ${error.response?.data?.message || error.message}`
      );
    }
  }

  async getFaceTemplate(
    faceId: string
  ): Promise<{ data: string; version: string }> {
    try {
      const response = await this.client.get(`/faces/${faceId}/face-template`);
      return response.data;
    } catch (error: any) {
      throw new Error(
        `Failed to get face template: ${error.response?.data?.message || error.message}`
      );
    }
  }

  async checkFaceMask(faceId: string): Promise<{ score: number }> {
    try {
      const response = await this.client.get(`/faces/${faceId}/face-mask`);
      return response.data;
    } catch (error: any) {
      throw new Error(
        `Failed to check face mask: ${error.response?.data?.message || error.message}`
      );
    }
  }

  // Customer Inspection - compares document portrait with selfie
  async inspectCustomer(customerId: string): Promise<any> {
    try {
      const response = await this.client.post(
        `/customers/${customerId}/inspect`
      );
      return response.data;
    } catch (error: any) {
      throw new Error(
        `Failed to inspect customer: ${error.response?.data?.message || error.message}`
      );
    }
  }

  // Re-inspect document after selfie upload to get face comparison
  async reinspectDocument(customerId: string): Promise<any> {
    try {
      const response = await this.client.post(
        `/customers/${customerId}/document/inspect`
      );
      return response.data;
    } catch (error: any) {
      this.throwInnovatricsError(error, {
        operation: 'reinspect document',
      });
    }
  }

  // Get document portrait image
  async getDocumentPortrait(customerId: string): Promise<any> {
    try {
      const response = await this.client.get(
        `/customers/${customerId}/document/portrait`
      );
      return response.data;
    } catch (error: any) {
      this.throwInnovatricsError(error, {
        operation: 'get document portrait',
      });
    }
  }

  // Liveness Detection
  async createLivenessChallenge(
    customerId: string,
    challengeRequest?: CreateLivenessRequest
  ): Promise<LivenessChallengeResponse> {
    try {
      // Map challengeType to type for Innovatrics API compatibility
      const payload: any = {};
      if (challengeRequest) {
        if (challengeRequest.type) {
          payload.type = challengeRequest.type;
        }
        if (
          challengeRequest.options &&
          Object.keys(challengeRequest.options).length > 0
        ) {
          payload.options = challengeRequest.options;
        }
      }

      console.log(
        'DEBUG: Liveness challenge payload:',
        JSON.stringify(payload)
      );

      const response = await this.client.put(
        `/customers/${customerId}/liveness/records/challenge`,
        payload
      );
      return response.data;
    } catch (error: any) {
      throw new Error(
        `Failed to create liveness challenge: ${error.response?.data?.message || error.message}`
      );
    }
  }

  async ensureLivenessRecord(customerId: string): Promise<void> {
    try {
      await this.client.put(`/customers/${customerId}/liveness`);
      console.log('Liveness record initialized for customer:', customerId);
    } catch (error: any) {
      this.throwInnovatricsError(error, {
        operation: 'initialize liveness record',
      });
    }
  }

  async uploadAdditionalSelfieLiveness(
    customerId: string,
    selfieData: InnovatricsImagePayload,
    assertion: string = 'PASSIVE_LIVENESS'
  ): Promise<void> {
    try {
      await this.client.post(`/customers/${customerId}/liveness/selfies`, {
        image: this.buildImagePayload(selfieData),
        assertion: assertion, // Required: type of liveness check
      });
      console.log('Additional liveness selfie uploaded for customer:', customerId);
    } catch (error: any) {
      this.throwInnovatricsError(error, {
        operation: 'upload additional liveness selfie',
      });
    }
  }

  async submitLivenessData(
    customerId: string,
    livenessData: {
      image: string;
      challengeId?: string;
      options?: LivenessCheckOptions;
    }
  ): Promise<{
    confidence: number;
    status: string;
    isDeepfake?: boolean;
    deepfakeConfidence?: number;
  }> {
    try {
      const response = await this.client.put(
        `/customers/${customerId}/liveness`,
        {
          image: livenessData.image,
          challengeId: livenessData.challengeId,
          options: livenessData.options || {},
        }
      );
      return response.data;
    } catch (error: any) {
      this.throwInnovatricsError(error, {
        operation: 'submit liveness data',
      });
    }
  }

  /**
   * Evaluate passive liveness (backend-only, no interactive challenge)
   * @param customerId - The customer ID
   * @param options - Liveness check options
   * @returns Liveness check results
   */
  async evaluateLiveness(
    customerId: string,
    options: {
      deepfakeCheck?: boolean;
      additionalSelfies?: InnovatricsImagePayload[];
    } = {}
  ): Promise<{
    confidence: number;
    status: 'live' | 'not_live' | 'suspicious';
    isDeepfake?: boolean;
    deepfakeConfidence?: number;
  }> {
    try {
      // Ensure liveness record exists
      await this.ensureLivenessRecord(customerId);

      // Upload any additional selfie frames for better liveness detection
      if (options.additionalSelfies && options.additionalSelfies.length > 0) {
        for (const selfie of options.additionalSelfies) {
          await this.uploadAdditionalSelfieLiveness(customerId, selfie);
        }
      }

      // Use passive evaluation endpoint (backend-only, no interactive challenge)
      const payload: any = {
        type: 'PASSIVE_LIVENESS',
      };

      console.log(
        'DEBUG: Passive liveness evaluation payload:',
        JSON.stringify(payload)
      );

      const response = await this.client.post(
        `/customers/${customerId}/liveness/evaluation`,
        payload
      );

      const result = response.data;
      console.log(
        'Passive liveness raw response:',
        JSON.stringify(result, null, 2)
      );

      // Check for errors in response
      if (result.errorCode) {
        console.warn('⚠️  Passive liveness returned error:', result.errorCode);
        if (result.errorCode === 'NOT_ENOUGH_DATA') {
          console.warn('   This usually means:');
          console.warn('   - Selfie image quality is too low');
          console.warn('   - Face not clearly visible');
          console.warn(
            '   - Image too small (recommend 1800px+ with clear face)'
          );
          console.warn(
            '   - Consider uploading additional selfie frames via additionalSelfies option'
          );
        }
        // Return default values when not enough data
        return {
          confidence: 0,
          status: 'not_live' as const,
        };
      }

      // If deepfake check requested, use extended evaluation
      if (options.deepfakeCheck) {
        const extendedPayload = {
          type: 'DEEPFAKE',
          livenessResources: ['PASSIVE'],
        };

        console.log(
          'DEBUG: Extended deepfake evaluation payload:',
          JSON.stringify(extendedPayload)
        );

        const extendedResponse = await this.client.post(
          `/customers/${customerId}/liveness/evaluation/extended`,
          extendedPayload
        );

        const extendedResult = extendedResponse.data;
        console.log(
          'Deepfake raw response:',
          JSON.stringify(extendedResult, null, 2)
        );

        return {
          confidence: result.confidence || 0,
          status: result.status as 'live' | 'not_live' | 'suspicious',
          isDeepfake: extendedResult.isDeepfake,
          deepfakeConfidence: extendedResult.confidence,
        };
      }

      return {
        confidence: result.confidence || 0,
        status: result.status as 'live' | 'not_live' | 'suspicious',
      };
    } catch (error: any) {
      this.throwInnovatricsError(error, {
        operation: 'evaluate liveness',
      });
    }
  }

  async deleteLivenessData(customerId: string): Promise<void> {
    try {
      await this.client.delete(`/api/v1/customers/${customerId}/liveness`);
    } catch (error: any) {
      this.throwInnovatricsError(error, {
        operation: 'delete liveness data',
      });
    }
  }

  // Document Verification
  async verifyDocument(
    request: DocumentVerificationRequest
  ): Promise<DocumentVerificationResult> {
    const { customerId, frontImage, backImage, documentType, issuingCountry } =
      request;

    const frontImagePayload = this.buildImagePayload(frontImage);
    const backImagePayload = backImage
      ? this.buildImagePayload(backImage)
      : undefined;

    try {
      const classificationAdvice: Record<string, any> = {};
      const classificationWarnings: string[] = [];
      let shouldSendAdvice = false;

      const normalizedDocumentType =
        this.normalizeDocumentTypeForAdvice(documentType);
      const normalizedCountry = this.normalizeCountryForAdvice(issuingCountry);

      if (normalizedDocumentType === 'PASSPORT') {
        classificationAdvice.types = [normalizedDocumentType];
        if (normalizedCountry) {
          classificationAdvice.countries = [normalizedCountry];
        }
        shouldSendAdvice = true;
      } else if (normalizedDocumentType) {
        if (normalizedCountry) {
          classificationAdvice.types = [normalizedDocumentType];
          classificationAdvice.countries = [normalizedCountry];
          shouldSendAdvice = true;
        } else {
          classificationWarnings.push(
            `Issuing country is required when documentType "${documentType}" is provided`
          );
        }
      } else if (documentType) {
        classificationWarnings.push(
          `Unsupported documentType "${documentType}"`
        );
      }

      if (
        !shouldSendAdvice &&
        normalizedCountry &&
        !classificationAdvice.countries
      ) {
        classificationAdvice.countries = [normalizedCountry];
        shouldSendAdvice = true;
      } else if (!shouldSendAdvice && issuingCountry) {
        classificationWarnings.push(
          `Unsupported issuingCountry "${issuingCountry}"`
        );
      }

      const baseDocumentPayload = {
        sources: ['VIZ', 'MRZ', 'DOCUMENT_PORTRAIT'],
      } as const;

      let advicePayload: { classification: Record<string, any> } | undefined;
      if (shouldSendAdvice && Object.keys(classificationAdvice).length > 0) {
        console.log(
          'Innovatrics document classification advice:',
          classificationAdvice
        );
        advicePayload = {
          classification: classificationAdvice,
        };
      } else {
        console.warn(
          'No Innovatrics classification advice will be sent (fallback to auto-detect).',
          {
            documentType,
            issuingCountry,
            warnings: classificationWarnings,
          }
        );
      }

      if (classificationWarnings.length > 0) {
        console.warn('Innovatrics classification warnings:', {
          warnings: classificationWarnings,
          documentType,
          issuingCountry,
        });
      }

      const documentRetryOptions = {
        shouldRetry: (error: any) => this.isRetryableError(error),
        ...(request.onRetry
          ? {
              onRetry: ({
                attempt,
                delayMs,
                error,
              }: {
                attempt: number;
                delayMs: number;
                error: any;
              }) => {
                request.onRetry?.({
                  stage: 'create_document',
                  attempt,
                  delayMs,
                  error,
                });
              },
            }
          : {}),
      } satisfies RetryOptions;

      const createDocumentWithAdvice = async (payloadAdvice?: {
        classification: Record<string, any>;
      }) => {
        const payload = payloadAdvice
          ? {
              ...baseDocumentPayload,
              advice: payloadAdvice,
            }
          : {
              ...baseDocumentPayload,
            };

        return withRetry(
          () => this.client.put(`/customers/${customerId}/document`, payload),
          documentRetryOptions
        );
      };

      let documentResponse;
      try {
        documentResponse = await createDocumentWithAdvice(advicePayload);
      } catch (error) {
        if (advicePayload && this.isClassificationAdviceError(error)) {
          console.warn(
            'Innovatrics rejected document classification advice, retrying without advice.',
            {
              documentType,
              issuingCountry,
              advicePayload,
              error:
                error instanceof InnovatricsApiError
                  ? error.serialize()
                  : error,
            }
          );
          documentResponse = await createDocumentWithAdvice(undefined);
        } else {
          throw error;
        }
      }

      const pages: DocumentPageResult[] = [];

      const frontPageRetryOptions = {
        shouldRetry: (error: any) => this.isRetryableError(error),
        ...(request.onRetry
          ? {
              onRetry: ({
                attempt,
                delayMs,
                error,
              }: {
                attempt: number;
                delayMs: number;
                error: any;
              }) => {
                request.onRetry?.({
                  stage: 'upload_page_front',
                  attempt,
                  delayMs,
                  error,
                });
              },
            }
          : {}),
      } satisfies RetryOptions;

      const frontPageResponse = await withRetry(
        () =>
          this.client.put(`/customers/${customerId}/document/pages`, {
            image: frontImagePayload,
            advice: {
              classification: {
                pageTypes: ['front'],
              },
            },
          }),
        frontPageRetryOptions
      );
      pages.push(frontPageResponse.data);

      if (backImage) {
        const backPageRetryOptions = {
          shouldRetry: (error: any) => this.isRetryableError(error),
          ...(request.onRetry
            ? {
                onRetry: ({
                  attempt,
                  delayMs,
                  error,
                }: {
                  attempt: number;
                  delayMs: number;
                  error: any;
                }) => {
                  request.onRetry?.({
                    stage: 'upload_page_back',
                    attempt,
                    delayMs,
                    error,
                  });
                },
              }
            : {}),
        } satisfies RetryOptions;

        const backPageResponse = await withRetry(
          () =>
            this.client.put(`/customers/${customerId}/document/pages`, {
              image: backImagePayload,
              advice: {
                classification: {
                  pageTypes: ['back'],
                },
              },
            }),
          backPageRetryOptions
        );
        pages.push(backPageResponse.data);
      }

      const inspectRetryOptions = {
        shouldRetry: (error: any) => this.isRetryableError(error),
        ...(request.onRetry
          ? {
              onRetry: ({
                attempt,
                delayMs,
                error,
              }: {
                attempt: number;
                delayMs: number;
                error: any;
              }) => {
                request.onRetry?.({
                  stage: 'inspect_document',
                  attempt,
                  delayMs,
                  error,
                });
              },
            }
          : {}),
      } satisfies RetryOptions;

      const inspectionResponse = await withRetry(
        () => this.client.post(`/customers/${customerId}/document/inspect`),
        inspectRetryOptions
      );

      let disclosedInspection: any | undefined;
      try {
        const discloseRetryOptions = {
          shouldRetry: (error: any) => this.isRetryableError(error),
          ...(request.onRetry
            ? {
                onRetry: ({
                  attempt,
                  delayMs,
                  error,
                }: {
                  attempt: number;
                  delayMs: number;
                  error: any;
                }) => {
                  request.onRetry?.({
                    stage: 'disclose_inspection',
                    attempt,
                    delayMs,
                    error,
                  });
                },
              }
            : {}),
        } satisfies RetryOptions;

        const disclosedResponse = await withRetry(
          () =>
            this.client.post(
              `/customers/${customerId}/document/inspect/disclose`
            ),
          discloseRetryOptions
        );
        disclosedInspection = disclosedResponse.data;
      } catch (discloseError: any) {
        console.warn('Document inspection disclosure failed:', {
          status: discloseError.response?.status,
          message: discloseError.message,
        });
      }

      const frontPage =
        pages.find(page => page.pageType === 'front') ?? pages[0];
      const collectedWarnings = pages.flatMap(page => page.warnings ?? []);
      const collectedErrors = pages
        .map(page => page.errorCode)
        .filter((code): code is string => Boolean(code));

      const summary: DocumentVerificationSummary = {
        ...(frontPage?.documentType?.type
          ? { documentType: frontPage.documentType.type }
          : {}),
        ...(frontPage?.documentType?.issuingCountry
          ? { issuingCountry: frontPage.documentType.issuingCountry }
          : {}),
        ...(collectedWarnings.length
          ? { warnings: Array.from(new Set(collectedWarnings)) }
          : {}),
        ...(collectedErrors.length
          ? { errors: Array.from(new Set(collectedErrors)) }
          : {}),
      };

      return {
        document: documentResponse.data,
        summary,
        pages,
        inspection: inspectionResponse.data,
        disclosedInspection,
      };
    } catch (error: any) {
      this.throwInnovatricsError(error, {
        operation: 'process document',
      });
    }
  }

  // Selfie Management (Customer-scoped)
  async uploadSelfie(
    customerId: string,
    selfieData: InnovatricsImagePayload
  ): Promise<{ id: string }> {
    try {
      const response = await this.client.put(
        `/customers/${customerId}/selfie`,
        {
          image: this.buildImagePayload(selfieData),
        }
      );
      return response.data;
    } catch (error: any) {
      this.throwInnovatricsError(error, {
        operation: 'upload selfie',
      });
    }
  }

  async getSelfie(customerId: string): Promise<{ image: string }> {
    try {
      const response = await this.client.get(
        `/api/v1/customers/${customerId}/selfie`
      );
      return response.data;
    } catch (error: any) {
      this.throwInnovatricsError(error, {
        operation: 'get selfie',
      });
    }
  }

  async deleteSelfie(customerId: string): Promise<void> {
    try {
      await this.client.delete(`/api/v1/customers/${customerId}/selfie`);
    } catch (error: any) {
      this.throwInnovatricsError(error, {
        operation: 'delete selfie',
      });
    }
  }

  // Utility method for binary uploads (for images)
  async uploadBinaryImage(
    customerId: string,
    imageBuffer: Buffer,
    endpoint: string
  ): Promise<any> {
    try {
      const response = await this.client.put(endpoint, imageBuffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
        },
      });
      return response.data;
    } catch (error: any) {
      this.throwInnovatricsError(error, {
        operation: 'upload binary image',
      });
    }
  }

  private normalizeBase64Image(image: string): string {
    if (!image) {
      return image;
    }

    const commaIndex = image.indexOf(',');
    const base64Data = commaIndex >= 0 ? image.slice(commaIndex + 1) : image;
    return base64Data.trim();
  }

  private isRetryableError(error: any): boolean {
    const status = error?.response?.status;
    if (!status) {
      return true;
    }

    if (status >= 500 || status === 429) {
      return true;
    }

    return false;
  }
}
