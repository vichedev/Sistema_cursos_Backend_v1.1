// src/common/ai.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface DeepSeekResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

@Injectable()
export class AIService {
  private readonly apiKey: string;
  private readonly apiUrl: string = 'https://api.deepseek.com/v1/chat/completions';

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY no está configurada en las variables de entorno');
    }
    
    this.apiKey = apiKey; 
  }

  async generateCourseDescription(titulo: string): Promise<string> {
    try {
      const response = await axios.post<DeepSeekResponse>(
        this.apiUrl,
        {
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: `Eres un asistente especializado en crear descripciones atractivas para cursos educativos. 
              Genera una descripción breve (máximo 150 palabras) que sea:
              - Atractiva y profesional
              - Mencione los beneficios principales
              - Incluya temas clave que se cubrirán
              - Sea persuasiva para potenciales estudiantes
              - Use un tono motivador y educativo
              - Formato: texto plano sin markdown`
            },
            {
              role: 'user',
              content: `Crea una descripción concisa y atractiva para el curso: "${titulo}"`
            }
          ],
          max_tokens: 250,
          temperature: 0.8
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000 // 30 segundos timeout
        }
      );

      // ✅ Ahora TypeScript sabe la estructura de response.data
      return response.data.choices[0].message.content.trim();
    } catch (error: any) {
      console.error('Error al generar descripción con IA:', error.response?.data || error.message);
      
      // Mensajes de error más específicos
      if (error.response?.status === 401) {
        throw new Error('Error de autenticación con DeepSeek API - verifica tu API Key');
      } else if (error.response?.status === 429) {
        throw new Error('Límite de tasa excedido - intenta de nuevo en un momento');
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Timeout al conectar con el servicio de IA');
      } else {
        throw new Error('No se pudo generar la descripción automática en este momento');
      }
    }
  }
}