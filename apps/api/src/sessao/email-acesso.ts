// Família acesso-email (modulos-proprios-2): o e-mail da porta de entrada (link do "Esqueci a senha" e código do
// segundo fator). Envio direto por SMTP (SMTP_URL), sem dependência nova (node:net), no mesmo formato do cliente SMTP
// do worker. Regra 6: fora de produção o SMTP_URL só pode apontar para a captura local (Mailpit em loopback); outro
// destino recusa a montagem (a API nem parte com ele). Sem SMTP_URL: sem envio (os recursos que dependem dele ficam
// indisponíveis, nunca caem calados). Texto só com o necessário: nunca senha, resumo ou dado clínico.
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface MensagemAcesso {
  readonly para: string;
  readonly assunto: string;
  readonly texto: string;
}

/** O envio do e-mail da porta de entrada. Lança quando o servidor não aceitou a mensagem. */
export interface PortaEmailAcesso {
  readonly destino: 'smtp' | 'memoria';
  enviar(m: MensagemAcesso): Promise<void>;
}

/** Endereço aceito no envelope (o mesmo do worker; nada de vírgula, espaço ou quebra de linha). */
export const ENDERECO_EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}$/;
export const REMETENTE_ACESSO_PADRAO = 'nao-responda@sgh.local';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** E-mail do dono (canal de avisos da obra): DONO_EMAIL do ambiente, senão o padrão de tools/obra/avisar_dono.py. */
export function emailDoDono(env: Readonly<Record<string, string | undefined>>): string {
  return (env['DONO_EMAIL']?.trim() || 'mmalves@hal-ai.com').toLowerCase();
}

/**
 * Entrega pelo canal de avisos da obra (tools/obra/avisar_dono.py, SES), só ao e-mail do dono. O texto (com link ou
 * código) passa por arquivo temporário 0600, apagado no fim: nunca por argumento de processo, saída ou log.
 */
export function envioPeloCanalDoDono(
  env: Readonly<Record<string, string | undefined>>,
  raiz: string,
): PortaEmailAcesso {
  return {
    destino: 'smtp',
    async enviar(m) {
      if (m.para.toLowerCase() !== emailDoDono(env))
        throw new Error('recusado: o canal do dono só entrega ao e-mail do dono');
      if (/[\r\n]/.test(m.assunto)) throw new Error('Assunto inválido.');
      const dir = mkdtempSync(join(tmpdir(), 'acesso-'));
      const arq = join(dir, 'mensagem.txt');
      try {
        writeFileSync(arq, m.texto, { mode: 0o600 });
        await new Promise<void>((ok, falha) =>
          execFile(
            'python3',
            [
              '-I',
              join(raiz, 'tools/obra/avisar_dono.py'),
              '--assunto',
              m.assunto,
              '--arquivo',
              arq,
              '--para',
              m.para,
            ],
            { timeout: 30_000 },
            (e) => (e ? falha(new Error('canal do dono: envio recusado')) : ok()),
          ),
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

/** Testes e dev sem SMTP: guarda as mensagens em memória (nada sai do processo). */
export function emailAcessoMemoria(): PortaEmailAcesso & { readonly enviadas: MensagemAcesso[] } {
  const enviadas: MensagemAcesso[] = [];
  return {
    destino: 'memoria',
    enviadas,
    enviar(m) {
      if (!ENDERECO_EMAIL.test(m.para)) return Promise.reject(new Error('Endereço de e-mail inválido.'));
      enviadas.push(m);
      return Promise.resolve();
    },
  };
}

/**
 * O envio pelo ambiente: SMTP_URL (smtp://host:porta) e EMAIL_REMETENTE. Fora de produção (AMBIENTE diferente de
 * `producao`), só loopback; senão lança (a montagem é recusada). Sem SMTP_URL, null.
 */
export function emailAcessoDoAmbiente(env: NodeJS.ProcessEnv): PortaEmailAcesso | null {
  const url = env['SMTP_URL']?.trim();
  // Canal do dono (decisão do dono, 24/11/2026: "para o admin, que sou eu, pode mandar"): fora de produção, com
  // ACESSO_EMAIL_CANAL_DONO=sim, o e-mail de acesso cujo destinatário é o dono vai à caixa real dele pelo canal de
  // avisos da obra (SES); qualquer outro destinatário segue para a captura local (SMTP em loopback) ou é recusado.
  if ((env['AMBIENTE'] ?? 'dev') !== 'producao' && env['ACESSO_EMAIL_CANAL_DONO']?.trim() === 'sim') {
    const dono = envioPeloCanalDoDono(env, env['SGH_RAIZ_REPOSITORIO']?.trim() || process.cwd());
    const resto = url ? emailAcessoDoAmbiente({ ...env, ACESSO_EMAIL_CANAL_DONO: '' }) : null;
    return {
      destino: 'smtp',
      enviar: (m) =>
        m.para.toLowerCase() === emailDoDono(env)
          ? dono.enviar(m)
          : resto
            ? resto.enviar(m)
            : Promise.reject(new Error('Neste ambiente só o e-mail do dono é entregue.')),
    };
  }
  if (!url) return null;
  const u = new URL(url);
  if (u.protocol !== 'smtp:') throw new Error('SMTP_URL: use smtp://.');
  if ((env['AMBIENTE'] ?? 'dev') !== 'producao' && !LOOPBACK.has(u.hostname))
    throw new Error('SMTP_URL: fora de produção, só a captura local em loopback.');
  const de = env['EMAIL_REMETENTE']?.trim() || REMETENTE_ACESSO_PADRAO;
  if (!ENDERECO_EMAIL.test(de)) throw new Error('EMAIL_REMETENTE inválido.');
  return { destino: 'smtp', enviar: (m) => enviarSmtpAcesso(url, de, m) };
}

function cabecalhoAssunto(assunto: string): string {
  return /^[\x20-\x7e]*$/.test(assunto)
    ? assunto
    : `=?UTF-8?B?${Buffer.from(assunto, 'utf8').toString('base64')}?=`;
}

export function montarMensagemAcesso(de: string, m: MensagemAcesso, data = new Date()): string {
  if (!ENDERECO_EMAIL.test(de) || !ENDERECO_EMAIL.test(m.para))
    throw new Error('Endereço de e-mail inválido.');
  if (/[\r\n]/.test(m.assunto)) throw new Error('Assunto inválido.');
  const corpo = Buffer.from(m.texto, 'utf8')
    .toString('base64')
    .replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: ${de}`,
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

/** Envia por SMTP sem TLS (captura local fora de produção). Resolve só com o 250 do servidor. */
export async function enviarSmtpAcesso(
  url: string,
  de: string,
  m: MensagemAcesso,
  tempoMs = 10_000,
): Promise<void> {
  const u = new URL(url);
  const dados = montarMensagemAcesso(de, m).replace(/^\./gm, '..');
  const socket: Socket = connect({ host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port || 25) });
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
      if (/^\d{3}-/.test(linha)) continue;
      esperas.shift()?.(linha);
    }
  });
  const erro = new Promise<never>((_, rejeitar) => {
    socket.once('error', rejeitar);
    socket.once('close', () => rejeitar(new Error('SMTP: conexão fechada')));
  });
  erro.catch(() => undefined);
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
    await enviar('EHLO sgh-api', '250');
    await enviar(`MAIL FROM:<${de}>`, '250');
    await enviar(`RCPT TO:<${m.para}>`, '250');
    await enviar('DATA', '354');
    await enviar(`${dados}\r\n.`, '250');
    await enviar('QUIT', '221').catch(() => undefined);
  } finally {
    socket.removeAllListeners('close');
    socket.end();
    socket.destroy();
  }
}
