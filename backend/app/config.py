from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""
    SUPABASE_SERVICE_KEY: str = ""
    DATABASE_URL: str = ""

    ANTHROPIC_API_KEY: str = ""
    GOOGLE_API_KEY: str = ""
    XAI_API_KEY: str = ""

    ENTRA_TENANT_ID: str = ""
    ENTRA_CLIENT_ID: str = ""
    ENTRA_CLIENT_SECRET: str = ""
    ENTRA_AUTHORITY: str = ""

    JWT_SECRET: str = "dev-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60

    CORS_ORIGINS: str = "http://localhost:5173"
    SUPABASE_STORAGE_BUCKET: str = "documents"


settings = Settings()

GENERATION_CONFIG: dict[str, dict] = {
    "easy":   {"temperature": 0.3, "top_p": 0.85, "top_k_rag": 3},
    "medium": {"temperature": 0.5, "top_p": 0.90, "top_k_rag": 5},
    "hard":   {"temperature": 0.7, "top_p": 0.95, "top_k_rag": 7},
    "mixed":  {"temperature": 0.5, "top_p": 0.90, "top_k_rag": 5},
}

EVALUATION_CONFIG: dict = {
    "temperature": 0.1,
    "top_p": 0.80,
}

HALLUCINATION_CONFIG: dict = {
    "temperature": 0.0,
    "top_p": 0.75,
}

EXPECTED_TIME_SECONDS: dict[tuple[str, str], int] = {
    ("mcq", "easy"):          45,
    ("mcq", "medium"):        45,
    ("mcq", "hard"):          45,
    ("short_answer", "easy"): 90,
    ("short_answer", "medium"): 120,
    ("short_answer", "hard"):  180,
    ("long_answer", "easy"):   240,
    ("long_answer", "medium"): 360,
    ("long_answer", "hard"):   480,
}

HAIKU_MODEL = "claude-haiku-4-5-20251001"
SONNET_MODEL = "claude-sonnet-4-6"
GROK_MODEL = "grok-2-latest"
EMBEDDING_MODEL = "models/text-embedding-004"
EMBEDDING_DIMENSIONS = 768

CHUNK_TARGET_TOKENS = 900
CHUNK_OVERLAP_TOKENS = 175
