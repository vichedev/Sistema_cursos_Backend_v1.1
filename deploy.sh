#!/bin/bash
# deploy.sh en Sistema_cursos_Backend_v1.1/

echo "🚀 Iniciando despliegue..."

# Verificar que .env existe
if [ ! -f .env ]; then
    echo "❌ Error: Archivo .env no encontrado"
    exit 1
fi

echo "✅ .env encontrado"

# Crear directorio ssl si no existe
mkdir -p ssl

# Verificar si Docker está instalado
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker no está instalado"
    exit 1
fi

# Verificar si docker compose está disponible
if ! docker compose version &> /dev/null; then
    echo "❌ Error: Docker Compose no está disponible"
    exit 1
fi

echo "🐳 Deteniendo contenedores existentes..."
docker compose down

echo "🐳 Construyendo y levantando contenedores..."
docker compose up -d --build

echo "✅ Despliegue completado"
echo "🌐 URL: https://moviesplus.xyz"
echo "📊 Verificar servicios: docker compose ps"
echo "📝 Ver logs: docker compose logs -f"