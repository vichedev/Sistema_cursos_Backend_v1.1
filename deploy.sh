#!/bin/bash
# deploy.sh - Sistema de Cursos MAAT - Panel de Control
# VERSIÓN SEGURA - CON PROTECCIÓN Y RESTAURACIÓN DE BD

# Colores para el menú
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuración
ENV_FILE=".env"
CONFIGURED_FILE=".system-configured"
BACKUP_DIR="backups"
LOCK_FILE=".deploy-lock"

# Función para mostrar header
show_header() {
    clear
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════╗"
    echo "║           SISTEMA DE CURSOS MAAT             ║"
    echo "║              Panel de Control                ║"
    echo "║           🛡️ VERSIÓN SEGURA🛡️             ║"
    echo "╚══════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# ✅ FUNCIÓN MEJORADA: Verificar salud de la base de datos
check_database_health() {
    echo -e "${YELLOW}🔍 Verificando salud de la base de datos...${NC}"
    
    if ! docker ps | grep -q cursos_postgres; then
        echo -e "${RED}❌ PostgreSQL no está corriendo${NC}"
        return 1
    fi
    
    # Verificar que la base de datos existe y es accesible
    if docker exec cursos_postgres psql -U postgres -d sistema_cursos -c "SELECT 1;" &>/dev/null; then
        echo -e "${GREEN}✅ Base de datos 'sistema_cursos' accesible${NC}"
        return 0
    else
        echo -e "${RED}❌ ALERTA: Base de datos 'sistema_cursos' NO encontrada${NC}"
        return 1
    fi
}

# ✅ FUNCIÓN MEJORADA: Crear backup automático con verificación
create_automatic_backup() {
    local context="$1"
    echo -e "${YELLOW}💾 Creando backup automático ($context)...${NC}"
    
    mkdir -p "$BACKUP_DIR"
    local timestamp=$(date +"%Y%m%d_%H%M%S")
    local backup_file="$BACKUP_DIR/auto_backup_${context}_${timestamp}.sql"
    
    if docker exec cursos_postgres pg_dump -U postgres sistema_cursos > "$backup_file" 2>/dev/null; then
        gzip "$backup_file"
        echo -e "${GREEN}✅ Backup automático creado: ${backup_file}.gz${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠️  No se pudo crear backup automático${NC}"
        rm -f "$backup_file"
        return 1
    fi
}

# ✅ FUNCIÓN NUEVA: Crear backup de emergencia OBLIGATORIO
create_emergency_backup() {
    local operation="$1"
    echo -e "${YELLOW}🚨 CREANDO RESPALDO DE EMERGENCIA...${NC}"
    
    mkdir -p "$BACKUP_DIR"
    local backup_file="$BACKUP_DIR/EMERGENCY_${operation}_$(date +"%Y%m%d_%H%M%S").sql"
    
    if ! docker exec cursos_postgres pg_dump -U postgres sistema_cursos > "$backup_file" 2>/dev/null; then
        echo -e "${RED}❌ CRÍTICO: No se pudo crear respaldo de emergencia${NC}"
        echo -e "${RED}🚨 NO CONTINÚES LA OPERACIÓN${NC}"
        return 1
    fi
    
    gzip "$backup_file"
    echo -e "${GREEN}✅ Respaldo de emergencia creado: ${backup_file}.gz${NC}"
    return 0
}

# ✅ FUNCIÓN NUEVA: Restaurar Base de Datos
restore_database() {
    show_header
    echo -e "${PURPLE}🔄 RESTAURAR BASE DE DATOS${NC}"
    echo "=========================================="
    
    # Verificar que hay backups
    if [ ! -d "$BACKUP_DIR" ] || [ -z "$(ls -A $BACKUP_DIR/*.sql.gz 2>/dev/null)" ]; then
        echo -e "${RED}❌ No hay backups disponibles para restaurar${NC}"
        read -p "Presiona Enter para volver al menú..."
        return 1
    fi
    
    # Listar backups disponibles
    echo -e "${CYAN}📋 Backups disponibles:${NC}"
    local backups=($(ls -t $BACKUP_DIR/*.sql.gz))
    local i=1
    for backup in "${backups[@]}"; do
        echo "  $i) $(basename $backup) ($(du -h $backup | cut -f1))"
        ((i++))
    done
    
    echo ""
    read -p "Selecciona el número del backup a restaurar (1-$((i-1))): " backup_choice
    
    # Validar selección
    if [[ ! $backup_choice =~ ^[0-9]+$ ]] || [ $backup_choice -lt 1 ] || [ $backup_choice -ge $i ]; then
        echo -e "${RED}❌ Selección inválida${NC}"
        read -p "Presiona Enter para volver al menú..."
        return 1
    fi
    
    local selected_backup="${backups[$((backup_choice-1))]}"
    
    echo ""
    echo -e "${YELLOW}📦 Backup seleccionado: $(basename $selected_backup)${NC}"
    echo -e "${RED}🚨 ADVERTENCIA: Esta acción SOBREESCRIBIRÁ la base de datos actual${NC}"
    echo -e "${RED}🚨 Todos los datos posteriores al backup se PERDERÁN${NC}"
    echo ""
    read -p "¿Estás ABSOLUTAMENTE seguro? Escribe 'RESTAURAR-BD': " confirmation
    
    if [ "$confirmation" != "RESTAURAR-BD" ]; then
        echo -e "${YELLOW}❌ Restauración cancelada${NC}"
        read -p "Presiona Enter para volver al menú..."
        return 1
    fi
    
    # ✅ CREAR BACKUP DE LA BD ACTUAL (por si acaso)
    echo -e "${YELLOW}💾 Creando backup de la base de datos actual...${NC}"
    local current_backup="$BACKUP_DIR/pre_restore_$(date +"%Y%m%d_%H%M%S").sql"
    docker exec cursos_postgres pg_dump -U postgres sistema_cursos > "$current_backup" 2>/dev/null && gzip "$current_backup"
    echo -e "${GREEN}✅ Backup de seguridad creado${NC}"
    
    # Detener servicios que usan la BD
    echo -e "${YELLOW}⏸️  Deteniendo servicios...${NC}"
    docker compose stop backend
    
    # Restaurar backup
    echo -e "${YELLOW}🔄 Restaurando base de datos...${NC}"
    if gunzip -c "$selected_backup" | docker exec -i cursos_postgres psql -U postgres sistema_cursos; then
        echo -e "${GREEN}✅ Base de datos restaurada exitosamente${NC}"
    else
        echo -e "${RED}❌ Error al restaurar la base de datos${NC}"
        echo -e "${YELLOW}💡 Se creó un backup pre-restauración: $(basename $current_backup).gz${NC}"
    fi
    
    # Reiniciar servicios
    echo -e "${YELLOW}🚀 Reiniciando servicios...${NC}"
    docker compose start backend
    
    # Verificar restauración
    echo -e "${YELLOW}🔍 Verificando restauración...${NC}"
    sleep 5
    if check_database_health; then
        echo -e "${GREEN}🎉 ¡RESTAURACIÓN COMPLETADA EXITOSAMENTE!${NC}"
    else
        echo -e "${RED}⚠️  Advertencia: Verificar estado del sistema después de la restauración${NC}"
    fi
    
    read -p "Presiona Enter para volver al menú..."
}

# ✅ FUNCIÓN MEJORADA: Protección contra eliminación de BD
protect_database() {
    local operation="$1"
    
    echo -e "${PURPLE}🛡️  ACTIVANDO PROTECCIÓN DE BASE DE DATOS${NC}"
    echo "=========================================="
    
    # 1. Verificar que PostgreSQL esté corriendo
    if ! docker ps | grep -q cursos_postgres; then
        echo -e "${RED}❌ CRÍTICO: PostgreSQL no está corriendo${NC}"
        return 1
    fi
    
    # 2. Verificar que la BD existe
    if ! check_database_health; then
        echo -e "${RED}🚨 ALERTA CRÍTICA: Base de datos no accesible${NC}"
        echo -e "${YELLOW}💡 Posibles causas:"
        echo "   - Base de datos eliminada"
        echo "   - Problema de conexión"
        echo "   - Volumen de datos corrupto"
        echo -e "${NC}"
        
        read -p "¿Continuar con $operation? (s/N): " confirm
        if [[ $confirm != "s" && $confirm != "S" ]]; then
            echo -e "${YELLOW}❌ Operación cancelada por protección de BD${NC}"
            return 1
        fi
    fi
    
    # 3. ✅ CREAR BACKUP DE EMERGENCIA OBLIGATORIO
    if ! create_emergency_backup "$operation"; then
        return 1
    fi
    
    echo -e "${GREEN}✅ Protección de base de datos activada${NC}"
    return 0
}

# ✅ FUNCIÓN MEJORADA: Verificación post-operación
verify_operation_success() {
    local operation="$1"
    
    echo -e "${YELLOW}🔍 Verificando resultado de $operation...${NC}"
    sleep 10  # Esperar que los servicios estén listos
    
    if check_database_health; then
        echo -e "${GREEN}✅ $operation completado - Base de datos preservada${NC}"
        return 0
    else
        echo -e "${RED}❌ ALERTA: Base de datos no accesible después de $operation${NC}"
        echo -e "${YELLOW}🚨 ACCIÓN REQUERIDA: Verificar estado del sistema${NC}"
        return 1
    fi
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
        
        # Construir con la configuración inicial
        echo -e "${YELLOW}🐳 Construyendo servicios con configuración inicial...${NC}"
        docker compose build --build-arg USER_ID=1001 --build-arg GROUP_ID=1001 --no-cache backend
        
    else
        echo -e "${GREEN}✅ Sistema ya configurado - Modo actualización${NC}"
        
        # En modo actualización, asegurarse de que no hay .env
        if [ -f "$ENV_FILE" ]; then
            echo -e "${YELLOW}⚠️  Eliminando $ENV_FILE temporal...${NC}"
            rm "$ENV_FILE"
        fi
    fi
}

# Función para limpiar .env al final
cleanup_environment() {
    if ! is_system_configured; then
        if [ -f "$ENV_FILE" ]; then
            echo -e "${YELLOW}🗑️  Eliminando $ENV_FILE por seguridad...${NC}"
            rm "$ENV_FILE"
            echo -e "${GREEN}✅ $ENV_FILE eliminado - Sistema seguro${NC}"
        fi
    fi
}

# ✅ FUNCIÓN MEJORADA: Liberar espacio SEGURO
free_space_safe() {
    show_header
    echo -e "${PURPLE}🔧 LIBERANDO ESPACIO SEGURO${NC}"
    echo "=========================================="
    echo -e "${YELLOW}⚠️  Esta acción limpiará solo elementos innecesarios${NC}"
    echo -e "${GREEN}✅ BASE DE DATOS PRESERVADA${NC}"
    echo ""
    
    # ✅ ACTIVAR PROTECCIÓN
    if ! protect_database "limpieza_segura"; then
        return 1
    fi
    
    # Mostrar espacio actual
    echo -e "${CYAN}📊 Espacio actual utilizado por Docker:${NC}"
    docker system df
    
    echo ""
    read -p "¿Continuar con la limpieza segura? (s/n): " confirm
    
    if [[ $confirm != "s" && $confirm != "S" ]]; then
        echo -e "${YELLOW}❌ Limpieza cancelada${NC}"
        read -p "Presiona Enter para volver al menú..."
        return
    fi
    
    echo -e "${YELLOW}🧹 Iniciando limpieza segura...${NC}"
    
    # Limpieza SEGURA (sin tocar volúmenes)
    docker container prune -f
    docker image prune -f
    docker network prune -f
    docker builder prune -f
    
    # Limpiar logs y cache de forma segura
    find /var/lib/docker/containers/ -name "*.log" -type f -size +100M -delete 2>/dev/null || true
    docker exec cursos_backend npm cache clean --force 2>/dev/null || true
    
    # Mostrar espacio liberado
    echo ""
    echo -e "${CYAN}📊 Espacio después de la limpieza:${NC}"
    docker system df
    
    # ✅ VERIFICAR QUE LA BD SIGUE FUNCIONANDO
    if verify_operation_success "limpieza"; then
        echo -e "${GREEN}🎉 ¡Limpieza segura completada!${NC}"
    else
        echo -e "${RED}⚠️  Advertencia: Verificar estado de la base de datos${NC}"
    fi
    
    read -p "Presiona Enter para volver al menú..."
}

# ✅ FUNCIÓN MEJORADA: Respaldar Base de Datos
backup_database() {
    show_header
    echo -e "${CYAN}💾 RESPALDO DE BASE DE DATOS${NC}"
    echo "=========================================="
    
    if ! protect_database "respaldo"; then
        read -p "Presiona Enter para volver al menú..."
        return 1
    fi
    
    # El backup ya se creó en protect_database, mostrar info
    echo ""
    echo -e "${GREEN}✅ Respaldo completado exitosamente!${NC}"
    
    # Listar últimos backups
    echo -e "${CYAN}📋 Últimos respaldos disponibles:${NC}"
    ls -laht "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -5 || echo "No hay respaldos anteriores"
    
    read -p "Presiona Enter para volver al menú..."
}

# ✅ FUNCIÓN MEJORADA SEGURA: Actualizar desde Git
update_from_git() {
    show_header
    echo -e "${BLUE}📥 ACTUALIZACIÓN SEGURA DESDE GIT${NC}"
    echo "=========================================="
    
    if ! is_system_configured; then
        echo -e "${RED}❌ Error: Sistema no configurado${NC}"
        echo "Primero debes instalar el sistema con la opción 1"
        read -p "Presiona Enter para continuar..."
        return
    fi
    
    # ✅ PROTECCIÓN ANTES DE ACTUALIZAR
    if ! protect_database "actualizacion_git"; then
        echo -e "${RED}❌ Actualización cancelada por protección de BD${NC}"
        read -p "Presiona Enter para continuar..."
        return 1
    fi
    
    echo -e "${YELLOW}📦 Descargando actualizaciones desde Git...${NC}"
    
    if git pull origin main; then
        echo -e "${GREEN}✅ Código actualizado desde Git${NC}"
        echo -e "${YELLOW}🔄 Reconstruyendo servicios...${NC}"
        
        # ✅ MÉTODO SEGURO: Construir sin detener
        docker compose build --no-cache backend
        
        echo -e "${YELLOW}🚀 Reiniciando servicios...${NC}"
        # ✅ MÉTODO SEGURO: Recargar solo el backend
        docker compose up -d --no-deps backend
        
        # ✅ VERIFICAR QUE TODO FUNCIONE
        if verify_operation_success "actualización_git"; then
            echo -e "${GREEN}✅ Actualización completada exitosamente${NC}"
        else
            echo -e "${RED}⚠️  Actualización completada con advertencias${NC}"
            echo -e "${YELLOW}💡 Verificar el estado del sistema${NC}"
        fi
        
    else
        echo -e "${RED}❌ Error al actualizar desde Git${NC}"
    fi
    
    read -p "Presiona Enter para continuar..."
}

# ✅ FUNCIÓN MEJORADA SEGURA: Instalar/Actualizar Sistema
install_or_update_system() {
    show_header
    
    if is_system_configured; then
        echo -e "${BLUE}🔄 ACTUALIZACIÓN SEGURA DEL SISTEMA${NC}"
        # ✅ PROTECCIÓN EN MODO ACTUALIZACIÓN
        if ! protect_database "actualizacion_sistema"; then
            echo -e "${RED}❌ Actualización cancelada por protección de BD${NC}"
            read -p "Presiona Enter para continuar..."
            return 1
        fi
    else
        echo -e "${BLUE}🚀 INSTALANDO SISTEMA${NC}"
    fi
    
    echo "=========================================="
    
    # Gestión del entorno
    setup_environment
    
    # Construir servicios
    if is_system_configured; then
        echo -e "${YELLOW}🐳 Actualizando servicios...${NC}"
        docker compose build --no-cache backend
    else
        echo -e "${YELLOW}🐳 Instalando servicios...${NC}"
        docker compose build --no-cache backend
    fi
    
    # Levantar servicios (método seguro)
    echo -e "${YELLOW}🐳 Levantando servicios...${NC}"
    docker compose up -d
    
    echo -e "${YELLOW}⏳ Esperando que los servicios estén listos...${NC}"
    sleep 15
    
    # Verificar permisos
    echo -e "${YELLOW}🔧 Verificando y corrigiendo permisos...${NC}"
    fix_permissions
    
    # Verificación final
    echo -e "${YELLOW}🔍 Verificando despliegue...${NC}"
    docker compose ps
    
    # ✅ VERIFICACIÓN DE BD EN MODO ACTUALIZACIÓN
    if is_system_configured; then
        if verify_operation_success "actualización_sistema"; then
            echo -e "${GREEN}✅ SISTEMA ACTUALIZADO CORRECTAMENTE${NC}"
        else
            echo -e "${RED}⚠️  SISTEMA ACTUALIZADO CON ADVERTENCIAS${NC}"
        fi
    else
        echo -e "${GREEN}✅ SISTEMA INSTALADO CORRECTAMENTE${NC}"
    fi
    
    echo "🌐 URL: https://moviesplus.xyz"
    echo "👤 Admin: admin / admin1234"
    
    # Limpiar .env al final
    cleanup_environment
    
    read -p "Presiona Enter para continuar..."
}

# ✅ FUNCIÓN MEJORADA: Resetear sistema
reset_system() {
    show_header
    echo -e "${RED}⚠️  RESETEO DEL SISTEMA${NC}"
    echo "=========================================="
    echo "ESTA ACCIÓN ELIMINARÁ TODA LA CONFIGURACIÓN"
    echo ""
    echo -e "${RED}🚨 OPCIONES:${NC}"
    echo "1) Reset seguro (preserva BD)"
    echo "2) Reset completo (elimina TODO incluyendo BD)"
    echo "3) Cancelar"
    echo ""
    read -p "Selecciona opción (1-3): " reset_option
    
    case $reset_option in
        1)
            echo -e "${YELLOW}🗑️  Eliminando configuración (BD preservada)...${NC}"
            # ✅ PROTECCIÓN ANTES DE RESET
            if protect_database "reset_seguro"; then
                docker compose down  # ← SIN -v
                rm -f "$CONFIGURED_FILE"
                rm -f "$ENV_FILE"
                sudo rm -rf uploads/*
                echo -e "${GREEN}✅ Sistema reseteado - BD preservada${NC}"
            else
                echo -e "${RED}❌ Reset cancelado por protección de BD${NC}"
            fi
            ;;
        2)
            read -p "¿ESTÁS SEGURO? Esto eliminará TODOS los datos. Escribe 'ELIMINAR-TODO': " confirmation
            if [ "$confirmation" = "ELIMINAR-TODO" ]; then
                echo -e "${RED}🗑️  ELIMINANDO TODO INCLUYENDO BD...${NC}"
                docker compose down -v  # ← SOLO aquí usamos -v
                rm -f "$CONFIGURED_FILE"
                rm -f "$ENV_FILE"
                sudo rm -rf uploads/*
                echo -e "${GREEN}✅ Sistema completamente reseteado${NC}"
            else
                echo -e "${YELLOW}❌ Reset cancelado${NC}"
            fi
            ;;
        *)
            echo -e "${YELLOW}❌ Reset cancelado${NC}"
            ;;
    esac
    
    read -p "Presiona Enter para continuar..."
}

# ✅ FUNCIÓN MEJORADA: Ver estado con verificación de BD
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
    
    # ✅ VERIFICACIÓN DE BD EN ESTADO
    echo -e "${YELLOW}🗄️  Base de Datos:${NC}"
    if check_database_health; then
        echo -e "${GREEN}✅ Salud: OPTIMA${NC}"
    else
        echo -e "${RED}❌ Salud: PROBLEMAS${NC}"
    fi
    
    echo -e "${YELLOW}🔗 URLs:${NC}"
    echo "🌐 Frontend: https://moviesplus.xyz"
    echo "🔧 Backend API: https://moviesplus.xyz/api"
    
    # Mostrar espacio de Docker
    echo -e "${YELLOW}💾 Espacio Docker:${NC}"
    docker system df
    
    # Mostrar últimos backups
    if [ -d "$BACKUP_DIR" ]; then
        echo -e "${YELLOW}💾 Últimos respaldos:${NC}"
        ls -laht "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -3 || echo "No hay respaldos"
    fi
    
    read -p "Presiona Enter para continuar..."
}

# 🔄 FUNCIÓN DE PERMISOS (sin cambios)
fix_permissions() {
    echo -e "${YELLOW}🔧 INICIANDO REPARACIÓN DE PERMISOS...${NC}"
    echo "=========================================="
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
    
    docker exec cursos_backend mkdir -p /app/uploads 2>/dev/null && echo -e "${GREEN}✅ Carpeta /app/uploads creada${NC}" || echo -e "${RED}❌ Error creando carpeta${NC}"
    sleep 1
    
    docker exec cursos_backend chown -R node:node /app/uploads 2>/dev/null && echo -e "${GREEN}✅ Ownership aplicado${NC}" || echo -e "${RED}❌ Error en ownership${NC}"
    sleep 1
    
    docker exec cursos_backend chmod -R 755 /app/uploads 2>/dev/null && echo -e "${GREEN}✅ Permisos aplicados${NC}" || echo -e "${RED}❌ Error en permisos${NC}"
    sleep 1
    
    # 4. Verificación final
    echo -e "${YELLOW}🔍 Verificando resultado...${NC}"
    if docker exec cursos_backend touch /app/uploads/test-final-$(date +%s).txt 2>/dev/null; then
        echo -e "${GREEN}🎉 ¡ÉXITO! Permisos configurados correctamente${NC}"
        echo -e "${GREEN}✅ Ya puedes subir imágenes sin problemas${NC}"
    else
        echo -e "${RED}❌ FALLO: No se pudo verificar los permisos${NC}"
    fi
    
    echo "=========================================="
    read -p "Presiona Enter para volver al menú..."
}

# Menú principal
main_menu() {
    while true; do
        show_header
        echo -e "${GREEN}MENÚ PRINCIPAL - VERSIÓN SEGURA${NC}"
        echo "=========================================="
        echo "1. 🚀 Instalar/Actualizar Sistema"
        echo "2. 📥 Actualizar desde Git + Reinstalar"
        echo "3. ⏸️  Detener Servicios"
        echo "4. ▶️  Iniciar Servicios" 
        echo "5. 📊 Ver Estado"
        echo "6. 🔧 Corregir Permisos"
        echo "7. 📝 Ver Logs"
        echo "8. 🧹 Liberar Espacio Seguro"
        echo "9. 💾 Respaldar Base de Datos"
        echo "10. 🔄 Restaurar Base de Datos"
        echo "11. 🗑️  Resetear Sistema (cuidado!)"
        echo "12. ❌ Salir"
        echo "=========================================="
        
        read -p "Selecciona una opción (1-12): " choice
        
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
            8) free_space_safe ;;
            9) backup_database ;;
            10) restore_database ;;
            11) reset_system ;;
            12) 
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