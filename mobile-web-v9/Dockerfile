FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN cat app.part01 app.part02 app.part03 app.part04 app.part05 > app.py && cat www/index.part01 www/index.part02 www/index.part03 www/index.part04 > www/index.html
ENV PORT=8080
EXPOSE 8080
CMD ["python","app.py"]
