// src/users/dto/user-response.dto.ts
export class SafeUserResponseDto {
  id: number;
  nombres: string;
  apellidos: string;
  correo: string;
  rol: string;
  ciudad?: string;
  empresa?: string;
  cargo?: string;
  asignatura?: string;
  // ❌ NO incluir: cedula, password, usuario, celular
}

// src/users/dto/profesor-response.dto.ts
export class ProfesorResponseDto {
  id: number;
  nombres: string;
  apellidos: string;
  asignatura?: string;
  // ❌ NO incluir datos sensibles
}