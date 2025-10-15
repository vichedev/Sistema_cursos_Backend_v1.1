import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  UsePipes,
  ValidationPipe
} from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import {
  CreateCouponDto,
  ApplyCouponDto,
  VerifyCouponDto,
  UpdateCouponDto
} from './dto/create-coupon.dto';

@Controller('coupons')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) { }

  // ===============================
  // ✅ CREAR CUPÓN (SOLO ADMIN)
  // ===============================
  @Roles('ADMIN')
  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async createCoupon(@Body() createCouponDto: CreateCouponDto) {
    try {
      return await this.couponsService.createCoupon(createCouponDto);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  // ===============================
  // ✅ APLICAR CUPÓN (ESTUDIANTES)
  // ===============================
  @Post('apply')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async applyCoupon(@Body() applyCouponDto: ApplyCouponDto) {
    try {
      return await this.couponsService.validateAndApplyCoupon(
        applyCouponDto.cursoId,
        applyCouponDto.codigo,
        applyCouponDto.userId
      );
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  // ===============================
  // ✅ VERIFICAR CUPÓN (SIN APLICAR)
  // ===============================
  @Post('verify')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async verifyCoupon(@Body() verifyCouponDto: VerifyCouponDto) {
    try {
      return await this.couponsService.verifyCoupon(
        verifyCouponDto.cursoId,
        verifyCouponDto.codigo,
        verifyCouponDto.userId
      );
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  // ===============================
  // ✅ OBTENER CUPONES POR CURSO
  // ===============================
  @Get('course/:cursoId')
  async getCouponsByCourse(@Param('cursoId') cursoId: number) {
    try {
      return await this.couponsService.getCouponsByCourse(cursoId);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  // ===============================
  // ✅ OBTENER ESTADÍSTICAS DE CUPONES
  // ===============================
  @Get('stats/:cursoId')
  async getCouponStats(@Param('cursoId') cursoId: number) {
    try {
      return await this.couponsService.getCouponStatsByCourse(cursoId);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  // ===============================
  // ✅ OBTENER USOS DE CUPÓN
  // ===============================
  @Roles('ADMIN')
  @Get('usage/:couponId')
  async getCouponUsage(@Param('couponId') couponId: number) {
    try {
      return await this.couponsService.getCouponUsage(couponId);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  // ===============================
  // ✅ OBTENER TODOS LOS CUPONES (ADMIN)
  // ===============================
  @Roles('ADMIN')
  @Get()
  async getAllCoupons() {
    try {
      return await this.couponsService.getAllCoupons();
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  // ===============================
  // ✅ ACTUALIZAR CUPÓN (ADMIN)
  // ===============================
  @Roles('ADMIN')
  @Put(':couponId')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async updateCoupon(
    @Param('couponId') couponId: number,
    @Body() updateCouponDto: UpdateCouponDto
  ) {
    try {
      return await this.couponsService.updateCoupon(couponId, updateCouponDto);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  // ===============================
  // ✅ DESACTIVAR CUPÓN (ADMIN)
  // ===============================
  @Roles('ADMIN')
  @Put(':couponId/deactivate')
  async deactivateCoupon(@Param('couponId') couponId: number) {
    try {
      return await this.couponsService.deactivateCoupon(couponId);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  // ===============================
  // ✅ ELIMINAR CUPÓN (ADMIN)
  // ===============================
  @Roles('ADMIN')
  @Delete(':couponId')
  async deleteCoupon(@Param('couponId') couponId: number) {
    try {
      return await this.couponsService.deleteCoupon(couponId);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }


  // ===============================
  // ✅ ACTIVAR CUPÓN (ADMIN) - NUEVO
  // ===============================
  @Roles('ADMIN')
  @Put(':couponId/activate')
  async activateCoupon(@Param('couponId') couponId: number) {
    try {
      return await this.couponsService.activateCoupon(couponId);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  // ===============================
  // ✅ OBTENER CUPÓN POR ID (ADMIN) - NUEVO
  // ===============================
  @Roles('ADMIN')
  @Get(':couponId')
  async getCouponById(@Param('couponId') couponId: number) {
    try {
      return await this.couponsService.getCouponById(couponId);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  // ===============================
  // ✅ OBTENER USUARIOS QUE USARON CUPÓN (ADMIN) - NUEVO
  // ===============================
  @Roles('ADMIN')
  @Get(':couponId/users')
  async getCouponUsers(@Param('couponId') couponId: number) {
    try {
      return await this.couponsService.getCouponUsers(couponId);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }


  // ===============================
  // ✅ OBTENER ESTADO DE CUPONES POR CURSO (ADMIN)
  // ===============================
  @Roles('ADMIN')
  @Get('course/:cursoId/status')
  async getCouponsStatusByCourse(@Param('cursoId') cursoId: number) {
    try {
      return await this.couponsService.getCouponsStatusByCourse(cursoId);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  // ===============================
  // ✅ DESACTIVAR CUPONES POR CURSO (ADMIN)
  // ===============================
  @Roles('ADMIN')
  @Put('course/:cursoId/deactivate-all')
  async deactivateAllCouponsByCourse(@Param('cursoId') cursoId: number) {
    try {
      return await this.couponsService.deactivateAllCouponsByCourse(cursoId);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  // ===============================
  // ✅ ACTIVAR CUPONES POR CURSO (ADMIN)
  // ===============================
  @Roles('ADMIN')
  @Put('course/:cursoId/activate-all')
  async activateAllCouponsByCourse(@Param('cursoId') cursoId: number) {
    try {
      return await this.couponsService.activateAllCouponsByCourse(cursoId);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

}