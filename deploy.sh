#!/bin/bash
# deploy.sh - Sistema de Cursos MAAT - Panel de Control

# Colores para el menú
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuración
ENV_FILE=".env"
CONFIGURED_FILE=".system-configured"

# Función para mostrar header
show_header() {
    clear
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════╗"
    echo "║           SISTEMA DE CURSOS MAAT             ║"
    echo "║              Panel de Control                ║"
    echo "╚══════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Función para verificar si el sistema está configurado
is_system_configured() {
    [ -f "$CONFIGURED_FILE" ]
}

# Función para gestión del .env
setup_environment() {
    if ! is_system_configured; then
        echo -e "${YELLOW}🚀 CONFIGURACIÓN INICIAL DETECTADA${NC}"
        
        if [ ! -f "$ENV_FILE" ]; then
            echo -e "${RED}❌ Error: Archivo $ENV_FILE no encontrado${NC}"
            echo "Para la primera ejecución necesitas:"
            echo "1. Crear un archivo $ENV_FILE con la configuración"
            echo "2. Ejecutar el deploy nuevamente"
            exit 1
        fi
        
        echo -e "${GREEN}✅ $ENV_FILE encontrado - Configurando sistema...${NC}"
        
        # Marcar sistema como configurado
        touch "$CONFIGURED_FILE"
        
        # Construir con la configuración inicial (EL .env ESTÁ DISPONIBLE)
        echo -e "${YELLOW}🐳 Construyendo servicios con configuración inicial...${NC}"
        docker compose build --build-arg USER_ID=1001 --build-arg GROUP_ID=1001 --no-cache backend
        
        # ✅ CORREGIDO: NO eliminar .env aquí todavía
        # Se eliminará después de verificar que todo funciona
        
    else
        echo -e "${GREEN}✅ Sistema ya configurado - Modo actualización${NC}"
        
        # En modo actualización, asegurarse de que no hay .env
        if [ -f "$ENV_FILE" ]; then
            echo -e "${YELLOW}⚠️  Eliminando $ENV_FILE temporal...${NC}"
            rm "$ENV_FILE"
        fi
    fi
}

# Función para limpiar .env al final (NUEVA FUNCIÓN)
cleanup_environment() {
    if ! is_system_configured; then
        # Solo en primera ejecución, eliminar .env al FINAL
        if [ -f "$ENV_FILE" ]; then
            echo -e "${YELLOW}🗑️  Eliminando $ENV_FILE por seguridad...${NC}"
            rm "$ENV_FILE"
            echo -e "${GREEN}✅ $ENV_FILE eliminado - Sistema seguro${NC}"
        fi
    fi
}

# ✅ FUNCIÓN CORREGIDA - Con pausas y mejor feedback
fix_permissions() {
    echo -e "${YELLOW}🔧 INICIANDO REPARACIÓN DE PERMISOS...${NC}"
    echo "=========================================="
    
    # Pausa inicial para que se vea
    sleep 1
    
    # 1. Permisos en HOST
    echo -e "${YELLOW}📁 Paso 1/3: Configurando permisos en HOST...${NC}"
    mkdir -p uploads public
    sudo chown -R 1001:1001 uploads/ 2>/dev/null || true
    sudo chmod -R 755 uploads/ 2>/dev/null || true
    echo -e "${GREEN}✅ Permisos en HOST configurados${NC}"
    sleep 1
    
    # 2. Verificar que el contenedor está corriendo
    echo -e "${YELLOW}🔍 Paso 2/3: Verificando contenedor...${NC}"
    if ! docker ps | grep -q cursos_backend; then
        echo -e "${RED}❌ ERROR: El contenedor 'cursos_backend' no está corriendo${NC}"
        echo -e "${YELLOW}💡 Inicia los servicios con la opción 4 primero${NC}"
        read -p "Presiona Enter para volver al menú..."
        return 1
    fi
    
    echo -e "${GREEN}✅ Contenedor detectado: cursos_backend${NC}"
    sleep 1
    
    # 3. Permisos en CONTENEDOR
    echo -e "${YELLOW}🐳 Paso 3/3: Configurando permisos en CONTENEDOR...${NC}"
    echo -e "${YELLOW}⏳ Esto puede tomar unos segundos...${NC}"
    
    # Ejecutar comandos con feedback visual
    if docker exec cursos_backend mkdir -p /app/uploads 2>/dev/null; then
        echo -e "${GREEN}✅ Carpeta /app/uploads creada${NC}"
    else
        echo -e "${RED}❌ Error creando carpeta${NC}"
    fi
    sleep 1
    
    if docker exec cursos_backend chown -R node:node /app/uploads 2>/dev/null; then
        echo -e "${GREEN}✅ Ownership aplicado${NC}"
    else
        echo -e "${RED}❌ Error en ownership${NC}"
    fi
    sleep 1
    
    if docker exec cursos_backend chmod -R 755 /app/uploads 2>/dev/null; then
        echo -e "${GREEN}✅ Permisos aplicados${NC}"
    else
        echo -e "${RED}❌ Error en permisos${NC}"
    fi
    sleep 1
    
    # 4. Verificación final
    echo -e "${YELLOW}🔍 Verificando resultado...${NC}"
    if docker exec cursos_backend touch /app/uploads/test-final-$(date +%s).txt 2>/dev/null; then
        echo -e "${GREEN}🎉 ¡ÉXITO! Permisos configurados correctamente${NC}"
        echo -e "${GREEN}✅ Ya puedes subir imágenes sin problemas${NC}"
    else
        echo -e "${RED}❌ FALLO: No se pudo verificar los permisos${NC}"
        echo -e "${YELLOW}💡 Ejecuta estos comandos manualmente para diagnosticar:${NC}"
        echo "docker exec cursos_backend ls -la /app/uploads/"
        echo "docker exec cursos_backend id"
    fi
    
    echo "=========================================="
    read -p "Presiona Enter para volver al menú..."
}

# Función principal de instalación/actualización
install_or_update_system() {
    show_header
    
    if is_system_configured; then
        echo -e "${BLUE}🔄 ACTUALIZANDO SISTEMA${NC}"
    else
        echo -e "${BLUE}🚀 INSTALANDO SISTEMA${NC}"
    fi
    echo "=========================================="
    
    # Gestión del entorno
    setup_environment
    
    # Corregir permisos
    fix_permissions
    
    # Construir servicios
    if is_system_configured; then
        echo -e "${YELLOW}🐳 Actualizando servicios...${NC}"
        docker compose build --no-cache backend
    else
        echo -e "${YELLOW}🐳 Instalando servicios...${NC}"
        docker compose build --no-cache backend
    fi
    
    # Levantar servicios
    echo -e "${YELLOW}🐳 Levantando servicios...${NC}"
    docker compose up -d
    
    echo -e "${YELLOW}⏳ Esperando que los servicios estén listos...${NC}"
    sleep 15
    
    # Verificación
    echo -e "${YELLOW}🔍 Verificando despliegue...${NC}"
    docker compose ps
    
    # Prueba final
    echo -e "${YELLOW}🎯 Probando funcionalidades...${NC}"
    if docker exec cursos_backend touch /app/uploads/test-$(date +%s).txt 2>/dev/null; then
        echo -e "${GREEN}✅ Escritura en uploads: OK${NC}"
    else
        echo -e "${RED}❌ Error en escritura${NC}"
    fi
    
    # ✅ CORREGIDO: Limpiar .env al FINAL de todo
    cleanup_environment
    
    echo -e "${GREEN}"
    if is_system_configured; then
        echo "✅ SISTEMA ACTUALIZADO CORRECTAMENTE"
    else
        echo "✅ SISTEMA INSTALADO CORRECTAMENTE"
    fi
    echo "🌐 URL: https://moviesplus.xyz"
    echo "👤 Admin: admin / admin1234"
    echo -e "${NC}"
    
    read -p "Presiona Enter para continuar..."
}


# Función para actualizar desde Git y reinstalar
update_from_git() {
    show_header
    echo -e "${BLUE}📥 ACTUALIZACIÓN DESDE GIT${NC}"
    echo "=========================================="
    
    if ! is_system_configured; then
        echo -e "${RED}❌ Error: Sistema no configurado${NC}"
        echo "Primero debes instalar el sistema con la opción 1"
        read -p "Presiona Enter para continuar..."
        return
    fi
    
    echo -e "${YELLOW}📦 Descargando actualizaciones desde Git...${NC}"
    
    if git pull origin main; then
        echo -e "${GREEN}✅ Código actualizado desde Git${NC}"
        echo -e "${YELLOW}🔄 Reiniciando servicios con los nuevos cambios...${NC}"
        
        # ✅ CORREGIDO: NO usar -v para preservar la BD
        docker compose down                    # ← SIN -v
        docker compose build --no-cache backend
        docker compose up -d
        
        echo -e "${GREEN}✅ Actualización completada${NC}"
    else
        echo -e "${RED}❌ Error al actualizar desde Git${NC}"
    fi
    
    read -p "Presiona Enter para continuar..."
}

# Función para ver estado
show_status() {
    show_header
    echo -e "${GREEN}📊 ESTADO DEL SISTEMA${NC}"
    echo "=========================================="
    
    if is_system_configured; then
        echo -e "${GREEN}✅ Estado: CONFIGURADO${NC}"
    else
        echo -e "${YELLOW}🔄 Estado: SIN CONFIGURAR${NC}"
    fi
    
    echo -e "${YELLOW}🐳 Contenedores:${NC}"
    docker compose ps
    
    echo -e "${YELLOW}🔗 URLs:${NC}"
    echo "🌐 Frontend: https://moviesplus.xyz"
    echo "🔧 Backend API: https://moviesplus.xyz/api"
    
    read -p "Presiona Enter para continuar..."
}

# Función para resetear sistema (solo desarrollo)
reset_system() {
    show_header
    echo -e "${RED}⚠️  RESETEO DEL SISTEMA${NC}"
    echo "=========================================="
    echo "ESTA ACCIÓN ELIMINARÁ TODA LA CONFIGURACIÓN"
    echo "PERO PRESERVARÁ LA BASE DE DATOS"
    echo ""
    echo "Opción destructiva (elimina BD también):"
    echo "  docker compose down -v"
    echo ""
    read -p "¿Estás seguro? (escribe 'reset' para confirmar): " confirmation
    
    if [ "$confirmation" = "reset" ]; then
        echo -e "${YELLOW}🗑️  Eliminando configuración...${NC}"
        # ✅ Preservar BD por defecto
        docker compose down
        rm -f "$CONFIGURED_FILE"
        rm -f "$ENV_FILE"
        sudo rm -rf uploads/*

        echo -e "${GREEN}✅ Sistema reseteado - BD preservada${NC}"
        echo "Ahora necesitarás un archivo .env para reinstalar"
    else
        echo -e "${YELLOW}❌ Reset cancelado${NC}"
    fi
    
    read -p "Presiona Enter para continuar..."
}

# Menú principal
main_menu() {
    while true; do
        show_header
        echo -e "${GREEN}MENÚ PRINCIPAL${NC}"
        echo "=========================================="
        echo "1. 🚀 Instalar/Actualizar Sistema"
        echo "2. 📥 Actualizar desde Git + Reinstalar"
        echo "3. ⏸️  Detener Servicios"
        echo "4. ▶️  Iniciar Servicios" 
        echo "5. 📊 Ver Estado"
        echo "6. 🔧 Corregir Permisos"
        echo "7. 📝 Ver Logs"
        echo "8. 🗑️  Resetear Sistema (cuidado!)"
        echo "9. ❌ Salir"
        echo "=========================================="
        
        read -p "Selecciona una opción (1-9): " choice
        
        case $choice in
            1) install_or_update_system ;;
            2) update_from_git ;;
            3) docker compose stop ;;
            4) docker compose up -d ;;
            5) show_status ;;
            6) fix_permissions ;;
            7) 
                echo -e "${YELLOW}📝 Mostrando logs (Ctrl+C para salir)...${NC}"
                docker compose logs -f 
                ;;
            8) reset_system ;;
            9) 
                echo -e "${GREEN}👋 ¡Hasta pronto!${NC}"
                exit 0
                ;;
            *) 
                echo -e "${RED}❌ Opción inválida${NC}"
                sleep 2
                ;;
        esac
    done
}

# Verificar requisitos
if [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}❌ Error: No se encuentra docker-compose.yml${NC}"
    exit 1
fi

# Iniciar menú principal
main_menu