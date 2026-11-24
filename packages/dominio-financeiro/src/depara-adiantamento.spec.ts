// F3.8, 07-FIN linha 67: o adiantamento no lote contábil pelo de-para por evento (nenhuma conta fixa no código). A
// concessão debita o adiantamento a fornecedor e credita o banco; a compensação credita a mesma conta do adiantamento e
// debita o fornecedor da emissão (competência) ou a despesa paga (caixa); a devolução debita o banco e credita o
// adiantamento. Sem a regra da concessão, a compensação e a devolução apontam a falta na regra de origem.
import { describe, expect, it } from 'vitest';
import {
  dePararFatos,
  eventosSemDePara,
  fatoDaCompensacao,
  fatoDaConcessao,
  fatoDaDevolucao,
  type RegraDeParaConta,
} from './depara-contabil.js';

let id = 0;
const regra = (
  evento: string,
  lado: RegraDeParaConta['lado'],
  conta: string,
  natureza: number | null = null,
) => ({
  id: ++id,
  evento,
  lado,
  natureza,
  conta,
  ativo: true,
});
const REGRAS: RegraDeParaConta[] = [
  regra('fin_adiantamento_concedido', 'debito', '1.1.5.01'),
  regra('fin_adiantamento_concedido', 'credito', '1.1.1.02'),
  regra('fin_adiantamento_devolvido', 'debito', '1.1.1.02'),
  regra('fin_despesa_reconhecida', 'debito', '3.1.1', 7),
  regra('fin_despesa_reconhecida', 'credito', '2.1.1.01'),
  regra('fin_despesa_paga', 'debito', '3.9.9', 7),
];
const base = {
  data: '2026-10-05',
  valor: 2000,
  historico: 'ADIANTAMENTO SINTETICO',
  documento: 'AD-1',
  natureza: 7,
  centro: 3,
  credor: 9,
};
const contas = (f: Parameters<typeof dePararFatos>[0], regras = REGRAS) =>
  dePararFatos(f, regras, new Map([[3, 'C3']]), new Map([[9, 'F9']])).depara.map((d) => [
    d.contaDebito,
    d.contaCredito,
  ]);

describe('adiantamento no lote contábil por evento (07-FIN linha 67)', () => {
  it('concessão: débito adiantamento, crédito banco; centro e credor externos no evento', () => {
    const f = fatoDaConcessao(base);
    expect(f.evento).toBe('fin_adiantamento_concedido');
    expect(contas([f])).toEqual([['1.1.5.01', '1.1.1.02']]);
    const { eventos } = dePararFatos([f], REGRAS, new Map([[3, 'C3']]), new Map([[9, 'F9']]));
    expect([eventos[0]?.valor, eventos[0]?.centroExterno, eventos[0]?.participanteExterno]).toEqual([
      2000,
      'C3',
      'F9',
    ]);
  });

  it('compensação: crédito a conta do adiantamento; débito o fornecedor (competência) ou a despesa paga (caixa)', () => {
    const c = { ...base, valor: 1500 };
    expect(contas([fatoDaCompensacao(c, 'competencia')])).toEqual([['2.1.1.01', '1.1.5.01']]);
    expect(contas([fatoDaCompensacao(c, 'caixa')])).toEqual([['3.9.9', '1.1.5.01']]);
  });

  it('devolução: débito banco, crédito o adiantamento; os três somam zero na conta do adiantamento', () => {
    const fatos = [
      fatoDaConcessao(base),
      fatoDaCompensacao({ ...base, valor: 1500 }, 'competencia'),
      fatoDaDevolucao({ ...base, valor: 500 }),
    ];
    const d = dePararFatos(fatos, REGRAS, new Map(), new Map());
    expect(contas([fatos[2]!])).toEqual([['1.1.1.02', '1.1.5.01']]);
    const saldo = d.depara.reduce(
      (s, x, i) =>
        s +
        (x.contaDebito === '1.1.5.01' ? d.eventos[i]!.valor : 0) -
        (x.contaCredito === '1.1.5.01' ? d.eventos[i]!.valor : 0),
      0,
    );
    expect(saldo).toBe(0);
  });

  it('sem a regra da concessão: a falta aponta a regra de origem (concessão, débito), uma vez por fato', () => {
    const semConcessao = REGRAS.filter(
      (r) => !(r.evento === 'fin_adiantamento_concedido' && r.lado === 'debito'),
    );
    const faltas = eventosSemDePara(
      [fatoDaConcessao(base), fatoDaCompensacao(base, 'competencia'), fatoDaDevolucao(base)],
      semConcessao,
    );
    expect(faltas).toEqual([
      { evento: 'fin_adiantamento_concedido', natureza: null, lado: 'debito', fatos: 3 },
    ]);
  });
});
