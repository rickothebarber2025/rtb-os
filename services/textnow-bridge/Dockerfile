FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt && \
    python -m pip install --no-cache-dir --no-deps 'git+https://github.com/leogomezz4t/PyTextNow_API.git@d54771ad1e52681a72e180d89db43f1ab975f854'
COPY app.py ./

EXPOSE 8795
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8795"]
