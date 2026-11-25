// Consolidação dos avisos na tela (01-ADM L76): a conferência enquanto se digita é a regra do domínio, o corpo volta
// a regra lida inteira, e "meus avisos" separa o que espera resposta. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import type { EnvioNotificacao } from './api-notificacao-regras.js';
import {
  alternarCampo,
  type ConsolidacaoLida,
  conferirConsolidacao,
  corpoDaConsolidacao,
  formConsolidacaoNova,
  formDaConsolidacao,
  percentual,
  separarMeusEnvios,
} from './notificacao-consolidacao-tela.js';

const lida: ConsolidacaoLida = {
  id: 7,
  versao: 3,
  codigo: 'RESUMO-DIA',
  nome: 'Resumo do dia',
  janelaMinutos: 120,
  campos: ['regra', 'paciente'],
  limitePorUsuario: 5,
  periodoLimiteMinutos: 60,
  horarioResumo: '07:30',
  formato: 'contagem',
  ativo: true,
};

const envio = (id: number, situacao: string, lidoEm: string | null): EnvioNotificacao => ({
  id,
  versao: 1,
  usuario: 'u.sintetico',
  canal: 'email',
  consolidacao: 'RESUMO-DIA',
  quantidadeAvisos: 2,
  avisos: [1, 2],
  situacao,
  tentativas: 1,
  ocorridoEm: '2026-11-25T10:00:00Z',
  enviadoEm: null,
  entregueEm: null,
  lidoEm,
  erro: null,
});

describe('consolidação dos avisos na tela', () => {
  it('formulário novo: código e nome pendentes, conferidos pela regra do domínio', () => {
    const f = formConsolidacaoNova();
    expect(conferirConsolidacao(f)).toMatch(/código/i);
    f.codigo = 'TURNO';
    expect(conferirConsolidacao(f)).toMatch(/nome/i);
    f.nome = 'Por turno';
    expect(conferirConsolidacao(f)).toBeNull();
  });

  it('janela fora de 1 minuto a 7 dias, sem agrupamento, limite sem período e horário inválido são recusados', () => {
    const f = { ...formConsolidacaoNova(), codigo: 'X', nome: 'X' };
    expect(conferirConsolidacao({ ...f, janelaMinutos: '0' })).toMatch(/janela/i);
    expect(conferirConsolidacao({ ...f, janelaMinutos: '10081' })).toMatch(/janela/i);
    expect(conferirConsolidacao({ ...f, janelaMinutos: 'abc' })).toMatch(/janela/i);
    expect(conferirConsolidacao({ ...f, campos: [] })).toMatch(/agrupamento/i);
    expect(conferirConsolidacao({ ...f, comLimite: true, limitePorUsuario: '3' })).toMatch(/período/i);
    expect(conferirConsolidacao({ ...f, horarioResumo: '25:00' })).toMatch(/HH:MM/);
  });

  it('a regra lida volta inteira no corpo (id e versão, limite e horário)', () => {
    expect(corpoDaConsolidacao(formDaConsolidacao(lida))).toEqual({
      id: 7,
      versao: 3,
      codigo: 'RESUMO-DIA',
      nome: 'Resumo do dia',
      janelaMinutos: 120,
      campos: ['regra', 'paciente'],
      limitePorUsuario: 5,
      periodoLimiteMinutos: 60,
      horarioResumo: '07:30',
      formato: 'contagem',
      ativo: true,
    });
  });

  it('desligar o limite manda limite e período nulos', () => {
    const f = { ...formDaConsolidacao(lida), comLimite: false };
    expect(corpoDaConsolidacao(f)).toMatchObject({ limitePorUsuario: null, periodoLimiteMinutos: null });
  });

  it('alternar campo mantém a ordem padrão', () => {
    expect(alternarCampo(['paciente'], 'regra')).toEqual(['regra', 'paciente']);
    expect(alternarCampo(['regra', 'paciente'], 'regra')).toEqual(['paciente']);
  });

  it('meus avisos: espera resposta o envio entregue, enviado ou capturado ainda não lido', () => {
    const r = separarMeusEnvios([
      envio(1, 'entregue', null),
      envio(2, 'lido', '2026-11-25T11:00:00Z'),
      envio(3, 'capturado', null),
      envio(4, 'falhou', null),
    ]);
    expect(r.aResponder.map((e) => e.id)).toEqual([1, 3]);
    expect(r.respondidos.map((e) => e.id)).toEqual([2, 4]);
  });

  it('percentual sem base é traço', () => {
    expect(percentual(null)).toBe('—');
    expect(percentual(50)).toBe('50%');
  });
});
