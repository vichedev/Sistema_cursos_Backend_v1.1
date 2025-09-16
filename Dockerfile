# Stage 1: Build
FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Production image
FROM node:18-alpine

WORKDIR /app

COPY --from=builder /app/package*.json ./
RUN npm install --production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/uploads ./uploads

# Asegurar permisos correctos para uploads (usuario node)
RUN chown -R node:node /app/uploads

USER node

EXPOSE 3001

CMD ["node", "dist/main.js"]
