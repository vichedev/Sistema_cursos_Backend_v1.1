# Dockerfile corregido
FROM node:18-alpine

# Instalar dependencias necesarias para crypto
RUN apk add --no-cache openssl

# Crear usuario no-root
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nestjs -u 1001

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

# Crear directorios necesarios y asignar permisos
RUN mkdir -p uploads public && \
    chown -R nestjs:nodejs /app

# Cambiar al usuario no-root
USER nestjs

# Exponer puerto
EXPOSE 3001

# Comando de inicio
CMD ["npm", "run", "start:prod"]