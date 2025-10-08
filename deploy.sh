#!/bin/bash
# deploy.sh en Sistema_cursos_Backend_v1-main/

echo "🚀 Iniciando despliegue..."

# Verificar que .env existe
if [ ! -f .env ]; then
    echo "❌ Error: Archivo .env no encontrado"
    exit 1
fi

echo "✅ .env encontrado"

# Crear directorio ssl si no existe
mkdir -p ssl

# Deploy con Docker
docker-compose down
docker-compose up -d --build

echo "✅ Despliegue completado"
echo "🌐 URL: https://moviesplus.xyz"
echo "📊 Verificar servicios: docker-compose ps"
echo "📝 Ver logs: docker-compose logs -f"