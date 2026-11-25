import { describe, expect, it } from 'vitest';
import {
  calcularCustoPadrao,
  compararComApurado,
  custoDoItemCent,
  custoMinutoSala,
  custoUnitarioDoItem,
  fichaVigente,
  type FichaParaVigencia,
  planejarAtivacao,
  problemasDaEdicaoDeItens,
  problemasDaFicha,
  problemasDaInativacao,
  problemasDoItemFicha,
  proximaVersaoFicha,
  vigenteNaData,
} from './custo-padrao.js';

const codigos = (l: readonly { codigo: string }[]) => l.map((x) => x.codigo);

describe('custo-padrão por procedimento: itens da ficha', () => {
  it('custo do item em centavos com quatro casas, meio para cima', () => {
    expect(custoDoItemCent(2, 10.5)).toBe(2100);
    expect(custoDoItemCent(45, 3.3333)).toBe(15000); // 149,9985 -> 150,00
    expect(custoDoItemCent(0.5, 0.0001)).toBe(0);
    expect(custoDoItemCent(1.25, 8.1234)).toBe(1015); // 10,15425 -> 10,15
  });

  it('referência obrigatória pelo tipo; mão de obra pede descrição', () => {
    expect(
      codigos(
        problemasDoItemFicha(
          { tipo: 'insumo', referencia: null, descricao: null, quantidade: 1, custoUnitario: 1 },
          null,
        ),
      ),
    ).toEqual(['referencia-obrigatoria']);
    expect(
      codigos(
        problemasDoItemFicha(
          { tipo: 'mao_de_obra', referencia: null, descricao: ' ', quantidade: 1, custoUnitario: 80 },
          null,
        ),
      ),
    ).toEqual(['descricao-obrigatoria']);
    expect(
      codigos(
        problemasDoItemFicha(
          { tipo: 'xyz', referencia: 1, descricao: null, quantidade: 1, custoUnitario: 1 },
          null,
        ),
      ),
    ).toEqual(['tipo-invalido']);
  });

  it('quantidade maior que zero com até quatro casas; custo não negativo', () => {
    expect(
      codigos(
        problemasDoItemFicha(
          { tipo: 'insumo', referencia: 3, descricao: null, quantidade: 0, custoUnitario: -1 },
          null,
        ),
      ),
    ).toEqual(['quantidade-invalida', 'custo-invalido']);
    expect(
      codigos(
        problemasDoItemFicha(
          { tipo: 'insumo', referencia: 3, descricao: null, quantidade: 1.00001, custoUnitario: 2 },
          null,
        ),
      ),
    ).toEqual(['quantidade-invalida']);
  });

  it('sem custo informado usa o de referência; sem nenhum dos dois é recusado', () => {
    const e = { tipo: 'gas_medicinal', referencia: 9, descricao: null, quantidade: 30, custoUnitario: null };
    expect(problemasDoItemFicha(e, 0.25)).toEqual([]);
    expect(custoUnitarioDoItem(e, 0.25)).toBe(0.25);
    expect(codigos(problemasDoItemFicha(e, null))).toEqual(['sem-custo-referencia']);
    expect(custoUnitarioDoItem({ ...e, custoUnitario: 0.3 }, 0.25)).toBe(0.3);
  });

  it('totais: mão de obra é honorário, o resto operacional, e o total por tipo', () => {
    const c = calcularCustoPadrao([
      { tipo: 'insumo', custoTotal: 1000 },
      { tipo: 'sala_cirurgica', custoTotal: 9000 },
      { tipo: 'mao_de_obra', custoTotal: 5000 },
      { tipo: 'insumo', custoTotal: 500 },
    ]);
    expect(c).toEqual({
      honorario: 5000,
      operacional: 10500,
      total: 15500,
      porTipo: { insumo: 1500, sala_cirurgica: 9000, mao_de_obra: 5000 },
    });
  });

  it('itens só mudam no rascunho', () => {
    expect(problemasDaEdicaoDeItens('rascunho')).toEqual([]);
    expect(codigos(problemasDaEdicaoDeItens('ativa'))).toEqual(['ficha-nao-rascunho']);
  });
});

describe('referências com vigência', () => {
  const lista = [
    { inicio: '2026-01-01', fim: '2026-05-31', valor: 2 },
    { inicio: '2026-06-01', fim: null, valor: 3 },
  ];
  it('valor vigente na data', () => {
    expect(vigenteNaData(lista, '2026-03-10')).toBe(2);
    expect(vigenteNaData(lista, '2026-07-10')).toBe(3);
    expect(vigenteNaData(lista, '2025-12-31')).toBeNull();
  });
  it('minuto de sala pela média das salas vigentes', () => {
    expect(custoMinutoSala([lista, [{ inicio: '2026-01-01', fim: null, valor: 4 }], []], '2026-07-01')).toBe(
      3.5,
    );
    expect(custoMinutoSala([[]], '2026-07-01')).toBeNull();
  });
});

describe('ficha, vigência e ativação', () => {
  it('ficha: descrição e vigência', () => {
    expect(
      codigos(problemasDaFicha({ descricao: '', vigenciaInicio: '2026-02-01', vigenciaFim: '2026-01-01' })),
    ).toEqual(['descricao-obrigatoria', 'vigencia-invalida']);
  });

  const f = (
    id: number,
    ini: string,
    fim: string | null,
    sit: FichaParaVigencia['situacao'] = 'ativa',
    padrao = false,
  ) => ({
    id,
    situacao: sit,
    vigenciaInicio: ini,
    vigenciaFim: fim,
    padrao,
  });

  it('vigente: a padrão primeiro, senão a de início mais recente; rascunho não conta', () => {
    const l = [f(1, '2026-01-01', null), f(2, '2026-03-01', null), f(3, '2026-04-01', null, 'rascunho')];
    expect(fichaVigente(l, '2026-05-01')?.id).toBe(2);
    expect(fichaVigente([...l, f(4, '2025-01-01', null, 'ativa', true)], '2026-05-01')?.id).toBe(4);
    expect(fichaVigente(l, '2025-06-01')).toBeNull();
  });

  it('ativação encerra a anterior na véspera e recusa sobreposição', () => {
    const nova = { ...f(5, '2026-06-01', null, 'rascunho'), itens: 3, custoTotal: 1000 };
    expect(planejarAtivacao(nova, [f(1, '2026-01-01', null), f(9, '2025-01-01', '2025-12-31')])).toEqual({
      problemas: [],
      encerrar: [{ id: 1, vigenciaFim: '2026-05-31' }],
    });
    expect(codigos(planejarAtivacao(nova, [f(2, '2026-06-01', null)]).problemas)).toEqual([
      'vigencia-sobreposta',
    ]);
    expect(codigos(planejarAtivacao({ ...nova, itens: 0 }, []).problemas)).toEqual(['ficha-sem-itens']);
    expect(codigos(planejarAtivacao({ ...nova, custoTotal: 0 }, []).problemas)).toEqual(['ficha-sem-custo']);
    expect(codigos(planejarAtivacao({ ...nova, situacao: 'ativa' }, []).problemas)).toEqual([
      'ficha-nao-rascunho',
    ]);
  });

  it('inativação pede motivo e não repete', () => {
    expect(problemasDaInativacao('ativa', 'revisão')).toEqual([]);
    expect(codigos(problemasDaInativacao('inativa', ''))).toEqual(['ficha-inativa', 'motivo-obrigatorio']);
  });

  it('próxima versão', () => {
    expect(proximaVersaoFicha([])).toBe('1');
    expect(proximaVersaoFicha(['1', '3', 'x'])).toBe('4');
  });
});

describe('comparação do padrão com o apurado', () => {
  it('padrão pela quantidade, variação, percentual e classe pela tolerância', () => {
    const c = compararComApurado(10_000, [
      { conta: 1, numero: 'A', quantidade: 1, custoApurado: 10_500 },
      { conta: 2, numero: 'B', quantidade: 2, custoApurado: 25_000 },
      { conta: 3, numero: 'C', quantidade: 1, custoApurado: 8_000 },
    ]);
    expect(c.linhas.map((l) => [l.custoPadrao, l.variacao, l.variacaoPercentualCent, l.classe])).toEqual([
      [10_000, 500, 500, 'dentro'],
      [20_000, 5_000, 2_500, 'acima'],
      [10_000, -2_000, -2_000, 'abaixo'],
    ]);
    expect(c.totalPadrao).toBe(40_000);
    expect(c.totalApurado).toBe(43_500);
    expect(c.variacao).toBe(3_500);
    expect(c.variacaoPercentualCent).toBe(875);
    expect(c.classe).toBe('dentro');
    expect(c.contagem).toEqual({ dentro: 1, acima: 1, abaixo: 1 });
  });
  it('sem contas e com padrão zero', () => {
    expect(compararComApurado(0, []).classe).toBe('dentro');
    expect(
      compararComApurado(0, [{ conta: 1, numero: 'A', quantidade: 1, custoApurado: 5 }]).linhas[0]?.classe,
    ).toBe('acima');
  });
});
