import { describe, expect, it } from 'vitest';
import { cifrarSenha, conferirSenha } from '../cifra-plataforma.js';
import { MENSAGEM_CREDENCIAL_INICIAL, planoCredencialInicial } from './credencial-inicial.js';

const LEVE = { memoria: 8_192, passes: 1, paralelismo: 1 };

describe('credencial inicial da conta criada (01-ADM L57)', () => {
  it('sem resumo: a conta nasce sem credencial', () => {
    expect(planoCredencialInicial(undefined)).toBeNull();
    expect(planoCredencialInicial(null)).toBeNull();
  });

  it('resumo fora do argon2id (texto puro, outro algoritmo, vazio) é recusado', () => {
    for (const r of [
      '',
      'senha-em-claro',
      '$2b$10$abcdefghijklmnopqrstuv',
      '$argon2i$v=19$m=8,t=1,p=1$YWFh$YmJi',
    ])
      expect(planoCredencialInicial(r)).toEqual({ recusa: 'senha-sem-cifra' });
    expect(MENSAGEM_CREDENCIAL_INICIAL['senha-sem-cifra']).toMatch(/cifrada/);
  });

  it('com resumo: credencial de troca obrigatória e histórico na forma "criacao"; o resumo confere a senha', async () => {
    const resumo = await cifrarSenha('Sintetica#2026x', LEVE);
    const p = planoCredencialInicial(resumo);
    expect(p).toEqual({
      credencial: {
        algoritmo: 'argon2id',
        resumo_senha: resumo,
        troca_obrigatoria: true,
        tentativas_invalidas: 0,
      },
      historico: { operacao: 'inclusao', hash_senha: resumo, algoritmo: 'argon2id', forma_troca: 'criacao' },
    });
    expect(await conferirSenha('Sintetica#2026x', resumo)).toBe(true);
  });
});
