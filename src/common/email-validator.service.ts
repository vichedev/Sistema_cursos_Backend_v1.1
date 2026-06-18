// src/common/email-validator.service.ts
// Validador de correos en capas: sintaxis → dominio MX (DNS) → desechables/typos
// → sondeo SMTP (verifica el buzón sin enviar; best-effort, puede ser bloqueado).
import { Injectable, Logger } from '@nestjs/common';
import * as dns from 'dns';
import * as net from 'net';

const resolveMx = dns.promises.resolveMx;

export type SmtpResultado = 'valido' | 'invalido' | 'desconocido' | 'omitido';
export type EstadoCorreo = 'valido' | 'riesgoso' | 'invalido';

export interface EmailValidation {
  email: string;
  sintaxis: boolean;
  dominio: string;
  mx: boolean;
  desechable: boolean;
  smtp: SmtpResultado;
  estado: EstadoCorreo;
  razon: string;
  sugerencia?: string | null;
}

@Injectable()
export class EmailValidatorService {
  private readonly logger = new Logger(EmailValidatorService.name);

  // Dominios temporales/desechables comunes (no se permiten)
  private readonly disposable = new Set([
    'mailinator.com', '10minutemail.com', 'guerrillamail.com', 'tempmail.com', 'temp-mail.org',
    'yopmail.com', 'sharklasers.com', 'trashmail.com', 'getnada.com', 'maildrop.cc', 'dispostable.com',
    'fakeinbox.com', 'mailnesia.com', 'throwawaymail.com', 'mintemail.com', 'mohmal.com', 'emailondeck.com',
    'tempmailo.com', 'tmpmail.org', 'tmpmail.net', 'moakt.com', 'spam4.me', 'mailtemp.net', 'discard.email',
  ]);

  // Proveedores conocidos: se aceptan como válidos sin depender de la consulta MX
  // (evita falsos negativos cuando el DNS del servidor no resuelve MX directos).
  private readonly trustedProviders = new Set([
    'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'hotmail.com.ar',
    'outlook.com', 'outlook.es', 'live.com', 'live.com.mx', 'msn.com',
    'yahoo.com', 'yahoo.es', 'yahoo.com.mx', 'ymail.com', 'rocketmail.com',
    'icloud.com', 'me.com', 'mac.com', 'aol.com',
    'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.es',
    'zoho.com', 'mail.com', 'yandex.com',
  ]);

  // Errores de tipeo frecuentes en dominios → sugerencia de corrección
  private readonly typos: Record<string, string> = {
    'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.co': 'gmail.com',
    'gmail.con': 'gmail.com', 'gamil.com': 'gmail.com', 'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com',
    'hotmail.con': 'hotmail.com', 'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com',
    'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'icloud.con': 'icloud.com',
  };

  isValidSyntax(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email || '').trim());
  }

  /**
   * Valida un correo. Con `opts.smtp = true` intenta verificar el buzón vía SMTP
   * (best-effort; puede quedar "desconocido" si el proveedor bloquea o el puerto
   * 25 saliente está cerrado).
   */
  async validate(email: string, opts: { smtp?: boolean } = {}): Promise<EmailValidation> {
    const e = (email || '').trim().toLowerCase();
    const res: EmailValidation = {
      email: e, sintaxis: false, dominio: '', mx: false, desechable: false,
      smtp: 'omitido', estado: 'invalido', razon: '', sugerencia: null,
    };

    if (!this.isValidSyntax(e)) {
      res.razon = 'Formato de correo inválido';
      return res;
    }
    res.sintaxis = true;
    const dominio = e.split('@')[1];
    res.dominio = dominio;

    if (this.typos[dominio]) {
      res.estado = 'invalido';
      res.sugerencia = e.replace(`@${dominio}`, `@${this.typos[dominio]}`);
      res.razon = `El dominio parece un error de tipeo. ¿Quisiste decir ${res.sugerencia}?`;
      return res;
    }

    if (this.disposable.has(dominio)) {
      res.desechable = true;
      res.estado = 'invalido';
      res.razon = 'Correo temporal/desechable no permitido';
      return res;
    }

    // Proveedores conocidos (Gmail, Outlook, etc.): válidos directamente.
    // No se sondea SMTP porque aceptan cualquier RCPT (catch-all) → no aporta.
    if (this.trustedProviders.has(dominio)) {
      res.mx = true;
      res.smtp = 'omitido';
      res.estado = 'valido';
      res.razon = 'Proveedor de correo conocido y válido';
      return res;
    }

    const mxHosts = await this.resolveMxRobust(dominio);
    res.mx = mxHosts.length > 0;

    if (!res.mx) {
      // Sin MX detectable: ¿el dominio al menos existe (registro A/AAAA)?
      const existe = await this.domainResolves(dominio);
      if (!existe) {
        res.estado = 'invalido';
        res.razon = 'El dominio no existe o no tiene servidor de correo. El correo probablemente no existe';
        return res;
      }
      // El dominio existe pero no se confirmó MX → dudoso, NO se bloquea.
      res.estado = 'riesgoso';
      res.razon = 'No se pudo confirmar el servidor de correo (MX) del dominio';
      return res;
    }

    if (opts.smtp) {
      const best = mxHosts.sort((a, b) => a.priority - b.priority)[0].exchange;
      res.smtp = await this.smtpProbe(e, best);
    }

    if (res.smtp === 'invalido') {
      res.estado = 'invalido';
      res.razon = 'El buzón no existe en el servidor de correo';
    } else if (res.smtp === 'valido') {
      res.estado = 'valido';
      res.razon = 'Correo válido y existente';
    } else {
      res.estado = 'riesgoso';
      res.razon =
        res.smtp === 'omitido'
          ? 'Dominio con servidor de correo válido (no se sondeó el buzón)'
          : 'Dominio válido, pero el servidor no confirmó la existencia del buzón';
    }

    return res;
  }

  /**
   * Resuelve los registros MX con reintento contra DNS público (8.8.8.8 / 1.1.1.1),
   * por si el resolver del sistema operativo no responde a consultas MX directas.
   */
  private async resolveMxRobust(dominio: string): Promise<dns.MxRecord[]> {
    try {
      const r = await resolveMx(dominio);
      if (r && r.length) return r;
    } catch {
      /* el resolver del sistema falló → reintentar con DNS público */
    }
    try {
      const resolver = new dns.promises.Resolver();
      resolver.setServers(['8.8.8.8', '1.1.1.1']);
      const r = await resolver.resolveMx(dominio);
      return r && r.length ? r : [];
    } catch {
      return [];
    }
  }

  /** ¿El dominio existe? (registro A/AAAA vía el resolver del sistema). */
  private async domainResolves(dominio: string): Promise<boolean> {
    try {
      await dns.promises.lookup(dominio);
      return true;
    } catch {
      return false;
    }
  }

  /** Sondeo SMTP (RCPT TO) sin enviar correo. Puerto 25 — a veces bloqueado. */
  private smtpProbe(email: string, mxHost: string): Promise<SmtpResultado> {
    return new Promise((resolve) => {
      let stage = 0;
      let done = false;
      const socket = net.createConnection(25, mxHost);
      const finish = (r: SmtpResultado) => {
        if (done) return;
        done = true;
        try { socket.write('QUIT\r\n'); socket.end(); } catch { /* ignore */ }
        resolve(r);
      };
      socket.setTimeout(7000);
      socket.on('timeout', () => finish('desconocido'));
      socket.on('error', () => finish('desconocido'));
      const cmds = ['HELO maat.ec\r\n', 'MAIL FROM:<verify@maat.ec>\r\n', `RCPT TO:<${email}>\r\n`];
      socket.on('data', (buf) => {
        const code = parseInt(buf.toString().slice(0, 3), 10);
        if (stage === 0) {
          if (code !== 220) return finish('desconocido');
          socket.write(cmds[0]); stage++; return;
        }
        if (stage === 1) {
          if (code !== 250) return finish('desconocido');
          socket.write(cmds[1]); stage++; return;
        }
        if (stage === 2) {
          if (code !== 250) return finish('desconocido');
          socket.write(cmds[2]); stage++; return;
        }
        if (stage === 3) {
          if (code === 250 || code === 251) return finish('valido');
          if ([550, 551, 553, 554, 501, 502].includes(code)) return finish('invalido');
          return finish('desconocido');
        }
      });
    });
  }
}
