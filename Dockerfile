FROM node:20-slim

# Instalar tzdata y configurar zona horaria
ENV TZ=America/Guayaquil
RUN apt-get update && apt-get install -y tzdata && \
    ln -fs /usr/share/zoneinfo/America/Guayaquil /etc/localtime && \
    dpkg-reconfigure -f noninteractive tzdata

# Dependencias del sistema que necesita Chromium en Debian
RUN apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    fonts-noto \
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# ✅ Dejar que Puppeteer 24 descargue su propio Chromium compatible
# NO usar PUPPETEER_SKIP_CHROMIUM_DOWNLOAD ni PUPPETEER_EXECUTABLE_PATH
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

# Usar UID 1001 y GID 1001
ARG USER_ID=1001
ARG GROUP_ID=1001

RUN groupadd -g $GROUP_ID nodejs && \
    useradd -u $USER_ID -g nodejs -m -s /bin/sh nestjs

# Crear directorio de la app
WORKDIR /app

# Copiar archivos de configuración
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./

# Instalar dependencias (Puppeteer descargará Chromium aquí)
RUN npm ci

# Dar permisos al usuario nestjs sobre el cache de puppeteer
RUN mkdir -p /app/.cache/puppeteer && chown -R nestjs:nodejs /app/.cache

# Copiar código fuente
COPY . .

# Compilar la aplicación
RUN npm run build

# Crear directorios necesarios y dar permisos
RUN mkdir -p uploads public && chown -R nestjs:nodejs /app

# Cambiar al usuario no-root
USER nestjs

# Exponer puerto
EXPOSE 3001

# Comando de inicio
CMD ["npm", "run", "start:prod"]