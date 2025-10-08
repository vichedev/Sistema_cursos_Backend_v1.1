#!/bin/bash
# deploy.sh en Sistema_cursos_Backend_v1.1/

echo "🚀 Iniciando despliegue..."

# Verificar que .env existe
if [ ! -f .env ]; then
    echo "❌ Error: Archivo .env no encontrado"
    exit 1
fi

echo "✅ .env encontrado"

# Crear directorios necesarios
mkdir -p uploads public

# Corregir permisos locales
echo "🔧 Configurando permisos..."
sudo chown -R $USER:$USER uploads/
sudo chmod -R 755 uploads/
sudo chmod 755 public/

# Verificar Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker no está instalado"
    exit 1
fi

# Deploy con Docker
echo "🐳 Deteniendo contenedores..."
docker compose down

echo "🐳 Reconstruyendo servicios..."
docker compose build --no-cache

echo "🐳 Levantando servicios..."
docker compose up -d

echo "⏳ Esperando que los servicios estén listos..."
sleep 10

echo "✅ Despliegue completado"
echo "🌐 URL: https://moviesplus.xyz"
echo "📊 Verificar servicios: docker compose ps"
echo "📝 Ver logs: docker compose logs -f"