import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const bucket = process.env.CLOUDFLARE_R2_BUCKET_RAW;

function assertEnv() {
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Missing R2 environment variables");
  }
}

export function getR2Bucket() {
  assertEnv();
  return bucket!;
}

export function createR2Client() {
  assertEnv();
  const resolvedEndpoint = endpoint!;
  const resolvedAccessKeyId = accessKeyId!;
  const resolvedSecretAccessKey = secretAccessKey!;
  return new S3Client({
    region: "auto",
    endpoint: resolvedEndpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: resolvedAccessKeyId,
      secretAccessKey: resolvedSecretAccessKey,
    },
  });
}

export async function getSignedUploadUrl({
  key,
  contentType,
  expiresInSeconds = 900,
}: {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}) {
  const client = createR2Client();
  const command = new PutObjectCommand({
    Bucket: getR2Bucket(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

export async function getSignedReadUrl({
  key,
  expiresInSeconds = 3600,
}: {
  key: string;
  expiresInSeconds?: number;
}) {
  const client = createR2Client();
  const command = new GetObjectCommand({
    Bucket: getR2Bucket(),
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}
