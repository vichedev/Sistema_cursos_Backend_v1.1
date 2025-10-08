FROM node:20-alpine

# Usar el mismo UID que el host (normalmente 1000)
ARG USER_ID=1000
ARG GROUP_ID=1000

# Crear usuario con mismo UID que el host
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