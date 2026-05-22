// src/common/ai.service.ts
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { SettingsService } from '../settings/settings.service';

interface ChatResponse {
  choices: Array<{ message: { content: string } }>;
}

/**
 * Servicio de IA agnóstico al proveedor. Funciona con cualquier API compatible
 * con OpenAI (chat completions): DeepSeek, Groq, etc. La configuración
 * (proveedor, API key, modelo, URL) se lee de la BD desde el panel admin,
 * con fallback al .env.
 */
@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  constructor(private settings: SettingsService) {}

  /** Llama al endpoint de chat del proveedor configurado. */
  private async chat(
    messages: Array<{ role: string; content: string }>,
    opts: { maxTokens?: number; temperature?: number } = {},
  ): Promise<string> {
    const cfg = this.settings.getAiConfig();

    if (!cfg.apiKey) {
      throw new Error('No hay una API Key de IA configurada. Configúrala en el panel de administración.');
    }
    if (!cfg.baseUrl) {
      throw new Error('Falta la URL del proveedor de IA (requerida para el modo personalizado).');
    }

    const response = await axios.post<ChatResponse>(
      cfg.baseUrl,
      {
        model: cfg.model,
        messages,
        max_tokens: opts.maxTokens ?? 250,
        temperature: opts.temperature ?? 0.8,
      },
      {
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('El proveedor de IA no devolvió contenido');
    return content.trim();
  }

  async generateCourseDescription(titulo: string): Promise<string> {
    try {
      return await this.chat(
        [
          {
            role: 'system',
            content: `Eres un asistente especializado en crear descripciones atractivas para cursos educativos.
              Genera una descripción breve (máximo 150 palabras) que sea:
              - Atractiva y profesional
              - Mencione los beneficios principales
              - Incluya temas clave que se cubrirán
              - Sea persuasiva para potenciales estudiantes
              - Use un tono motivador y educativo
              - Formato: texto plano sin markdown`,
          },
          {
            role: 'user',
            content: `Crea una descripción concisa y atractiva para el curso: "${titulo}"`,
          },
        ],
        { maxTokens: 250, temperature: 0.8 },
      );
    } catch (error: any) {
      const proveedor = this.settings.get('ai_provider') || 'IA';
      this.logger.error(`Error generando descripción con ${proveedor}: ${error.response?.data?.error?.message || error.message}`);

      if (error.response?.status === 401) {
        throw new Error('Error de autenticación con la IA — verifica tu API Key');
      } else if (error.response?.status === 429) {
        throw new Error('Límite de tasa excedido — intenta de nuevo en un momento');
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Timeout al conectar con el servicio de IA');
      }
      throw new Error('No se pudo generar la descripción automática en este momento');
    }
  }

  /**
   * Prueba la configuración de IA con un prompt mínimo. Devuelve el texto
   * generado o un error legible para el panel.
   */
  async testConnection(): Promise<{ success: boolean; message: string; sample?: string }> {
    const cfg = this.settings.getAiConfig();
    if (!cfg.apiKey) {
      return { success: false, message: 'Falta la API Key. Guárdala primero.' };
    }
    try {
      const sample = await this.chat(
        [{ role: 'user', content: 'Responde solo con: "Conexión IA OK"' }],
        { maxTokens: 20, temperature: 0 },
      );
      return {
        success: true,
        message: `Conexión exitosa con ${cfg.provider} (modelo: ${cfg.model})`,
        sample,
      };
    } catch (error: any) {
      const detail = error.response?.data?.error?.message || error.message;
      let hint = '';
      if (error.response?.status === 401) hint = ' — API Key inválida.';
      else if (error.response?.status === 404) hint = ' — Modelo o URL incorrectos.';
      else if (error.response?.status === 400) hint = ' — Revisa el nombre del modelo.';
      return { success: false, message: `Fallo de conexión IA: ${detail}${hint}` };
    }
  }
}
