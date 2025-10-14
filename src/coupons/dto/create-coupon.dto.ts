import { IsString, IsEnum, IsNumber, IsOptional, IsDateString, Min, Max } from 'class-validator';
import { CouponType } from '../coupon.entity';

export class CreateCouponDto {
  @IsString()
  @IsOptional()
  codigo?: string;

  // ✅ ACTUALIZADO: Agregar nuevos tipos al enum
  @IsEnum(['PORCENTAJE_10', 'PORCENTAJE_15', 'PORCENTAJE_30', 'PORCENTAJE_50', 'GRATIS'], {
    message: 'El tipo debe ser PORCENTAJE_10, PORCENTAJE_15, PORCENTAJE_30, PORCENTAJE_50 o GRATIS'
  })
  tipo: CouponType;

  @IsNumber()
  @Min(1, { message: 'Los usos máximos deben ser al menos 1' })
  @Max(1000, { message: 'Los usos máximos no pueden exceder 1000' })
  usosMaximos: number;

  @IsOptional()
  @IsDateString()
  fechaExpiracion?: string;

  @IsNumber()
  cursoId: number;
}

export class ApplyCouponDto {
  @IsNumber()
  cursoId: number;

  @IsString()
  codigo: string;

  @IsNumber()
  userId: number;
}

export class VerifyCouponDto {
  @IsNumber()
  cursoId: number;

  @IsString()
  codigo: string;

  @IsNumber()
  userId: number;
}

export class UpdateCouponDto {
  @IsOptional()
  @IsString()
  codigo?: string;

  // ✅ ACTUALIZADO: Agregar nuevos tipos al enum
  @IsOptional()
  @IsEnum(['PORCENTAJE_10', 'PORCENTAJE_15', 'PORCENTAJE_30', 'PORCENTAJE_50', 'GRATIS'])
  tipo?: CouponType;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  usosMaximos?: number;

  @IsOptional()
  @IsDateString()
  fechaExpiracion?: string;

  @IsOptional()
  activo?: boolean;
}