import { describe, expect, it } from 'vitest';
import type { ItemPedidoAutorizacao } from './autorizacao-previa.js';
import {
  avaliarLimiteOpme,
  conferirDecisaoLiberacaoOpme,
  conferirPedidoDeLiberacao,
  opmeDaGuiaCobranca,
  situacaoOpmeAutorizada,
} from './opme-guia.js';

const item = (x: Partial<ItemPedidoAutorizacao> = {}): ItemPedidoAutorizacao => ({
  codigoTabela: '19',
  codigoProcedimento: '70000001',
  descricao: 'OPME sintética',
  quantidade: 2,
  valorUnitario: 400,
  opme: true,
  registroAnvisa: '80000000001',
  fabricante: null,
  ...x,
});
const proc = item({ codigoTabela: '22', opme: false, quantidade: 1, valorUnitario: null });

describe('limite de OPME com liberação na alçada', () => {
  it('dentro do limite não retém nem recusa', () => {
    const a = avaliarLimiteOpme([proc, item()], [{ valorLimite: 1000, quantidadeLimite: null }]);
    expect(a).toMatchObject({ total: 800, excesso: [], bloqueios: [], limiteValor: 1000 });
    expect(conferirPedidoDeLiberacao(a, null)).toEqual({ retido: false, problemas: [] });
  });
  it('acima do limite de valor: sem justificativa recusa com o caminho; com ela, retém', () => {
    const a = avaliarLimiteOpme(
      [proc, item({ valorUnitario: 800 })],
      [{ valorLimite: 1000, quantidadeLimite: null }],
    );
    expect(a.total).toBe(1600);
    expect(a.excesso[0]!.mensagem).toMatch(/acima do limite de 1000.00/);
    const sem = conferirPedidoDeLiberacao(a, 'curta');
    expect(sem.retido).toBe(false);
    expect(sem.problemas.map((p) => p.campo)).toEqual(['itens', 'justificativaLimite']);
    expect(conferirPedidoDeLiberacao(a, 'Prótese de revisão exige haste longa')).toEqual({
      retido: true,
      problemas: [],
    });
  });
  it('acima do limite de quantidade também se libera; o menor limite vale', () => {
    const a = avaliarLimiteOpme(
      [proc, item({ quantidade: 3, valorUnitario: 10 })],
      [
        { valorLimite: null, quantidadeLimite: 5 },
        { valorLimite: null, quantidadeLimite: 2 },
      ],
    );
    expect(a.limiteQuantidade).toBe(2);
    expect(a.excesso[0]!.mensagem).toMatch(/3 unidades, acima do limite de 2/);
  });
  it('OPME sem valor com limite de valor bloqueia mesmo com justificativa', () => {
    const a = avaliarLimiteOpme(
      [proc, item({ valorUnitario: null })],
      [{ valorLimite: 10, quantidadeLimite: null }],
    );
    expect(a.bloqueios[0]!.mensagem).toMatch(/Informe o valor da OPME/);
    const r = conferirPedidoDeLiberacao(a, 'Justificativa longa o bastante');
    expect(r.retido).toBe(false);
    expect(r.problemas).toHaveLength(1);
  });
  it('sem OPME ou sem limite, nada a conferir', () => {
    expect(avaliarLimiteOpme([proc], [{ valorLimite: 1, quantidadeLimite: null }]).excesso).toEqual([]);
    expect(avaliarLimiteOpme([item({ valorUnitario: 99999 })], []).excesso).toEqual([]);
  });
});

describe('decisão da liberação (quatro olhos)', () => {
  const base = { situacao: 'pendente' as const, solicitante: 7, decisor: 8, justificativa: null };
  it('outra pessoa libera', () => {
    expect(conferirDecisaoLiberacaoOpme({ ...base, decisao: 'aprovar' })).toBeNull();
  });
  it('quem pediu não libera nem recusa, mas cancela', () => {
    expect(conferirDecisaoLiberacaoOpme({ ...base, decisor: 7, decisao: 'aprovar' })).toMatch(/não libera/);
    expect(
      conferirDecisaoLiberacaoOpme({ ...base, decisor: 7, decisao: 'recusar', justificativa: 'motivo x' }),
    ).toMatch(/não libera/);
    expect(conferirDecisaoLiberacaoOpme({ ...base, decisor: 7, decisao: 'cancelar' })).toBeNull();
    expect(conferirDecisaoLiberacaoOpme({ ...base, decisao: 'cancelar' })).toMatch(/Só quem pediu/);
  });
  it('recusa exige motivo; decidida ou sem usuário não muda', () => {
    expect(conferirDecisaoLiberacaoOpme({ ...base, decisao: 'recusar' })).toMatch(/Diga por que/);
    expect(
      conferirDecisaoLiberacaoOpme({ ...base, decisao: 'recusar', justificativa: 'Preço fora da tabela' }),
    ).toBeNull();
    expect(conferirDecisaoLiberacaoOpme({ ...base, situacao: 'aprovado', decisao: 'aprovar' })).toMatch(
      /já foi/,
    );
    expect(conferirDecisaoLiberacaoOpme({ ...base, decisor: null, decisao: 'aprovar' })).toMatch(
      /sem usuário/,
    );
  });
});

describe('OPME autorizada e cobrada na guia', () => {
  it('situação da linha autorizada pela resposta do item', () => {
    expect(situacaoOpmeAutorizada('autorizado')).toBe('autorizado');
    expect(situacaoOpmeAutorizada('autorizado_parcial')).toBe('autorizado_parcial');
    expect(situacaoOpmeAutorizada('negado')).toBe('negado');
    expect(situacaoOpmeAutorizada('cancelado')).toBe('cancelado');
    expect(situacaoOpmeAutorizada('em_analise')).toBe('enviado');
  });
  it('o autorizado limita o cobrado: consome na ordem e marca o que passa; sem autorização, revisão', () => {
    const c = (contaItem: number, itemFaturavel: number, valorTotal: number) => ({
      contaItem,
      itemFaturavel,
      codigo: `C${itemFaturavel}`,
      descricao: 'OPME',
      quantidade: 2,
      valorTotal,
      registroAnvisa: null,
    });
    const r = opmeDaGuiaCobranca(
      [c(1, 10, 300), c(2, 10, 300), c(3, 11, 50)],
      [{ id: 90, itemFaturavel: 10, valorAutorizado: 500, quantidadeAutorizada: 4 }],
    );
    expect(r.map((x) => x.sequencia)).toEqual([1, 2, 3]);
    expect(r[0]).toMatchObject({ opmeAutorizada: 90, revisao: null, valorUnitario: 150 });
    expect(r[1]!.revisao).toMatch(/Cobrado 300.00 acima do autorizado 200.00/);
    expect(r[2]).toMatchObject({ opmeAutorizada: null });
    expect(r[2]!.revisao).toMatch(/sem autorização/);
  });
});
