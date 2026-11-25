// Teste de conexão do servidor de e-mail (01-ADM L77): abre a conexão, espera a saudação do servidor (220) e o
// aceite da apresentação (250); com STARTTLS, exige que o servidor o anuncie e passa a conversa para TLS; quando o
// servidor exige autenticação, autentica (AUTH PLAIN) com o usuário cadastrado e a senha lida do cofre pela
// referência (C1-063). Não envia mensagem. A senha nunca vai a log, a erro nem ao detalhe devolvido à tela.
// Fora de produção (regra de nenhuma mensagem externa), só o servidor local (loopback ou container da própria
// máquina) é contatado; qualquer outro endereço é recusado sem abrir conexão.
import { connect as conectarTcp, type Socket } from 'node:net';
import { connect as conectarTls, type TLSSocket } from 'node:tls';
import { type Ambiente, containersLocais, ehDestinoLocal, envioExternoPermitido } from '@sgh/nucleo';
import { chaveMestra, resumoDoErro } from '@sgh/dominio-acesso';
import { cofreDoAmbiente } from '../assinatura/infra/cofre.js';

export interface ServidorParaTeste {
  readonly host: string;
  readonly porta: number;
  readonly seguranca: string;
  readonly tempoLimiteSegundos: number;
  /** Quando o servidor exige autenticação: o usuário e a referência da senha no cofre. */
  readonly usuario?: string | null;
  readonly referenciaCofre?: string | null;
}
export type ResultadoTesteConexao =
  | { readonly neutralizado: true }
  | { readonly neutralizado?: false; readonly sucesso: boolean; readonly detalhe: string };
export type TestadorConexao = (s: ServidorParaTeste) => Promise<ResultadoTesteConexao>;
export type LerSenhaCofre = (referencia: string) => Promise<string | null>;

/** Leitor de linhas da conversa SMTP; religado ao socket cifrado depois do STARTTLS. */
class Linhas {
  private buffer = '';
  private espera: ((r: { codigo: string; recursos: string[] }) => void) | null = null;
  private falha: ((e: Error) => void) | null = null;
  private recursos: string[] = [];
  private erro: Error | null = null;
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
        this.recursos.push(linha.slice(4).toUpperCase());
        if (/^\d{3}-/.test(linha)) continue;
        const ok = this.espera;
        this.espera = null;
        this.falha = null;
        ok?.({ codigo: linha.slice(0, 3), recursos: this.recursos });
        this.recursos = [];
      }
    });
    const falhou = (e: Error) => {
      this.erro = e;
      this.falha?.(e);
    };
    socket.once('error', falhou);
    socket.once('close', () => falhou(new Error('SMTP: conexão fechada')));
  }
  proxima(linha?: string): Promise<{ codigo: string; recursos: string[] }> {
    if (this.erro) return Promise.reject(this.erro);
    const r = new Promise<{ codigo: string; recursos: string[] }>((ok, falha) => {
      this.espera = ok;
      this.falha = falha;
    });
    if (linha !== undefined) this.socket.write(`${linha}\r\n`);
    return r;
  }
  soltar(): void {
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('close');
    this.socket.removeAllListeners('error');
    this.socket.setTimeout(0);
  }
}

const inesperada = (codigo: string) => new Error(`SMTP: resposta ${codigo} inesperada`);

/** A conversa do teste; devolve o aviso (texto vazio: tudo certo). */
export async function conversarTeste(
  socket: Socket | TLSSocket,
  s: { readonly host: string; readonly seguranca: string; readonly usuario?: string | null },
  senha: string | null,
  tempoMs: number,
): Promise<string> {
  const l = new Linhas(socket, tempoMs);
  try {
    let r = await l.proxima();
    if (r.codigo !== '220') throw inesperada(r.codigo);
    r = await l.proxima('EHLO sgh-api');
    if (r.codigo !== '250') throw inesperada(r.codigo);
    if (s.seguranca === 'starttls') {
      if (!r.recursos.some((x) => /^STARTTLS\b/.test(x)))
        return 'O servidor respondeu, mas não oferece STARTTLS.';
      const t = await l.proxima('STARTTLS');
      if (t.codigo !== '220') throw inesperada(t.codigo);
      l.soltar();
      const cifrado = conectarTls({ socket: l.socket as Socket, servername: s.host });
      await new Promise<void>((ok, falha) => {
        cifrado.once('secureConnect', () => ok());
        cifrado.once('error', falha);
      });
      cifrado.removeAllListeners('error');
      l.ligar(cifrado);
      r = await l.proxima('EHLO sgh-api');
      if (r.codigo !== '250') throw inesperada(r.codigo);
    }
    if (s.usuario) {
      if (!senha) return 'A senha do servidor não está no cofre: a autenticação não foi testada.';
      if (!r.recursos.some((x) => /^AUTH\b.*\bPLAIN\b/.test(x)))
        return 'O servidor respondeu, mas não oferece autenticação PLAIN.';
      const credencial = Buffer.from(`\u0000${s.usuario}\u0000${senha}`, 'utf8').toString('base64');
      const a = await l.proxima(`AUTH PLAIN ${credencial}`);
      if (a.codigo !== '235') return `O servidor recusou a autenticação (resposta ${a.codigo}).`;
    }
    l.socket.write('QUIT\r\n');
    return '';
  } finally {
    l.soltar();
  }
}

/** O leitor da senha no cofre do ambiente (o mesmo cofre de arquivo da API); null quando indisponível. */
export function senhaDoCofreDoAmbiente(env: Ambiente): LerSenhaCofre | null {
  const cofre = cofreDoAmbiente(env, chaveMestra(env['PLATAFORMA_CHAVE_MESTRA']), process.cwd());
  if (!cofre.disponivel) return null;
  return async (referencia) => {
    try {
      return await cofre.ler(referencia);
    } catch {
      return null;
    }
  };
}

/** O testador real, preso ao ambiente: fora de produção só fala com o servidor local. */
export function testadorDoAmbiente(
  env: Ambiente,
  lerSenha: LerSenhaCofre | null = senhaDoCofreDoAmbiente(env),
): TestadorConexao {
  return async (s) => {
    if (!envioExternoPermitido(env) && !ehDestinoLocal(s.host, containersLocais(env)))
      return { neutralizado: true };
    const tempoMs = Math.min(Math.max(s.tempoLimiteSegundos, 5), 300) * 1000;
    const senha = s.usuario && s.referenciaCofre && lerSenha ? await lerSenha(s.referenciaCofre) : null;
    const socket: Socket =
      s.seguranca === 'ssl_tls'
        ? conectarTls({ host: s.host, port: s.porta, servername: s.host })
        : conectarTcp({ host: s.host, port: s.porta });
    try {
      const aviso = await conversarTeste(socket, s, senha, tempoMs);
      if (aviso) return { sucesso: false, detalhe: aviso };
      return {
        sucesso: true,
        detalhe: s.usuario ? 'Servidor respondeu e aceitou a autenticação.' : 'Servidor respondeu.',
      };
    } catch (e) {
      return { sucesso: false, detalhe: resumoDoErro(e) };
    } finally {
      socket.destroy();
    }
  };
}
