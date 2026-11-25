// Regra 19 (NR32-03, NR32-05; NR-6): EPI por função com entrega assinada; entrega com CA vencido recusada; dosimetria
// (20 e 50 mSv no ano, com as parcelas) e exposição a quimioterápico registradas.
import { describe, expect, it } from 'vitest';
import {
  chaveFuncao,
  conferirDosimetria,
  conferirEntregaEpi,
  conferirLeituraRepetida,
  doseNoAno,
  type EntregaLida,
  episFaltando,
  type LinhaRiscoLida,
  linhasDaFuncao,
  pendenciasEpi,
} from './epi.js';
import { juntarPendencias } from './pendencias.js';

const HOJE = '2026-10-26';
const linha = (id: number, extra: Partial<LinhaRiscoLida>): LinhaRiscoLida => ({
  id,
  unidade: null,
  funcaoChave: 'TECNICO DE ENFERMAGEM',
  tipo: 'epi',
  epi: 'Luva de procedimento',
  inicio: '2026-01-01',
  fim: null,
  ...extra,
});
const entrega = (id: number, extra: Partial<EntregaLida>): EntregaLida => ({
  id,
  tipo: 'epi',
  data: '2026-10-01',
  epi: 'Luva de procedimento',
  caValidade: '2027-01-01',
  assinatura: 'assinada',
  doseMsv: null,
  ...extra,
});

describe('chave da função e o mapa que vale para o vínculo', () => {
  it('sem acento, sem caixa e sem espaço repetido', () => {
    expect(chaveFuncao('  Técnico   de enfermagem ')).toBe('TECNICO DE ENFERMAGEM');
  });
  it('a linha sem unidade vale em todas; a de outra unidade e a encerrada ou futura não valem', () => {
    const mapa = [
      linha(1, {}),
      linha(2, { unidade: 5 }),
      linha(3, { unidade: 6 }),
      linha(4, { fim: '2026-06-30' }),
      linha(5, { inicio: '2026-12-01' }),
      linha(6, { funcaoChave: 'MEDICO' }),
    ];
    expect(linhasDaFuncao(mapa, 'Técnico de Enfermagem', 5, HOJE).map((l) => l.id)).toEqual([1, 2]);
    expect(linhasDaFuncao(mapa, 'Técnico de Enfermagem', null, HOJE).map((l) => l.id)).toEqual([1]);
  });
});

describe('entrega de EPI (regra 19)', () => {
  const e = { epi: 'Luva', caNumero: '12345', caValidade: '2027-01-01', quantidade: 2, data: '2026-10-20' };
  it('passa; CA vencido na data da entrega recusado', () => {
    expect(conferirEntregaEpi(e, HOJE, '2025-01-10')).toBeNull();
    expect(conferirEntregaEpi({ ...e, caValidade: '2026-10-19' }, HOJE, '2025-01-10')?.codigo).toBe(
      'ca-vencido',
    );
    // Vence no próprio dia da entrega: ainda vale.
    expect(conferirEntregaEpi({ ...e, caValidade: '2026-10-20' }, HOJE, '2025-01-10')).toBeNull();
  });
  it('data futura, antes da admissão, CA sem número e quantidade recusados', () => {
    expect(conferirEntregaEpi({ ...e, data: '2026-10-27' }, HOJE, '2025-01-10')?.codigo).toBe('data-futura');
    expect(conferirEntregaEpi(e, HOJE, '2026-10-21')?.codigo).toBe('antes-admissao');
    expect(conferirEntregaEpi({ ...e, caNumero: 'CA-1' }, HOJE, '2025-01-10')?.codigo).toBe('ca-invalido');
    expect(conferirEntregaEpi({ ...e, quantidade: 0 }, HOJE, '2025-01-10')?.codigo).toBe('quantidade');
  });
  it('EPI exigido sem entrega com CA válido falta; a entrega com o CA vencido hoje não conta', () => {
    const exigidos = [
      linha(1, {}),
      linha(2, { epi: 'Óculos de proteção' }),
      linha(3, { tipo: 'risco', epi: null }),
    ];
    expect(episFaltando(exigidos, [entrega(1, {})], HOJE)).toEqual(['Óculos de proteção']);
    expect(episFaltando(exigidos, [entrega(1, { caValidade: '2026-10-25' })], HOJE)).toEqual([
      'Luva de procedimento',
      'Óculos de proteção',
    ]);
    expect(episFaltando(exigidos, [entrega(1, {}), entrega(2, { epi: 'OCULOS DE PROTECAO' })], HOJE)).toEqual(
      [],
    );
  });
});

describe('dosimetria e pendências', () => {
  it('leitura: período invertido, fim futuro e dose inválida recusados', () => {
    expect(
      conferirDosimetria({ periodoInicio: '2026-09-01', data: '2026-09-30', doseMsv: 0.4 }, HOJE),
    ).toBeNull();
    expect(
      conferirDosimetria({ periodoInicio: '2026-10-01', data: '2026-09-30', doseMsv: 0.4 }, HOJE)?.codigo,
    ).toBe('periodo-invertido');
    expect(
      conferirDosimetria({ periodoInicio: '2026-10-01', data: '2026-10-31', doseMsv: 0.4 }, HOJE)?.codigo,
    ).toBe('data-futura');
    expect(
      conferirDosimetria({ periodoInicio: '2026-09-01', data: '2026-09-30', doseMsv: -1 }, HOJE)?.codigo,
    ).toBe('dose-invalida');
  });
  it('a dose do ano é a soma das leituras do ano, com as parcelas: 8,5 + 12,0 = 20,5 mSv passa do limite de 20', () => {
    const ls = [
      entrega(1, { tipo: 'dosimetria', data: '2026-06-30', doseMsv: 8.5, epi: null }),
      entrega(2, { tipo: 'dosimetria', data: '2026-09-30', doseMsv: 12, epi: null }),
      entrega(3, { tipo: 'dosimetria', data: '2025-12-31', doseMsv: 40, epi: null }),
    ];
    expect(doseNoAno(ls, 2026)).toEqual({ total: 20.5, parcelas: [8.5, 12], situacao: 'acima-limite' });
    expect(doseNoAno(ls, 2025)).toEqual({ total: 40, parcelas: [40], situacao: 'acima-limite' });
    expect(doseNoAno(ls, 2024)).toEqual({ total: 0, parcelas: [], situacao: 'normal' });
    expect(
      doseNoAno([...ls, entrega(4, { tipo: 'dosimetria', data: '2026-10-20', doseMsv: 30, epi: null })], 2026)
        .situacao,
    ).toBe('acima-teto');
  });
  it('pendências: assinatura, EPI faltando e dose; juntas na ordem do vocabulário com a gravidade', () => {
    const p = pendenciasEpi(
      [linha(1, {}), linha(2, { epi: 'Avental' })],
      [
        entrega(1, { assinatura: 'pendente' }),
        entrega(2, { tipo: 'dosimetria', data: '2026-03-31', doseMsv: 25, epi: null }),
      ],
      HOJE,
    );
    expect(p).toEqual(['epi-assinatura', 'epi-faltando', 'dose-acima-limite']);
    expect(juntarPendencias(p, ['aso-vencido', 'epi-faltando']).map((x) => [x.codigo, x.gravidade])).toEqual([
      ['aso-vencido', 'alerta'],
      ['epi-assinatura', 'aviso'],
      ['epi-faltando', 'alerta'],
      ['dose-acima-limite', 'alerta'],
    ]);
  });
  it('o registro cancelado fica no histórico mas não conta na dose, nos EPI entregues nem nas pendências', () => {
    const alta = entrega(9, { tipo: 'dosimetria', data: '2026-03-31', doseMsv: 30, epi: null });
    expect(pendenciasEpi([], [alta], HOJE)).toEqual(['dose-acima-limite']);
    const cancelada = { ...alta, cancelada: true };
    expect(doseNoAno([cancelada], 2026)).toEqual({ total: 0, parcelas: [], situacao: 'normal' });
    expect(
      pendenciasEpi(
        [linha(1, {})],
        [
          cancelada,
          entrega(1, { assinatura: 'pendente', cancelada: true }),
          entrega(2, { cancelada: false }),
        ],
        HOJE,
      ),
    ).toEqual([]);
    expect(episFaltando([linha(1, {})], [entrega(1, { cancelada: true })], HOJE)).toEqual([
      'Luva de procedimento',
    ]);
  });
  it('leitura repetida: o mesmo dosímetro e início de período com leitura ativa recusa; a cancelada não', () => {
    const lida = (extra: Partial<Parameters<typeof conferirLeituraRepetida>[0][number]>) => ({
      tipo: 'dosimetria' as const,
      dosimetro: 'DOS-01',
      periodoInicio: '2026-09-01',
      cancelada: false,
      ...extra,
    });
    const nova = { dosimetro: ' dos-01 ', periodoInicio: '2026-09-01' };
    expect(conferirLeituraRepetida([lida({})], nova)).toEqual({
      codigo: 'leitura-repetida',
      mensagem:
        'Já há leitura deste dosímetro para o mesmo período: cancele a anterior para lançar a correta.',
      campo: 'periodoInicio',
    });
    expect(conferirLeituraRepetida([lida({ cancelada: true })], nova)).toBeNull();
    expect(conferirLeituraRepetida([lida({ periodoInicio: '2026-08-01' })], nova)).toBeNull();
    expect(conferirLeituraRepetida([lida({ dosimetro: 'DOS-02' })], nova)).toBeNull();
    expect(conferirLeituraRepetida([lida({ tipo: 'quimio' })], nova)).toBeNull();
  });
});
