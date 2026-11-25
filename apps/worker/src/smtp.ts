// Cliente SMTP mínimo (M06, fila `email`): envia texto simples pelo servidor do SMTP_URL (fora de produção o
// Mailpit em loopback, pela trava de saídas M01) ou, desde 01-ADM L77, pelo servidor de e-mail cadastrado no cliente
// (SSL/TLS direto ou STARTTLS, autenticação PLAIN com a senha lida do cofre). Sem dependência nova (node:net e
// node:tls). Mensagem só com identificadores e códigos (nunca nome de paciente nem texto clínico); a senha nunca vai a
// log nem a erro.
import { connect, type Socket } from 'node:net';
import { connect as conectarTls, type TLSSocket } from 'node:tls';

export interface MensagemEmail {
  readonly de: string;
  readonly para: string;
  readonly assunto: string;
  readonly texto: string;
  /** Nome de exibição do remetente (do cadastro do servidor ou do modelo). */
  readonly deNome?: string | null;
  /** Endereço para a resposta (cabeçalho Reply-To). */
  readonly responderPara?: string | null;
  /** Identificador da mensagem (cabeçalho Message-ID), estável entre as tentativas; registrado no envio. */
  readonly idMensagem?: string;
}

const ENDERECO = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}$/;
const ID_MENSAGEM = /^<[A-Za-z0-9._-]{1,150}@[A-Za-z0-9.-]{1,100}>$/;

/** Cabeçalho em ASCII; assunto com acento vai em MIME (UTF-8, base64). */
function cabecalhoAssunto(assunto: string): string {
  return /^[\x20-\x7e]*$/.test(assunto)
    ? assunto
    : `=?UTF-8?B?${Buffer.from(assunto, 'utf8').toString('base64')}?=`;
}

export function montarMensagem(m: MensagemEmail, data = new Date()): string {
  if (!ENDERECO.test(m.de) || !ENDERECO.test(m.para)) throw new Error('Endereço de e-mail inválido.');
  if (m.responderPara && !ENDERECO.test(m.responderPara)) throw new Error('Endereço de e-mail inválido.');
  const nome = m.deNome?.replace(/[\r\n"]/g, ' ').trim();
  if (m.idMensagem !== undefined && !ID_MENSAGEM.test(m.idMensagem))
    throw new Error('Identificador da mensagem fora do formato.');
  const corpo = Buffer.from(m.texto, 'utf8')
    .toString('base64')
    .replace(/.{1,76}/g, '$&\r\n');
  return [
    nome ? `From: "${cabecalhoAssunto(nome)}" <${m.de}>` : `From: ${m.de}`,
    `To: ${m.para}`,
    `Subject: ${cabecalhoAssunto(m.assunto)}`,
    `Date: ${data.toUTCString()}`,
    ...(m.responderPara ? [`Reply-To: ${m.responderPara}`] : []),
    ...(m.idMensagem ? [`Message-ID: ${m.idMensagem}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    corpo,
  ].join('\r\n');
}

/** Por onde a mensagem sai (o servidor do ambiente ou o cadastrado no cliente). */
export interface ConexaoSmtp {
  readonly host: string;
  readonly porta: number;
  readonly seguranca: 'nenhuma' | 'ssl_tls' | 'starttls';
  /** Usuário e senha da autenticação (senha lida do cofre); sem eles, não autentica. */
  readonly usuario?: string | null;
  readonly senha?: string | null;
  readonly tempoMs?: number;
}

/** A conexão do SMTP_URL (smtp://host:porta, sem TLS nem autenticação). */
export function conexaoDoUrl(url: string): ConexaoSmtp {
  const u = new URL(url);
  if (u.protocol !== 'smtp:') throw new Error('SMTP_URL: use smtp://.');
  return { host: u.hostname, porta: Number(u.port || 25), seguranca: 'nenhuma' };
}

/** Envia pelo SMTP_URL (smtp://host:porta). Responde só quando o servidor aceitou a mensagem (250). */
export async function enviarSmtp(url: string, m: MensagemEmail, tempoMs = 10_000): Promise<void> {
  return enviarPelaConexao({ ...conexaoDoUrl(url), tempoMs }, m);
}

/** Conversa linha a linha com o servidor; o leitor é religado ao socket cifrado depois do STARTTLS. */
class Conversa {
  private buffer = '';
  private esperas: ((linha: string) => void)[] = [];
  private recursos: string[] = [];
  private falhaPendente: Error | null = null;
  private rejeitar: ((e: Error) => void) | null = null;
  constructor(
    public socket: Socket | TLSSocket,
    private readonly tempoMs: number,
  ) {
    this.ligar(socket);
  }
  ligar(socket: Socket | TLSSocket): void {
    this.socket = socket;
    this.buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(this.tempoMs, () => socket.destroy(new Error('SMTP: tempo esgotado')));
    socket.on('data', (d: string) => {
      this.buffer += d;
      for (;;) {
        const i = this.buffer.indexOf('\r\n');
        if (i < 0) break;
        const linha = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 2);
        // Resposta multilinha (250-...): guarda o recurso; só a última linha (250 ...) encerra a espera.
        this.recursos.push(linha.slice(4).toUpperCase());
        if (/^\d{3}-/.test(linha)) continue;
        this.esperas.shift()?.(linha);
      }
    });
    const falhou = (e: Error) => {
      this.falhaPendente = e;
      this.rejeitar?.(e);
    };
    socket.once('error', falhou);
    socket.once('close', () => falhou(new Error('SMTP: conexão fechada')));
  }
  resposta(codigo: string): Promise<string[]> {
    if (this.falhaPendente) return Promise.reject(this.falhaPendente);
    return new Promise((ok, falha) => {
      this.rejeitar = falha;
      this.recursos = [];
      this.esperas.push((l) => {
        this.rejeitar = null;
        if (l.startsWith(codigo)) ok(this.recursos);
        else falha(new Error(`SMTP: resposta ${l.slice(0, 3)} inesperada`));
      });
    });
  }
  enviar(linha: string, codigo: string): Promise<string[]> {
    const r = this.resposta(codigo);
    this.socket.write(`${linha}\r\n`);
    return r;
  }
  soltar(): void {
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('close');
    this.socket.removeAllListeners('error');
    this.socket.setTimeout(0);
  }
}

/** Envia pela conexão dada. Responde só quando o servidor aceitou a mensagem (250). */
export async function enviarPelaConexao(c: ConexaoSmtp, m: MensagemEmail): Promise<void> {
  // A senha (AUTH PLAIN, só base64) nunca vai por canal sem cifra: falha fechada antes de conectar.
  if (c.usuario && c.seguranca !== 'ssl_tls' && c.seguranca !== 'starttls')
    throw new Error('SMTP: autenticação exige SSL/TLS ou STARTTLS');
  const tempoMs = c.tempoMs ?? 10_000;
  const bruto: Socket | TLSSocket =
    c.seguranca === 'ssl_tls'
      ? conectarTls({ host: c.host, port: c.porta, servername: c.host })
      : connect({ host: c.host, port: c.porta });
  const conversa = new Conversa(bruto, tempoMs);
  try {
    await conversa.resposta('220');
    let recursos = await conversa.enviar('EHLO sgh-worker', '250');
    if (c.seguranca === 'starttls') {
      if (!recursos.some((r) => /^STARTTLS\b/.test(r))) throw new Error('SMTP: servidor sem STARTTLS');
      await conversa.enviar('STARTTLS', '220');
      conversa.soltar();
      const cifrado = conectarTls({ socket: conversa.socket as Socket, servername: c.host });
      await new Promise<void>((ok, falha) => {
        cifrado.once('secureConnect', () => ok());
        cifrado.once('error', falha);
      });
      cifrado.removeAllListeners('error');
      conversa.ligar(cifrado);
      recursos = await conversa.enviar('EHLO sgh-worker', '250');
    }
    if (c.usuario) {
      if (!c.senha) throw new Error('SMTP: senha indisponível');
      if (!recursos.some((r) => /^AUTH\b.*\bPLAIN\b/.test(r)))
        throw new Error('SMTP: servidor sem autenticação PLAIN');
      const credencial = Buffer.from(`\u0000${c.usuario}\u0000${c.senha}`, 'utf8').toString('base64');
      await conversa.enviar(`AUTH PLAIN ${credencial}`, '235');
    }
    await conversa.enviar(`MAIL FROM:<${m.de}>`, '250');
    await conversa.enviar(`RCPT TO:<${m.para}>`, '250');
    await conversa.enviar('DATA', '354');
    const dados = montarMensagem(m).replace(/^\./gm, '..');
    await conversa.enviar(`${dados}\r\n.`, '250');
    await conversa.enviar('QUIT', '221').catch(() => undefined);
  } finally {
    conversa.soltar();
    conversa.socket.end();
    conversa.socket.destroy();
  }
}
