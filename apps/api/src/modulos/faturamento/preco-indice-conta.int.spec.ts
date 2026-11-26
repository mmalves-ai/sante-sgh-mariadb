// Contrato de efeito do preço pelo índice no lançamento da conta (06-FAT linha 5) contra o MariaDB real. Massa
// SINTÉTICA com códigos "C2IC" (nenhum dado real). Prova o que fica em conta_hospitalar_item:
//   - o item da tabela no modelo CH (modelo_valor 'indice') é cobrado pelo índice do acordo × quantidade, mais o
//     porte anestésico do acordo no regime da conta (internação), nunca pela soma da vigência do valor;
//   - o setor do lançamento leva o índice do setor no acordo (valor_indice_setor);
//   - o item no modelo PORTE é cobrado pelo valor do porte do acordo na data;
//   - faltando o valor do porte no acordo, o lançamento recusa com a falta dita (nada fica gravado).
//   - o simulador (06-FAT linha 11) dá o mesmo valor, explicado, e mede o impacto de um reajuste sem gravar nada.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { GravadorIndices } from '../precos/indices-gravacao.js';
import type { ContextoFaturamento } from './porta.js';
import { PortaFaturamentoPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'C2IC';
const COD = { ch: 83_790_001, porte: 83_790_002, semPorte: 83_790_003 } as const;

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('preço pelo índice do acordo no lançamento da conta (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaFaturamentoPropria;
  let gravador: GravadorIndices;
  let c: ContextoFaturamento;
  const ids: Record<string, number> = {};
  const op = (): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: ids['est']!,
    usuario: ids['usuario']!,
    correlacao: 'teste-c2ic',
    chaveIdempotencia: `c2ic-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-c2ic' }, fn);
  const linhas = (sql: string, p: unknown[]) => escrever((e) => e.consultar<Record<string, unknown>>(sql, p));

  const limpar = async (e: Escritor) => {
    if (!ids['est']) return;
    const contas = await e.consultar<{ id: number }>(
      'SELECT id FROM conta_hospitalar WHERE estabelecimento_id = ? AND numero LIKE ?',
      [ids['est'], `${P}%`],
    );
    for (const { id } of contas) {
      await e.executar(
        'DELETE m FROM conta_hospitalar_item_memoria m JOIN conta_hospitalar_item i ON i.id = m.conta_hospitalar_item_id WHERE i.conta_hospitalar_id = ?',
        [id],
      );
      await e.executar('DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?', [id]);
      await e.executar('DELETE FROM conta_hospitalar_etapa WHERE conta_hospitalar_id = ?', [id]);
      await e.executar('DELETE FROM conta_hospitalar WHERE id = ?', [id]);
    }
    await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids['est']]);
    if (ids['fonte']) {
      await e.executar(
        'DELETE s FROM valor_indice_setor s JOIN valor_indice v ON v.id = s.valor_indice_id WHERE v.fonte_pagadora_id = ?',
        [ids['fonte']],
      );
      await e.executar('DELETE FROM valor_indice WHERE fonte_pagadora_id = ?', [ids['fonte']]);
      await e.executar('DELETE FROM valor_porte_medico WHERE fonte_pagadora_id = ?', [ids['fonte']]);
      if (ids['tabela'])
        await e.executar('DELETE FROM valor_porte_anestesico WHERE tabela_preco_id = ?', [ids['tabela']]);
      await e.executar(
        'DELETE ctv FROM contrato_tabela_vigencia ctv JOIN contrato_fonte_pagadora k ON k.id = ctv.contrato_fonte_pagadora_id WHERE k.fonte_pagadora_id = ?',
        [ids['fonte']],
      );
      await e.executar('DELETE FROM contrato_fonte_pagadora WHERE fonte_pagadora_id = ?', [ids['fonte']]);
    }
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await escrever(async (e) => {
      const agora = new Date();
      const g = (tabela: string, codigo: string, ins: string, pi: unknown[]) =>
        garantir(e, `SELECT id FROM ${tabela} WHERE codigo = ?`, [codigo], ins, pi);
      ids['est'] = await g(
        'estabelecimento',
        `${P}A`,
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}A`, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      ids['fonte'] = await g(
        'fonte_pagadora',
        `${P}FP`,
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
        [`${P}FP`, `OPERADORA SINTETICA ${P}`, agora],
      );
      ids['tabela'] = await garantir(
        e,
        'SELECT id FROM tabela_preco WHERE codigo = ?',
        [`${P}T`],
        `INSERT INTO tabela_preco (estabelecimento_id, codigo, descricao, tipo_item, referencia, situacao, fonte_pagadora_id,
           criado_em) VALUES (?, ?, ?, 'honorario', 'propria', 'ativa', ?, ?)`,
        [ids['est'], `${P}T`, `TABELA SINTETICA ${P}`, ids['fonte'], agora],
      );
      await limpar(e);
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      const pp = await pessoa(`PACIENTE SINTETICO ${P}`);
      ids['paciente'] = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pp, 920_207_901, agora],
      );
      const pf = await pessoa(`PROFISSIONAL SINTETICO ${P}`);
      ids['prof'] = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pf, agora],
      );
      ids['categoria'] = await g(
        'categoria_atendimento',
        P,
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, `CATEGORIA SINTETICA ${P}`, agora],
      );
      ids['tipoConta'] = await g(
        'tipo_conta',
        P,
        "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, `TIPO DE CONTA SINTETICO ${P}`, agora],
      );
      ids['usuario'] = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [`${P.toLowerCase()}.fat`],
        'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
        [`${P.toLowerCase()}.fat`, `USUARIO ${P}`, agora],
      );
      ids['grupo'] = await g(
        'grupo_faturamento',
        `${P}G`,
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'honorario', ?)",
        [`${P}G`, `GRUPO ${P}`, agora],
      );
      ids['indiceCh'] = await g(
        'indice_cobranca',
        `${P}-CH`,
        "INSERT INTO indice_cobranca (codigo, descricao, tipo_indice, ativo, criado_em) VALUES (?, 'CH C2IC', 'coeficiente_honorario', TRUE, ?)",
        [`${P}-CH`, agora],
      );
      const porte = (codigo: string, ordem: number) =>
        g(
          'porte_procedimento',
          codigo,
          "INSERT INTO porte_procedimento (codigo, descricao, tipo_porte, ordem, criado_em) VALUES (?, ?, 'honorario', ?, ?)",
          [codigo, `PORTE ${codigo}`, ordem, agora],
        );
      ids['portePt'] = await porte(`${P}4A`, 9);
      ids['porteSemValor'] = await porte(`${P}5A`, 9);
      ids['setor'] = await garantir(
        e,
        'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
        [ids['est'], `${P}-CC`],
        "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, 'CENTRO CIRURGICO C2IC', 'assistencial', ?)",
        [ids['est'], `${P}-CC`, agora],
      );
      // Os itens: CH com porte anestésico 1, PORTE com valor no acordo e PORTE sem valor no acordo.
      const itens: [string, number, string, number | null, number | null][] = [
        ['ch', COD.ch, 'indice', 100, null],
        ['porte', COD.porte, 'porte', null, ids['portePt']!],
        ['semPorte', COD.semPorte, 'porte', null, ids['porteSemValor']!],
      ];
      let seq = 0;
      for (const [k, cod, modelo, qtdIndice, porteId] of itens) {
        seq += 1;
        ids[k] = await g(
          'item_faturavel',
          String(cod),
          `INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, porte_anestesico, criado_em)
           VALUES (?, ?, 'procedimento', ?, ?, ?)`,
          [String(cod), `PROCEDIMENTO SINTETICO ${P} ${k}`, ids['grupo'], k === 'ch' ? 1 : null, agora],
        );
        const ppId = await garantir(
          e,
          'SELECT id FROM preco_procedimento WHERE tabela_preco_id = ? AND item_faturavel_id = ?',
          [ids['tabela'], ids[k]],
          `INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, modelo_valor, quantidade_indice,
             porte_procedimento_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [ids['tabela'], seq, ids[k], modelo, qtdIndice, porteId, agora],
        );
        // A vigência do valor (109,25): nunca pode ser o preço do item CH ou PORTE.
        await garantir(
          e,
          'SELECT id FROM preco_procedimento_valor WHERE preco_procedimento_id = ?',
          [ppId],
          `INSERT INTO preco_procedimento_valor (preco_procedimento_id, operacao, ocorrido_em, vigencia_inicio,
             valor_honorario, valor_custo_operacional, valor_filme, valor_total, criado_em)
           VALUES (?, 'inclusao', ?, '2020-01-01', 100, 7.5, 1.75, 109.25, ?)`,
          [ppId, agora, agora],
        );
      }
      ids['contrato'] = await e.inserir(
        `INSERT INTO contrato_fonte_pagadora (estabelecimento_id, fonte_pagadora_id, numero, descricao, vigencia_inicio,
           situacao, prazo_apresentacao_dias, criado_em) VALUES (?, ?, ?, 'ACORDO C2IC', '2025-01-01', 'vigente', 60, ?)`,
        [ids['est'], ids['fonte'], `${P}-1`, agora],
      );
      await e.inserir(
        `INSERT INTO contrato_tabela_vigencia (contrato_fonte_pagadora_id, tipo_item, tabela_preco_id, vigencia_inicio, criado_em)
         VALUES (?, 'honorario_internacao', ?, '2025-01-01', ?)`,
        [ids['contrato'], ids['tabela'], agora],
      );
      // O regime de internação do padrão (código oficial 03) no atendimento: o porte anestésico da tabela de internação.
      ids['regime'] = await garantir(
        e,
        'SELECT id FROM regime_atendimento WHERE codigo_tiss = ?',
        ['03'],
        "INSERT INTO regime_atendimento (codigo_tiss, descricao, versao_fonte, abrangencia, criado_em) VALUES ('03', 'REGIME SINTETICO 03', 'teste', 'internacao', ?)",
        [agora],
      );
      const eletivo = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['FAE'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, urgencia, criado_em) VALUES (?, ?, 'teste', FALSE, ?)",
        ['FAE', 'CARATER SINTETICO FAE', agora],
      );
      const at = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, regime_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aberto', '2026-01-20 11:00:00', ?)`,
        [
          ids['est'],
          `${P}-AT`,
          ids['paciente'],
          ids['categoria'],
          ids['regime'],
          eletivo,
          ids['fonte'],
          ids['prof'],
          agora,
        ],
      );
      ids['conta'] = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tipo_conta_id, tabela_preco_id, natureza, competencia, inicio_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'internacao', '2026-01-01', '2026-01-20 11:00:00', ?)`,
        [ids['est'], `${P}-C`, at, ids['paciente'], ids['fonte'], ids['tipoConta'], ids['tabela'], agora],
      );
    });
    porta = new PortaFaturamentoPropria(nucleo, CLIENTE);
    gravador = new GravadorIndices(nucleo);
    c = {
      cliente: CLIENTE,
      estabelecimento: ids['est']!,
      usuario: ids['usuario']!,
      correlacao: 'teste-c2ic',
      rede: 'rede-teste',
      hospital: `${P}A`,
    };
    // Os valores do acordo pela gravação real (CH 0,5; porte 4A 210; porte anestésico 1 da tabela 150).
    const vCh = await gravador.gravar('indice', op(), {
      fonteId: ids['fonte'],
      indiceId: ids['indiceCh'],
      vigenciaInicio: '2025-01-01',
      valor: 0.5,
    });
    await gravador.gravar('porte', op(), {
      fonteId: ids['fonte'],
      porte: `${P}4A`,
      vigenciaInicio: '2025-01-01',
      valor: 210,
    });
    await gravador.gravar('porte-anestesico', op(), {
      fonteId: ids['fonte'],
      tabelaId: ids['tabela'],
      porte: '1',
      vigenciaInicio: '2025-01-01',
      valor: 150,
      valorHorarioEspecial: 195,
    });
    // O CH do centro cirúrgico no acordo: 0,7.
    await escrever((e) =>
      e.inserir(
        `INSERT INTO valor_indice_setor (valor_indice_id, setor_funcional_id, valor_honorario, ativo, criado_em)
         VALUES (?, ?, 0.7, TRUE, ?)`,
        [vCh.id, ids['setor'], new Date()],
      ),
    );
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids['est']] });
    });
    await nucleo.encerrar();
  });

  const lancar = (codigo: number, quantidade = 1, local = 0) =>
    porta.executar(
      c,
      'faturamento.lancarItem',
      { conta: ids['conta'], tipo: 3, codigo, quantidade, data: '2026-01-20', hora: '10:00', local, ato: 0 },
      op(),
    );
  const doItem = async (id: number) => {
    const [x] = await linhas(
      'SELECT valor_unitario, valor_honorario, valor_custo_operacional, valor_filme, valor_total FROM conta_hospitalar_item WHERE id = ?',
      [id],
    );
    return {
      unitario: Number(x!['valor_unitario']),
      honorario: Number(x!['valor_honorario']),
      custo: Number(x!['valor_custo_operacional']),
      filme: Number(x!['valor_filme']),
      total: Number(x!['valor_total']),
    };
  };

  it('modelo CH: valor_total = (CH do acordo × CH do item + porte anestésico da internação) × quantidade', async () => {
    const r = await lancar(COD.ch, 2);
    const i = await doItem(Number(r.resultado['id']));
    // (0,5 × 100 + 150) × 2 = 400, nunca 109,25 × 2 da vigência.
    expect(i).toEqual({ unitario: 200, honorario: 400, custo: 0, filme: 0, total: 400 });
  });

  it('setor do lançamento: o CH do setor no acordo vale para o item', async () => {
    const r = await lancar(COD.ch, 1, ids['setor']);
    expect((await doItem(Number(r.resultado['id']))).total).toBe(0.7 * 100 + 150);
  });

  it('modelo PORTE: valor_total = valor do porte do acordo × quantidade', async () => {
    const r = await lancar(COD.porte, 3);
    expect((await doItem(Number(r.resultado['id']))).total).toBe(630);
  });

  it('porte sem valor no acordo: recusa com a falta dita e nada fica gravado', async () => {
    const antes = await linhas(
      'SELECT COUNT(*) AS n FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?',
      [ids['conta']],
    );
    await expect(lancar(COD.semPorte)).rejects.toMatchObject({
      problema: { codigo: 'item-sem-indice' },
    });
    const depois = await linhas(
      'SELECT COUNT(*) AS n FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?',
      [ids['conta']],
    );
    expect(Number(depois[0]!['n'])).toBe(Number(antes[0]!['n']));
  });

  // Simulador (06-FAT linha 11): o mesmo motor do lançamento, explicado, e o impacto do reajuste; nada é gravado.
  const simular = (codigo: number, quantidade: number, extra: Record<string, unknown> = {}) =>
    porta.simular(c, {
      convenio: ids['fonte']!,
      tipoConta: 'I',
      tipo: 3,
      codigo,
      quantidade,
      data: '2026-01-20',
      ...extra,
    });
  const contagem = async () => {
    const [x] = await linhas(
      `SELECT (SELECT COUNT(*) FROM valor_indice WHERE fonte_pagadora_id = ?) AS ind,
              (SELECT COUNT(*) FROM valor_porte_medico WHERE fonte_pagadora_id = ?) AS por,
              (SELECT COUNT(*) FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?) AS itens`,
      [ids['fonte'], ids['fonte'], ids['conta']],
    );
    return [Number(x!['ind']), Number(x!['por']), Number(x!['itens'])];
  };

  it('simulador, modelo CH: valor = (CH do acordo × CH do item + porte anestésico da internação) × quantidade, explicado', async () => {
    const r = await simular(COD.ch, 2);
    expect(r.origem).toBe('indice');
    expect(r.preco?.unitario).toBe(200);
    expect(r.preco?.valor).toBe(400);
    expect(r.passos?.join(' ')).toContain('Porte anestésico 1');
    expect(r.passos?.at(-1)).toBe('Valor = 200 × 2 = 400.');
    expect((await simular(COD.ch, 1, { setor: ids['setor'] })).preco?.unitario).toBe(0.7 * 100 + 150);
    expect((await simular(COD.ch, 1, { horarioEspecial: true })).preco?.unitario).toBe(50 + 195);
  });

  it('simulador: impacto do reajuste do índice e do porte, só no que o item usa, sem gravar nada', async () => {
    const antes = await contagem();
    const ch = await simular(COD.ch, 2, { reajuste: { indice: 10, tabela: 50 } });
    expect(ch.impacto).toMatchObject({
      atual: 400,
      novo: 410,
      diferenca: 10,
      percentual: 2.5,
      afetadoPor: ['indice'],
    });
    const porte = await simular(COD.porte, 3, { reajuste: { porte: -5 } });
    expect(porte.preco?.valor).toBe(630);
    expect(porte.impacto).toMatchObject({ atual: 630, novo: 598.5, diferenca: -31.5, afetadoPor: ['porte'] });
    const nada = await simular(COD.porte, 1, { reajuste: { tabela: 10 } });
    expect(nada.impacto).toMatchObject({ diferenca: 0, afetadoPor: [] });
    expect(await contagem()).toEqual(antes);
  });

  it('simulador: os setores oferecidos são só os do estabelecimento da sessão', async () => {
    const setores = await porta.setoresDoSimulador(c);
    expect(setores.map((x) => x.id)).toContain(ids['setor']);
    const [x] = await linhas(
      'SELECT COUNT(*) AS n FROM setor_funcional WHERE estabelecimento_id = ? AND excluido_em IS NULL',
      [ids['est']],
    );
    expect(setores).toHaveLength(Number(x!['n']));
  });

  it('simulador: porte sem valor no acordo diz a falta (o lançamento recusaria)', async () => {
    const r = await simular(COD.semPorte, 1);
    expect(r.preco).toBeNull();
    expect(r.origem).toBe('indice');
    expect(r.falta).toContain('registre o valor');
  });
});
