// 01-ADM L77 (C1-063): o teste de conexão autentica (AUTH PLAIN) com a senha lida do cofre quando o servidor exige
// autenticação; sem a senha no cofre ou com a autenticação recusada, o resultado é falha com o motivo (sem a senha);
// STARTTLS cadastrado e não anunciado é falha. Servidor SMTP falso
// em loopback (nada sai da máquina).
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { testadorDoAmbiente } from './email-teste-conexao.js';

let servidor: Server | null = null;
afterEach(async () => {
  await new Promise<void>((ok) => (servidor ? servidor.close(() => ok()) : ok()));
  servidor = null;
});

function smtpFalso(recursos: string[], aceitaAuth: boolean, recebido: string[]): Promise<number> {
  return new Promise((ok) => {
    servidor = createServer((s) => {
      s.setEncoding('utf8');
      let buf = '';
      s.write('220 falso\r\n');
      s.on('error', () => undefined);
      s.on('data', (d: string) => {
        buf += d;
        for (;;) {
          const i = buf.indexOf('\r\n');
          if (i < 0) break;
          const l = buf.slice(0, i);
          buf = buf.slice(i + 2);
          recebido.push(l);
          if (l.startsWith('EHLO'))
            s.write([...recursos.map((r) => `250-${r}`), '250 SIZE 1000'].join('\r\n') + '\r\n');
          else if (l.startsWith('AUTH PLAIN')) s.write(aceitaAuth ? '235 ok\r\n' : '535 recusado\r\n');
          else if (l === 'QUIT') s.end('221 tchau\r\n');
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

const env = { SGH_AMBIENTE: 'desenvolvimento' };
const cofre = async (r: string) => (r === 'email/saida/sintetico' ? 'Sintetica#1' : null);
const base = { host: '127.0.0.1', seguranca: 'nenhuma', tempoLimiteSegundos: 5 };

describe('teste de conexão com autenticação', () => {
  it('autentica com o usuário e a senha do cofre', async () => {
    const recebido: string[] = [];
    const porta = await smtpFalso(['AUTH PLAIN LOGIN'], true, recebido);
    const r = await testadorDoAmbiente(
      env,
      cofre,
    )({
      ...base,
      porta,
      usuario: 'envio',
      referenciaCofre: 'email/saida/sintetico',
    });
    expect(r).toEqual({ sucesso: true, detalhe: 'Servidor respondeu e aceitou a autenticação.' });
    const auth = recebido.find((l) => l.startsWith('AUTH PLAIN '))!;
    expect(Buffer.from(auth.slice(11), 'base64').toString('utf8')).toBe('\u0000envio\u0000Sintetica#1');
  });
  it('autenticação recusada, senha fora do cofre ou PLAIN não anunciado: falha sem a senha no detalhe', async () => {
    const recebido: string[] = [];
    let porta = await smtpFalso(['AUTH PLAIN'], false, recebido);
    const t = testadorDoAmbiente(env, cofre);
    const recusada = await t({ ...base, porta, usuario: 'envio', referenciaCofre: 'email/saida/sintetico' });
    expect(recusada).toEqual({
      sucesso: false,
      detalhe: 'O servidor recusou a autenticação (resposta 535).',
    });
    const semSenha = await t({ ...base, porta, usuario: 'envio', referenciaCofre: 'email/saida/outra' });
    expect(semSenha).toMatchObject({ sucesso: false, detalhe: expect.stringContaining('não está no cofre') });
    await new Promise<void>((ok) => servidor!.close(() => ok()));
    porta = await smtpFalso([], true, recebido);
    const semPlain = await t({ ...base, porta, usuario: 'envio', referenciaCofre: 'email/saida/sintetico' });
    expect(semPlain).toMatchObject({ sucesso: false, detalhe: expect.stringContaining('PLAIN') });
    expect(JSON.stringify([recusada, semSenha, semPlain])).not.toContain('Sintetica#1');
  });
  it('sem autenticação só confere a apresentação; STARTTLS não anunciado é falha', async () => {
    const recebido: string[] = [];
    const porta = await smtpFalso([], true, recebido);
    expect(await testadorDoAmbiente(env, cofre)({ ...base, porta })).toEqual({
      sucesso: true,
      detalhe: 'Servidor respondeu.',
    });
    expect(await testadorDoAmbiente(env, cofre)({ ...base, porta, seguranca: 'starttls' })).toMatchObject({
      sucesso: false,
      detalhe: expect.stringContaining('STARTTLS'),
    });
    expect(recebido.some((l) => l.startsWith('AUTH'))).toBe(false);
  });
});
