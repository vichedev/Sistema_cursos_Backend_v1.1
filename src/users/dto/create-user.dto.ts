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

  @IsNotEmpty({ message: 'La cédula es obligatoria' })
  @IsString()
  @Matches(/^[0-9]{10}$/, { 
    message: 'La cédula debe tener exactamente 10 dígitos numéricos' 
  })
  cedula: string;

  @IsNotEmpty({ message: 'El celular es obligatorio' })
  @IsString()
  @Matches(/^[0-9]{10}$/, { 
    message: 'El celular debe tener exactamente 10 dígitos numéricos' 
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

  @IsOptional()
  @IsEnum(['ADMIN', 'ESTUDIANTE'], { 
    message: 'El rol debe ser ADMIN o ESTUDIANTE' 
  })
  rol?: Rol;

  @IsOptional()
  @IsString()
  ciudad?: string;

  @IsOptional()
  @IsString()
  empresa?: string;

  @IsOptional()
  @IsString()
  cargo?: string;
}