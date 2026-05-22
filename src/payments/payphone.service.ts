// src/payments/payphone.service.ts
import { Injectable, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentAttempt } from './payment-attempt.entity';
import { firstValueFrom } from 'rxjs';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class PayphoneService implements OnModuleInit {
  private readonly logger = new Logger(PayphoneService.name);

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
    private settings: SettingsService,
    @InjectRepository(PaymentAttempt)
    private paymentAttemptRepo: Repository<PaymentAttempt>,
  ) {}

  // ── Config leída en CALIENTE desde el panel (con fallback al .env) ──
  private get payphoneApiUrl() {
    return this.settings.getPayphoneConfig().apiUrl;
  }
  private get payphoneStoreId() {
    return this.settings.getPayphoneConfig().storeId;
  }
  private get payphoneToken() {
    return this.settings.getPayphoneConfig().token;
  }
  private get timeout() {
    return this.settings.getPayphoneConfig().timeout;
  }
  private get frontendUrl() {
    return this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
  }
  private get backendUrl() {
    return this.configService.get<string>('BACKEND_URL') || 'http://localhost:3001';
  }

  onModuleInit() {
    this.validateConfig();
  }

  private validateConfig(): void {
    // No lanza: si falta algo, solo advierte (el admin lo configura en el panel).
    const requiredConfigs = {
      payphone_api_url: this.payphoneApiUrl,
      payphone_store_id: this.payphoneStoreId,
      payphone_token: this.payphoneToken,
    };

    const faltantes = Object.entries(requiredConfigs)
      .filter(([, v]) => !v)
      .map(([k]) => k);

    if (faltantes.length) {
      this.logger.warn(`⚠️  Payphone sin configurar: ${faltantes.join(', ')} (configúralo en el panel admin)`);
    } else {
      this.logger.log(`✅ Payphone configurado - Store ID: ${this.payphoneStoreId}`);
    }
    this.logger.log(`✅ Response URL: ${this.backendUrl}/api/payments/payphone-confirm`);
  }

  // ✅ MÉTODO AUXILIAR PARA ESPERAR (DELAY)
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ✅ MÉTODO PARA VERIFICAR SI ES ERROR DE RED
  private esErrorDeRed(error: any): boolean {
    return error.code === 'ECONNRESET' || 
           error.code === 'ETIMEDOUT' || 
           error.code === 'ECONNREFUSED' ||
           error.code === 'ENOTFOUND' ||
           error.message?.includes('timeout') ||
           error.message?.includes('socket hang up') ||
           error.message?.includes('network');
  }

  // ✅ MÉTODO MEJORADO CON REINTENTOS - createPayment
  async createPayment(
    amount: number,
    clientTransactionId: string,
    clientUser: string,
    metadata?: Record<string, any>
  ): Promise<{
    paymentUrl: string;
    paymentId: string;
    clientTransactionId: string;
  }> {
    const currentBackendUrl = this.configService.get<string>('BACKEND_URL') || 'http://localhost:3001';
    const currentFrontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    
    this.logger.log(`🔍 BACKEND_URL: ${currentBackendUrl}`);
    this.logger.log(`🔍 FRONTEND_URL: ${currentFrontendUrl}`);

    if (!amount || amount <= 0) {
      throw new Error('El monto debe ser mayor a cero');
    }
    if (!clientTransactionId) {
      throw new Error('clientTransactionId es requerido');
    }

    const numericAmount = parseFloat(String(amount));
    const totalAmountInCents = Math.round(numericAmount * 100);
    const taxRate = 0.15;
    const amountWithTaxCents = Math.round(totalAmountInCents / (1 + taxRate));
    const taxCents = totalAmountInCents - amountWithTaxCents;

    const responseUrl = `${currentBackendUrl}/api/payments/payphone-confirm`;
    const cancellationUrl = `${currentFrontendUrl}/pago-fallido`;

    this.logger.log(`📤 URLs configuradas:`);
    this.logger.log(`   Response URL: ${responseUrl}`);
    this.logger.log(`   Cancellation URL: ${cancellationUrl}`);

    const paymentData = {
      amount: totalAmountInCents,
      amountWithTax: amountWithTaxCents,
      amountWithoutTax: 0,
      tax: taxCents,
      service: 0,
      tip: 0,
      storeId: this.payphoneStoreId,
      clientTransactionId,
      currency: "USD",
      responseUrl: responseUrl,
      cancellationUrl: cancellationUrl,
      reference: "Inscripción a Cursos de MAAT ACADEMY",
      phoneNumber: null,
      email: null,
      documentId: null,
      optionalParameter: JSON.stringify(metadata || {})
    };

    this.logger.log(`🚀 Iniciando pago en Payphone`);
    this.logger.log(`   API URL: ${this.payphoneApiUrl}/api/button/Prepare`);
    this.logger.log(`   Client Transaction ID: ${clientTransactionId}`);
    this.logger.log(`   Amount: $${numericAmount.toFixed(2)} (${totalAmountInCents} cents)`);
    this.logger.debug(`   Payload completo:`, JSON.stringify(paymentData, null, 2));

    // ✅ IMPLEMENTACIÓN DE REINTENTOS
    const maxReintentos = 3;
    const tiempoEsperaMs = 2000;
    const targetUrl = `${this.payphoneApiUrl}/api/button/Prepare`;

    for (let intento = 1; intento <= maxReintentos; intento++) {
      try {
        this.logger.log(`📤 Intento ${intento}/${maxReintentos} - Creando pago en Payphone...`);

        const response = await firstValueFrom(
          this.httpService.post(targetUrl, paymentData, {
            headers: {
              Authorization: `Bearer ${this.payphoneToken}`,
              'Content-Type': 'application/json'
            },
            timeout: this.timeout
          })
        );

        this.logger.log(`✅ Respuesta exitosa de Payphone:`);
        this.logger.log(`   Status: ${response.status}`);
        this.logger.log(`   Payment ID: ${response.data.paymentId}`);
        this.logger.debug(`   Respuesta completa:`, JSON.stringify(response.data, null, 2));

        await this.paymentAttemptRepo.update(
          { clientTransactionId },
          { 
            payphoneId: response.data.paymentId,
            status: 'PROCESANDO'
          }
        );

        this.logger.log(`✅ PaymentAttempt actualizado con Payphone ID: ${response.data.paymentId}`);

        return {
          paymentUrl: response.data.payWithPayPhone ||
            response.data.payWithCard ||
            response.data.payphoneUrl,
          paymentId: response.data.paymentId,
          clientTransactionId
        };

      } catch (error) {
        const esUltimoIntento = intento === maxReintentos;
        const esErrorRed = this.esErrorDeRed(error);

        this.logger.error(`💥 Error en intento ${intento}/${maxReintentos}:`, {
          message: error.message,
          code: error.code,
          response: error.response?.data,
          status: error.response?.status,
          url: targetUrl
        });

        // Si es error de red y no es el último intento, reintentar
        if (esErrorRed && !esUltimoIntento) {
          const tiempoEspera = tiempoEsperaMs * intento;
          this.logger.warn(`🔄 Error de red detectado. Reintentando en ${tiempoEspera}ms...`);
          await this.delay(tiempoEspera);
          continue;
        }

        // Si es el último intento, registrar y lanzar error
        if (esUltimoIntento) {
          this.logger.error(`❌ Falló después de ${maxReintentos} intentos`);
          
          await this.paymentAttemptRepo.update(
            { clientTransactionId },
            { status: 'ERROR_INICIO_PAGO' }
          );

          throw new InternalServerErrorException('Error al iniciar el pago con Payphone');
        }

        // Si no es error de red, lanzar inmediatamente
        await this.paymentAttemptRepo.update(
          { clientTransactionId },
          { status: 'ERROR_INICIO_PAGO' }
        );

        throw new InternalServerErrorException('Error al iniciar el pago con Payphone');
      }
    }

    // Esta línea nunca debería ejecutarse, pero TypeScript requiere un return
    throw new InternalServerErrorException('Error inesperado al crear pago');
  }

  // ✅ MÉTODO MEJORADO CON REINTENTOS - confirmTransaction
  async confirmTransaction(id: string, clientTransactionId: string): Promise<any> {
    const maxReintentos = 3;
    const tiempoEsperaMs = 2000;
    const url = `${this.payphoneApiUrl}/api/button/V2/Confirm`;

    const confirmData = {
      id: parseInt(id),
      clientTxId: clientTransactionId
    };

    for (let intento = 1; intento <= maxReintentos; intento++) {
      try {
        this.logger.log(`🔐 Confirmando transacción - ID: ${id} (Intento ${intento}/${maxReintentos})`);
        this.logger.log(`📤 Enviando confirmación a: ${url}`);
        this.logger.log(`📦 Datos:`, JSON.stringify(confirmData, null, 2));

        const response = await firstValueFrom(
          this.httpService.post(url, confirmData, {
            headers: {
              Authorization: `Bearer ${this.payphoneToken}`,
              'Content-Type': 'application/json'
            },
            timeout: this.timeout
          })
        );

        this.logger.log(`✅ Confirmación exitosa - Status: ${response.status}`);
        this.logger.debug(`📋 Respuesta:`, JSON.stringify(response.data, null, 2));
        
        return response.data;
        
      } catch (error) {
        const esUltimoIntento = intento === maxReintentos;
        const esErrorRed = this.esErrorDeRed(error);

        this.logger.error(`💥 Error en confirmación (Intento ${intento}/${maxReintentos}):`, {
          message: error.message,
          code: error.code,
          response: error.response?.data,
          status: error.response?.status
        });

        // Si es error de red y no es el último intento, reintentar
        if (esErrorRed && !esUltimoIntento) {
          const tiempoEspera = tiempoEsperaMs * intento;
          this.logger.warn(`🔄 Error de red detectado. Reintentando en ${tiempoEspera}ms...`);
          await this.delay(tiempoEspera);
          continue;
        }

        // Si es el último intento, lanzar error
        if (esUltimoIntento) {
          this.logger.error(`❌ Confirmación falló después de ${maxReintentos} intentos`);
        }
        
        throw new Error('Error confirmando transacción con Payphone');
      }
    }
  }

  // ✅ MÉTODO PARA OBTENER ESTADO DE PAGO (sin cambios necesarios)
  async getPaymentStatus(clientTransactionId: string): Promise<any> {
    try {
      this.logger.log(`🔍 Buscando estado de pago en BD para: ${clientTransactionId}`);

      const paymentAttempt = await this.paymentAttemptRepo.findOne({
        where: { clientTransactionId }
      });

      if (!paymentAttempt) {
        this.logger.error(`❌ Pago no encontrado para clientTransactionId: ${clientTransactionId}`);
        throw new Error('Pago no encontrado');
      }

      this.logger.log(`✅ Estado encontrado: ${paymentAttempt.status}`);

      return {
        success: paymentAttempt.status === 'Approved',
        status: paymentAttempt.status,
        paymentId: paymentAttempt.payphoneId,
        clientTransactionId: paymentAttempt.clientTransactionId,
        amount: paymentAttempt.amount
      };
    } catch (error) {
      this.logger.error(`💥 Error obteniendo estado de pago: ${clientTransactionId}`, error.message);
      throw new InternalServerErrorException('Error al obtener estado del pago');
    }
  }
}