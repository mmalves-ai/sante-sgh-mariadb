// Contrato de efeito da simulação de cenários de receita (F8, 01-ADM L120) contra o MariaDB real. Massa SINTÉTICA com
// códigos "C278" (nenhuma pessoa real). Prova o que fica no banco:
//   - criar o cenário grava cenario_simulacao_receita (rascunho, dono), as premissas (reajuste e recorte por tipo de
//     atendimento em cenario_simulacao_parametro), a troca por convênio (regra_conversao_tabela_preco) e o de-para de
//     procedimentos com fatores (regra_conversao_procedimento), com os códigos resolvidos no catálogo;
//   - executar recalcula a produção do período pelo motor de preços (tabela nova + reajuste + conversão com fator) e
//     grava a execução com os totais, o resultado por convênio, procedimento e tipo de atendimento e a inconsistência do
//     item sem preço de destino; conta cancelada, item estornado e outra competência ficam fora; o cenário fica
//     concluído com a receita base e a simulada;
//   - NADA muda nas contas (itens e contas com o mesmo valor e a mesma versão);
//   - o convênio simulado é precificado pela tabela dele, com o recorte por tipo de atendimento;
//   - nova execução é outra fotografia (a anterior fica); recusas sem gravar (código fora do catálogo, nome repetido,
//     plano de outro convênio).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ServicoSimulacaoReceita } from './simulacao-receita.controller.js';
import {
  detalheSimulacaoReceitaPropria,
  painelSimulacaoReceitaPropria,
} from './simulacao-receita-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'C278';
const COD = { x: '82780001', y: '82780002', z: '82780003', w: '82780004' } as const;

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('simulação de cenários de receita sobre a produção real (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let s: ServicoSimulacaoReceita;
  const ids: Record<string, number> = {};
  const op = (): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: ids['est']!,
    usuario: ids['usuario']!,
    correlacao: 'teste-c278',
    chaveIdempotencia: `c278-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const ctxL = () => ({
    cliente: CLIENTE,
    estabelecimento: ids['est']!,
    usuario: null,
    correlacao: 'teste-c278',
  });
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-c278' }, fn);
  const linhas = (sql: string, p: unknown[]) => escrever((e) => e.consultar<Record<string, unknown>>(sql, p));

  const limpar = async (e: Escritor) => {
    if (!ids['est']) return;
    const est = ids['est'];
    const sim = 'SELECT id FROM simulacao_receita WHERE estabelecimento_id = ?';
    await e.executar(`DELETE FROM simulacao_receita_inconsistencia WHERE simulacao_receita_id IN (${sim})`, [
      est,
    ]);
    await e.executar(`DELETE FROM simulacao_receita_resultado WHERE simulacao_receita_id IN (${sim})`, [est]);
    await e.executar('DELETE FROM simulacao_receita WHERE estabelecimento_id = ?', [est]);
    const cen = 'SELECT id FROM cenario_simulacao_receita WHERE estabelecimento_id = ?';
    await e.executar(
      `DELETE p FROM regra_conversao_procedimento p JOIN regra_conversao_tabela_preco r ON r.id = p.regra_conversao_tabela_preco_id
        WHERE r.cenario_simulacao_receita_id IN (${cen})`,
      [est],
    );
    await e.executar(
      `DELETE FROM regra_conversao_tabela_preco WHERE cenario_simulacao_receita_id IN (${cen})`,
      [est],
    );
    await e.executar(
      `DELETE FROM cenario_simulacao_parametro WHERE cenario_simulacao_receita_id IN (${cen})`,
      [est],
    );
    await e.executar('DELETE FROM cenario_simulacao_receita WHERE estabelecimento_id = ?', [est]);
    await e.executar(
      'DELETE i FROM conta_hospitalar_item i JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id WHERE c.estabelecimento_id = ?',
      [est],
    );
    await e.executar('DELETE FROM conta_hospitalar WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [est]);
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
      await limpar(e);
      const fonte = (k: string) =>
        g(
          'fonte_pagadora',
          `${P}${k}`,
          "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
          [`${P}${k}`, `OPERADORA SINTETICA ${P} ${k}`, agora],
        );
      ids['fonteA'] = await fonte('FA');
      ids['fonteB'] = await fonte('FB');
      ids['planoB'] = await garantir(
        e,
        'SELECT id FROM plano_fonte_pagadora WHERE fonte_pagadora_id = ? AND codigo = ?',
        [ids['fonteB'], `${P}PB`],
        'INSERT INTO plano_fonte_pagadora (fonte_pagadora_id, codigo, descricao, criado_em) VALUES (?, ?, ?, ?)',
        [ids['fonteB'], `${P}PB`, `PLANO SINTETICO ${P}`, agora],
      );
      const tabela = (k: string, f: number) =>
        garantir(
          e,
          'SELECT id FROM tabela_preco WHERE codigo = ?',
          [`${P}${k}`],
          `INSERT INTO tabela_preco (estabelecimento_id, codigo, descricao, tipo_item, referencia, situacao, fonte_pagadora_id,
             criado_em) VALUES (?, ?, ?, 'honorario', 'propria', 'ativa', ?, ?)`,
          [ids['est'], `${P}${k}`, `TABELA SINTETICA ${P} ${k}`, f, agora],
        );
      ids['tabA'] = await tabela('TA', ids['fonteA']!);
      ids['tabN'] = await tabela('TN', ids['fonteA']!);
      ids['tabB'] = await tabela('TB', ids['fonteB']!);
      ids['grupo'] = await g(
        'grupo_faturamento',
        `${P}G`,
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'honorario', ?)",
        [`${P}G`, `GRUPO ${P}`, agora],
      );
      for (const [k, cod] of Object.entries(COD))
        ids[k] = await g(
          'item_faturavel',
          cod,
          `INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em)
           VALUES (?, ?, 'procedimento', ?, ?)`,
          [cod, `PROCEDIMENTO SINTETICO ${P} ${k}`, ids['grupo'], agora],
        );
      // Preços: TA (em uso) X 100, Y 50, W 40; TN (nova) X 150, Z 30 (Y e W sem preço); TB (outro convênio) X 120.
      const precos: [string, string, number][] = [
        ['tabA', 'x', 100],
        ['tabA', 'y', 50],
        ['tabA', 'w', 40],
        ['tabN', 'x', 150],
        ['tabN', 'z', 30],
        ['tabB', 'x', 120],
      ];
      for (const [t, k, valor] of precos) {
        const seq = Number(COD[k as keyof typeof COD].slice(-1));
        const pp = await garantir(
          e,
          'SELECT id FROM preco_procedimento WHERE tabela_preco_id = ? AND item_faturavel_id = ?',
          [ids[t], ids[k]],
          `INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, modelo_valor, criado_em)
           VALUES (?, ?, ?, 'valor', ?)`,
          [ids[t], seq, ids[k], agora],
        );
        await garantir(
          e,
          'SELECT id FROM preco_procedimento_valor WHERE preco_procedimento_id = ?',
          [pp],
          `INSERT INTO preco_procedimento_valor (preco_procedimento_id, operacao, ocorrido_em, vigencia_inicio,
             valor_honorario, valor_custo_operacional, valor_filme, valor_total, criado_em)
           VALUES (?, 'inclusao', ?, '2020-01-01', ?, 0, 0, ?, ?)`,
          [pp, agora, valor, valor, agora],
        );
      }
      const pf = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PACIENTE SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PACIENTE SINTETICO ${P}`, agora],
      );
      ids['paciente'] = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pf],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pf, 920_278_901, agora],
      );
      const pp = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PROFISSIONAL SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PROFISSIONAL SINTETICO ${P}`, agora],
      );
      ids['prof'] = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pp],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pp, agora],
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
      const carater = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['FAE'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, urgencia, criado_em) VALUES (?, ?, 'teste', FALSE, ?)",
        ['FAE', 'CARATER SINTETICO FAE', agora],
      );
      ids['motivoCancel'] = await g(
        'motivo_cancelamento_conta',
        P,
        'INSERT INTO motivo_cancelamento_conta (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [P, `MOTIVO SINTETICO ${P}`, agora],
      );
      let nAt = 0;
      const conta = async (natureza: string, competencia: string, situacao = 'aberta') => {
        nAt += 1;
        const at = await e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', ?, ?)`,
          [
            ids['est'],
            `${P}-AT${nAt}`,
            ids['paciente'],
            ids['categoria'],
            carater,
            ids['fonteA'],
            ids['prof'],
            `${competencia.slice(0, 8)}10 08:00:00`,
            agora,
          ],
        );
        return e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
             tipo_conta_id, tabela_preco_id, natureza, competencia, inicio_em, situacao, cancelada_em,
             motivo_cancelamento_conta_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ids['est'],
            `${P}-C${nAt}`,
            at,
            ids['paciente'],
            ids['fonteA'],
            ids['tipoConta'],
            ids['tabA'],
            natureza,
            competencia,
            `${competencia.slice(0, 8)}10 08:00:00`,
            situacao,
            situacao === 'cancelada' ? agora : null,
            situacao === 'cancelada' ? ids['motivoCancel'] : null,
            agora,
          ],
        );
      };
      const item = (
        c: number,
        seq: number,
        k: string,
        q: number,
        total: number,
        dia: string,
        situacao = 'lancado',
      ) =>
        e.inserir(
          `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade,
             valor_unitario, valor_total, situacao, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [c, seq, ids[k], `${dia} 10:00:00`, q, total / q, total, situacao, agora],
        );
      const c1 = await conta('internacao', '2026-01-01');
      await item(c1, 1, 'x', 2, 200, '2026-01-10');
      await item(c1, 2, 'y', 1, 50, '2026-01-11');
      await item(c1, 3, 'w', 1, 40, '2026-01-12');
      await item(c1, 4, 'x', 3, 300, '2026-01-12', 'estornado');
      const c2 = await conta('ambulatorial', '2026-01-01');
      await item(c2, 1, 'x', 1, 100, '2026-01-15');
      const c3 = await conta('internacao', '2026-01-01', 'cancelada');
      await item(c3, 1, 'x', 5, 500, '2026-01-16');
      const c4 = await conta('internacao', '2026-02-01');
      await item(c4, 1, 'x', 7, 700, '2026-02-03');
    });
    s = new ServicoSimulacaoReceita(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids['est']] });
    });
    await nucleo.encerrar();
  });

  const fotoDasContas = () =>
    linhas(
      `SELECT i.id, i.valor_total, i.valor_unitario, i.situacao, i.versao, c.valor_total AS conta_total, c.versao AS conta_versao
         FROM conta_hospitalar_item i JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id
        WHERE c.estabelecimento_id = ? ORDER BY i.id`,
      [ids['est']],
    );
  const cenarioCompleto = () => ({
    nome: `${P} TABELA NOVA COM REAJUSTE`,
    producaoInicio: '2026-01-01',
    producaoFim: '2026-01-31',
    dataReferencia: 'competencia',
    regras: [
      {
        fontePagadoraId: ids['fonteA'],
        tabelaDestinoId: ids['tabN'],
        percentualAjuste: 10,
        conversoes: [{ itemAtualCodigo: COD.y, itemDestinoCodigo: COD.z, fatorAtual: 1, fatorDestino: 2 }],
      },
    ],
  });

  it('cria o cenário com a troca de tabela, o reajuste e o de-para de procedimento', async () => {
    const r = await s.gravar('criar', op(), cenarioCompleto());
    ids['cen1'] = Number(r['id']);
    expect(r).toMatchObject({ regras: 1, conversoes: 1, parametros: 1 });
    const [c] = await linhas(
      'SELECT objetivo, situacao, dono_usuario_id, criado_por, producao_inicio FROM cenario_simulacao_receita WHERE id = ?',
      [ids['cen1']],
    );
    expect(c).toMatchObject({
      objetivo: 'troca_tabela_preco',
      situacao: 'rascunho',
      dono_usuario_id: ids['usuario'],
      criado_por: ids['usuario'],
    });
    const [p] = await linhas(
      'SELECT tipo_parametro, fonte_pagadora_id, percentual_reajuste FROM cenario_simulacao_parametro WHERE cenario_simulacao_receita_id = ?',
      [ids['cen1']],
    );
    expect(p).toMatchObject({ tipo_parametro: 'reajuste_fonte_pagadora', fonte_pagadora_id: ids['fonteA'] });
    expect(Number(p!['percentual_reajuste'])).toBe(10);
    const [rg] = await linhas(
      `SELECT r.destino_tabela_preco_id, r.percentual_ajuste, p.atual_item_faturavel_id, p.destino_item_faturavel_id,
              p.fator_atual, p.fator_destino
         FROM regra_conversao_tabela_preco r JOIN regra_conversao_procedimento p ON p.regra_conversao_tabela_preco_id = r.id
        WHERE r.cenario_simulacao_receita_id = ?`,
      [ids['cen1']],
    );
    expect(rg).toMatchObject({
      destino_tabela_preco_id: ids['tabN'],
      atual_item_faturavel_id: ids['y'],
      destino_item_faturavel_id: ids['z'],
    });
    expect([Number(rg!['fator_atual']), Number(rg!['fator_destino'])]).toEqual([1, 2]);
  });

  it('executa sobre a produção real: totais, resultado por procedimento e inconsistência, sem mexer nas contas', async () => {
    const antes = await fotoDasContas();
    const r = await s.gravar('executar', op(), { cenarioId: ids['cen1'] });
    ids['sim1'] = Number(r['id']);
    // Σ atual = 200 (X) + 50 (Y) + 40 (W) + 100 (X amb.) = 390; fora: estornado, cancelada e fevereiro.
    // Σ simulado = 150×2×1,1 = 330 + Z 30×2×1,1 = 66 + W sem preço 40 + 150×1,1 = 165 → 601.
    expect(r).toMatchObject({
      quantidadeItens: 4,
      quantidadeAtendimentos: 2,
      quantidadeInconsistencias: 1,
      valorAtual: 390,
      valorSimulado: 601,
      diferenca: 211,
      situacao: 'concluida_com_inconsistencia',
    });
    const [sim] = await linhas(
      `SELECT tipo_simulacao, situacao, data_referencia, solicitante_usuario_id, valor_atual_total, valor_simulado_total,
              valor_diferenca_total FROM simulacao_receita WHERE id = ?`,
      [ids['sim1']],
    );
    expect(sim).toMatchObject({
      tipo_simulacao: 'cenario_completo',
      situacao: 'concluida_com_inconsistencia',
      data_referencia: 'competencia',
      solicitante_usuario_id: ids['usuario'],
    });
    expect(Number(sim!['valor_diferenca_total'])).toBe(211);
    const res = await linhas(
      `SELECT item_faturavel_id, tipo_atendimento, quantidade, quantidade_atendimentos, valor_atual, valor_simulado,
              valor_diferenca FROM simulacao_receita_resultado WHERE simulacao_receita_id = ? ORDER BY sequencia`,
      [ids['sim1']],
    );
    const porItem = res.map((x) => [
      Number(x['item_faturavel_id']),
      x['tipo_atendimento'],
      Number(x['quantidade']),
      Number(x['valor_atual']),
      Number(x['valor_simulado']),
    ]);
    expect(porItem).toEqual(
      [
        [ids['x'], 'ambulatorial', 1, 100, 165],
        [ids['x'], 'internacao', 2, 200, 330],
        [ids['y'], 'internacao', 1, 50, 66],
        [ids['w'], 'internacao', 1, 40, 40],
      ].sort((a, b) => Number(a[0]) - Number(b[0]) || String(a[1]).localeCompare(String(b[1]))),
    );
    const inc = await linhas(
      'SELECT motivo, atual_item_faturavel_id, data_referencia FROM simulacao_receita_inconsistencia WHERE simulacao_receita_id = ?',
      [ids['sim1']],
    );
    expect(inc).toHaveLength(1);
    expect(inc[0]).toMatchObject({ motivo: 'sem_preco_destino', atual_item_faturavel_id: ids['w'] });
    const [cen] = await linhas(
      'SELECT situacao, receita_base, receita_simulada, quantidade_atendimentos FROM cenario_simulacao_receita WHERE id = ?',
      [ids['cen1']],
    );
    expect([cen!['situacao'], Number(cen!['receita_base']), Number(cen!['receita_simulada'])]).toEqual([
      'concluido',
      390,
      601,
    ]);
    // Nada muda nas contas: mesmo valor, mesma situação e mesma versão em cada item e conta.
    expect(await fotoDasContas()).toEqual(antes);
  });

  it('a leitura da execução traz o resultado por convênio, por grupo e as inconsistências com o código', async () => {
    const d = await s.ler(ctxL(), (l, est) => detalheSimulacaoReceitaPropria(l, est, ids['sim1']!));
    expect(d.simulacao).toMatchObject({
      valorAtual: 390,
      valorSimulado: 601,
      diferenca: 211,
      percentual: 54.1,
    });
    expect(d.porConvenio).toEqual([
      expect.objectContaining({
        fonteId: ids['fonteA'],
        valorAtual: 390,
        valorSimulado: 601,
        diferenca: 211,
      }),
    ]);
    expect(d.porGrupo).toEqual([expect.objectContaining({ grupo: `GRUPO ${P}`, valorAtual: 390 })]);
    expect(d.porTipoAtendimento.map((x) => [x.tipo, x.valorAtual, x.valorSimulado])).toEqual([
      ['ambulatorial', 100, 165],
      ['internacao', 290, 436],
    ]);
    expect(d.itens[0]).toMatchObject({ codigo: COD.x, tipo: 'internacao', diferenca: 130 });
    expect(d.inconsistencias).toEqual([
      expect.objectContaining({ motivo: 'sem_preco_destino', codigoAtual: COD.w, data: '2026-01-12' }),
    ]);
    expect(d.regras[0]).toMatchObject({ tabelaDestino: `TABELA SINTETICA ${P} TN`, conversoes: 1 });
    const painel = await s.ler(ctxL(), (l, est) => painelSimulacaoReceitaPropria(l, est));
    expect(painel.cenarios.map((c) => c.id)).toContain(ids['cen1']);
    expect(painel.execucoes[0]).toMatchObject({ id: ids['sim1'], cenarioId: ids['cen1'], diferenca: 211 });
    expect(painel.opcoes.tabelas.map((t) => t.id)).toEqual(
      expect.arrayContaining([ids['tabA'], ids['tabN'], ids['tabB']]),
    );
  });

  it('convênio simulado com recorte por internação: preço pela tabela do outro convênio', async () => {
    const r = await s.gravar('criar', op(), {
      nome: `${P} MIGRAR PARA OUTRO CONVENIO`,
      producaoInicio: '2026-01-01',
      producaoFim: '2026-01-31',
      tipoAtendimento: 'internacao',
      regras: [{ fontePagadoraId: ids['fonteA'], fonteDestinoId: ids['fonteB'] }],
    });
    ids['cen2'] = Number(r['id']);
    const [p] = await linhas(
      'SELECT tipo_parametro, tipo_atendimento FROM cenario_simulacao_parametro WHERE cenario_simulacao_receita_id = ?',
      [ids['cen2']],
    );
    expect(p).toMatchObject({ tipo_parametro: 'filtro_tipo_atendimento', tipo_atendimento: 'internacao' });
    const x = await s.gravar('executar', op(), { cenarioId: ids['cen2'] });
    // Só a internação: X 120×2 = 240 (tabela do convênio B); Y e W sem preço no B ficam pelo atual (50 + 40).
    expect(x).toMatchObject({ valorAtual: 290, valorSimulado: 330, quantidadeInconsistencias: 2 });
    const [sim] = await linhas('SELECT tipo_simulacao FROM simulacao_receita WHERE id = ?', [x['id']]);
    expect(sim!['tipo_simulacao']).toBe('conversao_tabela');
    const res = await linhas(
      'SELECT DISTINCT destino_fonte_pagadora_id FROM simulacao_receita_resultado WHERE simulacao_receita_id = ?',
      [x['id']],
    );
    expect(res.map((y) => Number(y['destino_fonte_pagadora_id']))).toEqual([ids['fonteB']]);
  });

  it('nova execução é outra fotografia: a anterior fica, e pela data do atendimento o recorte é o mesmo', async () => {
    const r = await s.gravar('executar', op(), { cenarioId: ids['cen1'], dataReferencia: 'atendimento' });
    expect(r).toMatchObject({ valorAtual: 390, valorSimulado: 601 });
    const n = await linhas(
      'SELECT COUNT(*) AS n FROM simulacao_receita WHERE cenario_simulacao_receita_id = ?',
      [ids['cen1']],
    );
    expect(Number(n[0]!['n'])).toBe(2);
  });

  it('recusa sem gravar: código fora do catálogo, nome repetido e plano de outro convênio', async () => {
    const conta = async () =>
      Number(
        (
          await linhas('SELECT COUNT(*) AS n FROM cenario_simulacao_receita WHERE estabelecimento_id = ?', [
            ids['est'],
          ])
        )[0]!['n'],
      );
    const antes = await conta();
    const base = cenarioCompleto();
    await expect(
      s.gravar('criar', op(), {
        ...base,
        nome: `${P} CODIGO RUIM`,
        regras: [
          {
            ...base.regras[0],
            conversoes: [
              { itemAtualCodigo: COD.y, itemDestinoCodigo: '00000000X', fatorAtual: 1, fatorDestino: 1 },
            ],
          },
        ],
      }),
    ).rejects.toMatchObject({ problema: { campos: ['regras.0.conversoes.0.itemDestinoCodigo'] } });
    await expect(s.gravar('criar', op(), base)).rejects.toMatchObject({ problema: { campos: ['nome'] } });
    await expect(
      s.gravar('criar', op(), {
        ...base,
        nome: `${P} PLANO ERRADO`,
        regras: [{ fontePagadoraId: ids['fonteA'], planoId: ids['planoB'], percentualAjuste: 5 }],
      }),
    ).rejects.toMatchObject({ problema: { campos: ['regras.0.planoId'] } });
    await expect(
      s.gravar('criar', op(), {
        ...base,
        nome: `${P} SEM MUDANCA`,
        regras: [{ fontePagadoraId: ids['fonteA'] }],
      }),
    ).rejects.toMatchObject({ problema: { campos: ['regras.0.destino'] } });
    expect(await conta()).toBe(antes);
  });
});
