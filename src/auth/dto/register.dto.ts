import { IsString, IsEmail, MinLength, MaxLength, IsIn, IsOptional, IsNotEmpty, Matches } from 'class-validator';

export class RegisterDto {
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

  // ✅ CAMBIADO: Celular con formato internacional
  @IsNotEmpty({ message: 'El celular es obligatorio' })
  @IsString()
  @Matches(/^\+\d{1,3}\d{7,15}$/, {
    message: 'El celular debe tener formato internacional válido (ej: +593991234567)'
  })
  celular: string;

  // ✅ Cédula (puede variar según el país, por eso quitamos validación fija)
  @IsNotEmpty({ message: 'La cédula es obligatoria' })
  @IsString()
  @Matches(/^[a-zA-Z0-9-]+$/, {
    message: 'La cédula contiene caracteres inválidos'
  })
  cedula: string;

  @IsNotEmpty({ message: 'El usuario es obligatorio' })
  @IsString()
  @MinLength(3, { message: 'El usuario debe tener al menos 3 caracteres' })
  @MaxLength(50, { message: 'El usuario no puede exceder 50 caracteres' })
  @Matches(/^[a-zA-Z0-9_@.-]+$/, {
    message: 'El usuario solo puede contener letras, números y @ . - _'
  })
  usuario: string;

  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  @MaxLength(32, { message: 'La contraseña no puede exceder 32 caracteres' })
  password: string;

  // ✅ NUEVO: País
  @IsNotEmpty({ message: 'El país es obligatorio' })
  @IsString()
  pais: string;

  @IsNotEmpty({ message: 'La ciudad es obligatoria' })
  @IsString()
  ciudad: string;

  @IsOptional()
  @IsString()
  empresa?: string;

  // ✅ CAMBIADO: Ahora es 'cargo' en lugar de 'rol' (para no confundir con rol de usuario)
  @IsNotEmpty({ message: 'El cargo es obligatorio' })
  @IsString()
  @IsIn(['Gerente', 'Técnico'], {
    message: 'El cargo debe ser "Gerente" o "Técnico"'
  })
  cargo: string;
}