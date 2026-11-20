// Regra 4 (ficha do M29; cap-13 CTRL-01 a CTRL-03): prescritor com registro coerente com o conselho na saída de
// controlado; internado pela prescrição do prontuário; dupla conferência e perda com testemunha; saldo por substância.
import { describe, expect, it } from 'vitest';
import {
  conferirDuplaConferencia,
  conferirPerdaControlado,
  conferirPrescritorControlado,
  listaDoItem,
  REAUTENTICACAO_CONTROLADO_MS,
  saldoPorSubstancia,
} from '@sgh/contratos/regras-suprimentos';

const crm = { vinculo: 55, conselho: 'CRM', registro: 12345, uf: 'RJ' };

describe('lista da Portaria 344', () => {
  it('reconhece as listas do cadastro; vazio e desconhecido: não controlado', () => {
    expect(listaDoItem(' b1 ')).toBe('B1');
    expect(listaDoItem('C5')).toBe('C5');
    expect(listaDoItem('')).toBeNull();
    expect(listaDoItem('Z9')).toBeNull();
    expect(listaDoItem(null)).toBeNull();
  });
});

describe('prescritor do controlado (regra 4)', () => {
  it('item não controlado: nada a conferir', () => {
    expect(
      conferirPrescritorControlado({ lista: null, internado: true, prescritor: null, daPrescricao: false }),
    ).toBeNull();
  });
  it('internado: só pela prescrição do prontuário; com ela, o prescritor dela basta', () => {
    expect(
      conferirPrescritorControlado({ lista: 'A1', internado: true, prescritor: crm, daPrescricao: false })
        ?.codigo,
    ).toBe('sem-prescricao');
    expect(
      conferirPrescritorControlado({ lista: 'A1', internado: true, prescritor: crm, daPrescricao: true }),
    ).toBeNull();
  });
  it('sem prescritor, conselho que não prescreve, sem registro, sem UF: recusa', () => {
    const b = { lista: 'B1' as const, internado: false, daPrescricao: false };
    expect(conferirPrescritorControlado({ ...b, prescritor: null })?.codigo).toBe('sem-prescritor');
    expect(conferirPrescritorControlado({ ...b, prescritor: { ...crm, vinculo: null } })?.codigo).toBe(
      'sem-prescritor',
    );
    expect(conferirPrescritorControlado({ ...b, prescritor: { ...crm, conselho: 'COREN' } })?.codigo).toBe(
      'conselho-incoerente',
    );
    expect(conferirPrescritorControlado({ ...b, prescritor: { ...crm, conselho: null } })?.mensagem).toMatch(
      /informado/,
    );
    expect(conferirPrescritorControlado({ ...b, prescritor: { ...crm, registro: 0 } })?.codigo).toBe(
      'sem-registro-conselho',
    );
    expect(conferirPrescritorControlado({ ...b, prescritor: { ...crm, uf: '' } })?.codigo).toBe(
      'sem-uf-conselho',
    );
    expect(conferirPrescritorControlado({ ...b, prescritor: { ...crm, conselho: 'cro' } })).toBeNull();
    expect(conferirPrescritorControlado({ ...b, prescritor: { ...crm, conselho: 'CRMV' } })).toBeNull();
  });
});

describe('dupla conferência (CTRL-03)', () => {
  const agora = 1_000_000;
  const b = {
    responsavel: 'FARM.A',
    conferente: 'FARM.B',
    reautenticadoEm: agora - 1_000,
    agora,
    quantidadeDocumento: 2,
    quantidadeContada: 2,
    justificativa: '',
  };
  it('conferente diferente, reautenticado, contagem igual: confere', () => {
    expect(conferirDuplaConferencia(b)).toBeNull();
  });
  it('mesma pessoa (sem diferença de caixa), sem reautenticação ou vencida, quantidade inválida', () => {
    expect(conferirDuplaConferencia({ ...b, conferente: 'farm.a ' })?.codigo).toBe('conferente-igual');
    expect(conferirDuplaConferencia({ ...b, conferente: '' })?.codigo).toBe('conferente-igual');
    expect(conferirDuplaConferencia({ ...b, reautenticadoEm: null })?.codigo).toBe('reautenticar');
    expect(
      conferirDuplaConferencia({ ...b, reautenticadoEm: agora - REAUTENTICACAO_CONTROLADO_MS - 1 })?.codigo,
    ).toBe('reautenticar');
    expect(conferirDuplaConferencia({ ...b, quantidadeContada: Number.NaN })?.codigo).toBe(
      'quantidade-invalida',
    );
  });
  it('divergência exige justificativa', () => {
    expect(conferirDuplaConferencia({ ...b, quantidadeContada: 1 })?.codigo).toBe(
      'divergencia-sem-justificativa',
    );
    expect(
      conferirDuplaConferencia({
        ...b,
        quantidadeContada: 1,
        justificativa: 'ampola quebrada na conferência',
      }),
    ).toBeNull();
  });
});

describe('perda de controlado (P2)', () => {
  const agora = 5_000_000;
  const b = {
    responsavel: 'FARM.A',
    testemunha: 'FARM.B',
    motivo: 'frasco quebrado no transporte',
    quantidade: 1,
    saldoLote: 3,
    reautenticadoEm: agora,
    agora,
  };
  it('com testemunha, motivo, saldo e reautenticação: aceita', () => {
    expect(conferirPerdaControlado(b)).toBeNull();
  });
  it('recusas', () => {
    expect(conferirPerdaControlado({ ...b, testemunha: 'farm.a' })?.codigo).toBe('sem-testemunha');
    expect(conferirPerdaControlado({ ...b, testemunha: '' })?.codigo).toBe('sem-testemunha');
    expect(conferirPerdaControlado({ ...b, motivo: 'curto' })?.codigo).toBe('sem-motivo');
    expect(conferirPerdaControlado({ ...b, quantidade: 4 })?.codigo).toBe('saldo-insuficiente');
    expect(conferirPerdaControlado({ ...b, quantidade: 0 })?.codigo).toBe('saldo-insuficiente');
    expect(conferirPerdaControlado({ ...b, reautenticadoEm: null })?.codigo).toBe('reautenticar');
  });
});

describe('saldo por substância (CTRL-01)', () => {
  it('anterior + entradas (inclui devolução e transferência recebida) − saídas (inclui perda e transferência enviada)', () => {
    const m = (tipo: Parameters<typeof saldoPorSubstancia>[1][number]['tipo'], quantidade: number) => ({
      item: 1,
      data: '2026-10-20',
      tipo,
      quantidade,
      documento: 'x',
    });
    expect(
      saldoPorSubstancia(10, [
        m('entrada', 5),
        m('devolucao', 1),
        m('transferencia-entrada', 2),
        m('saida', 3),
        m('perda', 1),
        m('transferencia-saida', 0.5),
      ]),
    ).toEqual({ anterior: 10, entradas: 8, saidas: 4.5, final: 13.5 });
    expect(saldoPorSubstancia(0, [])).toEqual({ anterior: 0, entradas: 0, saidas: 0, final: 0 });
  });
});
