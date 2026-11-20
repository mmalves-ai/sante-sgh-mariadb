// Cliente SMTP mínimo (M06, fila `email`): envia texto simples por SMTP sem TLS, só para o servidor do
// SMTP_URL, que a trava de saídas (M01) limita ao Mailpit em loopback fora de produção. Sem dependência nova
// (node:net). Mensagem só com identificadores e códigos (nunca nome de paciente nem texto clínico).
import { connect, type Socket } from 'node:net';

export interface MensagemEmail {
  readonly de: string;
  readonly para: string;
  readonly assunto: string;
  readonly texto: string;
}

const ENDERECO = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}$/;

/** Cabeçalho em ASCII; assunto com acento vai em MIME (UTF-8, base64). */
function cabecalhoAssunto(assunto: string): string {
  return /^[\x20-\x7e]*$/.test(assunto)
    ? assunto
    : `=?UTF-8?B?${Buffer.from(assunto, 'utf8').toString('base64')}?=`;
}

export function montarMensagem(m: MensagemEmail, data = new Date()): string {
  if (!ENDERECO.test(m.de) || !ENDERECO.test(m.para)) throw new Error('Endereço de e-mail inválido.');
  const corpo = Buffer.from(m.texto, 'utf8')
    .toString('base64')
    .replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: ${m.de}`,
    `To: ${m.para}`,
    `Subject: ${cabecalhoAssunto(m.assunto)}`,
    `Date: ${data.toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    corpo,
  ].join('\r\n');
}

/** Envia pelo SMTP_URL (smtp://host:porta). Responde só quando o servidor aceitou a mensagem (250). */
export async function enviarSmtp(url: string, m: MensagemEmail, tempoMs = 10_000): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== 'smtp:') throw new Error('SMTP_URL: use smtp://.');
  const porta = Number(u.port || 25);
  const socket: Socket = connect({ host: u.hostname, port: porta });
  socket.setEncoding('utf8');
  socket.setTimeout(tempoMs, () => socket.destroy(new Error('SMTP: tempo esgotado')));
  let buffer = '';
  const esperas: ((linha: string) => void)[] = [];
  socket.on('data', (d: string) => {
    buffer += d;
    for (;;) {
      const i = buffer.indexOf('\r\n');
      if (i < 0) break;
      const linha = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      // Resposta multilinha (250-...): só a última linha (250 ...) encerra a espera.
      if (/^\d{3}-/.test(linha)) continue;
      esperas.shift()?.(linha);
    }
  });
  const erro = new Promise<never>((_, rejeitar) => {
    socket.once('error', rejeitar);
    socket.once('close', () => rejeitar(new Error('SMTP: conexão fechada')));
  });
  const resposta = (codigo: string) =>
    Promise.race([
      new Promise<void>((ok, falha) =>
        esperas.push((l) =>
          l.startsWith(codigo) ? ok() : falha(new Error(`SMTP: resposta ${l.slice(0, 3)} inesperada`)),
        ),
      ),
      erro,
    ]);
  const enviar = (linha: string, codigo: string) => {
    const r = resposta(codigo);
    socket.write(`${linha}\r\n`);
    return r;
  };
  try {
    await resposta('220');
    await enviar('EHLO sgh-worker', '250');
    await enviar(`MAIL FROM:<${m.de}>`, '250');
    await enviar(`RCPT TO:<${m.para}>`, '250');
    await enviar('DATA', '354');
    const dados = montarMensagem(m).replace(/^\./gm, '..');
    await enviar(`${dados}\r\n.`, '250');
    await enviar('QUIT', '221').catch(() => undefined);
  } finally {
    socket.removeAllListeners('close');
    socket.end();
    socket.destroy();
  }
}
