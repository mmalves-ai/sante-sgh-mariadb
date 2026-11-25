// 01-ADM L77: envio pelo servidor cadastrado (autenticação PLAIN com a senha do cofre, STARTTLS exigido quando
// cadastrado, remetente com nome e "responder para"), provado contra um servidor SMTP falso em loopback.
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { conexaoDoUrl, enviarPelaConexao, montarMensagem } from './smtp.js';

let servidor: Server | null = null;
afterEach(async () => {
  await new Promise<void>((ok) => (servidor ? servidor.close(() => ok()) : ok()));
  servidor = null;
});

/** Servidor falso: anuncia os recursos dados e guarda as linhas recebidas (fora do DATA). */
function smtpFalso(recursos: string[], recebido: string[]): Promise<number> {
  return new Promise((ok) => {
    servidor = createServer((s) => {
      s.setEncoding('utf8');
      let dados = false;
      let buf = '';
      s.write('220 falso\r\n');
      s.on('data', (d: string) => {
        buf += d;
        for (;;) {
          const i = buf.indexOf('\r\n');
          if (i < 0) break;
          const l = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (dados) {
            if (l === '.') {
              dados = false;
              s.write('250 ok\r\n');
            } else recebido.push(`D:${l}`);
            continue;
          }
          recebido.push(l);
          if (l.startsWith('EHLO'))
            s.write([...recursos.map((r) => `250-${r}`), '250 SIZE 1000'].join('\r\n') + '\r\n');
          else if (l.startsWith('AUTH PLAIN')) s.write('235 ok\r\n');
          else if (l === 'DATA') {
            dados = true;
            s.write('354 vai\r\n');
          } else if (l === 'QUIT') s.end('221 tchau\r\n');
          else s.write('250 ok\r\n');
        }
      });
    });
    servidor.listen(0, '127.0.0.1', () => {
      const a = servidor!.address();
      ok(typeof a === 'object' && a ? a.port : 0);
    });
  });
}

const msg = {
  de: 'nao-responda@sintetico.invalid',
  deNome: 'HOSPITAL SINTÉTICO',
  responderPara: 'auditoria@sintetico.invalid',
  para: 'destino@sintetico.invalid',
  assunto: 'ALERTA SINTETICO',
  texto: 'TEXTO',
};

describe('envio pelo servidor cadastrado', () => {
  it('autentica com PLAIN (usuário e senha do cofre) antes do envelope', async () => {
    const recebido: string[] = [];
    const porta = await smtpFalso(['AUTH LOGIN PLAIN'], recebido);
    await enviarPelaConexao(
      { host: '127.0.0.1', porta, seguranca: 'nenhuma', usuario: 'envio', senha: 'Sintetica#1' },
      msg,
    );
    const auth = recebido.find((l) => l.startsWith('AUTH PLAIN '));
    expect(Buffer.from(auth!.slice(11), 'base64').toString('utf8')).toBe('\u0000envio\u0000Sintetica#1');
    expect(recebido.indexOf(auth!)).toBeLessThan(
      recebido.indexOf('MAIL FROM:<nao-responda@sintetico.invalid>'),
    );
    expect(recebido).toContain('D:Reply-To: auditoria@sintetico.invalid');
    expect(recebido.some((l) => l.startsWith('D:From: "=?UTF-8?B?'))).toBe(true);
  });
  it('sem usuário não autentica; sem senha ou sem PLAIN anunciado, recusa sem enviar', async () => {
    const recebido: string[] = [];
    const porta = await smtpFalso([], recebido);
    await enviarPelaConexao({ host: '127.0.0.1', porta, seguranca: 'nenhuma' }, msg);
    expect(recebido.some((l) => l.startsWith('AUTH'))).toBe(false);
    await expect(
      enviarPelaConexao(
        { host: '127.0.0.1', porta, seguranca: 'nenhuma', usuario: 'envio', senha: 'x' },
        msg,
      ),
    ).rejects.toThrow('sem autenticação PLAIN');
    await expect(
      enviarPelaConexao(
        { host: '127.0.0.1', porta, seguranca: 'nenhuma', usuario: 'envio', senha: null },
        msg,
      ),
    ).rejects.toThrow('senha indisponível');
    expect(recebido.filter((l) => l.startsWith('MAIL FROM'))).toHaveLength(1);
  });
  it('STARTTLS cadastrado e não anunciado: recusa (nunca cai para texto aberto)', async () => {
    const recebido: string[] = [];
    const porta = await smtpFalso([], recebido);
    await expect(enviarPelaConexao({ host: '127.0.0.1', porta, seguranca: 'starttls' }, msg)).rejects.toThrow(
      'sem STARTTLS',
    );
    expect(recebido.some((l) => l.startsWith('MAIL FROM'))).toBe(false);
  });
  it('SMTP_URL vira conexão sem segurança; Reply-To inválido é recusado', () => {
    expect(conexaoDoUrl('smtp://127.0.0.1:1025')).toEqual({
      host: '127.0.0.1',
      porta: 1025,
      seguranca: 'nenhuma',
    });
    expect(() => montarMensagem({ ...msg, responderPara: 'x' })).toThrow('inválido');
  });
});
