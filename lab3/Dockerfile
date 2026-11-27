FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY gateway.py backend.py .

USER 10001

CMD ["python", "gateway.py"]
