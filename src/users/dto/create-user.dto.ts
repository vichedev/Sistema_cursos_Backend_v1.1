// src/users/dto/create-user.dto.ts
import { IsString, IsEmail, IsNotEmpty, MinLength, MaxLength, Matches, IsOptional, IsEnum } from 'class-validator';
import { Rol } from '../user.entity';

export class CreateUserDto {
  @IsNotEmpty({ message: 'Los nombres son obligatorios' })
  @IsString()
  @Matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/, {
    message: 'Los nombres solo pueden contener letras y espacios'
  })
  nombres: string;

  @IsNotEmpty({ message: 'Los apellidos son obligatorios' })
  @IsString()
  @Matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/, {
    message: 'Los apellidos solo pueden contener letras y espacios'
  })
  apellidos: string;

  @IsNotEmpty({ message: 'El correo es obligatorio' })
  @IsEmail({}, { message: 'El correo debe tener un formato válido' })
  correo: string;

  @IsNotEmpty({ message: 'El usuario es obligatorio' })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9_@.-]+$/, {
    message: 'El usuario solo puede contener letras, números y @ . - _'
  })
  usuario: string;

  @IsNotEmpty({ message: 'La identificación es obligatoria' })
  @IsString()
  @Matches(/^[a-zA-Z0-9-]+$/, {
    message: 'La identificación contiene caracteres inválidos'
  })
  cedula: string;

  // ✅ PAÍS - NUEVO CAMPO OBLIGATORIO
  @IsNotEmpty({ message: 'El país es obligatorio' })
  @IsString()
  pais: string;

  // ✅ CELULAR - FORMATO INTERNACIONAL
  @IsNotEmpty({ message: 'El celular es obligatorio' })
  @IsString()
  @Matches(/^\+\d{1,3}\d{7,15}$/, {
    message: 'El celular debe tener formato internacional válido (ej: +593991234567)'
  })
  celular: string;

  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  @IsString()
  @MinLength(6)
  @MaxLength(100)
  password: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]*$/, {
    message: 'La asignatura solo puede contener letras y espacios'
  })
  asignatura?: string;

  // ✅ ROL - PARA ADMIN/ESTUDIANTE (opcional, por defecto ESTUDIANTE)
  @IsOptional()
  @IsEnum(['ADMIN', 'ESTUDIANTE'], {
    message: 'El rol debe ser ADMIN o ESTUDIANTE'
  })
  rol?: Rol;

  // ✅ CARGO - NUEVO CAMPO PARA GERENTE/TÉCNICO
  @IsOptional()
  @IsString()
  @Matches(/^(Gerente|Técnico)$/, {
    message: 'El cargo debe ser "Gerente" o "Técnico"'
  })
  cargo?: string;

  @IsOptional()
  @IsString()
  ciudad?: string;

  @IsOptional()
  @IsString()
  empresa?: string;
}