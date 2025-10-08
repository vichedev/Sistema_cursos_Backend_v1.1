#!/bin/bash
# deploy.sh - Sistema de Cursos MAAT - Menú Interactivo

# Colores para el menú
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Función para verificar .env
check_env() {
    if [ ! -f .env ]; then
        echo -e "${RED}❌ Error: Archivo .env no encontrado${NC}"
        echo "Crea un archivo .env con las variables necesarias"
        exit 1
    fi
    echo -e "${GREEN}✅ Archivo .env verificado${NC}"
}

# Función para corregir permisos
fix_permissions() {
    echo -e "${YELLOW}🔧 Configurando permisos...${NC}"
    
    # Crear directorios necesarios
    mkdir -p uploads public
    
    # Corregir permisos
    echo "📁 Aplicando permisos: sudo chown -R 1001:1001 uploads/"
    sudo chown -R 1001:1001 uploads/ 2>/dev/null || true
    echo "📁 Aplicando permisos: sudo chmod -R 755 uploads/"
    sudo chmod -R 755 uploads/ 2>/dev/null || true
    
    echo -e "${GREEN}✅ Permisos configurados${NC}"
    echo "📋 Estado de permisos:"
    ls -la uploads/ | head -3
}

# Función para instalar/actualizar el sistema
install_system() {
    show_header
    echo -e "${BLUE}🚀 INSTALACIÓN/ACTUALIZACIÓN DEL SISTEMA${NC}"
    echo "=========================================="
    
    check_env
    fix_permissions
    
    echo -e "${YELLOW}🐳 Reconstruyendo servicios...${NC}"
    docker compose build --build-arg USER_ID=1001 --build-arg GROUP_ID=1001 --no-cache backend
    
    echo -e "${YELLOW}🐳 Levantando todos los servicios...${NC}"
    docker compose up -d
    
    echo -e "${YELLOW}⏳ Esperando que los servicios estén listos...${NC}"
    sleep 15
    
    # Verificación
    echo -e "${YELLOW}🔍 Verificando despliegue...${NC}"
    docker compose ps
    
    echo -e "${YELLOW}🎯 Probando funcionalidades...${NC}"
    docker exec cursos_backend touch /app/uploads/test-install-$(date +%s).txt && \
        echo -e "${GREEN}✅ Escritura en uploads: OK${NC}" || \
        echo -e "${RED}❌ Error en escritura${NC}"
    
    echo -e "${GREEN}"
    echo "✅ INSTALACIÓN COMPLETADA"
    echo "🌐 URL: https://moviesplus.xyz"
    echo "👤 Admin: admin / admin1234"
    echo -e "${NC}"
    
    read -p "Presiona Enter para continuar..."
}

# Función para detener servicios (excepto BD)
stop_services() {
    show_header
    echo -e "${YELLOW}🛑 DETENIENDO SERVICIOS (excepto base de datos)${NC}"
    echo "=========================================="
    
    # Detener solo backend y nginx, mantener postgres
    docker compose stop backend nginx
    
    echo -e "${GREEN}✅ Servicios detenidos (PostgreSQL sigue activo)${NC}"
    echo "📊 Estado actual:"
    docker compose ps
    
    read -p "Presiona Enter para continuar..."
}

# Función para iniciar servicios
start_services() {
    show_header
    echo -e "${GREEN}🚀 INICIANDO SERVICIOS${NC}"
    echo "=========================================="
    
    docker compose up -d
    
    echo -e "${GREEN}✅ Servicios iniciados${NC}"
    echo "📊 Estado:"
    docker compose ps
    
    read -p "Presiona Enter para continuar..."
}

# Función para actualizar desde Git
update_from_git() {
    show_header
    echo -e "${BLUE}📥 ACTUALIZACIÓN DESDE GIT${NC}"
    echo "=========================================="
    
    # Guardar cambios locales si existen
    if [ -d .git ]; then
        echo -e "${YELLOW}📦 Actualizando desde repositorio Git...${NC}"
        git pull origin main
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Código actualizado desde Git${NC}"
        else
            echo -e "${RED}❌ Error al actualizar desde Git${NC}"
            read -p "Presiona Enter para continuar..."
            return
        fi
    else
        echo -e "${YELLOW}📦 No es un repositorio Git, continuando...${NC}"
    fi
    
    # Reinstalar con los cambios
    install_system
}

# Función para ver logs
show_logs() {
    show_header
    echo -e "${YELLOW}📝 VISUALIZANDO LOGS${NC}"
    echo "=========================================="
    echo "1. Logs del Backend"
    echo "2. Logs de Nginx" 
    echo "3. Logs de PostgreSQL"
    echo "4. Todos los logs"
    echo "5. Volver al menú principal"
    
    read -p "Selecciona una opción (1-5): " log_choice
    
    case $log_choice in
        1) docker compose logs backend -f ;;
        2) docker compose logs nginx -f ;;
        3) docker compose logs postgres -f ;;
        4) docker compose logs -f ;;
        5) return ;;
        *) echo -e "${RED}Opción inválida${NC}"; sleep 2 ;;
    esac
}

# Función para ver estado
show_status() {
    show_header
    echo -e "${GREEN}📊 ESTADO DEL SISTEMA${NC}"
    echo "=========================================="
    
    echo -e "${YELLOW}🐳 Estado de contenedores:${NC}"
    docker compose ps
    
    echo -e "${YELLOW}📈 Uso de recursos:${NC}"
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}" | head -6
    
    echo -e "${YELLOW}🔗 URLs:${NC}"
    echo "🌐 Frontend: https://moviesplus.xyz"
    echo "🔧 Backend API: https://moviesplus.xyz/api"
    echo "🗄️  Base de datos: localhost:5432"
    
    read -p "Presiona Enter para continuar..."
}

# Función para backup de base de datos
backup_database() {
    show_header
    echo -e "${YELLOW}💾 BACKUP DE BASE DE DATOS${NC}"
    echo "=========================================="
    
    BACKUP_FILE="backup_$(date +%Y%m%d_%H%M%S).sql"
    
    echo "Realizando backup en: $BACKUP_FILE"
    docker exec cursos_postgres pg_dump -U postgres sistema_cursos > $BACKUP_FILE
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Backup completado: $BACKUP_FILE${NC}"
        ls -la $BACKUP_FILE
    else
        echo -e "${RED}❌ Error en el backup${NC}"
    fi
    
    read -p "Presiona Enter para continuar..."
}

# Menú principal
main_menu() {
    while true; do
        show_header
        echo -e "${GREEN}MENÚ PRINCIPAL${NC}"
        echo "=========================================="
        echo "1. 🚀 Instalar/Actualizar Sistema Completo"
        echo "2. 📥 Actualizar desde Git y Reinstalar"
        echo "3. ⏸️  Detener Servicios (excepto BD)"
        echo "4. ▶️  Iniciar Servicios"
        echo "5. 📝 Ver Logs"
        echo "6. 📊 Ver Estado del Sistema"
        echo "7. 💾 Backup Base de Datos"
        echo "8. 🔧 Corregir Permisos"
        echo "9. ❌ Salir"
        echo "=========================================="
        
        read -p "Selecciona una opción (1-9): " choice
        
        case $choice in
            1) install_system ;;
            2) update_from_git ;;
            3) stop_services ;;
            4) start_services ;;
            5) show_logs ;;
            6) show_status ;;
            7) backup_database ;;
            8) fix_permissions ;;
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

# Verificar que estamos en el directorio correcto
if [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}❌ Error: Debes ejecutar este script en el directorio del proyecto${NC}"
    echo "Directorio actual: $(pwd)"
    exit 1
fi

# Iniciar menú principal
main_menu