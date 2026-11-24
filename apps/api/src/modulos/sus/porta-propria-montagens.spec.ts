// Unidade das montagens próprias do faturamento SUS (porta-propria-montagens.ts) sobre um leitor falso: os domínios da
// APAC pelo código oficial, a chave do solicitante (CPF) e o CRM, a linha sem remessa, o BPA sem fonte SUS e o código
// SIH da acomodação (nunca o id interno).
import type { Leitor } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  type ApoioMontagemSus,
  codigoAcomodacaoSih,
  MontagensSusPropria,
} from './porta-propria-montagens.js';

type Linha = Record<string, unknown>;

function leitor(respostas: (sql: string, p: readonly unknown[]) => Linha[]): Leitor & { sqls: string[] } {
  const sqls: string[] = [];
  const l = {
    sqls,
    consultar: async (sql: string, p: readonly unknown[] = []) => {
      sqls.push(sql);
      return respostas(sql, p);
    },
    uma: async (sql: string, p: readonly unknown[] = []) => {
      sqls.push(sql);
      return respostas(sql, p)[0] ?? null;
    },
  };
  return l as unknown as Leitor & { sqls: string[] };
}

const apoio: ApoioMontagemSus = {
  sigtapDosIds: async () => ({
    procedimentos: [],
    registros: [],
    compatibilidades: { cids: [], cbos: [], habilitacoes: [], leitos: [] },
  }),
  cnesCadastrados: async () => [1234567],
  leitosUti: async () => [],
  sigtapPorCodigo: async () => null,
};

describe('montagens próprias do faturamento SUS', () => {
  it('domínios da APAC: só o código oficial numérico, por lista', async () => {
    const l = leitor(() => [
      { lista: 'acesso_vascular', codigo: '1', descricao: 'FISTULA' },
      { lista: 'acesso_vascular', codigo: 'X9', descricao: 'SEM CODIGO NUMERICO' },
      { lista: 'situacao_transplante', codigo: '2', descricao: 'INSCRITO' },
    ]);
    const d = await new MontagensSusPropria(l, 7, apoio).dominiosApac();
    expect(d.acessoVascular).toEqual([{ id: 1, nome: 'FISTULA' }]);
    expect(d.situacaoTransplante).toEqual([{ id: 2, nome: 'INSCRITO' }]);
    expect(d.caracteristicaTratamento).toEqual([]);
  });

  it('solicitantes pela chave: CPF válido, sem repetir, com o CRM numérico', async () => {
    const l = leitor(() => [
      { cpf: '11122233344', nome: 'MEDICO A', cns: null, crm: '12.345' },
      { cpf: '11122233344', nome: 'MEDICO A', cns: null, crm: '12345' },
    ]);
    const m = new MontagensSusPropria(l, 7, apoio);
    expect(await m.solicitantesApacPorChave(['curto'])).toEqual([]);
    expect(await m.solicitantesApacPorChave(['111.222.333-44'])).toEqual([
      { chave: '11122233344', nome: 'MEDICO A', crm: 12345, cns: null },
    ]);
  });

  it('linhas do arquivo sem remessa e BPA sem fonte SUS: vazios, com o CNES do estabelecimento', async () => {
    const l = leitor(() => []);
    const m = new MontagensSusPropria(l, 7, apoio);
    expect(await m.linhasBpa({ arquivo: 0, pagina: 0, porPagina: 10 })).toEqual({
      itens: [],
      total: 0,
      porTipo: {},
    });
    expect(await m.linhasApac({ arquivo: 5, pagina: 0, porPagina: 10 })).toMatchObject({
      total: 0,
      apacs: 0,
    });
    const d = await m.dadosBpa({ inicio: '2026-03-01', fim: '2026-03-31' }, [], []);
    expect(d.atendimentos).toEqual([]);
    expect(d.cnesCadastrados).toEqual([1234567]);
    // Sem fonte SUS, nenhuma consulta à produção.
    expect(l.sqls.some((s) => s.includes('conta_hospitalar c'))).toBe(false);
  });

  it('acomodação da passagem da AIH: só o código SIH numérico da enfermaria; sem ele, nada (nunca o id interno)', () => {
    expect(codigoAcomodacaoSih('3')).toBe(3);
    expect(codigoAcomodacaoSih(' 17 ')).toBe(17);
    expect(codigoAcomodacaoSih(7)).toBe(7);
    expect(codigoAcomodacaoSih(null)).toBeNull();
    expect(codigoAcomodacaoSih('')).toBeNull();
    expect(codigoAcomodacaoSih('UTI')).toBeNull();
    expect(codigoAcomodacaoSih('3A')).toBeNull();
    expect(codigoAcomodacaoSih('-3')).toBeNull();
  });

  it('dados da AIH: a passagem em quarto sem código SIH fica fora da trajetória', async () => {
    const l = leitor((sql) => {
      if (sql.includes('FROM internacao i'))
        return [
          {
            id: 41,
            atendimento_id: 51,
            fonte_pagadora_id: 2,
            entrada: '2026-03-02',
            alta: '2026-03-06',
          },
        ];
      if (sql.includes('FROM ocupacao_leito'))
        return [
          { internacao_id: 41, entrada: '2026-03-02', saida: '2026-03-03', acomodacao: null },
          { internacao_id: 41, entrada: '2026-03-03', saida: '2026-03-04', acomodacao: 'X1' },
          { internacao_id: 41, entrada: '2026-03-04', saida: null, acomodacao: '3' },
        ];
      return [];
    });
    const d = await new MontagensSusPropria(l, 7, apoio).dadosAih([41], [], [], [2]);
    expect(d.passagens.map((p) => [p.entrada, p.acomodacao])).toEqual([['2026-03-04', 3]]);
  });
});
