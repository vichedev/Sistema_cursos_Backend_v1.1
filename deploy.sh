#!/bin/bash
# deploy.sh en Sistema_cursos_Backend_v1.1/

echo "🚀 Iniciando despliegue automático..."

# Verificar que .env existe
if [ ! -f .env ]; then
    echo "❌ Error: Archivo .env no encontrado"
    exit 1
fi

echo "✅ .env encontrado"

# Crear directorios necesarios
mkdir -p uploads public

# 🔧 CORRECCIÓN AUTOMÁTICA DE PERMISOS
echo "🔧 Configurando permisos automáticamente..."

# Parar servicios si están corriendo
echo "🐳 Deteniendo contenedores..."
docker compose down

# Corregir permisos del directorio uploads
echo "📁 Corrigiendo permisos de uploads..."
sudo chown -R 1001:65533 uploads/
sudo chmod -R 755 uploads/

# Verificar permisos
echo "📋 Verificando permisos:"
ls -la uploads/ | head -3

# Verificar Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker no está instalado"
    exit 1
fi

# Reconstruir y levantar servicios
echo "🐳 Reconstruyendo servicios..."
docker compose build --no-cache

echo "🐳 Levantando servicios..."
docker compose up -d

echo "⏳ Esperando que los servicios estén listos..."
sleep 10

# Verificación final
echo "🔍 Verificando despliegue..."
docker compose ps

echo "🎯 Probando escritura en uploads..."
docker exec cursos_backend touch /app/uploads/test-deploy.txt && echo "✅ Escritura OK" || echo "❌ Error en escritura"

echo "✅ Despliegue completado"
echo "🌐 URL: https://moviesplus.xyz"
echo "👤 Admin: admin / admin1234"
echo "📊 Ver servicios: docker compose ps"
echo "📝 Ver logs: docker compose logs -f"