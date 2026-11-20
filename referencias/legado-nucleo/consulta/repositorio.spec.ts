// Consulta somente leitura (M14) sobre o dublê de leitor (nada conecta a banco): SQL da página por chave (keyset)
// e por posição, filtros só por coluna indexada (igual e período), contagem com teto e com tempo esgotado,
// registro pela chave, exportação com teto e a conversão dos valores. Declarações e linhas sintéticas.
import { TETO_CONTAGEM_CONSULTA, TETO_EXPORTACAO_CONSULTA } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { escritorDuble } from '../duble-escritor.spec-util.js';
import { ErroTempoEsgotado } from '../transacao.js';
import {
  colunasDescritas,
  declararConsultaLegado,
  type DeclaracaoConsulta,
  exigeFiltro,
} from './declaracao.js';
import {
  clausulaEscopoConsulta,
  clausulaFiltros,
  contarConsulta,
  ErroConsulta,
  linhasParaExportar,
  paginaDaConsulta,
  registroDaConsulta,
  valorDaConsulta,
} from './repositorio.js';

const publico = {
  modulo: 'auditoria',
  recurso: 'sintetica',
  rotulo: 'Consulta sintética',
  item: null,
  fase: null,
  classe: 'pessoal' as const,
  grande: true,
  marco: 'M14',
};
const comChave: DeclaracaoConsulta = declararConsultaLegado({
  publico,
  grupo: 'auditoria',
  tabela: 'TBSINT',
  chave: ['DATA', 'ID'],
  colunas: [
    { coluna: 'DATA', campo: 'data', rotulo: 'Data', tipo: 'dataHora', filtro: 'periodo' },
    { coluna: 'ID', campo: 'codigo', rotulo: 'Código', tipo: 'inteiro', filtro: 'igual' },
    { coluna: 'NOME', campo: 'nome', rotulo: 'Nome', tipo: 'texto', mascarada: true },
    { coluna: 'VALOR', campo: 'valor', rotulo: 'Valor', tipo: 'decimal' },
  ],
});
const semChave: DeclaracaoConsulta = declararConsultaLegado({
  publico: { ...publico, recurso: 'semChave', grande: false },
  grupo: 'auditoria',
  tabela: 'TBSEM',
  chave: [],
  colunas: [{ coluna: 'NOME', campo: 'nome', rotulo: 'Nome', tipo: 'texto' }],
});

const motivo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroConsulta ? e.codigo : String(e);
  }
};

describe('declaração da consulta', () => {
  it('nomes conferidos; descrição pública sem nomes do banco; exige filtro na tabela grande', () => {
    expect(() => declararConsultaLegado({ ...semChave, tabela: 'tb;x' })).toThrow(/nome de objeto/);
    expect(() =>
      declararConsultaLegado({ ...semChave, colunas: [...semChave.colunas, ...semChave.colunas] }),
    ).toThrow(/repetido/);
    expect(() => declararConsultaLegado({ ...semChave, chave: ['OUTRA'] })).toThrow(/fora das colunas/);
    const c = colunasDescritas(comChave);
    expect(c.map((x) => x.campo)).toEqual(['data', 'codigo', 'nome', 'valor']);
    expect(c.find((x) => x.campo === 'nome')).toMatchObject({ mascarada: true, chave: false });
    expect(c.find((x) => x.campo === 'codigo')).toMatchObject({ filtro: 'igual', chave: true });
    expect(exigeFiltro(comChave)).toBe(true);
    expect(exigeFiltro(semChave)).toBe(false);
  });
});

describe('valores e filtros', () => {
  it('data, data e hora, hora, bigint, buffer e texto com brancos à direita', () => {
    const quando = new Date(Date.UTC(2026, 6, 1, 13, 5));
    expect(valorDaConsulta({ tipo: 'data' }, quando)).toMatch(/^2026-07-01$/);
    expect(valorDaConsulta({ tipo: 'dataHora' }, quando)).toMatch(/^2026-07-01 \d{2}:05:00$/);
    expect(valorDaConsulta({ tipo: 'dataHora' }, new Date(Date.UTC(2026, 6, 1, 13, 5, 37, 42)))).toMatch(
      /^2026-07-01 \d{2}:05:37\.042$/,
    );
    expect(valorDaConsulta({ tipo: 'hora' }, quando)).toMatch(/^\d{2}:05$/);
    expect(valorDaConsulta({ tipo: 'inteiro' }, 5n)).toBe(5);
    expect(valorDaConsulta({ tipo: 'inteiro' }, 2n ** 60n)).toBe(String(2n ** 60n));
    expect(valorDaConsulta({ tipo: 'decimal' }, 1.5)).toBe(1.5);
    expect(valorDaConsulta({ tipo: 'texto' }, Buffer.from('x'))).toBeNull();
    expect(valorDaConsulta({ tipo: 'texto' }, 'ABC   ')).toBe('ABC');
    expect(valorDaConsulta({ tipo: 'texto' }, null)).toBeNull();
  });

  it('coluna catalogada como UTF-8: os bytes que o driver leu como CP1252 voltam a ser o texto', () => {
    // "serviços" gravado em UTF-8 (C3 A7) numa coluna NONE: o driver entrega "serviÃ§os".
    const lidoComoCp1252 = 'Interrompe serviÃ§os essenciais  ';
    expect(valorDaConsulta({ tipo: 'texto', utf8: true }, lidoComoCp1252)).toBe(
      'Interrompe serviços essenciais',
    );
    expect(valorDaConsulta({ tipo: 'texto', utf8: true }, 'Impacto Baixo')).toBe('Impacto Baixo');
    expect(valorDaConsulta({ tipo: 'texto' }, lidoComoCp1252)).toBe('Interrompe serviÃ§os essenciais');
  });

  it('igual e período viram parâmetros; campo sem filtro, inexistente ou data ruim são recusados', () => {
    const f = clausulaFiltros(comChave, [
      { campo: 'codigo', modo: 'igual', igual: 3 },
      { campo: 'data', modo: 'periodo', de: '2026-07-01', ate: '2026-07-31' },
    ]);
    expect(f.sql).toEqual(['ID = ?', 'DATA >= ?', 'DATA < ?']);
    expect(f.parametros[0]).toBe(3);
    expect(f.parametros[1]).toBeInstanceOf(Date);
    expect(() => clausulaFiltros(comChave, [{ campo: 'nome', modo: 'igual', igual: 'x' }])).toThrow(
      ErroConsulta,
    );
    expect(() => clausulaFiltros(comChave, [{ campo: 'naoExiste', modo: 'igual', igual: 1 }])).toThrow(
      /inexistente/,
    );
    expect(() => clausulaFiltros(comChave, [{ campo: 'data', modo: 'periodo', de: '01/07/2026' }])).toThrow(
      /Data inválida/,
    );
  });
});

describe('página', () => {
  const linhas = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      DATA: new Date(Date.UTC(2026, 6, 1 + i, 12)),
      ID: i + 1,
      NOME: `Pessoa ${i + 1}`,
      VALOR: 1.5,
    }));

  it('keyset: FIRST n+1, ORDER BY a chave; a próxima página parte da última chave lida', async () => {
    const l = escritorDuble(() => linhas(3));
    const p = await paginaDaConsulta(l, comChave, [], null, 2);
    expect(p.linhas).toHaveLength(2);
    expect(p.proxima).toEqual([p.linhas[1]!['data'], 2]);
    expect(l.comandos[0]!.sql).toMatch(
      /^SELECT FIRST 3 DATA, ID, NOME, VALOR FROM TBSINT ORDER BY DATA, ID$/,
    );
    const l2 = escritorDuble(() => linhas(1));
    const p2 = await paginaDaConsulta(
      l2,
      comChave,
      [{ campo: 'codigo', modo: 'igual', igual: 1 }],
      p.proxima,
      2,
    );
    expect(p2.proxima).toBeNull();
    expect(l2.comandos[0]!.sql).toContain('WHERE ID = ? AND ((DATA > ?) OR (DATA = ? AND ID > ?))');
    expect(l2.comandos[0]!.parametros[1]).toBeInstanceOf(Date);
    expect(await motivo(paginaDaConsulta(l2, comChave, [], [1], 2))).toBe('pagina-invalida');
    expect(await motivo(paginaDaConsulta(l2, comChave, [], ['ontem', 1], 2))).toBe('pagina-invalida');
    const l3 = escritorDuble(() => linhas(1));
    await paginaDaConsulta(l3, comChave, [], [null, 1], 2);
    expect(l3.comandos[0]!.parametros[0]).toBeNull();
  });

  it('sem chave: por posição (SKIP), até o limite; teto de 100 por página', async () => {
    const l = escritorDuble(() => [{ NOME: 'a' }, { NOME: 'b' }, { NOME: 'c' }]);
    const p = await paginaDaConsulta(l, semChave, [], null, 2);
    expect(p.proxima).toEqual([2]);
    const p2 = await paginaDaConsulta(l, semChave, [], [2], 2);
    expect(p2.proxima).toEqual([4]);
    expect(l.comandos[1]!.sql).toMatch(/SKIP 2 /);
    expect(await motivo(paginaDaConsulta(l, semChave, [], [20_000], 2))).toBe('pagina-invalida');
    await paginaDaConsulta(l, semChave, [], null, 5000);
    expect(l.comandos.at(-1)!.sql).toMatch(/^SELECT FIRST 101 /);
    const vazia = escritorDuble(() => []);
    expect((await paginaDaConsulta(vazia, semChave, [], null)).proxima).toBeNull();
  });
});

describe('contagem, registro e exportação', () => {
  it('contagem com teto; tempo esgotado vira "mais de"; outro erro sobe', async () => {
    expect(
      await contarConsulta(
        escritorDuble(() => [{ N: 7n }]),
        comChave,
        [],
      ),
    ).toEqual({ valor: 7, maisDe: false });
    expect(
      await contarConsulta(
        escritorDuble(() => [{ N: TETO_CONTAGEM_CONSULTA + 1 }]),
        semChave,
        [],
      ),
    ).toEqual({
      valor: TETO_CONTAGEM_CONSULTA,
      maisDe: true,
    });
    expect(
      await contarConsulta(
        escritorDuble(() => []),
        semChave,
        [],
      ),
    ).toEqual({ valor: 0, maisDe: false });
    const lento = escritorDuble(() => {
      throw new ErroTempoEsgotado('tempo');
    });
    expect(await contarConsulta(lento, comChave, [{ campo: 'codigo', modo: 'igual', igual: 1 }])).toEqual({
      valor: TETO_CONTAGEM_CONSULTA,
      maisDe: true,
    });
    const quebrado = escritorDuble(() => {
      throw new Error('outro');
    });
    await expect(contarConsulta(quebrado, comChave, [])).rejects.toThrow('outro');
  });

  it('registro pela chave inteira; código inválido e tabela sem chave recusados', async () => {
    const l = escritorDuble(() => [
      { DATA: new Date(Date.UTC(2026, 6, 1)), ID: 1, NOME: 'Pessoa', VALOR: 2 },
    ]);
    const r = await registroDaConsulta(l, comChave, ['2026-07-01 00:00', '1']);
    expect(r?.['nome']).toBe('Pessoa');
    expect(l.comandos[0]!.sql).toContain('WHERE DATA = ? AND ID = ?');
    expect(
      await registroDaConsulta(
        escritorDuble(() => []),
        comChave,
        ['2026-07-01', '1'],
      ),
    ).toBeNull();
    expect(await motivo(registroDaConsulta(l, comChave, ['2026-07-01', 'x']))).toBe('pagina-invalida');
    expect(await motivo(registroDaConsulta(l, comChave, ['1']))).toBe('pagina-invalida');
    expect(await motivo(registroDaConsulta(l, semChave, []))).toBe('sem-chave');
    const dec: DeclaracaoConsulta = {
      ...semChave,
      chave: ['VALOR'],
      colunas: [
        { coluna: 'VALOR', campo: 'valor', rotulo: 'V', tipo: 'decimal' },
        { coluna: 'NOME', campo: 'nome', rotulo: 'N', tipo: 'texto' },
      ],
    };
    const l2 = escritorDuble(() => []);
    await registroDaConsulta(l2, dec, ['1.5']);
    expect(l2.comandos[0]!.parametros).toEqual([1.5]);
    const txt: DeclaracaoConsulta = { ...semChave, chave: ['NOME'] };
    const l3 = escritorDuble(() => []);
    await registroDaConsulta(l3, txt, ['abc']);
    expect(l3.comandos[0]!.parametros).toEqual(['abc']);
  });

  it('exportação: as linhas do filtro, ordenadas pela chave; acima do teto, recusada', async () => {
    const l = escritorDuble(() => [{ NOME: 'a' }]);
    expect(await linhasParaExportar(l, semChave, [])).toEqual([{ nome: 'a' }]);
    const l2 = escritorDuble(() => []);
    await linhasParaExportar(l2, comChave, [{ campo: 'codigo', modo: 'igual', igual: 1 }]);
    expect(l2.comandos[0]!.sql).toMatch(/WHERE ID = \? ORDER BY DATA, ID$/);
    const muitas = escritorDuble(() =>
      Array.from({ length: TETO_EXPORTACAO_CONSULTA + 1 }, () => ({ NOME: 'x' })),
    );
    expect(await motivo(linhasParaExportar(muitas, semChave, []))).toBe('exportacao-grande');
  });
});

describe('correção do M14: chave de data e hora com segundos e escopo do M06', () => {
  it('a página seguinte e o registro usam a data e hora inteira (segundos e milissegundos)', async () => {
    const quando = new Date(2026, 6, 1, 10, 5, 37, 250);
    const linhas = [0, 1, 2].map((i) => ({ DATA: quando, ID: i + 1, NOME: 'x', VALOR: 1 }));
    const l = escritorDuble(() => linhas);
    const p = await paginaDaConsulta(l, comChave, [], null, 2);
    expect(p.proxima?.[0]).toBe('2026-07-01 10:05:37.250');
    const l2 = escritorDuble(() => []);
    await paginaDaConsulta(l2, comChave, [], p.proxima, 2);
    const param = l2.comandos[0]!.parametros[0] as Date;
    expect(param.getTime()).toBe(quando.getTime());
    const l3 = escritorDuble(() => [linhas[0]!]);
    const r = await registroDaConsulta(l3, comChave, [String(p.linhas[0]!['data']), '1']);
    expect(r).not.toBeNull();
    expect((l3.comandos[0]!.parametros[0] as Date).getTime()).toBe(quando.getTime());
  });
  it('escopo restrito vira IN na coluna declarada; sem coluna, falha fechado; lista vazia não deixa nada sair', async () => {
    const comEscopo = declararConsultaLegado({ ...comChave, escopos: { convenio: 'ID' } });
    expect(clausulaEscopoConsulta(comEscopo, { convenio: ['1', '2'] })).toEqual({
      sql: ['ID IN (?, ?)'],
      parametros: ['1', '2'],
    });
    expect(clausulaEscopoConsulta(comEscopo, { convenio: [] }).sql).toEqual(['1 = 0']);
    expect(clausulaEscopoConsulta(comEscopo, { convenio: null }).sql).toEqual([]);
    expect(() => clausulaEscopoConsulta(comChave, { unidade: ['1'] })).toThrow(/sem coluna/);
    const l = escritorDuble(() => []);
    await paginaDaConsulta(l, comEscopo, [], null, 2, { convenio: ['7'] });
    expect(l.comandos[0]!.sql).toContain('WHERE ID IN (?)');
    await contarConsulta(l, comEscopo, [], { convenio: ['7'] });
    expect(l.comandos[1]!.sql).toContain('ID IN (?)');
    await registroDaConsulta(l, comEscopo, ['2026-07-01 10:00:00', '1'], { convenio: ['7'] });
    expect(l.comandos[2]!.sql).toMatch(/WHERE DATA = \? AND ID = \? AND ID IN \(\?\)$/);
    await linhasParaExportar(l, comEscopo, [], { convenio: ['7'] });
    expect(l.comandos[3]!.sql).toContain('WHERE ID IN (?)');
    expect(() => declararConsultaLegado({ ...comChave, escopos: { convenio: 'x;y' } })).toThrow(/escopo/);
  });
});
