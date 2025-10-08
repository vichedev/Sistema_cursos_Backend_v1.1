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

# 🔧 CORRECCIÓN AUTOMÁTICA DE PERMISOS - ESTO ES LO QUE QUERÍAS
echo "🔧 Configurando permisos automáticamente..."
echo "📁 Aplicando: sudo chown -R 1001:1001 uploads/"
sudo chown -R 1001:1001 uploads/
echo "📁 Aplicando: sudo chmod -R 755 uploads/"
sudo chmod -R 755 uploads/

# Verificar permisos
echo "📋 Verificando permisos:"
ls -la uploads/ | head -3

# Parar servicios si están corriendo
echo "🐳 Deteniendo contenedores..."
docker compose down

# Verificar Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker no está instalado"
    exit 1
fi

# Reconstruir con los parámetros correctos
echo "🐳 Reconstruyendo backend..."
docker compose build --build-arg USER_ID=1001 --build-arg GROUP_ID=1001 --no-cache backend

echo "🐳 Levantando servicios..."
docker compose up -d

echo "⏳ Esperando que los servicios estén listos..."
sleep 10

# Verificación final
echo "🔍 Verificando despliegue..."
docker compose ps

echo "🎯 Probando escritura en uploads..."
docker exec cursos_backend touch /app/uploads/test-deploy-$(date +%s).txt && echo "✅ Escritura OK" || echo "❌ Error en escritura"

echo "✅ Despliegue completado"
echo "🌐 URL: https://moviesplus.xyz"
echo "👤 Admin: admin / admin1234"
echo "📊 Ver servicios: docker compose ps"
echo "📝 Ver logs: docker compose logs -f"