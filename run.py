"""Convenience runner for the FreightPower AI API."""

import uvicorn

from apps.api.settings import settings


def main():
    uvicorn.run(
        "apps.api.main:app",
        host=settings.APP_HOST,
        port=settings.APP_PORT,
        reload=True,
        # On Windows, watching the whole `apps/` directory can cause the reloader
        # to churn through `apps/venv/` and appear to hang.
        reload_dirs=["apps/api"],
        reload_excludes=[
            "apps/venv/*",
            "apps/venv/**",
            "**/__pycache__/**",
        ],
    )


if __name__ == "__main__":
    main()
