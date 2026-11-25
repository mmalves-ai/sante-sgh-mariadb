// F3.8, 07-FIN linha 89: o cartão na sessão sintética (sem banco do cliente). O controller responde as opções e a
// prévia do recebimento pela regra do domínio só quando a porta do financeiro é a de memória; sem ela e sem núcleo,
// segue 503 (falha fechada), e a cadastro nunca responde sem banco. O que fica no banco é provado em
// `cartao.int.spec.ts` e no `porta-propria.int.spec.ts` do faturamento.
import { describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { ErroProblema } from '../../../problema.filter.js';
import { CartaoController } from '../cartao.controller.js';
import { opcoesCartaoMemoria, planoDoCartaoMemoria } from '../cartao-memoria.js';
import { PortaFinanceiroMemoria } from '../porta-memoria.js';

const req = () =>
  ({
    headers: {},
    sgh: {
      sessao: { rede: 'r1', estabelecimentoAtivo: 'pc', usuario: { login: 'SINT.CAIXA' }, permissoes: [] },
    },
  }) as unknown as RequisicaoAutorizada;
const pedido = {
  administradora: 1,
  bandeira: 1,
  modalidade: 'credito' as const,
  parcelas: 2,
  valor: 200,
  dataVenda: '2026-11-24',
};

describe('cartão em memória (sessão sintética)', () => {
  it('a prévia sai da regra do domínio: taxa da faixa de parcelas, líquido e datas previstas', () => {
    const p = planoDoCartaoMemoria(pedido);
    expect([p.bruto, p.taxaTotal, p.liquido]).toEqual([200, 6, 194]);
    expect(p.parcelas.map((x) => [x.sequencia, x.bruto, x.liquido, x.dataPrevista])).toEqual([
      [1, 100, 97, '2026-12-24'],
      [2, 100, 97, '2027-01-23'],
    ]);
    const debito = planoDoCartaoMemoria({ ...pedido, bandeira: 2, modalidade: 'debito', parcelas: 1 });
    expect([debito.taxaTotal, debito.liquido, debito.parcelas[0]?.dataPrevista]).toEqual([
      2,
      198,
      '2026-11-25',
    ]);
  });
  it('bandeira de outra modalidade e administradora desconhecida são recusadas', () => {
    expect(() => planoDoCartaoMemoria({ ...pedido, bandeira: 2 })).toThrow(/bandeira/);
    expect(() => planoDoCartaoMemoria({ ...pedido, administradora: 9 })).toThrow(/administradora/);
  });
  it('o controller responde só com a porta em memória; sem ela segue 503 e a gravação nunca responde', async () => {
    const sintetico = new CartaoController(null, new PortaFinanceiroMemoria(null));
    expect(sintetico.opcoes(req())).toEqual(opcoesCartaoMemoria());
    const q = { administradora: '1', bandeira: '1', modalidade: 'credito', parcelas: '1', valor: '100' };
    expect(await sintetico.previa(q, req())).toMatchObject({ bruto: 100, taxaTotal: 2, liquido: 98 });
    const fechado = new CartaoController(null, null);
    expect(() => fechado.opcoes(req())).toThrow(ErroProblema);
    // O cadastro (leitura e gravação) não existe sem banco: nem na sessão sintética.
    expect(() => sintetico.administradoras(req())).toThrow(ErroProblema);
  });
});
