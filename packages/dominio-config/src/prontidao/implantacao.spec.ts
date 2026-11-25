import { describe, expect, it } from 'vitest';
import {
  conferirDatasImplantacao,
  conferirMeta,
  conferirMudancaItem,
  type ItemDoResumo,
  minimoEfetivo,
  resumoImplantacao,
  situacaoMeta,
  situacaoPelaContagem,
} from './implantacao.js';

describe('kit de implantação: situação do item pela contagem', () => {
  const base = { tipo: 'cadastro_minimo' as const, quantidadeMinima: 3, atual: 'pendente' as const };
  it('pronto ao atingir o mínimo, em andamento com algum registro, pendente sem nenhum', () => {
    expect(situacaoPelaContagem({ ...base, contagem: 3 })).toBe('pronto');
    expect(situacaoPelaContagem({ ...base, contagem: 5 })).toBe('pronto');
    expect(situacaoPelaContagem({ ...base, contagem: 1 })).toBe('em_andamento');
    expect(situacaoPelaContagem({ ...base, contagem: 0 })).toBe('pendente');
  });
  it('volta de pronto quando o cadastro deixa de existir', () => {
    expect(situacaoPelaContagem({ ...base, atual: 'pronto', contagem: 0 })).toBe('pendente');
  });
  it('o dispensado fica dispensado e os itens manuais não mudam pela contagem', () => {
    expect(situacaoPelaContagem({ ...base, atual: 'dispensado', contagem: 0 })).toBe('dispensado');
    expect(
      situacaoPelaContagem({
        tipo: 'treinamento',
        quantidadeMinima: null,
        contagem: null,
        atual: 'em_andamento',
      }),
    ).toBe('em_andamento');
  });
  it('sem mínimo no modelo basta um registro', () => {
    expect(minimoEfetivo(null)).toBe(1);
    expect(minimoEfetivo(0)).toBe(1);
    expect(situacaoPelaContagem({ ...base, quantidadeMinima: null, contagem: 1 })).toBe('pronto');
  });
});

describe('kit de implantação: mudança manual do item', () => {
  const item = {
    tipo: 'cadastro_minimo' as const,
    quantidadeMinima: 2,
    contagem: 1,
    situacao: 'em_andamento' as const,
    dataInicioPrevista: '2026-12-01',
  };
  it('a dispensa pede o motivo', () => {
    expect(conferirMudancaItem(item, { situacao: 'dispensado' }).map((p) => p.campo)).toEqual([
      'motivoDispensa',
    ]);
    expect(
      conferirMudancaItem(item, { situacao: 'dispensado', motivoDispensa: 'Hospital sem centro cirúrgico' }),
    ).toEqual([]);
  });
  it('o cadastro mínimo não vira pronto à mão abaixo do mínimo', () => {
    const p = conferirMudancaItem(item, { situacao: 'pronto' });
    expect(p[0]?.campo).toBe('situacao');
    expect(p[0]?.mensagem).toMatch(/1 de 2 registros/);
    expect(conferirMudancaItem({ ...item, tipo: 'treinamento' }, { situacao: 'pronto' })).toEqual([]);
  });
  it('o prazo não vem antes do início previsto', () => {
    expect(conferirMudancaItem(item, { dataPrazo: '2026-11-30' }).map((p) => p.campo)).toEqual(['dataPrazo']);
    expect(conferirMudancaItem(item, { dataPrazo: '2026-12-15' })).toEqual([]);
  });
  it('as datas do projeto são coerentes', () => {
    expect(
      conferirDatasImplantacao({
        dataInicioPrevista: '2026-12-01',
        dataFimPrevista: '2026-11-01',
        dataViradaPrevista: '2026-10-01',
      }).map((p) => p.campo),
    ).toEqual(['dataFimPrevista', 'dataViradaPrevista']);
    expect(
      conferirDatasImplantacao({ dataInicioPrevista: '2026-12-01', dataFimPrevista: '2027-02-01' }),
    ).toEqual([]);
  });
});

describe('kit de implantação: resumo e o que falta', () => {
  const i = (id: number, o: Partial<ItemDoResumo>): ItemDoResumo => ({
    id,
    modulo: 'Administração',
    titulo: `Item ${id}`,
    tipo: 'cadastro_minimo',
    situacao: 'pendente',
    critico: false,
    ordem: id,
    dataPrazo: null,
    ...o,
  });
  const itens = [
    i(1, { situacao: 'pronto' }),
    i(2, { situacao: 'dispensado', modulo: 'Centro cirúrgico' }),
    i(3, { dataPrazo: '2026-12-20' }),
    i(4, { critico: true, dataPrazo: '2026-12-30' }),
    i(5, { dataPrazo: '2026-11-01', situacao: 'em_andamento' }),
    i(6, {}),
    i(7, { critico: true, dataPrazo: '2026-11-10' }),
  ];
  const r = resumoImplantacao(itens, '2026-11-25');
  it('conta pelas situações e calcula o percentual com prontos e dispensados', () => {
    expect(r).toMatchObject({
      total: 7,
      prontos: 1,
      dispensados: 1,
      emAndamento: 1,
      pendentes: 4,
      criticosEmAberto: 2,
      atrasados: 2,
      percentual: 28,
    });
  });
  it('resume por módulo', () => {
    expect(r.porModulo).toEqual([
      { modulo: 'Administração', total: 6, concluidos: 1, percentual: 16 },
      { modulo: 'Centro cirúrgico', total: 1, concluidos: 1, percentual: 100 },
    ]);
  });
  it('ordena o que falta: crítico, atrasado, prazo mais próximo, sem prazo por último', () => {
    expect(r.oQueFalta).toEqual([7, 4, 5, 3, 6]);
  });
  it('sem itens, nada falta', () => {
    expect(resumoImplantacao([], '2026-11-25')).toMatchObject({ total: 0, percentual: 100, oQueFalta: [] });
  });
});

describe('kit de implantação: metas', () => {
  const m = { valorMeta: 10, dataLimite: '2026-12-31', atual: 'pendente' as const, hoje: '2026-11-25' };
  it('menor é melhor no prazo e no tempo de resposta; maior nos demais', () => {
    expect(situacaoMeta({ ...m, indicador: 'prazo', valorMedido: 8 })).toBe('atingida');
    expect(situacaoMeta({ ...m, indicador: 'tempo_resposta', valorMedido: 12 })).toBe('parcial');
    expect(situacaoMeta({ ...m, indicador: 'volume', valorMedido: 12 })).toBe('atingida');
    expect(situacaoMeta({ ...m, indicador: 'adesao', valorMedido: 8 })).toBe('parcial');
  });
  it('sem medição fica pendente; vencida sem atingir, não atingida; a cancelada fica cancelada', () => {
    expect(situacaoMeta({ ...m, indicador: 'volume', valorMedido: null })).toBe('pendente');
    expect(situacaoMeta({ ...m, indicador: 'volume', valorMedido: 2, hoje: '2027-01-02' })).toBe(
      'nao_atingida',
    );
    expect(situacaoMeta({ ...m, indicador: 'volume', valorMedido: 20, atual: 'cancelada' })).toBe(
      'cancelada',
    );
  });
  it('confere a meta nova', () => {
    expect(conferirMeta({ processo: 'Admissão', indicador: 'adesao', valorMeta: 90 })).toEqual([]);
    expect(conferirMeta({ processo: 'x', indicador: 'adesao', valorMeta: 120 }).map((p) => p.campo)).toEqual([
      'processo',
      'valorMeta',
    ]);
    expect(conferirMeta({ processo: 'Faturamento', indicador: 'volume', valorMeta: -1 })).toHaveLength(1);
  });
});
