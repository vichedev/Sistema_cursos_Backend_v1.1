FROM node:20-alpine

# Instalar tzdata y configurar zona horaria
RUN apk add --no-cache tzdata
ENV TZ=America/Guayaquil

# ✅ NUEVO: dependencias de Chromium para Puppeteer en Alpine
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto \
    font-noto-emoji \
    fontconfig

# ✅ NUEVO: decirle a Puppeteer que use el Chromium del sistema (no descargar el suyo)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Usar UID 1001 y GID 1001 
ARG USER_ID=1001
ARG GROUP_ID=1001

# Crear usuario con IDs que no existen
RUN addgroup -g $GROUP_ID -S nodejs && \
    adduser -S nestjs -u $USER_ID -G nodejs

# Crear directorio de la app
WORKDIR /app

# Copiar archivos de configuración
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./

# Instalar dependencias
RUN npm ci

# Copiar código fuente
COPY . .

# Compilar la aplicación
RUN npm run build

# Crear directorios necesarios
RUN mkdir -p uploads public

# Cambiar al usuario no-root
USER nestjs

# Exponer puerto
EXPOSE 3001

# Comando de inicio
CMD ["npm", "run", "start:prod"]