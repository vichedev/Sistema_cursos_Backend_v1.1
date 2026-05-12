import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Coupon, CouponType } from './coupon.entity';
import { CouponUsage } from './coupon-usage.entity';
import { CreateCouponDto, UpdateCouponDto } from './dto/create-coupon.dto';
import { isDateOnlyExpired, toDateOnlyString } from '../common/date.util';


@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);

  constructor(
    @InjectRepository(Coupon)
    private couponRepo: Repository<Coupon>,
    @InjectRepository(CouponUsage)
    private couponUsageRepo: Repository<CouponUsage>,
  ) { }

  // ===============================
  // ✅ CREAR CUPÓN
  // ===============================
  async createCoupon(createCouponDto: CreateCouponDto) {
    // Generar código automático si no se proporciona
    const codigo = createCouponDto.codigo || this.generarCodigoAutomatico();

    // Validar que el código sea único
    const existingCoupon = await this.couponRepo.findOne({
      where: { codigo }
    });

    if (existingCoupon) {
      throw new BadRequestException('Ya existe un cupón con este código');
    }

    // Crear objeto sin usar this.couponRepo.create()
    const couponData: any = {
      codigo,
      tipo: createCouponDto.tipo,
      usosMaximos: createCouponDto.usosMaximos,
      cursoId: createCouponDto.cursoId,
      usosActuales: 0,
      activo: true
    };

    // Solo agregar fechaExpiracion si existe.
    // ⚠️ Se guarda como cadena 'YYYY-MM-DD' — NO convertir a Date: hacerlo provoca que,
    // por la zona horaria del servidor (ej. UTC-5), la fecha se almacene un día antes.
    if (createCouponDto.fechaExpiracion) {
      const fecha = toDateOnlyString(createCouponDto.fechaExpiracion);
      if (fecha) couponData.fechaExpiracion = fecha;
    }

    const coupon = this.couponRepo.create(couponData);
    return await this.couponRepo.save(coupon);
  }

  // ===============================
  // ✅ ACTUALIZAR CUPÓN
  // ===============================
  async updateCoupon(couponId: number, updateCouponDto: UpdateCouponDto) {
    const coupon = await this.couponRepo.findOne({
      where: { id: couponId }
    });

    if (!coupon) {
      throw new NotFoundException('Cupón no encontrado');
    }

    // Validar que el nuevo código no esté en uso (si se está actualizando)
    if (updateCouponDto.codigo && updateCouponDto.codigo !== coupon.codigo) {
      const existingCoupon = await this.couponRepo.findOne({
        where: { codigo: updateCouponDto.codigo }
      });

      if (existingCoupon) {
        throw new BadRequestException('Ya existe un cupón con este código');
      }
    }

    // Normalizar la fecha de expiración a 'YYYY-MM-DD' (o null para limpiarla) antes de persistir.
    // NO usar `new Date(...)`: desplazaría el día por la zona horaria del servidor.
    const updateData: Record<string, any> = { ...updateCouponDto };
    if ('fechaExpiracion' in updateData) {
      updateData.fechaExpiracion = toDateOnlyString(updateData.fechaExpiracion);
    }

    await this.couponRepo.update(couponId, updateData);

    return await this.couponRepo.findOne({ where: { id: couponId } });
  }

  // ===============================
  // ✅ GENERAR CÓDIGO AUTOMÁTICO
  // ===============================
  private generarCodigoAutomatico(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let codigo = '';
    for (let i = 0; i < 8; i++) {
      codigo += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return codigo;
  }

  // ===============================
  // ✅ VALIDAR Y APLICAR CUPÓN
  // ===============================
  async validateAndApplyCoupon(cursoId: number, codigo: string, userId: number) {
    // Buscar el cupón
    const coupon = await this.couponRepo.findOne({
      where: {
        codigo,
        cursoId,
        activo: true
      }
    });

    if (!coupon) {
      throw new BadRequestException('Cupón no válido para este curso');
    }

    // Verificar fecha de expiración
    if (isDateOnlyExpired(coupon.fechaExpiracion)) {
      throw new BadRequestException('Este cupón ha expirado');
    }

    // Verificar usos máximos
    if (coupon.usosActuales >= coupon.usosMaximos) {
      throw new BadRequestException('Este cupón ya alcanzó su límite de usos');
    }

    // Verificar que el usuario no haya usado este cupón antes
    const existingUsage = await this.couponUsageRepo.findOne({
      where: { couponId: coupon.id, userId }
    });

    if (existingUsage) {
      throw new BadRequestException('Ya has usado este cupón anteriormente');
    }

    // Registrar el uso
    await this.couponUsageRepo.save({
      couponId: coupon.id,
      userId,
      cursoId
    });

    // Actualizar contador de usos
    await this.couponRepo.update(coupon.id, {
      usosActuales: coupon.usosActuales + 1
    });

    this.logger.log(`✅ Cupón aplicado: ${codigo} por usuario ${userId} en curso ${cursoId}`);

    return {
      success: true,
      cupon: {
        id: coupon.id,
        codigo: coupon.codigo,
        tipo: coupon.tipo,
        descuentoAplicado: this.calcularDescuento(coupon.tipo)
      }
    };
  }

  // ===============================
  // ✅ OBTENER CUPONES POR CURSO
  // ===============================
  async getCouponsByCourse(cursoId: number) {
    return await this.couponRepo.find({
      where: { cursoId, activo: true },
      order: { createdAt: 'DESC' }
    });
  }

  // ===============================
  // ✅ OBTENER ESTADÍSTICAS DE CUPONES POR CURSO (ACTUALIZADO)
  // ===============================
  async getCouponStatsByCourse(cursoId: number) {
    const cupones = await this.getCouponsByCourse(cursoId);

    const stats = {
      totalCupones: cupones.length,
      cuponesActivos: cupones.filter(c => c.activo).length,
      cuponesExpirados: cupones.filter(c => isDateOnlyExpired(c.fechaExpiracion)).length,
      usosTotales: cupones.reduce((sum, c) => sum + c.usosActuales, 0),
      usosDisponibles: cupones.reduce((sum, c) => sum + (c.usosMaximos - c.usosActuales), 0),
      // ✅ ACTUALIZADO: Agregar nuevos tipos
      porTipo: {
        PORCENTAJE_10: cupones.filter(c => c.tipo === 'PORCENTAJE_10').length,
        PORCENTAJE_15: cupones.filter(c => c.tipo === 'PORCENTAJE_15').length,
        PORCENTAJE_30: cupones.filter(c => c.tipo === 'PORCENTAJE_30').length,
        PORCENTAJE_50: cupones.filter(c => c.tipo === 'PORCENTAJE_50').length,
        GRATIS: cupones.filter(c => c.tipo === 'GRATIS').length,
      }
    };

    return stats;
  }

  // ===============================
  // ✅ DESACTIVAR CUPÓN
  // ===============================
  async deactivateCoupon(couponId: number) {
    const coupon = await this.couponRepo.findOne({
      where: { id: couponId }
    });

    if (!coupon) {
      throw new NotFoundException('Cupón no encontrado');
    }

    await this.couponRepo.update(couponId, { activo: false });

    return { success: true, message: 'Cupón desactivado correctamente' };
  }

  // ===============================
  // ✅ ELIMINAR CUPÓN
  // ===============================
  async deleteCoupon(couponId: number) {
    const coupon = await this.couponRepo.findOne({
      where: { id: couponId }
    });

    if (!coupon) {
      throw new NotFoundException('Cupón no encontrado');
    }

    // Eliminar usos primero (por la relación foreign key)
    await this.couponUsageRepo.delete({ couponId });

    // Eliminar cupón
    await this.couponRepo.delete(couponId);

    return { success: true, message: 'Cupón eliminado correctamente' };
  }

  // ===============================
  // ✅ CALCULAR DESCUENTO (ACTUALIZADO)
  // ===============================
  private calcularDescuento(tipo: CouponType): number {
    switch (tipo) {
      case 'PORCENTAJE_10':
        return 0.1; // 10%
      case 'PORCENTAJE_15':
        return 0.15; // 15%
      case 'PORCENTAJE_30':
        return 0.3; // 30%
      case 'PORCENTAJE_50':
        return 0.5; // 50%
      case 'GRATIS':
        return 1; // 100%
      default:
        return 0;
    }
  }

  // ===============================
  // ✅ OBTENER TODOS LOS CUPONES (PARA ADMIN)
  // ===============================
  async getAllCoupons() {
    return await this.couponRepo.find({
      order: { createdAt: 'DESC' }
    });
  }

  // ===============================
  // ✅ RESERVAR CUPÓN (sin aplicarlo definitivamente)
  // ===============================
  async reserveCoupon(cursoId: number, codigo: string, userId: number) {
    // Buscar el cupón
    const coupon = await this.couponRepo.findOne({
      where: {
        codigo,
        cursoId,
        activo: true
      }
    });

    if (!coupon) {
      throw new BadRequestException('Cupón no válido para este curso');
    }

    // Verificar fecha de expiración
    if (isDateOnlyExpired(coupon.fechaExpiracion)) {
      throw new BadRequestException('Este cupón ha expirado');
    }

    // Verificar usos máximos
    if (coupon.usosActuales >= coupon.usosMaximos) {
      throw new BadRequestException('Este cupón ya alcanzó su límite de usos');
    }

    // Verificar que el usuario no tenga una reserva activa o uso previo
    const existingUsage = await this.couponUsageRepo.findOne({
      where: { couponId: coupon.id, userId }
    });

    if (existingUsage) {
      if (existingUsage.estado === 'USADO') {
        throw new BadRequestException('Ya has usado este cupón anteriormente');
      }
      if (existingUsage.estado === 'RESERVADO') {
        // Si ya existe una reserva, retornar la misma
        return {
          success: true,
          reservationId: existingUsage.id,
          cupon: {
            id: coupon.id,
            codigo: coupon.codigo,
            tipo: coupon.tipo,
            descuentoAplicado: this.calcularDescuento(coupon.tipo)
          }
        };
      }
    }

    // ✅ CREAR RESERVA TEMPORAL (no cuenta como uso definitivo)
    const reservedUsage = await this.couponUsageRepo.save({
      couponId: coupon.id,
      userId,
      cursoId,
      estado: 'RESERVADO'
    });

    this.logger.log(`📌 Cupón reservado: ${codigo} por usuario ${userId} - Reserva ID: ${reservedUsage.id}`);

    return {
      success: true,
      reservationId: reservedUsage.id,
      cupon: {
        id: coupon.id,
        codigo: coupon.codigo,
        tipo: coupon.tipo,
        descuentoAplicado: this.calcularDescuento(coupon.tipo)
      }
    };
  }


  // ===============================
  // ✅ LIMPIAR RESERVAS EXPIRADAS (ejecutar periódicamente)
  // ===============================
  async cleanupExpiredReservations() {
    const expirationTime = 30 * 60 * 1000; // 30 minutos
    const cutoffTime = new Date(Date.now() - expirationTime);

    const expiredReservations = await this.couponUsageRepo
      .createQueryBuilder('usage')
      .where('usage.estado = :estado', { estado: 'RESERVADO' })
      .andWhere('usage.usadoEn < :cutoffTime', { cutoffTime })
      .getMany();

    for (const reservation of expiredReservations) {
      await this.couponUsageRepo.delete(reservation.id);
      this.logger.log(`🧹 Reserva expirada eliminada: ${reservation.id}`);
    }

    this.logger.log(`✅ Limpieza completada: ${expiredReservations.length} reservas expiradas eliminadas`);
  }

  // ===============================
  // ✅ CONFIRMAR USO DEL CUPÓN (cuando el pago es exitoso)
  // ===============================
  async confirmCouponUsage(reservationId: number) {
    const reservedUsage = await this.couponUsageRepo.findOne({
      where: { id: reservationId, estado: 'RESERVADO' },
      relations: ['coupon'] // ✅ AGREGAR RELACIÓN
    });

    if (!reservedUsage) {
      throw new BadRequestException('Reserva de cupón no encontrada o ya confirmada');
    }

    // Obtener el cupón actualizado
    const coupon = await this.couponRepo.findOne({
      where: { id: reservedUsage.couponId }
    });

    if (!coupon) {
      throw new BadRequestException('Cupón no encontrado');
    }

    // Actualizar contador de usos del cupón
    await this.couponRepo.update(reservedUsage.couponId, {
      usosActuales: coupon.usosActuales + 1
    });

    // Marcar como usado definitivamente
    await this.couponUsageRepo.update(reservationId, {
      estado: 'USADO',
      confirmadoEn: new Date()
    });

    this.logger.log(`✅ Cupón confirmado: ${coupon.codigo} - Reserva ID: ${reservationId}`);

    return { success: true };
  }

  // ===============================
  // ✅ CANCELAR RESERVA DE CUPÓN (si el pago falla)
  // ===============================
  async cancelCouponReservation(reservationId: number) {
    try {
      this.logger.log(`🔄 Intentando cancelar reserva: ${reservationId}`);

      // Buscar la reserva con diferentes criterios
      const reservedUsage = await this.couponUsageRepo.findOne({
        where: {
          id: reservationId,
          estado: 'RESERVADO'
        }
      });

      if (reservedUsage) {
        await this.couponUsageRepo.delete(reservationId);
        this.logger.log(`✅ Reserva de cupón CANCELADA correctamente: ${reservationId}`);
        return { success: true, message: 'Reserva cancelada' };
      } else {
        // Si no está en estado RESERVADO, verificar si existe en otro estado
        const existingUsage = await this.couponUsageRepo.findOne({
          where: { id: reservationId }
        });

        if (existingUsage) {
          if (existingUsage.estado === 'USADO') {
            this.logger.warn(`⚠️ Cupón ya fue usado: ${reservationId}`);
            return { success: false, message: 'Cupón ya fue usado' };
          } else {
            // Eliminar de todas formas si existe pero no está en RESERVADO
            await this.couponUsageRepo.delete(reservationId);
            this.logger.log(`✅ Uso de cupón eliminado: ${reservationId}`);
            return { success: true, message: 'Uso de cupón eliminado' };
          }
        } else {
          this.logger.log(`ℹ️ Reserva no encontrada: ${reservationId}`);
          return { success: true, message: 'Reserva no existía' };
        }
      }
    } catch (error) {
      this.logger.error(`❌ Error cancelando reserva ${reservationId}:`, error);

      // Intentar eliminación directa como último recurso
      try {
        await this.couponUsageRepo.delete(reservationId);
        this.logger.log(`✅ Reserva eliminada directamente después de error: ${reservationId}`);
        return { success: true, message: 'Reserva eliminada después de error' };
      } catch (deleteError) {
        this.logger.error(`💥 Error crítico eliminando reserva:`, deleteError);
        return { success: false, message: 'Error crítico eliminando reserva' };
      }
    }
  }


  // ===============================
  // ✅ VERIFICAR CUPÓN (MODIFICADO para incluir reservas)
  // ===============================
  async verifyCoupon(cursoId: number, codigo: string, userId: number) {
    const coupon = await this.couponRepo.findOne({
      where: {
        codigo,
        cursoId,
        activo: true
      }
    });

    if (!coupon) {
      return { valid: false, error: 'Cupón no válido para este curso' };
    }

    // Verificar fecha de expiración
    if (isDateOnlyExpired(coupon.fechaExpiracion)) {
      return { valid: false, error: 'Este cupón ha expirado' };
    }

    // Verificar usos máximos
    if (coupon.usosActuales >= coupon.usosMaximos) {
      return { valid: false, error: 'Este cupón ya alcanzó su límite de usos' };
    }

    // Verificar que el usuario no haya usado este cupón antes (incluye reservas)
    const existingUsage = await this.couponUsageRepo.findOne({
      where: { couponId: coupon.id, userId }
    });

    if (existingUsage) {
      if (existingUsage.estado === 'USADO') {
        return { valid: false, error: 'Ya has usado este cupón anteriormente' };
      }
      if (existingUsage.estado === 'RESERVADO') {
        return { valid: false, error: 'Tienes una reserva pendiente con este cupón' };
      }
    }

    return {
      valid: true,
      cupon: {
        id: coupon.id,
        codigo: coupon.codigo,
        tipo: coupon.tipo,
        descuento: this.calcularDescuento(coupon.tipo),
        descuentoTexto: this.getDescuentoTexto(coupon.tipo)
      }
    };
  }


  // ===============================
  // ✅ OBTENER TEXTO DE DESCUENTO (ACTUALIZADO)
  // ===============================
  private getDescuentoTexto(tipo: CouponType): string {
    switch (tipo) {
      case 'PORCENTAJE_10':
        return '10% de descuento';
      case 'PORCENTAJE_15':
        return '15% de descuento';
      case 'PORCENTAJE_30':
        return '30% de descuento';
      case 'PORCENTAJE_50':
        return '50% de descuento';
      case 'GRATIS':
        return 'Curso GRATIS';
      default:
        return 'Sin descuento';
    }
  }

  // ===============================
  // ✅ ACTIVAR CUPÓN
  // ===============================
  async activateCoupon(couponId: number) {
    const coupon = await this.couponRepo.findOne({
      where: { id: couponId }
    });

    if (!coupon) {
      throw new NotFoundException('Cupón no encontrado');
    }

    await this.couponRepo.update(couponId, { activo: true });

    return { success: true, message: 'Cupón activado correctamente' };
  }

  // ===============================
  // ✅ OBTENER CUPÓN POR ID CON INFORMACIÓN COMPLETA
  // ===============================
  async getCouponById(couponId: number) {
    const coupon = await this.couponRepo.findOne({
      where: { id: couponId },
      relations: ['curso'] // Incluir información del curso
    });

    if (!coupon) {
      throw new NotFoundException('Cupón no encontrado');
    }

    return coupon;
  }

  // ===============================
  // ✅ OBTENER USUARIOS QUE USARON EL CUPÓN
  // ===============================
  async getCouponUsers(couponId: number) {
    // Verificar que el cupón existe
    const coupon = await this.couponRepo.findOne({
      where: { id: couponId }
    });

    if (!coupon) {
      throw new NotFoundException('Cupón no encontrado');
    }

    // Obtener los usos del cupón con información de usuarios
    const usos = await this.couponUsageRepo
      .createQueryBuilder('usage')
      .leftJoinAndSelect('usage.user', 'user')
      .select([
        'usage.id',
        'usage.usadoEn',
        'user.id',
        'user.nombres',
        'user.apellidos',
        'user.correo',
        'user.cedula'
      ])
      .where('usage.couponId = :couponId', { couponId })
      .getMany();

    return {
      cupon: {
        id: coupon.id,
        codigo: coupon.codigo,
        tipo: coupon.tipo,
        usosActuales: coupon.usosActuales,
        usosMaximos: coupon.usosMaximos
      },
      usuarios: usos.map(uso => ({
        id: uso.user.id,
        nombres: uso.user.nombres,
        apellidos: uso.user.apellidos,
        correo: uso.user.correo,
        cedula: uso.user.cedula,
        fechaUso: uso.usadoEn
      }))
    };
  }

  // ===============================
  // ✅ ACTUALIZAR EL MÉTODO getCouponUsage PARA INCLUIR INFO DE USUARIOS
  // ===============================
  async getCouponUsage(couponId: number) {
    return await this.couponUsageRepo
      .createQueryBuilder('usage')
      .leftJoinAndSelect('usage.user', 'user')
      .select([
        'usage.id',
        'usage.usadoEn',
        'user.id',
        'user.nombres',
        'user.apellidos',
        'user.correo'
      ])
      .where('usage.couponId = :couponId', { couponId })
      .getMany();
  }


  // ===============================
  // ✅ OBTENER CUPÓN POR CÓDIGO Y CURSO (NUEVO MÉTODO)
  // ===============================
  async getCouponByCodeAndCourse(codigo: string, cursoId: number) {
    return await this.couponRepo.findOne({
      where: { codigo, cursoId }
    });
  }

  // ===============================
  // ✅ ELIMINAR USOS DE CUPÓN POR USUARIO (NUEVO MÉTODO)
  // ===============================
  async deleteCouponUsagesByUser(couponId: number, userId: number) {
    const result = await this.couponUsageRepo.delete({
      couponId,
      userId
    });

    this.logger.log(`✅ Usos de cupón eliminados: ${result.affected} registros`);
    return result;
  }

  // ===============================
  // ✅ FORZAR LIBERACIÓN DE CUPÓN (NUEVO MÉTODO)
  // ===============================
  async forceReleaseCoupon(codigoCupon: string, userId: number, cursoId: number) {
    this.logger.log(`🔄 Forzando liberación de cupón: ${codigoCupon} para usuario ${userId}`);

    // Buscar el cupón
    const coupon = await this.getCouponByCodeAndCourse(codigoCupon, cursoId);

    if (!coupon) {
      throw new BadRequestException('Cupón no encontrado');
    }

    // Eliminar cualquier uso/reserva de este cupón para este usuario
    const result = await this.deleteCouponUsagesByUser(coupon.id, userId);

    this.logger.log(`✅ Cupón forzadamente liberado - Eliminados: ${result.affected} registros`);

    return {
      success: true,
      message: `Cupón liberado correctamente (${result.affected} registros eliminados)`,
      eliminados: result.affected
    };
  }


  // En coupons.service.ts - Agregar después del método forceReleaseCoupon

  // ===============================
  // ✅ DESACTIVAR TODOS LOS CUPONES DE UN CURSO
  // ===============================
  async deactivateAllCouponsByCourse(cursoId: number) {
    try {
      const result = await this.couponRepo
        .createQueryBuilder('coupon')
        .update()
        .set({ activo: false })
        .where('cursoId = :cursoId', { cursoId })
        .andWhere('activo = :activo', { activo: true })
        .execute();

      this.logger.log(`🔒 ${result.affected} cupones desactivados para el curso ${cursoId}`);
      return result;
    } catch (error) {
      this.logger.error(`❌ Error desactivando cupones del curso ${cursoId}:`, error);
      throw error;
    }
  }

  // ===============================
  // ✅ ACTIVAR TODOS LOS CUPONES DE UN CURSO
  // ===============================
  async activateAllCouponsByCourse(cursoId: number) {
    try {
      const result = await this.couponRepo
        .createQueryBuilder('coupon')
        .update()
        .set({ activo: true })
        .where('cursoId = :cursoId', { cursoId })
        .andWhere('activo = :activo', { activo: false })
        .execute();

      this.logger.log(`🔓 ${result.affected} cupones activados para el curso ${cursoId}`);
      return result;
    } catch (error) {
      this.logger.error(`❌ Error activando cupones del curso ${cursoId}:`, error);
      throw error;
    }
  }

  // ===============================
  // ✅ OBTENER ESTADO DE CUPONES POR CURSO
  // ===============================
  async getCouponsStatusByCourse(cursoId: number) {
    const cupones = await this.couponRepo.find({
      where: { cursoId }
    });

    return {
      total: cupones.length,
      activos: cupones.filter(c => c.activo).length,
      inactivos: cupones.filter(c => !c.activo).length,
      cupones: cupones.map(c => ({
        id: c.id,
        codigo: c.codigo,
        tipo: c.tipo,
        activo: c.activo,
        usosActuales: c.usosActuales,
        usosMaximos: c.usosMaximos
      }))
    };
  }
// Editar cursos y ekiminar cupones al borrar curso
  async deleteAllCouponsByCourse(cursoId: number) {
    try {
      // Primero eliminar los usos de cupones
      const cupones = await this.couponRepo.find({ where: { cursoId } });
      for (const cupon of cupones) {
        await this.couponUsageRepo.delete({ couponId: cupon.id });
      }

      // Luego eliminar los cupones
      const result = await this.couponRepo.delete({ cursoId });
      this.logger.log(`🗑️ ${result.affected} cupones eliminados del curso ${cursoId}`);
      return result;
    } catch (error) {
      this.logger.error(`❌ Error eliminando cupones del curso ${cursoId}:`, error);
      throw error;
    }
  }

}