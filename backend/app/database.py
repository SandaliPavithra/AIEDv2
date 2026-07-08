from supabase import create_client, Client
from app.config import settings

# SUPABASE_URL is configured with a "/rest/v1/" suffix (needed by the custom
# PostgREST client in supabase_rest.py). supabase-py's create_client expects
# the bare project URL and appends its own "/storage/v1/" internally — passing
# the suffixed URL through produces "/rest/v1//storage/v1/", which 404s against
# the wrong subsystem. Strip it here the same way supabase_rest.py does.
_PROJECT_URL = settings.SUPABASE_URL.rstrip("/").replace("/rest/v1", "").rstrip("/")


def get_supabase() -> Client:
    return create_client(_PROJECT_URL, settings.SUPABASE_SERVICE_KEY)
