// Regras da inscrição do paciente em programa de saúde e linha de cuidado (F8, 02-CAD linha 11).
import { describe, expect, it } from 'vitest';
import {
  conferirInscricao,
  conferirMudancaEstado,
  encerraAoEntrar,
  type EntradaInscricao,
  type EstadoLinha,
  estadoDeEntrada,
  idadeNaData,
  idadeNaUnidade,
  totaisPorEstado,
} from './linha-cuidado.js';

const est = (id: number, tipo: EstadoLinha['tipo'], p: Partial<EstadoLinha> = {}): EstadoLinha => ({
  id,
  tipo,
  padraoAtivacao: false,
  encerraInscricao: false,
  ativo: true,
  ...p,
});
const base: EntradaInscricao = {
  linhaAtiva: true,
  exigeReferencia: false,
  referencia: null,
  vigenciaInicio: '2026-11-20',
  hoje: '2026-11-24',
  nascimento: '1960-05-10',
  inscricaoViva: false,
  faixa: null,
  pacienteFalecido: false,
};
const codigos = (r: { codigo: string }[]) => r.map((x) => x.codigo);

describe('estado de entrada', () => {
  it('usa o padrão do hospital; sem ele, o incluído; nunca um final ou inativo', () => {
    expect(estadoDeEntrada([est(1, 'incluido'), est(2, 'ativo', { padraoAtivacao: true })])?.id).toBe(2);
    expect(estadoDeEntrada([est(3, 'ativo'), est(1, 'incluido')])?.id).toBe(1);
    expect(estadoDeEntrada([est(4, 'alta', { padraoAtivacao: true }), est(3, 'ativo')])?.id).toBe(3);
    expect(estadoDeEntrada([est(1, 'incluido', { ativo: false })])).toBeNull();
  });
  it('estado final ou marcado para encerrar encerra a inscrição', () => {
    expect(encerraAoEntrar(est(1, 'obito'))).toBe(true);
    expect(encerraAoEntrar(est(1, 'suspenso', { encerraInscricao: true }))).toBe(true);
    expect(encerraAoEntrar(est(1, 'suspenso'))).toBe(false);
  });
});

describe('inscrição', () => {
  it('aceita a inscrição válida', () => {
    expect(conferirInscricao(base)).toEqual([]);
  });
  it('recusa programa inativo, inscrição viva, falecido, referência faltando e início futuro', () => {
    expect(
      codigos(
        conferirInscricao({
          ...base,
          linhaAtiva: false,
          inscricaoViva: true,
          pacienteFalecido: true,
          exigeReferencia: true,
          vigenciaInicio: '2026-12-01',
        }),
      ),
    ).toEqual([
      'linha-inativa',
      'paciente-falecido',
      'inscricao-viva',
      'referencia-obrigatoria',
      'inicio-futuro',
    ]);
  });
  it('recusa início antes do nascimento e idade fora da faixa do programa', () => {
    expect(codigos(conferirInscricao({ ...base, nascimento: '2026-11-22' }))).toEqual([
      'inicio-antes-nascimento',
    ]);
    expect(codigos(conferirInscricao({ ...base, faixa: { minima: 0, maxima: 17 } }))).toEqual([
      'fora-da-faixa-etaria',
    ]);
    expect(conferirInscricao({ ...base, faixa: { minima: 60, maxima: null } })).toEqual([]);
  });
  it('idade em anos completos', () => {
    expect(idadeNaData('1960-05-10', '2026-05-09')).toBe(65);
    expect(idadeNaData('1960-05-10', '2026-05-10')).toBe(66);
  });
  it('idade completa em meses, semanas, dias e horas', () => {
    expect(idadeNaUnidade('2024-11-25', '2026-11-24', 'mes')).toBe(23);
    expect(idadeNaUnidade('2024-11-24', '2026-11-24', 'mes')).toBe(24);
    expect(idadeNaUnidade('2026-11-10', '2026-11-24', 'semana')).toBe(2);
    expect(idadeNaUnidade('2026-02-27', '2026-03-02', 'dia')).toBe(3);
    expect(idadeNaUnidade('2026-11-22', '2026-11-24', 'hora')).toBe(48);
    expect(idadeNaUnidade('1960-05-10', '2026-05-09', 'ano')).toBe(65);
  });
  it('a faixa em meses vale em meses (puericultura de 0 a 24 meses), nunca é descartada', () => {
    const bebe = { ...base, nascimento: '2025-01-15' };
    expect(conferirInscricao({ ...bebe, faixa: { minima: 0, maxima: 24, unidade: 'mes' } })).toEqual([]);
    // Em anos a mesma faixa aceitaria o adulto de 24 anos; em meses, não.
    expect(codigos(conferirInscricao({ ...base, faixa: { minima: 0, maxima: 24, unidade: 'mes' } }))).toEqual(
      ['fora-da-faixa-etaria'],
    );
    expect(
      codigos(
        conferirInscricao({
          ...bebe,
          vigenciaInicio: '2026-11-20',
          faixa: { minima: 0, maxima: 28, unidade: 'dia' },
        }),
      ),
    ).toEqual(['fora-da-faixa-etaria']);
  });
});

describe('mudança de estado', () => {
  const m = {
    atual: 'ativo' as const,
    atualId: 2,
    inscricaoEncerrada: false,
    data: '2026-11-24',
    hoje: '2026-11-24',
    estadoDesde: '2026-11-20',
    motivo: null,
  };
  it('ativo para suspenso exige motivo; com motivo, aceita', () => {
    expect(codigos(conferirMudancaEstado({ ...m, novo: est(5, 'suspenso') }))).toEqual([
      'motivo-obrigatorio',
    ]);
    expect(conferirMudancaEstado({ ...m, novo: est(5, 'suspenso'), motivo: 'Viagem longa' })).toEqual([]);
  });
  it('alta exige motivo; volta de suspenso para ativo não exige', () => {
    expect(codigos(conferirMudancaEstado({ ...m, novo: est(6, 'alta') }))).toEqual(['motivo-obrigatorio']);
    expect(conferirMudancaEstado({ ...m, atual: 'suspenso', atualId: 5, novo: est(2, 'ativo') })).toEqual([]);
  });
  it('recusa o mesmo estado, a volta para incluído, data futura e data antes do estado atual', () => {
    expect(codigos(conferirMudancaEstado({ ...m, novo: est(2, 'ativo') }))).toEqual(['estado-igual']);
    expect(codigos(conferirMudancaEstado({ ...m, novo: est(1, 'incluido') }))).toEqual([
      'transicao-invalida',
    ]);
    expect(
      codigos(
        conferirMudancaEstado({ ...m, novo: est(5, 'suspenso'), motivo: 'Motivo ok', data: '2026-11-25' }),
      ),
    ).toEqual(['data-futura']);
    expect(
      codigos(
        conferirMudancaEstado({ ...m, novo: est(5, 'suspenso'), motivo: 'Motivo ok', data: '2026-11-19' }),
      ),
    ).toEqual(['data-antes-do-estado-atual']);
  });
  it('inscrição encerrada não muda mais: voltar é inscrição nova', () => {
    expect(
      codigos(
        conferirMudancaEstado({
          ...m,
          atual: 'alta',
          atualId: 6,
          inscricaoEncerrada: true,
          novo: est(2, 'ativo'),
        }),
      ),
    ).toEqual(['inscricao-encerrada']);
  });
  it('estado inativo é recusado', () => {
    expect(
      codigos(
        conferirMudancaEstado({ ...m, novo: est(5, 'suspenso', { ativo: false }), motivo: 'Motivo ok' }),
      ),
    ).toEqual(['estado-inativo']);
  });
});

describe('painel do programa', () => {
  it('conta vivas, encerradas e por estado', () => {
    expect(
      totaisPorEstado([
        { tipo: 'ativo', encerrada: false },
        { tipo: 'ativo', encerrada: false },
        { tipo: 'alta', encerrada: true },
      ]),
    ).toEqual({ vivas: 2, encerradas: 1, porEstado: { ativo: 2, alta: 1 } });
  });
});
