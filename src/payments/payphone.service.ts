// src/payments/payphone.service.ts
import { Injectable, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentAttempt } from './payment-attempt.entity';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class PayphoneService implements OnModuleInit {
  private readonly logger = new Logger(PayphoneService.name);
  private payphoneApiUrl: string;
  private payphoneStoreId: string;
  private payphoneToken: string;
  private frontendUrl: string;
  private backendUrl: string;
  private timeout: number;

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
    @InjectRepository(PaymentAttempt)
    private paymentAttemptRepo: Repository<PaymentAttempt>,
  ) {}

  onModuleInit() {
    this.payphoneApiUrl = this.configService.get<string>('PAYPHONE_API_URL') || '';
    this.payphoneStoreId = this.configService.get<string>('PAYPHONE_STORE_ID') || '';
    this.payphoneToken = this.configService.get<string>('PAYPHONE_TOKEN') || '';
    this.frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    this.backendUrl = this.configService.get<string>('BACKEND_URL') || 'http://localhost:3001';
    this.timeout = this.configService.get<number>('PAYPHONE_TIMEOUT') || 10000;

    this.validateConfig();
  }

  private validateConfig(): void {
    const requiredConfigs = {
      PAYPHONE_API_URL: this.payphoneApiUrl,
      PAYPHONE_STORE_ID: this.payphoneStoreId,
      PAYPHONE_TOKEN: this.payphoneToken,
      FRONTEND_URL: this.frontendUrl,
      BACKEND_URL: this.backendUrl
    };

    Object.entries(requiredConfigs).forEach(([key, value]) => {
      if (!value) {
        this.logger.error(`❌ Configuración faltante en .env: ${key}`);
        throw new Error(`Configuración faltante en .env: ${key}`);
      }
    });

    this.logger.log(`✅ Payphone configurado - Store ID: ${this.payphoneStoreId}`);
    this.logger.log(`✅ Frontend URL: ${this.frontendUrl}`);
    this.logger.log(`✅ Backend URL: ${this.backendUrl}`);
    this.logger.log(`✅ Response URL: ${this.backendUrl}/payments/payphone-confirm`);
  }

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

    const totalAmountInCents = Math.round(amount * 100);
    const taxRate = 0.15;
    const amountWithTaxCents = Math.round(totalAmountInCents / (1 + taxRate));
    const taxCents = totalAmountInCents - amountWithTaxCents;

    // URLs según la documentación de Payphone
    const responseUrl = `${currentBackendUrl}/payments/payphone-confirm`;
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
      responseUrl: responseUrl, // URL donde Payphone redirige después del pago
      cancellationUrl: cancellationUrl,
      reference: "Inscripción a Cursos de MAAT ACADEMY",
      // Campos opcionales según la documentación
      phoneNumber: null,
      email: null,
      documentId: null,
      optionalParameter: JSON.stringify(metadata || {})
    };

    this.logger.log(`🚀 Iniciando pago en Payphone`);
    this.logger.log(`   API URL: ${this.payphoneApiUrl}/api/button/Prepare`);
    this.logger.log(`   Client Transaction ID: ${clientTransactionId}`);
    this.logger.log(`   Amount: $${amount} (${totalAmountInCents} cents)`);
    this.logger.debug(`   Payload completo:`, JSON.stringify(paymentData, null, 2));

    try {
      const targetUrl = `${this.payphoneApiUrl}/api/button/Prepare`;

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
      this.logger.error(`💥 Error al crear pago en Payphone:`, {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        url: `${this.payphoneApiUrl}/api/button/Prepare`
      });

      await this.paymentAttemptRepo.update(
        { clientTransactionId },
        { status: 'ERROR_INICIO_PAGO' }
      );

      throw new InternalServerErrorException('Error al iniciar el pago con Payphone');
    }
  }

  // Método para confirmar transacción con Payphone (V2)
  async confirmTransaction(id: string, clientTransactionId: string): Promise<any> {
    try {
      this.logger.log(`🔐 Confirmando transacción con Payphone - ID: ${id}`);
      
      const url = `${this.payphoneApiUrl}/api/button/V2/Confirm`;
      
      // Estructura según documentación oficial
      const confirmData = {
        id: parseInt(id), // Debe ser número entero
        clientTxId: clientTransactionId // Nombre exacto según documentación
      };

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
      this.logger.error(`💥 Error en confirmación:`, {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      throw new Error('Error confirmando transacción con Payphone');
    }
  }

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