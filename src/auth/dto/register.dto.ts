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

  @IsNotEmpty({ message: 'El celular es obligatorio' })
  @IsString()
  @Matches(/^[0-9]{10}$/, { 
    message: 'El celular debe tener exactamente 10 dígitos numéricos' 
  })
  celular: string;

  @IsNotEmpty({ message: 'La cédula es obligatoria' })
  @IsString()
  @Matches(/^[0-9]{10}$/, { 
    message: 'La cédula debe tener exactamente 10 dígitos numéricos' 
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

  @IsNotEmpty({ message: 'La ciudad es obligatoria' })
  @IsString()
  ciudad: string;

  @IsOptional()
  @IsString()
  empresa?: string;

  @IsNotEmpty({ message: 'El rol es obligatorio' })
  @IsString()
  @IsIn(['Gerente', 'Técnico'], { 
    message: 'El rol debe ser "Gerente" o "Técnico"' 
  })
  rol: string;
}