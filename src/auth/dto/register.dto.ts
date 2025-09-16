import { IsString, IsEmail, MinLength, MaxLength, IsIn, IsOptional } from 'class-validator';

export class RegisterDto {
  @IsString() nombres: string;
  @IsString() apellidos: string;
  @IsEmail() correo: string;
  @IsString() celular: string;
  @IsString() cedula: string;
  @IsString() usuario: string;
  @MinLength(6) @MaxLength(32) password: string;

  @IsString()
  ciudad: string; // validar que viene de la lista en frontend (backend opcional)

  @IsOptional()
  @IsString()
  empresa?: string;

  @IsString()
  @IsIn(['Gerente', 'Técnico'])
  rol: string;
}
