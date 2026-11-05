FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app/apps/api
ARG PIP_INDEX_URL=https://pypi.org/simple
COPY apps/api/requirements.lock.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --index-url "$PIP_INDEX_URL" -r /tmp/requirements.txt && useradd --create-home --uid 10001 interior
COPY apps/api /app/apps/api
COPY packages /app/packages
COPY alembic.ini /app/alembic.ini
COPY scripts /app/scripts
RUN mkdir -p /app/data/assets && chown -R interior:interior /app/data
USER interior
EXPOSE 8000
CMD ["uvicorn", "interior.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
