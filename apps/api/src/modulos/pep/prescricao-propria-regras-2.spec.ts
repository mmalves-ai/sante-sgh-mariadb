// Unidade da família pep-resto2 (prescricao-propria-regras-2.ts): as funções puras da regra de alerta e da ficha de
// antimicrobiano. Sem banco.
import { FORMATO_CHAVE_IDEMPOTENCIA } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  chaveDaGravacao,
  colunasDoNivel,
  FINALIDADE_DO_TIPO,
  hojeLocal,
  periodoDaFicha,
  somarDias,
  TABELAS_REGRAS_2,
} from './prescricao-propria-regras-2.js';

describe('prescricao-propria-regras-2 (funções puras)', () => {
  it('colunasDoNivel: aviso informa, justificar pede justificativa, bloqueio impede', () => {
    expect(colunasDoNivel('aviso')).toEqual({ bloqueante: false, exige_justificativa: false, gravidade: 'informativo' });
    expect(colunasDoNivel('justificar')).toEqual({ bloqueante: false, exige_justificativa: true, gravidade: 'atencao' });
    expect(colunasDoNivel('bloqueio')).toEqual({ bloqueante: true, exige_justificativa: true, gravidade: 'critico' });
  });

  it('somarDias atravessa mês, ano e fevereiro bissexto, para frente e para trás', () => {
    expect(somarDias('2026-11-24', 0)).toBe('2026-11-24');
    expect(somarDias('2026-11-24', 7)).toBe('2026-12-01');
    expect(somarDias('2026-12-30', 3)).toBe('2027-01-02');
    expect(somarDias('2024-02-28', 1)).toBe('2024-02-29');
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('periodoDaFicha: o dia de tratamento conta a partir de hoje (dia 1 = hoje) e o fim fecha os dias previstos', () => {
    expect(periodoDaFicha('2026-11-24', 1, 7)).toEqual({ inicio: '2026-11-24', fim: '2026-11-30' });
    expect(periodoDaFicha('2026-11-24', 3, 7)).toEqual({ inicio: '2026-11-22', fim: '2026-11-28' });
    expect(periodoDaFicha('2026-11-24', 1, 1)).toEqual({ inicio: '2026-11-24', fim: '2026-11-24' });
  });

  it('hojeLocal usa o fuso do estabelecimento', () => {
    const quase = new Date('2026-11-25T01:30:00Z');
    expect(hojeLocal('America/Sao_Paulo', quase)).toBe('2026-11-24');
    expect(hojeLocal('UTC', quase)).toBe('2026-11-25');
    expect(hojeLocal('America/Manaus', new Date('2026-11-25T03:59:00Z'))).toBe('2026-11-24');
  });

  it('FINALIDADE_DO_TIPO liga o tipo da ficha à finalidade terapêutica do catálogo', () => {
    expect(FINALIDADE_DO_TIPO).toEqual({ empirico: 'empirica', dirigido: 'terapeutica', profilatico: 'profilatica' });
    expect([...TABELAS_REGRAS_2]).toEqual(['regra_alerta', 'regra_alerta_versao', 'ficha_antimicrobiano']);
  });

  it('chaveDaGravacao: derivada da chave da requisição (mesma chave, mesma gravação); sem ela, única por chamada', () => {
    const a = chaveDaGravacao('pep.registrarFicha', 'r'.repeat(80));
    expect(a).toBe(chaveDaGravacao('pep.registrarFicha', 'r'.repeat(80)));
    expect(a).not.toBe(chaveDaGravacao('pep.gravarRegra', 'r'.repeat(80)));
    expect(FORMATO_CHAVE_IDEMPOTENCIA.test(a)).toBe(true);
    const b = chaveDaGravacao('pep.gravarRegra', undefined);
    expect(b).not.toBe(chaveDaGravacao('pep.gravarRegra', undefined));
    expect(FORMATO_CHAVE_IDEMPOTENCIA.test(b)).toBe(true);
    expect(chaveDaGravacao('pep.gravarRegra', 'curta')).not.toBe(chaveDaGravacao('pep.gravarRegra', 'curta'));
  });
});
