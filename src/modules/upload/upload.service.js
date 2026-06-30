import cloudinary from "../../config/cloudinary.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../utils/AppError.js";

/**
 * Allowed upload purposes and their Cloudinary folder + allowed formats.
 */
const UPLOAD_CONFIG = {
  profile_picture: {
    folder: "workforcebd/profile_pictures",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{ width: 400, height: 400, crop: "fill", quality: "auto" }],
  },
  nid_front: {
    folder: "workforcebd/kyc_documents",
    allowed_formats: ["jpg", "jpeg", "png", "pdf"],
    transformation: [{ quality: "auto" }],
  },
  nid_back: {
    folder: "workforcebd/kyc_documents",
    allowed_formats: ["jpg", "jpeg", "png", "pdf"],
    transformation: [{ quality: "auto" }],
  },
  selfie: {
    folder: "workforcebd/kyc_documents",
    allowed_formats: ["jpg", "jpeg", "png"],
    transformation: [{ width: 600, height: 600, crop: "fill", quality: "auto" }],
  },
  student_id: {
    folder: "workforcebd/kyc_documents",
    allowed_formats: ["jpg", "jpeg", "png", "pdf"],
    transformation: [{ quality: "auto" }],
  },
  trade_license: {
    folder: "workforcebd/business_documents",
    allowed_formats: ["jpg", "jpeg", "png", "pdf"],
    transformation: [{ quality: "auto" }],
  },
  business_doc: {
    folder: "workforcebd/business_documents",
    allowed_formats: ["jpg", "jpeg", "png", "pdf"],
    transformation: [{ quality: "auto" }],
  },
  business_logo: {
    folder: "workforcebd/business_logos",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{ width: 400, height: 400, crop: "fill", quality: "auto" }],
  },
};

/**
 * Generates a signed upload signature for direct frontend-to-Cloudinary upload.
 * Frontend uses this to upload directly — file never touches our server.
 * @param {string} purpose - one of the keys in UPLOAD_CONFIG
 * @param {string} userId - used to namespace the uploaded file
 * @returns {{ signature: string, timestamp: number, upload_url: string, folder: string, api_key: string, allowed_formats: string[], transformation: object[] }}
 */
export const generateUploadSignature = (purpose, userId) => {
  const config = UPLOAD_CONFIG[purpose];
  if (!config) throw new AppError(`Invalid upload purpose: ${purpose}`, 400);

  const timestamp = Math.round(Date.now() / 1000);
  const publicId = `${config.folder}/${userId}_${purpose}_${timestamp}`;

  const paramsToSign = {
    timestamp,
    public_id: publicId,
    folder: config.folder,
  };

  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    cloudinary.config().api_secret
  );

  logger.info(`Upload presign generated | userId=${userId} purpose=${purpose} publicId=${publicId}`);

  return {
    signature,
    timestamp,
    public_id: publicId,
    folder: config.folder,
    api_key: cloudinary.config().api_key,
    cloud_name: cloudinary.config().cloud_name,
    allowed_formats: config.allowed_formats,
    transformation: config.transformation,
    upload_url: `https://api.cloudinary.com/v1_1/${cloudinary.config().cloud_name}/auto/upload`,
  };
};
