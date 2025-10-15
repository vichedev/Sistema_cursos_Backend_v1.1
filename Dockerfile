FROM node:20-alpine

# Instalar tzdata
RUN apk add --no-cache tzdata
ENV TZ=America/Guayaquil

# Crear usuario y grupo primero
ARG USER_ID=1001
ARG GROUP_ID=1001
RUN addgroup -g $GROUP_ID -S nodejs && \
    adduser -S nestjs -u $USER_ID -G nodejs

# Crear directorio con permisos correctos desde el inicio
RUN mkdir -p /app && chown -R nestjs:nodejs /app
WORKDIR /app

# Copiar archivos con permisos correctos
COPY --chown=nestjs:nodejs package*.json ./
COPY --chown=nestjs:nodejs tsconfig*.json ./
COPY --chown=nestjs:nodejs nest-cli.json ./

# Instalar dependencias como usuario nestjs
USER nestjs
RUN npm ci

# Copiar código fuente
COPY --chown=nestjs:nodejs . .

# Compilar la aplicación
RUN npm run build

# Crear directorios necesarios
RUN mkdir -p uploads public

# Exponer puerto
EXPOSE 3001

# Comando de inicio
CMD ["npm", "run", "start:prod"]