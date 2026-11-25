import { describe, expect, it } from 'vitest';
import { planejarAlteracaoTituloPagar, type TituloPagarAlteravel } from './alteracao-titulo-pagar.js';

const base: TituloPagarAlteravel = {
  situacao: 'aberto',
  pago: 0,
  bordero: 0,
  notasAplicadas: 0,
  aprovacoes: 0,
  credor: 10,
  documento: '123',
  serie: '',
  emissao: '2026-11-01',
  valorDocumento: 300,
  centroCusto: null,
  referente: 'SINTETICO',
  observacao: '',
  parcelas: [
    { parcela: 1, vencimento: '2026-12-01', valor: 150, prorrogada: false },
    { parcela: 2, vencimento: '2027-01-01', valor: 150, prorrogada: false },
  ],
  retencoes: [{ tributo: 7, valor: 10 }],
};
const codigo = (r: ReturnType<typeof planejarAlteracaoTituloPagar>) => (r.ok ? 'ok' : r.recusa.codigo);

describe('alteração do título a pagar não pago', () => {
  it('campo descritivo muda sem reabrir a alçada, mesmo no título aprovado', () => {
    const r = planejarAlteracaoTituloPagar({ ...base, aprovacoes: 2 }, { referente: 'NOVO TEXTO' });
    expect(r).toMatchObject({ ok: true, campos: ['referente'], materiais: [], reabreAlcada: false });
  });

  it('valor e parcelas reabrem a alçada do título aprovado e exigem justificativa', () => {
    const pedido = {
      valorDocumento: 400,
      parcelas: [
        { parcela: 1, vencimento: '2026-12-01', valor: 200 },
        { parcela: 2, vencimento: '2027-01-01', valor: 200 },
      ],
    };
    expect(codigo(planejarAlteracaoTituloPagar({ ...base, aprovacoes: 1 }, pedido))).toBe(
      'justificativa-obrigatoria',
    );
    const r = planejarAlteracaoTituloPagar(
      { ...base, aprovacoes: 1 },
      { ...pedido, justificativa: 'nota corrigida' },
    );
    expect(r).toMatchObject({ ok: true, materiais: ['valorDocumento', 'parcelas'], reabreAlcada: true });
  });

  it('mudança material sem aprovação anterior não pede justificativa nem reabre nada', () => {
    const r = planejarAlteracaoTituloPagar(base, { credor: 11, retencoes: [] });
    expect(r).toMatchObject({ ok: true, materiais: ['credor', 'retencoes'], reabreAlcada: false });
  });

  it('valor novo sem as parcelas é recusado, e parcelas que não somam o valor também', () => {
    expect(codigo(planejarAlteracaoTituloPagar(base, { valorDocumento: 400 }))).toBe('parcelas-do-valor');
    expect(
      codigo(
        planejarAlteracaoTituloPagar(base, {
          valorDocumento: 400,
          parcelas: [{ parcela: 1, vencimento: '2026-12-01', valor: 300 }],
        }),
      ),
    ).not.toBe('ok');
  });

  it('recusa título pago, com baixa, em borderô ou abatido por nota', () => {
    expect(codigo(planejarAlteracaoTituloPagar({ ...base, situacao: 'pago' }, { referente: 'x' }))).toBe(
      'titulo-nao-alteravel',
    );
    expect(codigo(planejarAlteracaoTituloPagar({ ...base, pago: 1 }, { referente: 'x' }))).toBe(
      'titulo-com-baixa',
    );
    expect(codigo(planejarAlteracaoTituloPagar({ ...base, bordero: 1 }, { referente: 'x' }))).toBe(
      'titulo-em-bordero',
    );
    expect(codigo(planejarAlteracaoTituloPagar({ ...base, notasAplicadas: 1 }, { referente: 'x' }))).toBe(
      'titulo-com-nota',
    );
  });

  it('nada mudou, retenção repetida ou acima do valor', () => {
    expect(codigo(planejarAlteracaoTituloPagar(base, { referente: ' SINTETICO ' }))).toBe('sem-alteracao');
    expect(
      codigo(
        planejarAlteracaoTituloPagar(base, {
          retencoes: [
            { tributo: 7, valor: 1 },
            { tributo: 7, valor: 2 },
          ],
        }),
      ),
    ).toBe('retencao-repetida');
    expect(codigo(planejarAlteracaoTituloPagar(base, { retencoes: [{ tributo: 7, valor: 301 }] }))).toBe(
      'retencao-acima-do-documento',
    );
  });

  it('a parcela prorrogada não muda de vencimento por aqui, mas pode mudar de valor', () => {
    const prorrogado = {
      ...base,
      parcelas: [{ ...base.parcelas[0]!, prorrogada: true }, base.parcelas[1]!],
    };
    expect(
      codigo(
        planejarAlteracaoTituloPagar(prorrogado, {
          parcelas: [
            { parcela: 1, vencimento: '2026-12-05', valor: 150 },
            { parcela: 2, vencimento: '2027-01-01', valor: 150 },
          ],
        }),
      ),
    ).toBe('parcela-prorrogada');
    expect(
      codigo(
        planejarAlteracaoTituloPagar(prorrogado, {
          parcelas: [
            { parcela: 1, vencimento: '2026-12-01', valor: 100 },
            { parcela: 2, vencimento: '2027-01-01', valor: 200 },
          ],
        }),
      ),
    ).toBe('ok');
  });
});
