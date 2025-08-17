# Vercel Serverless entrypoint: re-use existing Flask app
# This file exposes `app` so that @vercel/python can detect the WSGI application.

from server import app  # noqa: F401
