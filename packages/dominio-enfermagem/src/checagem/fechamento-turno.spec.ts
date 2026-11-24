import { describe, expect, it } from 'vitest';
import {
  conferirFechamento,
  conferirReabertura,
  justificativaDaLeitura,
  resultadoLeituraLote,
  resumirFechamento,
} from './fechamento-turno.js';

const h = (id: number, letra: string, travado = false) => ({ id, letra, travado });

describe('fechamento da checagem do turno', () => {
  it('trava só os resolvidos; os pendentes seguem para o próximo turno', () => {
    const r = resumirFechamento([h(1, 'A'), h(2, 'N'), h(3, 'S'), h(4, 'P'), h(5, 'A', true), h(6, 'p')]);
    expect(r).toMatchObject({ total: 6, administrados: 3, naoAdministrados: 1, suspensos: 1, jaTravados: 1 });
    expect(r.aTravar).toEqual([1, 2, 3, 6]);
    expect(r.pendentes).toEqual([4]);
  });
  it('com pendência exige justificativa; sem pendência fecha sem ela', () => {
    const com = resumirFechamento([h(1, 'A'), h(2, 'P')]);
    expect(conferirFechamento(com, null)?.codigo).toBe('pendencias-sem-justificativa');
    expect(conferirFechamento(com, 'curta')?.codigo).toBe('pendencias-sem-justificativa');
    expect(conferirFechamento(com, 'Paciente em exame externo, dose passada ao noturno')).toBeNull();
    expect(conferirFechamento(resumirFechamento([h(1, 'A'), h(2, 'N')]), null)).toBeNull();
  });
  it('recusa turno vazio, já fechado ou só com pendentes', () => {
    expect(conferirFechamento(resumirFechamento([]), null)?.codigo).toBe('turno-sem-horarios');
    expect(conferirFechamento(resumirFechamento([h(1, 'A', true)]), null)?.codigo).toBe('turno-ja-fechado');
    expect(conferirFechamento(resumirFechamento([h(1, 'P')]), 'justificativa longa')?.codigo).toBe(
      'turno-sem-horarios',
    );
  });
  it('reabre só o vigente e sempre com motivo', () => {
    expect(conferirReabertura('reaberto', 'motivo bem explicado')).toMatch(/já foi reaberto/);
    expect(conferirReabertura('fechado', ' ')).toMatch(/motivo/);
    expect(conferirReabertura('fechado', 'Checagem lançada no paciente errado')).toBeNull();
  });
});

describe('leitura do produto e do lote na administração', () => {
  const lote = { insumo: 7, validade: '2027-01-31', situacao: 'liberado' };
  const base = { insumoDoCodigo: 7, lote, validadeLida: null, dataAdministracao: '2026-11-24' };
  it('confere produto, situação e validade do lote', () => {
    expect(resultadoLeituraLote(base)).toBe('conforme');
    expect(resultadoLeituraLote({ ...base, insumoDoCodigo: 8 })).toBe('produto_divergente');
    expect(resultadoLeituraLote({ ...base, lote: { ...lote, situacao: 'bloqueado' } })).toBe(
      'lote_bloqueado',
    );
    expect(resultadoLeituraLote({ ...base, lote: { ...lote, validade: '2026-11-23' } })).toBe('lote_vencido');
    expect(resultadoLeituraLote({ ...base, lote: { ...lote, situacao: 'vencido' } })).toBe('lote_vencido');
    expect(resultadoLeituraLote({ ...base, insumoDoCodigo: null, lote: null })).toBe('nao_identificado');
    expect(resultadoLeituraLote({ ...base, lote: null, validadeLida: '2026-01-01' })).toBe('lote_vencido');
  });
  it('o que não confere só segue com a justificativa', () => {
    expect(justificativaDaLeitura('conforme', null)).toEqual({ justificativa: null });
    expect(justificativaDaLeitura('lote_vencido', null)).toHaveProperty('recusa');
    expect(justificativaDaLeitura('nao_identificado', 'Lote da farmácia satélite, sem cadastro')).toEqual({
      justificativa: 'Lote da farmácia satélite, sem cadastro',
    });
  });
});
