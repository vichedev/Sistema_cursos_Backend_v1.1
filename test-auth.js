const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'mail.maat.ec',
  port: 587,
  secure: false,
  auth: {
    user: 'cursos@maat.ec',
    pass: 'Lz83b4bemEWC86LAEbEp',
  },
  tls: {
    rejectUnauthorized: false,
  },
  connectionTimeout: 60000,
  debug: true, // ✅ ESTO ES CLAVE
  logger: true,
});

console.log('🔌 Conectando...');

transporter.verify((error, success) => {
  if (error) {
    console.log('\n❌ ERROR COMPLETO:');
    console.log(error);
  } else {
    console.log('\n✅ SERVIDOR LISTO');
    console.log('Enviando email de prueba...');

    transporter.sendMail(
      {
        from: 'cursos@maat.ec',
        to: 'codermax119@gmail.com',
        subject: 'Test de conexión',
        text: 'Prueba exitosa',
      },
      (err, info) => {
        if (err) {
          console.log('❌ Error al enviar:', err);
        } else {
          console.log('✅ Enviado:', info.messageId);
        }
      },
    );
  }
});
