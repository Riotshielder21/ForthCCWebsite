# JustGo sync/upload image for Cloud Run Jobs. The job's --args choose the script (justgo-sync.py or justgo-upload.py).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY justgo_api.py justgo-sync.py justgo-upload.py justgo-admin.py ./

USER nobody
ENTRYPOINT ["python"]
