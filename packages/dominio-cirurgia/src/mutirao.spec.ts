// Regras dos projetos e mutirões cirúrgicos do SUS (F8, 04-CC linha 108). Massa sintética.
import { describe, expect, it } from 'vitest';
import {
  producaoDoDocumento,
  acompanharMetas,
  conferirJustificativa,
  conferirMudancaSituacao,
  conferirVinculo,
  documentoSemProducao,
  projetoEditavel,
  validarMeta,
  validarProjetoMutirao,
} from './mutirao.js';

const PROJETO = {
  codigo: 'FILAS-2030',
  descricao: 'Mutirão de catarata',
  portaria: 'Portaria fictícia 1/2030',
  periodoInicio: '2030-01-01',
  periodoFim: '2030-12-31',
  valorFinanciamento: 1000,
};
const JUST = { ativo: true, aplicaInclusao: true, aplicaAlteracao: true, exigeComplemento: false };
const EM_ANDAMENTO = {
  id: 1,
  situacao: 'em_andamento' as const,
  periodoInicio: '2030-01-01',
  periodoFim: '2030-06-30',
  sigtapsDasMetas: [10, 20],
};
const AIH = {
  tipo: 'aih' as const,
  situacao: 'fechada',
  data: '2030-03-01',
  sigtaps: [10],
  projetoAtual: null,
};

describe('validarProjetoMutirao', () => {
  it('aceita o projeto completo', () => expect(validarProjetoMutirao(PROJETO)).toEqual([]));
  it('exige a portaria e recusa a vigência invertida e o valor negativo', () => {
    const p = validarProjetoMutirao({
      ...PROJETO,
      portaria: ' ',
      periodoFim: '2029-12-31',
      valorFinanciamento: -1,
    });
    expect(p.map((x) => x.campo)).toEqual(['portaria', 'periodoFim', 'valorFinanciamento']);
  });
  it('recusa código vazio ou com espaço', () =>
    expect(validarProjetoMutirao({ ...PROJETO, codigo: 'A B' })[0]?.campo).toBe('codigo'));
});

describe('situação do projeto', () => {
  it('segue planejado → em andamento → encerrado, sem volta', () => {
    expect(conferirMudancaSituacao('planejado', 'em_andamento', null)).toEqual([]);
    expect(conferirMudancaSituacao('em_andamento', 'encerrado', null)).toEqual([]);
    expect(conferirMudancaSituacao('encerrado', 'em_andamento', null)[0]?.campo).toBe('situacao');
    expect(conferirMudancaSituacao('planejado', 'encerrado', null)[0]?.campo).toBe('situacao');
  });
  it('cancelar exige o motivo', () => {
    expect(conferirMudancaSituacao('planejado', 'cancelado', '')[0]?.campo).toBe('motivo');
    expect(conferirMudancaSituacao('planejado', 'cancelado', 'Sem verba')).toEqual([]);
  });
  it('só planejado e em andamento são editáveis', () => {
    expect(projetoEditavel('planejado') && projetoEditavel('em_andamento')).toBe(true);
    expect(projetoEditavel('encerrado') || projetoEditavel('cancelado')).toBe(false);
  });
});

describe('validarMeta', () => {
  it('exige o SIGTAP do procedimento e não repete no projeto', () => {
    expect(validarMeta({ sigtap: null, quantidadePrevista: 5, valorUnitario: null }, [])[0]?.campo).toBe(
      'procedimento',
    );
    expect(
      validarMeta({ sigtap: 10, quantidadePrevista: 5, valorUnitario: null }, [10])[0]?.mensagem,
    ).toMatch(/já tem meta/);
    expect(validarMeta({ sigtap: 10, quantidadePrevista: 5, valorUnitario: 300 }, [20])).toEqual([]);
  });
  it('recusa quantidade não inteira ou zero e valor negativo', () => {
    const p = validarMeta({ sigtap: 10, quantidadePrevista: 1.5, valorUnitario: -2 }, []);
    expect(p.map((x) => x.campo)).toEqual(['quantidadePrevista', 'valorUnitario']);
  });
});

describe('conferirVinculo (AIH ou APAC marcada com o projeto)', () => {
  it('aceita a AIH na vigência com procedimento da meta', () =>
    expect(conferirVinculo(EM_ANDAMENTO, AIH, JUST, null)).toEqual([]));
  it('recusa projeto planejado, data fora da vigência e procedimento fora das metas', () => {
    const p = conferirVinculo(
      { ...EM_ANDAMENTO, situacao: 'planejado' },
      { ...AIH, data: '2030-07-01', sigtaps: [99] },
      JUST,
      null,
    );
    expect(p.map((x) => x.campo)).toEqual(['projeto', 'documento', 'documento']);
  });
  it('recusa a AIH cancelada e a APAC já marcada em outro projeto', () => {
    expect(conferirVinculo(EM_ANDAMENTO, { ...AIH, situacao: 'cancelada' }, JUST, null)[0]?.mensagem).toMatch(
      /não conta como produção/,
    );
    expect(
      conferirVinculo(EM_ANDAMENTO, { ...AIH, tipo: 'apac', projetoAtual: 7 }, JUST, null)[0]?.mensagem,
    ).toMatch(/APAC já está marcada em outro projeto/);
  });
  it('a justificativa precisa ser ativa, de inclusão e com o complemento quando exige', () => {
    expect(conferirVinculo(EM_ANDAMENTO, AIH, null, null)[0]?.campo).toBe('justificativa');
    expect(conferirVinculo(EM_ANDAMENTO, AIH, { ...JUST, aplicaInclusao: false }, null)[0]?.campo).toBe(
      'justificativa',
    );
    expect(conferirVinculo(EM_ANDAMENTO, AIH, { ...JUST, exigeComplemento: true }, ' ')[0]?.campo).toBe(
      'complemento',
    );
  });
  it('a retirada usa a justificativa de alteração', () => {
    expect(
      conferirJustificativa({ ...JUST, aplicaAlteracao: false }, null, 'alteracao')[0]?.mensagem,
    ).toMatch(/retirar/);
    expect(conferirJustificativa(JUST, null, 'alteracao')).toEqual([]);
  });
  it('situações sem produção por tipo', () => {
    expect(documentoSemProducao('aih', 'negada')).toBe(true);
    expect(documentoSemProducao('apac', 'aprovada')).toBe(false);
  });
});

describe('acompanharMetas (meta contra produção)', () => {
  const metas = [
    { sigtap: 10, quantidadePrevista: 100, valorUnitario: 500 },
    { sigtap: 20, quantidadePrevista: 10, valorUnitario: null },
  ];
  it('soma a produção por SIGTAP, mede saldo, percentual, ritmo e valor', () => {
    const r = acompanharMetas(
      metas,
      [
        { sigtap: 10, quantidade: 30 },
        { sigtap: 10, quantidade: 10 },
        { sigtap: 20, quantidade: 12 },
        { sigtap: 99, quantidade: 5 },
      ],
      { inicio: '2030-01-01', fim: '2030-01-10' },
      '2030-01-05',
    );
    expect(r.decorrido).toBe(0.5);
    expect(r.metas[0]).toMatchObject({
      realizada: 40,
      saldo: 60,
      percentual: 40,
      esperadoAteHoje: 50,
      ritmo: 'abaixo_do_ritmo',
      valorPrevisto: 50000,
      valorRealizado: 20000,
    });
    expect(r.metas[1]).toMatchObject({ realizada: 12, saldo: 0, ritmo: 'atingida', valorPrevisto: null });
    // O excedente de uma meta não cobre o saldo de outra: 40 + 10 de 110.
    expect(r).toMatchObject({ prevista: 110, realizada: 50, percentual: 45.5, valorRealizado: 20000 });
  });
  it('sem fim de vigência não há ritmo esperado; antes do início o decorrido é zero', () => {
    expect(
      acompanharMetas(metas, [], { inicio: '2030-01-01', fim: null }, '2030-01-05').metas[0]?.ritmo,
    ).toBe('sem_vigencia');
    const r = acompanharMetas(metas, [], { inicio: '2030-01-01', fim: '2030-01-10' }, '2029-12-01');
    expect(r.decorrido).toBe(0);
    expect(r.metas[0]?.ritmo).toBe('no_ritmo');
  });
});

describe('producaoDoDocumento (mesma fonte para vínculo e produção)', () => {
  it('usa as linhas lançadas e ignora o cabeçalho quando há linha', () =>
    expect(
      producaoDoDocumento(
        [
          { sigtap: 10, quantidade: 2 },
          { sigtap: 11, quantidade: 1 },
        ],
        { realizado: 99, solicitado: 98 },
      ),
    ).toEqual([
      { sigtap: 10, quantidade: 2 },
      { sigtap: 11, quantidade: 1 },
    ]));
  it('sem linha, conta o realizado do cabeçalho com quantidade 1', () =>
    expect(producaoDoDocumento([], { realizado: 99, solicitado: 98 })).toEqual([
      { sigtap: 99, quantidade: 1 },
    ]));
  it('sem linha nem realizado, conta o solicitado; sem nenhum, nada', () => {
    expect(producaoDoDocumento([], { realizado: null, solicitado: 98 })).toEqual([
      { sigtap: 98, quantidade: 1 },
    ]);
    expect(producaoDoDocumento([], { realizado: null, solicitado: null })).toEqual([]);
  });
  it('linha com quantidade zero não conta e cai no cabeçalho', () =>
    expect(producaoDoDocumento([{ sigtap: 10, quantidade: 0 }], { realizado: 99, solicitado: null })).toEqual(
      [{ sigtap: 99, quantidade: 1 }],
    ));
});
