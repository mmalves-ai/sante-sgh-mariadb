// Família acesso-email: o código do segundo fator no e-mail e o envio pela captura local (unidade, sem banco).
import { describe, expect, it } from 'vitest';
import { ArmazemMemoria } from './armazem.js';
import {
  contaPlataforma,
  contaUsuario,
  ENVIOS_CODIGO_EMAIL_HORA,
  ErroCodigoEmail,
  ServicoCodigoEmail,
  TENTATIVAS_CODIGO_EMAIL,
} from './codigo-email.js';
import { emailAcessoDoAmbiente, emailAcessoMemoria, montarMensagemAcesso } from './email-acesso.js';

const PARA = 'pessoa@exemplo.invalid';
const codigoDe = (texto: string) => /(\d{6})/.exec(texto)?.[1] ?? '';

function montar(seq: number[] = []) {
  const email = emailAcessoMemoria();
  let i = 0;
  const s = new ServicoCodigoEmail(
    new ArmazemMemoria(),
    email,
    seq.length ? () => seq[i++ % seq.length] as number : undefined,
  );
  return { s, email };
}

describe('ServicoCodigoEmail', () => {
  it('envia 6 dígitos ao e-mail, confere uma vez só (uso único)', async () => {
    const { s, email } = montar();
    const conta = contaUsuario('rede', 'h1', 'maria');
    expect(await s.emitir(conta, PARA)).toEqual({ validadeMinutos: 5 });
    expect(email.enviadas).toHaveLength(1);
    const codigo = codigoDe(email.enviadas[0]?.texto ?? '');
    expect(codigo).toMatch(/^\d{6}$/);
    expect(await s.conferir(conta, codigo)).toBe('ok');
    expect(await s.conferir(conta, codigo)).toBe('invalido');
  });

  it('completa com zeros à esquerda e não confunde contas', async () => {
    const { s, email } = montar([42]);
    await s.emitir(contaPlataforma(1), PARA);
    expect(codigoDe(email.enviadas[0]?.texto ?? '')).toBe('000042');
    expect(await s.conferir(contaPlataforma(2), '000042')).toBe('invalido');
    expect(await s.conferir(contaPlataforma(1), '000042')).toBe('ok');
  });

  it('código novo invalida o anterior', async () => {
    const { s } = montar([111111, 222222]);
    const conta = contaPlataforma(7);
    await s.emitir(conta, PARA);
    await s.emitir(conta, PARA);
    expect(await s.conferir(conta, '111111')).toBe('invalido');
    expect(await s.conferir(conta, '222222')).toBe('ok');
  });

  it('no teto de tentativas o código é descartado, mesmo o certo', async () => {
    const { s } = montar([123456]);
    const conta = contaUsuario('rede', 'h1', 'joao');
    await s.emitir(conta, PARA);
    for (let k = 0; k < TENTATIVAS_CODIGO_EMAIL; k++)
      expect(await s.conferir(conta, '000000')).toBe('invalido');
    expect(await s.conferir(conta, '123456')).toBe('esgotado');
  });

  it('formato errado conta tentativa e não confere', async () => {
    const { s } = montar([123456]);
    const conta = contaPlataforma(3);
    await s.emitir(conta, PARA);
    expect(await s.conferir(conta, '12345a')).toBe('invalido');
    expect(await s.conferir(conta, '123456')).toBe('ok');
  });

  it('limita envios por hora e recusa conta sem e-mail', async () => {
    const { s } = montar();
    const conta = contaPlataforma(9);
    for (let k = 0; k < ENVIOS_CODIGO_EMAIL_HORA; k++) await s.emitir(conta, PARA);
    await expect(s.emitir(conta, PARA)).rejects.toMatchObject({ codigo: 'muitos-envios' });
    await expect(s.emitir(contaPlataforma(10), null)).rejects.toBeInstanceOf(ErroCodigoEmail);
    await expect(s.emitir(contaPlataforma(10), 'sem arroba')).rejects.toMatchObject({ codigo: 'sem-email' });
  });

  it('falha do servidor de e-mail descarta o código', async () => {
    const armazem = new ArmazemMemoria();
    const s = new ServicoCodigoEmail(
      armazem,
      { destino: 'memoria', enviar: () => Promise.reject(new Error('x')) },
      () => 5,
    );
    await expect(s.emitir(contaPlataforma(4), PARA)).rejects.toThrow('x');
    expect(await s.conferir(contaPlataforma(4), '000005')).toBe('invalido');
  });
});

describe('envio pela captura local (regra 6)', () => {
  it('sem SMTP_URL, sem envio', () => {
    expect(emailAcessoDoAmbiente({})).toBe(null);
  });
  it('fora de produção, só loopback', () => {
    expect(emailAcessoDoAmbiente({ SMTP_URL: 'smtp://127.0.0.1:1025', AMBIENTE: 'dev' })?.destino).toBe(
      'smtp',
    );
    expect(() =>
      emailAcessoDoAmbiente({ SMTP_URL: 'smtp://smtp.exemplo.com:25', AMBIENTE: 'homologacao' }),
    ).toThrow(/loopback/);
    expect(() => emailAcessoDoAmbiente({ SMTP_URL: 'smtp://smtp.exemplo.com:25' })).toThrow(/loopback/);
    expect(
      emailAcessoDoAmbiente({ SMTP_URL: 'smtp://smtp.exemplo.com:25', AMBIENTE: 'producao' })?.destino,
    ).toBe('smtp');
    expect(() => emailAcessoDoAmbiente({ SMTP_URL: 'http://127.0.0.1:1025' })).toThrow(/smtp/);
  });
  it('a mensagem recusa cabeçalho injetado e endereço inválido', () => {
    expect(() =>
      montarMensagemAcesso('a@b.c', { para: 'x@y.z', assunto: 'a\r\nBcc: z@w.k', texto: '' }),
    ).toThrow();
    expect(() => montarMensagemAcesso('a@b.c', { para: 'x@y.z>, w@k.l', assunto: 'a', texto: '' })).toThrow();
    expect(montarMensagemAcesso('a@b.c', { para: 'x@y.z', assunto: 'Código', texto: 'oi' })).toContain(
      '=?UTF-8?B?',
    );
  });
});
