import { Injectable } from '@nestjs/common';
import { MailService } from './mail.service';

@Injectable()
export class MailQueueService {
  private queue: Array<{ 
    email: string; 
    token: string; 
    nombre: string;
    timestamp: number;
  }> = [];
  
  private isProcessing = false;
  private maxRetries = 3;

  constructor(private mailService: MailService) {
    // Iniciar procesamiento automático
    this.startQueueProcessor();
  }

  addToQueue(email: string, token: string, nombre: string) {
    const queueItem = { email, token, nombre, timestamp: Date.now() };
    this.queue.push(queueItem);
    
    console.log(`📧 Email agregado a cola: ${email} (Tamaño cola: ${this.queue.length})`);
    
    // Procesar inmediatamente si no está procesando
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  private async startQueueProcessor() {
    // Procesar cola cada 5 segundos si hay elementos
    setInterval(() => {
      if (this.queue.length > 0 && !this.isProcessing) {
        this.processQueue();
      }
    }, 5000);
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    
    this.isProcessing = true;
    console.log(`🔄 Procesando cola de correos (${this.queue.length} pendientes)...`);

    while (this.queue.length > 0) {
      const task = this.queue[0]; // Tomar el primero sin remover todavía
      
      try {
        await this.mailService.sendVerificationEmail(
          task.email, 
          task.token, 
          task.nombre
        );
        
        // ✅ Éxito - remover de la cola
        this.queue.shift();
        console.log(`✅ Correo enviado: ${task.email} (${this.queue.length} restantes)`);
        
      } catch (error) {
        console.error(`❌ Error enviando correo a ${task.email}:`, error.message);
        
        // ✅ Reintento inteligente
        const retryCount = (task as any).retryCount || 0;
        if (retryCount < this.maxRetries) {
          (task as any).retryCount = retryCount + 1;
          console.log(`🔄 Reintento ${retryCount + 1}/3 para: ${task.email}`);
          
          // Mover al final de la cola para reintentar
          this.queue.shift();
          this.queue.push(task);
        } else {
          // ❌ Máximo de reintentos alcanzado - remover permanentemente
          this.queue.shift();
          console.error(`🚫 Máximo de reintentos para: ${task.email}`);
        }
      }
      
      // Pequeña pausa entre correos (500ms)
      if (this.queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    this.isProcessing = false;
    console.log('🏁 Procesamiento de cola completado');
  }

  getQueueStatus() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      pendingEmails: this.queue.map(item => item.email)
    };
  }
}