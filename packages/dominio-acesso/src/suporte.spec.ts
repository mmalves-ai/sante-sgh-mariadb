// Regras do suporte técnico e do "login como" (ADR 0021): quem entra e onde, prazo absoluto e a guarda por
// requisição. Sem bloqueio de uso: nenhuma regra aqui olha a rota (o "como" pode o que o alvo pode).
import { describe, expect, it } from 'vitest';
import {
  conferirSessaoComo,
  estabelecimentosDaConta,
  fimAbsolutoComo,
  minutosSessaoComo,
  podeDesignar,
  podeEntrarComo,
  podeEntrarNoEstabelecimento,
  segundoFatorObrigatorio,
  SUPORTE_SESSAO_MINUTOS_PADRAO,
  SUPORTE_SESSAO_MINUTOS_TETO,
  tipoDoAtor,
  type ContaRegra,
  type EstadoSessaoComo,
} from './suporte.js';

const plataforma: ContaRegra = { papel: 'PLATAFORMA', ativo: true, atribuicoes: [] };
const suporte: ContaRegra = { papel: 'SUPORTE', ativo: true, atribuicoes: [{ rede: 'r', hospital: 'aa' }] };
const livre: ContaRegra = { papel: 'SUPORTE', ativo: true, atribuicoes: [] };
const conf = ['aa', 'bb'];

describe('papéis', () => {
  it('só a plataforma ativa designa; ícone para plataforma e suporte ativo com estabelecimento', () => {
    expect(podeDesignar(plataforma)).toBe(true);
    expect(podeDesignar(suporte)).toBe(false);
    expect(podeDesignar({ ...plataforma, ativo: false })).toBe(false);
    expect(podeEntrarComo(plataforma)).toBe(true);
    expect(podeEntrarComo(suporte)).toBe(true);
    expect(podeEntrarComo(livre)).toBe(false);
    expect(podeEntrarComo({ ...suporte, ativo: false })).toBe(false);
    expect(tipoDoAtor('PLATAFORMA')).toBe('plataforma');
    expect(tipoDoAtor('SUPORTE')).toBe('suporte');
  });

  it('plataforma em todos os configurados; suporte só nos atribuídos; nunca fora da configuração', () => {
    expect(estabelecimentosDaConta(plataforma, 'r', conf)).toEqual(['aa', 'bb']);
    expect(estabelecimentosDaConta(suporte, 'r', conf)).toEqual(['aa']);
    expect(estabelecimentosDaConta(suporte, 'outra', conf)).toEqual([]);
    expect(podeEntrarNoEstabelecimento(plataforma, 'r', 'zz', conf)).toBe(false);
    expect(podeEntrarNoEstabelecimento(suporte, 'r', 'bb', conf)).toBe(false);
    expect(podeEntrarNoEstabelecimento({ ...plataforma, ativo: false }, 'r', 'aa', conf)).toBe(false);
  });

  it('segundo fator obrigatório fora de dev e ci', () => {
    expect(segundoFatorObrigatorio('dev')).toBe(false);
    expect(segundoFatorObrigatorio('ci')).toBe(false);
    for (const a of ['homolog', 'treino', 'producao', '']) expect(segundoFatorObrigatorio(a)).toBe(true);
  });
});

describe('prazo absoluto (R5)', () => {
  it('padrão 60, inválido vale o padrão, teto de um turno', () => {
    expect(minutosSessaoComo(undefined)).toBe(SUPORTE_SESSAO_MINUTOS_PADRAO);
    expect(minutosSessaoComo('abc')).toBe(60);
    expect(minutosSessaoComo('0')).toBe(60);
    expect(minutosSessaoComo('-5')).toBe(60);
    expect(minutosSessaoComo(' 30 ')).toBe(30);
    expect(minutosSessaoComo('100000')).toBe(SUPORTE_SESSAO_MINUTOS_TETO);
    expect(fimAbsolutoComo(1_000, 60)).toBe(1_000 + 3_600_000);
  });
});

describe('guarda por requisição', () => {
  const base: EstadoSessaoComo = {
    sessao: {
      idConta: '7',
      atorTipo: 'suporte',
      rede: 'r',
      hospital: 'aa',
      expiraMs: 10_000,
      encerrada: false,
    },
    conta: { ...suporte, id: '7' },
    configurados: conf,
    agoraMs: 5_000,
  };
  it('vale com sessão aberta, no prazo, conta ativa com a função e a atribuição', () => {
    expect(conferirSessaoComo(base)).toEqual({ valida: true });
  });
  it.each([
    ['inexistente', { sessao: null }],
    ['encerrada', { sessao: { ...base.sessao!, encerrada: true } }],
    ['expirada', { agoraMs: 10_000 }],
    ['conta', { conta: null }],
    ['conta', { conta: { ...suporte, id: '8' } }],
    ['conta', { conta: { ...suporte, id: '7', ativo: false } }],
    ['funcao', { conta: { ...plataforma, id: '7' } }],
    ['atribuicao', { conta: { ...livre, id: '7' } }],
    ['atribuicao', { configurados: ['bb'] }],
  ] as const)('recusa: %s', (motivo, mudanca) => {
    expect(conferirSessaoComo({ ...base, ...mudanca } as EstadoSessaoComo)).toEqual({
      valida: false,
      motivo,
    });
  });
});
