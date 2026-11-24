// Contrato de efeito das regras comerciais da conta (F8, 06-FAT linhas 13, 19 e 23) contra o MariaDB real.
// Massa SINTÉTICA com códigos "F861" (nenhuma pessoa real): regras de criação e quebra de conta gravadas com autoria, a
// simulação sobre o atendimento (a mais específica vence, a exceção afasta, o período da quebra), a exceção retirada
// fica inativa e não some; desconto por volume com faixas (sobreposição recusada) e franquia do contrato aplicadas na
// conta (linhas em conta_hospitalar_franquia; a reaplicação marca as anteriores como excluídas); a remoção por trajeto
// e por quilômetro lançada na conta com o preço da tabela e a memória do cálculo; a ligação tarifada registrada e
// lançada (minuto iniciado), a gratuita marcada como não cobrada, e o total da conta refeito. No fim, a massa é apagada.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ServicoRegrasComerciais } from './regras-comerciais.controller.js';
import { comercialDaContaPropria, simularRegraContaPropria } from './regras-comerciais-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F861';

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

describe.skipIf(SEM_BANCO)('regras comerciais da conta (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let s: ServicoRegrasComerciais;
  const ids: Record<string, number> = {};
  const op = (): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: ids['est'] as number,
    usuario: ids['usuario'] as number,
    correlacao: 'teste-f861',
    chaveIdempotencia: `f861-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const ctxL = () => ({
    cliente: CLIENTE,
    estabelecimento: ids['est'] as number,
    usuario: null,
    correlacao: 'teste-f861',
  });
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f861' }, fn);
  const linhas = (sql: string, p: unknown[]) => escrever((e) => e.consultar<Record<string, unknown>>(sql, p));

  const limpar = async (e: Escritor) => {
    const est = ids['est'];
    await e.executar('DELETE FROM ligacao_tarifada WHERE estabelecimento_id = ?', [est]);
    await e.executar(
      'DELETE f FROM conta_hospitalar_franquia f JOIN conta_hospitalar c ON c.id = f.conta_hospitalar_id WHERE c.estabelecimento_id = ?',
      [est],
    );
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
    await e.executar('DELETE FROM regra_cobranca_ambulancia WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM regra_cobranca_ligacao WHERE estabelecimento_id = ?', [est]);
    await e.executar(
      `DELETE x FROM franquia_contrato_excecao x JOIN franquia_contrato f ON f.id = x.franquia_contrato_id
         JOIN contrato_fonte_pagadora c ON c.id = f.contrato_fonte_pagadora_id WHERE c.estabelecimento_id = ?`,
      [est],
    );
    await e.executar(
      'DELETE f FROM franquia_contrato f JOIN contrato_fonte_pagadora c ON c.id = f.contrato_fonte_pagadora_id WHERE c.estabelecimento_id = ?',
      [est],
    );
    await e.executar('DELETE FROM contrato_fonte_pagadora WHERE estabelecimento_id = ?', [est]);
    await e.executar(
      'DELETE x FROM regra_desconto_volume_faixa x JOIN regra_desconto_volume r ON r.id = x.regra_desconto_volume_id WHERE r.estabelecimento_id = ?',
      [est],
    );
    await e.executar('DELETE FROM regra_desconto_volume WHERE estabelecimento_id = ?', [est]);
    await e.executar(
      'DELETE x FROM regra_criacao_conta_excecao x JOIN regra_criacao_conta r ON r.id = x.regra_criacao_conta_id WHERE r.estabelecimento_id = ?',
      [est],
    );
    await e.executar('DELETE FROM regra_criacao_conta WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM rota_ambulancia WHERE estabelecimento_id = ?', [est]);
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
        ['f861.sintetico'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['f861.sintetico', `USUARIO SINTETICO ${P}`, agora],
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
        [pp, 886_101, agora],
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
      ids['ambulancia'] = await cat('categoria_ambulancia', P);
      ids['tipoLocal'] = await cat('tipo_ligacao_tarifada', `${P}LOC`, ', abrangencia, cobravel', [
        'local',
        1,
      ]);
      ids['tipoGratis'] = await cat('tipo_ligacao_tarifada', `${P}GRA`, ', abrangencia, cobravel', [
        'gratuita',
        0,
      ]);
      ids['grupo'] = await cat('grupo_faturamento', `${P}G`, ', tipo_grupo', ['taxa']);
      const item = (c: string) =>
        garantir(
          e,
          'SELECT id FROM item_faturavel WHERE codigo = ?',
          [c],
          "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'servico', ?, ?)",
          [c, `ITEM SINTETICO ${c}`, ids['grupo'], agora],
        );
      ids['proc'] = await item(`${P}PR`);
      ids['km'] = await item(`${P}KM`);
      ids['trajeto'] = await item(`${P}TR`);
      ids['minuto'] = await item(`${P}MI`);
      const tabela = await garantir(
        e,
        'SELECT id FROM tabela_preco WHERE codigo = ?',
        [`${P}TP`],
        `INSERT INTO tabela_preco (codigo, descricao, tipo_item, referencia, situacao, fonte_pagadora_id, criado_em)
         VALUES (?, ?, 'servico_hospitalar', 'propria', 'ativa', ?, ?)`,
        [`${P}TP`, `TABELA SINTETICA ${P}`, ids['fonte'], agora],
      );
      let sq = 0;
      for (const [it, total] of [
        [ids['km'], 5],
        [ids['trajeto'], 300],
        [ids['minuto'], 1.5],
      ] as const) {
        const pr = await garantir(
          e,
          'SELECT id FROM preco_procedimento WHERE tabela_preco_id = ? AND item_faturavel_id = ?',
          [tabela, it],
          'INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, criado_em) VALUES (?, ?, ?, ?)',
          [tabela, ++sq, it, agora],
        );
        await garantir(
          e,
          'SELECT id FROM preco_procedimento_valor WHERE preco_procedimento_id = ?',
          [pr],
          `INSERT INTO preco_procedimento_valor (preco_procedimento_id, operacao, ocorrido_em, vigencia_inicio,
             valor_honorario, valor_custo_operacional, valor_filme, valor_total, criado_em)
           VALUES (?, 'inclusao', ?, '2020-01-01', 0, ?, 0, ?, ?)`,
          [pr, agora, total, total, agora],
        );
      }
      ids['contrato'] = await e.inserir(
        `INSERT INTO contrato_fonte_pagadora (estabelecimento_id, fonte_pagadora_id, numero, descricao, vigencia_inicio,
           criado_em) VALUES (?, ?, ?, ?, '2025-01-01', ?)`,
        [ids['est'], ids['fonte'], `${P}CT`, `CONTRATO SINTETICO ${P}`, agora],
      );
      ids['rota'] = await e.inserir(
        `INSERT INTO rota_ambulancia (estabelecimento_id, codigo, descricao, local_partida, local_destino, distancia_km,
           criado_em) VALUES (?, ?, ?, 'PARTIDA SINTETICA', 'DESTINO SINTETICO', 20, ?)`,
        [ids['est'], `${P}R`, `TRAJETO SINTETICO ${P}`, agora],
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
           contrato_fonte_pagadora_id, tipo_conta_id, natureza, competencia, inicio_em, valor_itens, valor_total, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'internacao', '2026-01-01', '2026-01-20 08:00:00', 1000, 1000, ?)`,
        [
          ids['est'],
          `${P}-C1`,
          ids['atendimento'],
          ids['paciente'],
          ids['fonte'],
          ids['contrato'],
          ids['tipoConta'],
          agora,
        ],
      );
      await e.inserir(
        `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, grupo_faturamento_id,
           realizado_em, quantidade, valor_unitario, valor_total, criado_em)
         VALUES (?, 1, ?, ?, '2026-01-20 09:00:00', 1, 1000, 1000, ?)`,
        [ids['conta'], ids['proc'], ids['grupo'], agora],
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

  it('linha 13: regras de criação e quebra gravadas; a simulação escolhe a mais específica e respeita a exceção', async () => {
    expect(
      await codigoDo(
        s.gravar('salvar-regra-conta', op(), { acao: 'criar_conta', vigenciaInicio: '2026-01-01' }),
      ),
    ).toBe('entrada-invalida');
    const a = await s.gravar('salvar-regra-conta', op(), {
      acao: 'criar_conta',
      origemEntradaId: ids['origem'],
      fonteDestinoId: ids['fonte'],
      vigenciaInicio: '2026-01-01',
    });
    const b = await s.gravar('salvar-regra-conta', op(), {
      acao: 'criar_conta',
      origemEntradaId: ids['origem'],
      categoriaAtendimentoId: ids['categoria'],
      fonteDestinoId: ids['fonte'],
      vigenciaInicio: '2026-01-01',
      excecoes: [{ itemId: ids['proc'] }],
    });
    const q = await s.gravar('salvar-regra-conta', op(), {
      acao: 'quebrar_conta',
      periodicidade: 'quinzenal',
      vigenciaInicio: '2026-01-01',
    });
    const sim = await s.ler(ctxL(), (l, est) =>
      simularRegraContaPropria(l, est, ids['atendimento'] as number),
    );
    expect(sim.criacao.regraId).toBe(b['id']);
    expect(sim.quebra).toMatchObject({
      regraId: q['id'],
      periodo: { inicio: '2026-01-16', fim: '2026-01-31' },
    });
    const comItem = await s.ler(ctxL(), (l, est) =>
      simularRegraContaPropria(l, est, ids['atendimento'] as number, { itemId: ids['proc'] as number }),
    );
    expect(comItem.criacao.regraId).toBe(a['id']);
    expect(comItem.criacao.avaliadas.find((x) => x.id === b['id'])?.motivo).toBe('excecao');
    const [gravada] = await linhas('SELECT criado_por, versao FROM regra_criacao_conta WHERE id = ?', [
      b['id'],
    ]);
    expect(Number(gravada?.['criado_por'])).toBe(ids['usuario']);
    // Retirar a exceção: a anterior fica inativa no banco, nunca apagada.
    await s.gravar('salvar-regra-conta', op(), {
      id: b['id'],
      versao: Number(gravada?.['versao']),
      acao: 'criar_conta',
      origemEntradaId: ids['origem'],
      categoriaAtendimentoId: ids['categoria'],
      fonteDestinoId: ids['fonte'],
      vigenciaInicio: '2026-01-01',
    });
    const ex = await linhas(
      'SELECT ativo FROM regra_criacao_conta_excecao WHERE regra_criacao_conta_id = ?',
      [b['id']],
    );
    expect(ex.map((x) => Number(x['ativo']))).toEqual([0]);
  });

  it('linha 19: desconto por volume e franquia aplicados na conta; reaplicar marca as anteriores', async () => {
    expect(
      await codigoDo(
        s.gravar('salvar-desconto-volume', op(), {
          fontePagadoraId: ids['fonte'],
          descricao: 'DESCONTO SINTETICO',
          vigenciaInicio: '2026-01-01',
          faixas: [
            { sequencia: 1, volumeInicial: 0, volumeFinal: 600, percentual: 0 },
            { sequencia: 2, volumeInicial: 500, volumeFinal: null, percentual: 10 },
          ],
        }),
      ),
    ).toBe('entrada-invalida');
    const d = await s.gravar('salvar-desconto-volume', op(), {
      fontePagadoraId: ids['fonte'],
      descricao: 'DESCONTO SINTETICO',
      baseVolume: 'valor_competencia',
      vigenciaInicio: '2026-01-01',
      faixas: [
        { sequencia: 1, volumeInicial: 0, volumeFinal: 500, percentual: 0 },
        { sequencia: 2, volumeInicial: 500, volumeFinal: null, percentual: 10 },
      ],
    });
    const f = await s.gravar('salvar-franquia', op(), {
      contratoId: ids['contrato'],
      descricao: 'FRANQUIA SINTETICA',
      tipo: 'valor',
      valorFranquia: 200,
      aplicaPensionista: false,
      vigenciaInicio: '2025-01-01',
    });
    const pre = await s.ler(ctxL(), (l, est) =>
      comercialDaContaPropria(l, est, ids['conta'] as number, 'pensionista'),
    );
    expect(pre.previa.franquia).toEqual([
      expect.objectContaining({ id: f['id'], motivo: 'vinculo_nao_coberto', valor: 0 }),
    ]);
    expect(pre.previa.desconto).toMatchObject({ regraId: d['id'], volume: 1000, valor: 100 });

    const r1 = await s.gravar('aplicar-comercial', op(), { contaId: ids['conta'], vinculo: 'titular' });
    expect(r1).toMatchObject({ franquia: 200, desconto: 100, substituidas: 0 });
    const r2 = await s.gravar('aplicar-comercial', op(), { contaId: ids['conta'], vinculo: 'titular' });
    expect(r2).toMatchObject({ substituidas: 2 });
    const aplicadas = await linhas(
      `SELECT sequencia, tipo, valor, franquia_contrato_id, regra_desconto_volume_id, excluido_em, excluido_por, criado_por
         FROM conta_hospitalar_franquia WHERE conta_hospitalar_id = ? ORDER BY sequencia`,
      [ids['conta']],
    );
    expect(
      aplicadas.map((x) => [
        Number(x['sequencia']),
        x['tipo'],
        Number(x['valor']),
        x['excluido_em'] === null,
      ]),
    ).toEqual([
      [1, 'franquia', 200, false],
      [2, 'desconto_volume', 100, false],
      [3, 'franquia', 200, true],
      [4, 'desconto_volume', 100, true],
    ]);
    expect(Number(aplicadas[0]?.['excluido_por'])).toBe(ids['usuario']);
    expect(Number(aplicadas[2]?.['franquia_contrato_id'])).toBe(f['id']);
    expect(Number(aplicadas[3]?.['regra_desconto_volume_id'])).toBe(d['id']);
    expect(Number(aplicadas[3]?.['criado_por'])).toBe(ids['usuario']);
  });

  it('linha 23: remoção por trajeto e por km e ligações lançadas na conta, com o total refeito', async () => {
    await s.gravar('salvar-regra-ambulancia', op(), {
      categoriaAmbulanciaId: ids['ambulancia'],
      forma: 'quilometro',
      itemId: ids['km'],
    });
    await s.gravar('salvar-regra-ambulancia', op(), {
      fontePagadoraId: ids['fonte'],
      categoriaAmbulanciaId: ids['ambulancia'],
      forma: 'trajeto',
      rotaId: ids['rota'],
      itemId: ids['trajeto'],
    });
    expect(
      await codigoDo(
        s.gravar('salvar-regra-ambulancia', op(), {
          categoriaAmbulanciaId: ids['ambulancia'],
          forma: 'quilometro',
          itemId: ids['km'],
        }),
      ),
    ).toBe('entrada-invalida');
    const t = await s.gravar('lancar-remocao', op(), {
      contaId: ids['conta'],
      categoriaAmbulanciaId: ids['ambulancia'],
      rotaId: ids['rota'],
      data: '2026-01-21',
    });
    expect(t).toMatchObject({ quantidade: 1, semPreco: false });
    const k = await s.gravar('lancar-remocao', op(), {
      contaId: ids['conta'],
      categoriaAmbulanciaId: ids['ambulancia'],
      km: 35,
      data: '2026-01-21',
    });
    expect(k).toMatchObject({ quantidade: 35 });

    await s.gravar('salvar-regra-ligacao', op(), {
      tipoLigacaoId: ids['tipoLocal'],
      itemMinutoId: ids['minuto'],
    });
    await s.gravar('salvar-regra-ligacao', op(), {
      tipoLigacaoId: ids['tipoGratis'],
      itemMinutoId: ids['minuto'],
    });
    const lig = (tipo: number, dur: number) =>
      s.gravar('registrar-ligacao', op(), {
        atendimentoId: ids['atendimento'],
        tipoLigacaoId: tipo,
        iniciadaEm: '2026-01-21T10:00:00',
        duracaoSegundos: dur,
        telefone: '0000000000',
      });
    const l1 = await lig(ids['tipoLocal'] as number, 125);
    const l2 = await lig(ids['tipoGratis'] as number, 60);
    const r = await s.gravar('lancar-ligacoes', op(), { contaId: ids['conta'] });
    expect(r).toMatchObject({ lancadas: 1, naoCobradas: 1, pendentes: 0 });
    expect(await s.gravar('lancar-ligacoes', op(), { contaId: ids['conta'] })).toMatchObject({ lancadas: 0 });

    const ls = await linhas(
      'SELECT id, tipo_ligacao, situacao, lancamento_conta_hospitalar_item_id AS item, criado_por FROM ligacao_tarifada WHERE id IN (?, ?) ORDER BY id',
      [l1['id'], l2['id']],
    );
    expect(ls.map((x) => [x['tipo_ligacao'], x['situacao']])).toEqual([
      ['local', 'lancada'],
      ['outra', 'nao_cobrada'],
    ]);
    expect(Number(ls[0]?.['criado_por'])).toBe(ids['usuario']);
    const itens = await linhas(
      `SELECT i.item_faturavel_id AS item, i.quantidade, i.valor_unitario, i.valor_total, i.tipo_valorizacao, m.dados
         FROM conta_hospitalar_item i JOIN conta_hospitalar_item_memoria m ON m.conta_hospitalar_item_id = i.id
        WHERE i.conta_hospitalar_id = ? ORDER BY i.sequencia`,
      [ids['conta']],
    );
    expect(
      itens.map((x) => [
        Number(x['item']),
        Number(x['quantidade']),
        Number(x['valor_total']),
        x['tipo_valorizacao'],
      ]),
    ).toEqual([
      [ids['trajeto'], 1, 300, 'tabela'],
      [ids['km'], 35, 175, 'tabela'],
      [ids['minuto'], 3, 4.5, 'tabela'],
    ]);
    expect(JSON.stringify(itens[0]?.['dados'])).toContain('remocao_ambulancia');
    expect(JSON.stringify(itens[2]?.['dados'])).toContain('ligacao_tarifada');
    expect(Number(ls[0]?.['item'])).toBeGreaterThan(0);
    const [conta] = await linhas('SELECT valor_total FROM conta_hospitalar WHERE id = ?', [ids['conta']]);
    expect(Number(conta?.['valor_total'])).toBe(1479.5);
    const visao = await s.ler(ctxL(), (l, est) => comercialDaContaPropria(l, est, ids['conta'] as number));
    expect(visao.ligacoes.map((x) => x.situacao)).toEqual(['lancada', 'nao_cobrada']);
  });
});
