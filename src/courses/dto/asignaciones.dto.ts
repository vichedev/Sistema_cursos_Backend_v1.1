// src/courses/dto/asignaciones.dto.ts
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsInt, IsOptional, Min,
} from 'class-validator';
import { ToBoolean } from '../../common/to-boolean.decorator';

/** POST /courses/:id/asignados */
export class AsignarEstudiantesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Selecciona al menos un estudiante' })
  @ArrayMaxSize(500, { message: 'Máximo 500 estudiantes por solicitud' })
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  estudianteIds: number[];

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  notificarCorreo?: boolean;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  notificarWhatsapp?: boolean;
}

/** POST /courses/:id/asignados/notificar */
export class NotificarAsignadosDto {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  correo?: boolean;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  whatsapp?: boolean;
}
