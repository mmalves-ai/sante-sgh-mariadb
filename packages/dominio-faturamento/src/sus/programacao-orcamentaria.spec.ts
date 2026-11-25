// Regras da programação físico-orçamentária, dos tetos e das cotas do SUS (F7, 06-SUS linha 54). Massa sintética.
import { describe, expect, it } from 'vitest';
import {
  aplicarRemanejamentoCota,
  apurarSaldosSus,
  conferirDecisaoRemanejamento,
  conferirLimiteSus,
  conferirRemanejamentoCota,
  conferirVigenciaCompetencia,
  criticasDeLimiteSus,
  lerArquivoProgramacao,
  type LimiteSus,
  numeroDoArquivo,
  periodoDaCompetenciaSus,
  type RegistroProducaoSus,
  vesperaDe,
} from './programacao-orcamentaria.js';

const limite = (x: Partial<LimiteSus>): LimiteSus => ({
  tipo: 'teto',
  id: 1,
  instrumento: 'todos',
  setor: null,
  municipio: null,
  procedimento: null,
  grupo: null,
  financiamento: null,
  quantidade: null,
  valor: null,
  percentualAlerta: 90,
  bloqueia: false,
  descricao: 'limite',
  ...x,
});
const reg = (chave: string, x: Partial<RegistroProducaoSus> = {}): RegistroProducaoSus => ({
  chave,
  instrumento: 'bpa',
  procedimento: '0301010072',
  financiamento: '06',
  setor: 10,
  municipio: 500,
  quantidade: 1,
  valor: 10,
  conta: 1,
  atendimento: 2,
  item: 3,
  ...x,
});

describe('leitor do arquivo da programação', () => {
  it('lê cabeçalho, separadores, vírgula decimal, nível pelo tamanho e incremento', () => {
    const r = lerArquivoProgramacao(
      '\uFEFFcodigo;quantidade;valor;incremento\n03;100;;\n0301|50|12,50|10\n# comentário\n\n0301010072\t20\t1.234,56\n',
    );
    expect(r.problemas).toEqual([]);
    expect(r.itens.map((i) => [i.nivel, i.codigo, i.sequencia])).toEqual([
      ['grupo', '03', 1],
      ['subgrupo', '0301', 2],
      ['procedimento', '0301010072', 3],
    ]);
    expect(r.itens[1]).toMatchObject({
      valorTotal: 625,
      valorIncremento: 62.5,
      valorTotalComIncremento: 687.5,
    });
    expect(r.itens[2]).toMatchObject({ valorUnitario: 1234.56, valorTotal: 24691.2 });
    expect(r.quantidadeTotal).toBe(170);
    expect(r.valorTotal).toBe(25378.7);
  });

  it('recusa o arquivo inteiro com código fora do tamanho, repetido, quantidade e valor inválidos', () => {
    const r = lerArquivoProgramacao('03;10\n031;5\n03;7\n0401;x\n0402;1;-2\n0403;1;1;5000\nabc;1');
    expect(r.itens).toEqual([]);
    expect(r.problemas.map((p) => [p.linha, p.campo])).toEqual([
      [2, 'codigo'],
      [3, 'codigo'],
      [4, 'quantidade'],
      [5, 'valorUnitario'],
      [6, 'incremento'],
      [7, 'codigo'],
    ]);
  });

  it('arquivo vazio é problema', () => {
    expect(lerArquivoProgramacao('\n# nada\n').problemas[0]?.campo).toBe('conteudo');
  });

  it('número do arquivo', () => {
    expect(numeroDoArquivo('1.234,5')).toBe(1234.5);
    expect(numeroDoArquivo('12.5')).toBe(12.5);
    expect(numeroDoArquivo('')).toBeNull();
    expect(numeroDoArquivo('1a')).toBeNaN();
  });
});

describe('vigência e limites', () => {
  it('vigência por competência', () => {
    expect(conferirVigenciaCompetencia('2026-03-01', null)).toEqual([]);
    expect(conferirVigenciaCompetencia('2026-03-01', '2026-12-31')).toEqual([]);
    expect(conferirVigenciaCompetencia('2026-03-02', '2026-12-30').map((p) => p.campo)).toEqual([
      'vigenciaInicio',
      'vigenciaFim',
    ]);
    expect(conferirVigenciaCompetencia('2026-03-01', '2026-02-28')[0]?.campo).toBe('vigenciaFim');
    expect(vesperaDe('2026-03-01')).toBe('2026-02-28');
    expect(periodoDaCompetenciaSus('202602')).toEqual({ inicio: '2026-02-01', fim: '2026-02-28' });
    expect(periodoDaCompetenciaSus('202613')).toBeNull();
  });

  it('teto e cota', () => {
    const base = {
      tipo: 'teto' as const,
      instrumento: 'todos' as const,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
      quantidade: null,
      valor: 1000,
      percentualAlerta: 80,
      procedimento: null,
      grupo: null,
      financiamento: '06',
    };
    expect(conferirLimiteSus(base)).toEqual([]);
    expect(conferirLimiteSus({ ...base, valor: null }).map((p) => p.campo)).toEqual(['quantidade']);
    expect(conferirLimiteSus({ ...base, tipo: 'cota', quantidade: 5 }).map((p) => p.campo)).toEqual([
      'instrumento',
    ]);
    expect(
      conferirLimiteSus({
        ...base,
        percentualAlerta: 120,
        procedimento: '0401010010',
        grupo: '03',
        financiamento: '6',
      }).map((p) => p.campo),
    ).toEqual(['percentualAlerta', 'grupo', 'financiamento']);
    expect(conferirLimiteSus({ ...base, procedimento: '12' })[0]?.campo).toBe('procedimento');
  });
});

describe('saldo e crítica', () => {
  const registros = [
    reg('r1', { quantidade: 2, valor: 20 }),
    reg('r2', { quantidade: 2, valor: 20 }),
    reg('r3', { quantidade: 1, valor: 10, municipio: 600 }),
    reg('r4', {
      instrumento: 'aih',
      procedimento: '0408010010',
      quantidade: 1,
      valor: 500,
      conta: 9,
      item: null,
    }),
  ];

  it('soma o que o limite alcança e marca o excedente na ordem da produção', () => {
    const [cota, teto, grupo, aih] = apurarSaldosSus(
      [
        limite({ tipo: 'cota', id: 7, instrumento: 'bpa', municipio: 500, quantidade: 3, bloqueia: true }),
        limite({ id: 8, valor: 545, percentualAlerta: 90 }),
        limite({ tipo: 'programacao', id: 9, grupo: '0301', financiamento: '06', quantidade: 100 }),
        limite({ id: 10, instrumento: 'aih', setor: 99, valor: 1 }),
      ],
      registros,
    );
    expect(cota).toMatchObject({
      registros: 2,
      consumoQuantidade: 4,
      saldoQuantidade: -1,
      situacao: 'excedido',
      excedentes: ['r2'],
    });
    expect(teto).toMatchObject({
      consumoValor: 550,
      saldoValor: -5,
      situacao: 'excedido',
      excedentes: ['r4'],
    });
    expect(grupo).toMatchObject({ registros: 3, percentual: 5, situacao: 'livre', excedentes: [] });
    expect(aih).toMatchObject({ registros: 0, situacao: 'livre' });
  });

  it('alerta a partir do percentual e limite zero com consumo é excedido', () => {
    const [a, z] = apurarSaldosSus(
      [limite({ quantidade: 6, percentualAlerta: 80 }), limite({ id: 2, valor: 0 })],
      registros.slice(0, 3),
    );
    expect(a).toMatchObject({ percentual: 83.33, situacao: 'alerta' });
    expect(z).toMatchObject({ situacao: 'excedido', percentual: null });
  });

  it('a crítica sai do excedente com a gravidade do limite e chave estável', () => {
    const saldos = apurarSaldosSus(
      [
        limite({ tipo: 'cota', id: 7, instrumento: 'bpa', municipio: 500, quantidade: 3, bloqueia: true }),
        limite({ id: 8, valor: 545 }),
      ],
      registros,
    );
    const c = criticasDeLimiteSus(saldos, registros);
    expect(c.map((x) => [x.chave, x.regra, x.gravidade, x.conta, x.item])).toEqual([
      ['limite:cota:7:r2', 'producao-acima-da-cota', 'bloqueante', 1, 3],
      ['limite:teto:8:r4', 'producao-acima-do-teto', 'aviso', 9, null],
    ]);
    expect(c[0]?.detalhe).toMatchObject({ limite: 'cota', limiteQuantidade: 3, consumoQuantidade: 4 });
  });
});

describe('remanejamento de cota', () => {
  const origem = {
    setor: 10,
    municipio: 500,
    quantidadeCota: 10,
    valorCota: 100,
    consumoQuantidade: 6,
    consumoValor: 60,
  };
  const pedido = {
    tipo: 'setor' as const,
    destinoSetor: 11,
    destinoMunicipio: null,
    origemCompetencia: null,
    destinoCompetencia: null,
    quantidade: 4,
    valor: 40,
    motivo: 'Setor de destino com fila maior',
  };

  it('aceita até o saldo livre, com pontas e motivo', () => {
    expect(conferirRemanejamentoCota(origem, pedido)).toEqual([]);
    expect(
      conferirRemanejamentoCota(origem, {
        ...pedido,
        quantidade: 5,
        valor: 41,
        destinoSetor: 10,
        motivo: 'curto',
      }).map((p) => p.campo),
    ).toEqual(['quantidade', 'valor', 'destinoSetor', 'motivo']);
    expect(
      conferirRemanejamentoCota(origem, { ...pedido, tipo: 'municipio', destinoMunicipio: 500 }).map(
        (p) => p.campo,
      ),
    ).toEqual(['destinoMunicipio']);
    expect(
      conferirRemanejamentoCota(origem, {
        ...pedido,
        tipo: 'competencia',
        origemCompetencia: 1,
        destinoCompetencia: 1,
      })[0]?.campo,
    ).toBe('destinoCompetencia');
    expect(conferirRemanejamentoCota(origem, { ...pedido, quantidade: null, valor: null })[0]?.campo).toBe(
      'quantidade',
    );
    expect(
      conferirRemanejamentoCota({ ...origem, valorCota: null }, { ...pedido, quantidade: 1 })[0]?.campo,
    ).toBe('valor');
  });

  it('decisão por outra pessoa e só do pedido solicitado', () => {
    expect(conferirDecisaoRemanejamento('solicitada', 1, 2)).toEqual([]);
    expect(conferirDecisaoRemanejamento('solicitada', 1, 1)[0]?.campo).toBe('aprovador');
    expect(conferirDecisaoRemanejamento('aprovada', 1, 2)[0]?.campo).toBe('situacao');
  });

  it('aplica na origem e no destino (novo ou existente)', () => {
    expect(
      aplicarRemanejamentoCota({ quantidadeCota: 10, valorCota: 100 }, null, { quantidade: 4, valor: 40 }),
    ).toEqual({
      origem: { quantidadeCota: 6, valorCota: 60 },
      destino: { quantidadeCota: 4, valorCota: 40 },
    });
    expect(
      aplicarRemanejamentoCota(
        { quantidadeCota: 10, valorCota: null },
        { quantidadeCota: 3, valorCota: null },
        { quantidade: 2, valor: null },
      ),
    ).toEqual({
      origem: { quantidadeCota: 8, valorCota: null },
      destino: { quantidadeCota: 5, valorCota: null },
    });
    expect(
      aplicarRemanejamentoCota(
        { quantidadeCota: 10, valorCota: 100 },
        { quantidadeCota: 3, valorCota: 30 },
        { quantidade: 1, valor: 10 },
      ).destino,
    ).toEqual({ quantidadeCota: 4, valorCota: 40 });
  });
});
