FROM python:3.11-slim

WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Set environment variables
ENV API_HOST=0.0.0.0
ENV API_PORT=8000
ENV DATABASE_PATH=/app/drug_database.db

# Expose the API port
EXPOSE 8000

# Run the API server
CMD ["python", "api_server.py"]
