from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://nebula:nebula123@db:5432/nebula_db"
    REDIS_URL: str = "redis://redis:6379/0"
    CELERY_BROKER_URL: str = "redis://redis:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://redis:6379/0"
    APP_NAME: str = "Network Nebula Orchestrator"
    DEBUG: bool = True

    # MinIO Storage
    MINIO_ENDPOINT: str = "http://minio:9000"
    MINIO_ACCESS_KEY: str = "nebula"
    MINIO_SECRET_KEY: str = "nebula123"
    MINIO_BUCKET: str = "nebula-renders"
    MINIO_REGION: str = "us-east-1"

    # Stable Diffusion & Execution Modes
    MODEL_CACHE_DIR: str = "/models/cache"
    SD_MODEL_ID: str = "runwayml/stable-diffusion-v1-5"
    FAST_POC_MODE: bool = True

    class Config:
        env_file = ".env"


settings = Settings()
