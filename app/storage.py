import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
import uuid
from typing import Optional, List
import logging
from io import BytesIO
from PIL import Image

from app.config import settings

logger = logging.getLogger(__name__)


class StorageClient:
    def __init__(self, endpoint: str, access_key: str, secret_key: str, bucket: str, region: str = "us-east-1"):
        self.s3 = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
            config=Config(signature_version="s3v4")
        )
        self.bucket = bucket
        self.endpoint = endpoint
        self._verified_buckets: set = set()

    def ensure_bucket_exists(self, bucket_name: Optional[str] = None):
        target_bucket = bucket_name or self.bucket
        try:
            self.s3.head_bucket(Bucket=target_bucket)
        except ClientError:
            try:
                self.s3.create_bucket(Bucket=target_bucket)
                logger.info(f"Created bucket: {target_bucket}")
            except ClientError as e:
                logger.error(f"Could not create bucket {target_bucket}: {e}")
                raise
        
        # AUD-02: Private training buckets must NEVER have public-read bucket policies
        PRIVATE_BUCKETS = {"nebula-datasets", "nebula-checkpoints", "nebula-models"}
        if target_bucket not in PRIVATE_BUCKETS:
            # Only set public read policy for explicitly public buckets (e.g. nebula-renders)
            try:
                import json
                policy = json.dumps({
                    "Version": "2012-10-17",
                    "Statement": [{
                        "Sid": "PublicReadGetObject",
                        "Effect": "Allow",
                        "Principal": "*",
                        "Action": ["s3:GetObject"],
                        "Resource": [f"arn:aws:s3:::{target_bucket}/*"]
                    }]
                })
                self.s3.put_bucket_policy(Bucket=target_bucket, Policy=policy)
            except Exception as e:
                logger.warning(f"Could not set public bucket policy on {target_bucket}: {e}")
        else:
            # Ensure any existing public read policy on private buckets is removed
            try:
                self.s3.delete_bucket_policy(Bucket=target_bucket)
            except Exception:
                pass
        self._verified_buckets.add(target_bucket)

    def ensure_all_enterprise_buckets_exist(self) -> List[str]:
        """Ensure all enterprise platform buckets exist in MinIO"""
        buckets = list(dict.fromkeys([
            self.bucket,
            "nebula-renders",          # Image & render task outputs
            "nebula-datasets",         # Customer fine-tuning datasets
            "nebula-checkpoints",      # LoRA and model checkpoints (.safetensors)
            "nebula-models",           # Foundation model weight cache
        ]))
        created = []
        for b in buckets:
            self.ensure_bucket_exists(b)
            created.append(b)
        return created

    def upload_bytes(
        self,
        bucket: str,
        object_name: str,
        data: bytes,
        content_type: str = "application/octet-stream"
    ) -> str:
        """Upload raw bytes to a specific bucket"""
        try:
            if bucket not in self._verified_buckets:
                self.ensure_bucket_exists(bucket)
            self.s3.put_object(
                Bucket=bucket,
                Key=object_name,
                Body=data,
                ContentType=content_type
            )
            url = f"{self.endpoint}/{bucket}/{object_name}"
            return url
        except ClientError as e:
            logger.error(f"Failed to upload bytes to {bucket}/{object_name}: {e}")
            raise

    def upload_image(self, image: Image.Image, object_name: str, format: str = "PNG") -> str:
        """Upload a PIL Image directly to MinIO"""
        buffer = BytesIO()
        image.save(buffer, format=format)
        buffer.seek(0)
        return self.upload_bytes(
            bucket=self.bucket,
            object_name=object_name,
            data=buffer.getvalue(),
            content_type=f"image/{format.lower()}"
        )

    def download_bytes(self, bucket: str, object_name: str) -> bytes:
        """Download raw bytes from a specific bucket"""
        try:
            resp = self.s3.get_object(Bucket=bucket, Key=object_name)
            return resp["Body"].read()
        except ClientError as e:
            logger.error(f"Failed to download bytes from {bucket}/{object_name}: {e}")
            raise

    def get_presigned_url(self, object_name: str, bucket_name: Optional[str] = None, expires_in: int = 3600) -> str:
        target_bucket = bucket_name or self.bucket
        try:
            url = self.s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": target_bucket, "Key": object_name},
                ExpiresIn=expires_in
            )
            return url
        except ClientError as e:
            logger.error(f"Presigned URL generation failed: {e}")
            raise

    def get_presigned_upload_url(self, object_name: str, bucket_name: Optional[str] = None, expires_in: int = 3600) -> str:
        """Generate presigned PUT URL for customer uploads"""
        target_bucket = bucket_name or "nebula-datasets"
        try:
            url = self.s3.generate_presigned_url(
                "put_object",
                Params={"Bucket": target_bucket, "Key": object_name},
                ExpiresIn=expires_in
            )
            return url
        except ClientError as e:
            logger.error(f"Presigned upload URL generation failed: {e}")
            raise


_storage = None


def get_storage() -> StorageClient:
    global _storage
    if _storage is None:
        _storage = StorageClient(
            endpoint=settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            bucket=settings.MINIO_BUCKET,
            region=settings.MINIO_REGION
        )
    return _storage


# Global singleton access
storage = get_storage()


def upload_image_to_minio(image: Image.Image, object_name: str) -> str:
    """Convenience function to upload PIL Image to MinIO."""
    return storage.upload_image(image, object_name)
