FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render (y la mayoría de PaaS) inyectan $PORT en runtime; uvicorn debe
# escuchar en ese puerto, no en uno fijo.
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}"]
