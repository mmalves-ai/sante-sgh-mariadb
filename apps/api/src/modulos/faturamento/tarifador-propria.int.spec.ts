// Contrato de efeito da importação do arquivo do tarifador (F8, 06-FAT linha 23) contra o MariaDB real.
// Massa SINTÉTICA com códigos "F815" (nenhuma pessoa real; números de telefone inventados): o layout gravado com
// autoria (coluna repetida recusada, descrição repetida recusada, alteração pela versão); a importação a partir da
// conta exige o ramal quando o layout o traz e só com o ramal do paciente registra as ligações pendentes (origem integracao, ramal reconhecido, tipo da
// mesma abrangência) e devolve as linhas ruins só com número e motivo; a linha sem ramal conta como de outro ramal e a
// do mesmo ramal antes da entrada (paciente anterior do quarto) é recusada sem registro; reimportar não duplica; o
// layout com a coluna do atendimento acha o atendimento pelo número e recusa a ligação fora do período dele; o lançamento na conta usa o valor do tarifador. No fim, a massa é
// apagada. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ServicoRegrasComerciais } from './regras-comerciais.controller.js';
import { abrirResultadoImportacao, servicosAcessoriosPropria } from './tarifador-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F815';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
async function codigoDo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao) return String(e.problema['codigo'] ?? e.problema.type ?? '');
    throw e;
  }
  throw new Error('esperava recusa');
}

describe.skipIf(SEM_BANCO)('importação do arquivo do tarifador (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let s: ServicoRegrasComerciais;
  const ids: Record<string, number> = {};
  const op = (): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: ids['est'] as number,
    usuario: ids['usuario'] as number,
    correlacao: 'teste-f815',
    chaveIdempotencia: `f815-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f815' }, fn);
  const linhas = (sql: string, p: unknown[]) => escrever((e) => e.consultar<Record<string, unknown>>(sql, p));
  const importar = async (corpo: Record<string, unknown>) =>
    abrirResultadoImportacao(await s.gravarTarifador('importar-ligacoes', op(), corpo));

  const limpar = async (e: Escritor) => {
    const est = ids['est'];
    await e.executar('DELETE FROM ligacao_tarifada WHERE estabelecimento_id = ?', [est]);
    await e.executar(
      `DELETE m FROM conta_hospitalar_item_memoria m JOIN conta_hospitalar_item i ON i.id = m.conta_hospitalar_item_id
         JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id WHERE c.estabelecimento_id = ?`,
      [est],
    );
    await e.executar(
      'DELETE i FROM conta_hospitalar_item i JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id WHERE c.estabelecimento_id = ?',
      [est],
    );
    await e.executar('DELETE FROM conta_hospitalar WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM regra_cobranca_ligacao WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM layout_tarifador WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM ramal_telefonico WHERE estabelecimento_id = ?', [est]);
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await escrever(async (e) => {
      const agora = new Date();
      const cat = (tabela: string, codigo: string, extraCol = '', extraVal: unknown[] = []) =>
        garantir(
          e,
          `SELECT id FROM ${tabela} WHERE codigo = ?`,
          [codigo],
          `INSERT INTO ${tabela} (codigo, descricao${extraCol}, criado_em) VALUES (?, ?${extraVal.map(() => ', ?').join('')}, ?)`,
          [codigo, `${tabela.toUpperCase()} SINTETICO ${codigo}`, ...extraVal, agora],
        );
      ids['est'] = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [`${P}A`],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}A`, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      ids['usuario'] = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['f815.sintetico'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['f815.sintetico', `USUARIO SINTETICO ${P}`, agora],
      );
      await limpar(e);
      ids['fonte'] = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}FP`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
        [`${P}FP`, `OPERADORA SINTETICA ${P}`, agora],
      );
      const pp = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PACIENTE SINTETICO ${P}`],
        "INSERT INTO pessoa_fisica (nome, data_nascimento, criado_em) VALUES (?, '1980-05-10', ?)",
        [`PACIENTE SINTETICO ${P}`, agora],
      );
      ids['paciente'] = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pp, 881_501, agora],
      );
      const pf = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PROFISSIONAL SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PROFISSIONAL SINTETICO ${P}`, agora],
      );
      ids['prof'] = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pf, agora],
      );
      ids['categoria'] = await cat('categoria_atendimento', P, ', tipo_base', ['internacao']);
      ids['carater'] = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['F5'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('F5', ?, 'teste', ?)",
        [`CARATER SINTETICO ${P}`, agora],
      );
      ids['tipoConta'] = await cat('tipo_conta', P, ', natureza', ['internacao']);
      ids['origem'] = await cat('origem_entrada_atendimento', P);
      for (const a of ['local', 'celular_local', 'interurbano'])
        await cat('tipo_ligacao_tarifada', `${P}${a.toUpperCase()}`.slice(0, 30), ', abrangencia, cobravel', [
          a,
          1,
        ]);
      ids['grupo'] = await cat('grupo_faturamento', `${P}G`, ', tipo_grupo', ['taxa']);
      ids['minuto'] = await garantir(
        e,
        'SELECT id FROM item_faturavel WHERE codigo = ?',
        [`${P}MI`],
        "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'servico', ?, ?)",
        [`${P}MI`, `ITEM SINTETICO ${P}MI`, ids['grupo'], agora],
      );
      ids['ramal'] = await e.inserir(
        `INSERT INTO ramal_telefonico (estabelecimento_id, numero_ramal, tipo_local, descricao_local, criado_em)
         VALUES (?, '201', 'outro', 'QUARTO SINTETICO', ?)`,
        [ids['est'], agora],
      );
      ids['atendimento'] = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, origem_entrada_atendimento_id, fonte_pagadora_id, profissional_id, situacao,
           entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aberto', '2026-01-20 08:00:00', ?)`,
        [
          ids['est'],
          `${P}-1`,
          ids['paciente'],
          ids['categoria'],
          ids['carater'],
          ids['origem'],
          ids['fonte'],
          ids['prof'],
          agora,
        ],
      );
      ids['conta'] = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tipo_conta_id, natureza, competencia, inicio_em, valor_itens, valor_total, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'internacao', '2026-01-01', '2026-01-20 08:00:00', 0, 0, ?)`,
        [ids['est'], `${P}-C1`, ids['atendimento'], ids['paciente'], ids['fonte'], ids['tipoConta'], agora],
      );
    });
    s = new ServicoRegrasComerciais(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids['est'] as number] });
    });
    await nucleo.encerrar();
  });

  const LAYOUT = {
    descricao: `CENTRAL ${P}`,
    separador: 'ponto_virgula',
    cabecalho: true,
    formatoData: 'dia_mes_ano',
    formatoDuracao: 'horas_minutos_segundos',
    decimal: ',',
    dddLocal: '54',
    colunaRamal: 1,
    colunaDataHora: 2,
    colunaDuracao: 3,
    colunaNumero: 4,
    colunaValor: 5,
  };

  it('layout: coluna repetida e descrição repetida recusadas; gravado com autoria e alterado pela versão', async () => {
    expect(
      await codigoDo(s.gravarTarifador('salvar-layout-tarifador', op(), { ...LAYOUT, colunaValor: 4 })),
    ).toBe('entrada-invalida');
    const r = await s.gravarTarifador('salvar-layout-tarifador', op(), LAYOUT);
    ids['layout'] = Number(r['id']);
    expect(await codigoDo(s.gravarTarifador('salvar-layout-tarifador', op(), LAYOUT))).toBe('conflito');
    const [l0] = await linhas('SELECT versao FROM layout_tarifador WHERE id = ?', [ids['layout']]);
    await s.gravarTarifador('salvar-layout-tarifador', op(), {
      ...LAYOUT,
      id: ids['layout'],
      versao: Number(l0?.['versao']),
      dddLocal: '54',
    });
    const [l] = await linhas(
      `SELECT estabelecimento_id, separador, tem_cabecalho, coluna_ramal, coluna_valor, coluna_atendimento, ddd_local,
              criado_por, alterado_por, versao, ativo FROM layout_tarifador WHERE id = ?`,
      [ids['layout']],
    );
    expect(l).toMatchObject({
      separador: 'ponto_virgula',
      coluna_ramal: 1,
      coluna_valor: 5,
      ddd_local: '54',
    });
    expect(l?.['coluna_atendimento']).toBeNull();
    expect(Number(l?.['estabelecimento_id'])).toBe(ids['est']);
    expect(Number(l?.['criado_por'])).toBe(ids['usuario']);
    expect(Number(l?.['alterado_por'])).toBe(ids['usuario']);
    expect(Number(l?.['versao'])).toBe(Number(l0?.['versao']) + 1);
    const visao = await s.ler(
      { cliente: CLIENTE, estabelecimento: ids['est'] as number, usuario: null, correlacao: 'teste-f815' },
      (le, est) => servicosAcessoriosPropria(le, est),
    );
    expect(visao.layouts.map((x) => [x.descricao, x.colunaNumero, x.ativo])).toEqual([
      [`CENTRAL ${P}`, 4, true],
    ]);
  });

  it('importação a partir da conta: só o ramal do paciente, linhas ruins com o motivo, reimportação sem duplicar', async () => {
    expect(await codigoDo(importar({ layoutId: ids['layout'], conteudo: 'x\n201;1' }))).toBe(
      'entrada-invalida',
    );
    expect(
      await codigoDo(
        importar({ layoutId: ids['layout'], conteudo: '201;1', contaId: ids['conta'], ramal: null }),
      ),
    ).toBe('entrada-invalida');
    const arquivo = [
      'RAMAL;DATA;DURACAO;NUMERO;VALOR',
      '201;20/01/2026 10:00:00;00:02:05;32221234;0,80',
      '201;20/01/2026 11:00:00;00:00:40;991234567;1,20',
      '202;20/01/2026 11:30:00;00:01:00;32229999;0,40',
      '201;31/02/2026 10:00;00:01:00;32221234;1,00',
      '201;20/01/2026 12:00:00;00:03:00;0215132221234;2,50',
      '201;19/01/2026 22:00:00;00:04:00;32227777;3,10',
      ';20/01/2026 13:00:00;00:01:00;32226666;0,40',
    ].join('\n');
    const corpo = { layoutId: ids['layout'], conteudo: arquivo, contaId: ids['conta'], ramal: '201' };
    const r = await importar(corpo);
    expect(r).toMatchObject({ lidas: 7, registradas: 3, repetidas: 0, outroRamal: 2, recusadas: 2 });
    expect(r.linhasRecusadas).toEqual([
      { linha: 5, motivo: 'data_invalida' },
      { linha: 7, motivo: 'fora_do_atendimento' },
    ]);
    expect(r.porAbrangencia).toEqual({ local: 1, celular_local: 1, interurbano: 1 });
    const ls = await linhas(
      `SELECT l.atendimento_id, l.ramal_telefonico_id, l.tipo_ligacao, l.situacao, l.origem, l.valor, l.duracao_segundos,
              l.iniciada_em, l.ddd, l.criado_por, t.abrangencia
         FROM ligacao_tarifada l JOIN tipo_ligacao_tarifada t ON t.id = l.tipo_ligacao_tarifada_id
        WHERE l.estabelecimento_id = ? ORDER BY l.iniciada_em`,
      [ids['est']],
    );
    expect(
      ls.map((x) => [
        Number(x['atendimento_id']),
        Number(x['ramal_telefonico_id']),
        x['abrangencia'],
        x['tipo_ligacao'],
        x['situacao'],
        x['origem'],
        Number(x['valor']),
        Number(x['duracao_segundos']),
        x['ddd'],
      ]),
    ).toEqual([
      [ids['atendimento'], ids['ramal'], 'local', 'local', 'pendente', 'integracao', 0.8, 125, null],
      [ids['atendimento'], ids['ramal'], 'celular_local', 'celular', 'pendente', 'integracao', 1.2, 40, null],
      [
        ids['atendimento'],
        ids['ramal'],
        'interurbano',
        'interurbana',
        'pendente',
        'integracao',
        2.5,
        180,
        '51',
      ],
    ]);
    expect(ls.every((x) => Number(x['criado_por']) === ids['usuario'])).toBe(true);
    const r2 = await importar(corpo);
    expect(r2).toMatchObject({ registradas: 0, repetidas: 3, outroRamal: 2, recusadas: 2 });
    const [c] = await linhas('SELECT COUNT(*) AS n FROM ligacao_tarifada WHERE estabelecimento_id = ?', [
      ids['est'],
    ]);
    expect(Number(c?.['n'])).toBe(3);
    const [fora] = await linhas(
      `SELECT COUNT(*) AS n FROM ligacao_tarifada WHERE estabelecimento_id = ?
          AND (iniciada_em < '2026-01-20 08:00:00' OR telefone_destino IN ('32227777', '32226666'))`,
      [ids['est']],
    );
    expect(Number(fora?.['n'])).toBe(0);
  });

  it('layout com a coluna do atendimento: acha pelo número; atendimento desconhecido volta como linha recusada', async () => {
    const l = await s.gravarTarifador('salvar-layout-tarifador', op(), {
      descricao: `CENTRAL ${P} B`,
      separador: 'tabulacao',
      cabecalho: false,
      formatoData: 'ano_mes_dia',
      formatoDuracao: 'segundos',
      decimal: '.',
      colunaAtendimento: 1,
      colunaDataHora: 2,
      colunaHora: 3,
      colunaDuracao: 4,
      colunaNumero: 5,
    });
    const r = await importar({
      layoutId: Number(l['id']),
      conteudo: `${P}-1\t2026-01-21\t09:15\t61\t32224321\n${P}-NAO\t2026-01-21\t09:20\t61\t32224321\n${P}-1\t2026-01-19\t09:20\t61\t32224321\n`,
    });
    expect(r).toMatchObject({ lidas: 3, registradas: 1, recusadas: 2 });
    expect(r.linhasRecusadas).toEqual([
      { linha: 2, motivo: 'sem_atendimento' },
      { linha: 3, motivo: 'fora_do_atendimento' },
    ]);
    const [antes] = await linhas(
      `SELECT COUNT(*) AS n FROM ligacao_tarifada WHERE estabelecimento_id = ? AND iniciada_em = '2026-01-19 09:20:00'`,
      [ids['est']],
    );
    expect(Number(antes?.['n'])).toBe(0);
    const [x] = await linhas(
      `SELECT atendimento_id, ramal_telefonico_id, valor FROM ligacao_tarifada
        WHERE estabelecimento_id = ? AND iniciada_em = '2026-01-21 09:15:00'`,
      [ids['est']],
    );
    expect(Number(x?.['atendimento_id'])).toBe(ids['atendimento']);
    expect(x?.['ramal_telefonico_id']).toBeNull();
    expect(x?.['valor']).toBeNull();
  });

  it('lançamento na conta das ligações importadas com o valor do tarifador', async () => {
    const [loc] = await linhas(
      `SELECT l.tipo_ligacao_tarifada_id AS tipo FROM ligacao_tarifada l
        WHERE l.estabelecimento_id = ? AND l.iniciada_em = '2026-01-20 10:00:00'`,
      [ids['est']],
    );
    await s.gravar('salvar-regra-ligacao', op(), {
      tipoLigacaoId: Number(loc?.['tipo']),
      itemMinutoId: ids['minuto'],
      assumeValorTarifador: true,
    });
    const r = await s.gravar('lancar-ligacoes', op(), { contaId: ids['conta'] });
    expect(Number(r['lancadas'])).toBeGreaterThanOrEqual(1);
    const [lig] = await linhas(
      `SELECT l.situacao, i.valor_total, i.item_faturavel_id AS item FROM ligacao_tarifada l
         JOIN conta_hospitalar_item i ON i.id = l.lancamento_conta_hospitalar_item_id
        WHERE l.estabelecimento_id = ? AND l.iniciada_em = '2026-01-20 10:00:00'`,
      [ids['est']],
    );
    expect(lig?.['situacao']).toBe('lancada');
    expect(Number(lig?.['valor_total'])).toBe(0.8);
    expect(Number(lig?.['item'])).toBe(ids['minuto']);
  });
});
