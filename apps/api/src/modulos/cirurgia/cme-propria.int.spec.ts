// Contrato de efeito da central de material esterilizado (CME; F7, 05-SUP linha 29; RDC 15/2012) contra o MariaDB real
// (cliente de teste). Massa SINTÉTICA: estabelecimento com o código do teste, método de esterilização, paciente,
// caráter e agendamento cirúrgico fictícios; usuário, profissional, produto do estoque, setor e unidade são ids já
// existentes do cliente de teste (só os ids são lidos).
// Prova o que fica no banco: a caixa com as peças; o equipamento; a solicitação da cirurgia com número e item; o pacote
// com etiqueta, conteúdo copiado da caixa e o item da solicitação em processamento; a carga (ciclo em andamento, item e
// pacote ligados); a conclusão sem indicador químico é recusada (422) sem escrita; com indicadores conformes o ciclo é
// liberado e o pacote fica estéril com validade, a caixa conta o reprocessamento e o item fica pronto; a entrega para a
// cirurgia grava o movimento com o agendamento e o atendimento e fecha a solicitação; o uso fecha o rastreio até o
// paciente; o ciclo reprovado rejeita o pacote sem apagar nada; a carga com implante aguarda o biológico; tudo na
// trilha; a sessão de outro estabelecimento não enxerga o pacote (404).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { hojeNo, PortaCmePropria } from './cme-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const P = 'c2044cme';
const P2 = `${P}b`;

interface Massa {
  usuario: number;
  est: number;
  metodo: number;
  insumo: number;
  setor: number;
  unidade: number;
  agendamento: number;
  atendimento: number;
  paciente: number;
  terceiro: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar(
    `DELETE mi FROM movimento_material_esteril_item mi JOIN movimento_material_esteril m
        ON m.id = mi.movimento_material_esteril_id WHERE m.estabelecimento_id = ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM uso_pacote_esteril WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(`DELETE FROM movimento_material_esteril WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(
    `DELETE i FROM solicitacao_material_esteril_item i JOIN solicitacao_material_esteril s
        ON s.id = i.solicitacao_material_esteril_id WHERE s.estabelecimento_id = ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM solicitacao_material_esteril WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(
    `DELETE i FROM ciclo_esterilizacao_item i JOIN ciclo_esterilizacao c ON c.id = i.ciclo_esterilizacao_id
      WHERE c.estabelecimento_id = ${est}`,
    [P],
  );
  await e.executar(
    `DELETE x FROM pacote_esteril_conteudo x JOIN pacote_esteril p ON p.id = x.pacote_esteril_id
      WHERE p.estabelecimento_id = ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM pacote_esteril WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(`DELETE FROM ciclo_esterilizacao WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(`DELETE FROM material_terceiro_reprocessamento WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(`DELETE FROM equipamento_esterilizacao WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(
    `DELETE i FROM caixa_instrumental_item i JOIN caixa_instrumental c ON c.id = i.caixa_instrumental_id
      WHERE c.estabelecimento_id = ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM caixa_instrumental WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(`DELETE FROM agendamento_cirurgico WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(`DELETE FROM sequencia_negocio WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar('DELETE FROM metodo_esterilizacao WHERE codigo = ?', [`${P}-VAP`]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

describe.skipIf(SEM_BANCO)('PortaCmePropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaCmePropria;
  let m: Massa;
  const ctx = (hospital = P) => ({ cliente: CLIENTE, hospital, usuario: m.usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
      Record<string, unknown>[]
    >;
  const um = async (sql: string, p: unknown[] = []) => (await ler(sql, p))[0] ?? {};
  const erro = async (pr: Promise<unknown>) => {
    try {
      await pr;
    } catch (e) {
      const x = e as { problema?: { status?: number; codigo?: string } };
      return { status: x.problema?.status, codigo: x.problema?.codigo };
    }
    throw new Error('Esperava recusa.');
  };
  const trilha = (entidade: string, id: number) =>
    um(
      `SELECT COUNT(*) AS n FROM trilha_auditoria t JOIN estabelecimento e ON e.id = t.estabelecimento_id
        WHERE e.codigo = ? AND t.entidade = ? AND t.entidade_id = ?`,
      [P, entidade, id],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaCmePropria(nucleo, CLIENTE);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const cirurgiao = await e.uma('SELECT MIN(id) AS id FROM profissional WHERE excluido_em IS NULL');
      const insumo = await e.uma('SELECT MIN(id) AS id FROM insumo WHERE excluido_em IS NULL');
      const setor = await e.uma('SELECT MIN(id) AS id FROM setor_funcional');
      const unidade = await e.uma('SELECT MIN(id) AS id FROM unidade_assistencial');
      if (!usuario?.['id'] || !cirurgiao?.['id'] || !insumo?.['id'] || !setor?.['id'] || !unidade?.['id'])
        throw new Error('O cliente de teste precisa de usuário, profissional, produto, setor e unidade.');
      const g = async (sql: string, args: unknown[], ins: string, iargs: unknown[]) =>
        Number((await e.uma(sql, args))?.['id'] ?? (await e.inserir(ins, iargs)));
      const pf = await g(
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PACIENTE SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PACIENTE SINTETICO ${P}`, agora],
      );
      const paciente = await g(
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pf],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, 932044, 'ativo', ?)",
        [pf, agora],
      );
      const carater = await g(
        'SELECT id FROM carater_cirurgia WHERE codigo = ?',
        [`${P}-ELE`],
        'INSERT INTO carater_cirurgia (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}-ELE`, `CARATER SINTETICO ${P}`, agora],
      );
      const novoEst = (c: string) =>
        e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
          [c, `Hospital sintético ${c}`, `Hospital sintético ${c} (fictício)`, agora],
        );
      const est = await novoEst(P);
      await novoEst(P2);
      const metodo = await e.inserir(
        "INSERT INTO metodo_esterilizacao (codigo, descricao, categoria, criado_em) VALUES (?, ?, 'esterilizacao', ?)",
        [`${P}-VAP`, `VAPOR SINTETICO ${P}`, agora],
      );
      // O atendimento do paciente da cirurgia (a baixa do uso do pacote se liga a ele; 04-CME linha 118).
      const minimo = async (t: string) =>
        Number((await e.uma(`SELECT MIN(id) AS id FROM ${t}`))?.['id'] ?? 0);
      const [categoria, caraterTiss, pagadora] = [
        await minimo('categoria_atendimento'),
        await minimo('carater_atendimento_tiss'),
        await minimo('fonte_pagadora'),
      ];
      if (!categoria || !caraterTiss || !pagadora)
        throw new Error('O cliente de teste precisa de categoria, caráter TISS e fonte pagadora.');
      const atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id,
           fonte_pagadora_id, profissional_id, entrada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [est, `${P}-AT`, paciente, categoria, caraterTiss, pagadora, cirurgiao['id'], agora, agora],
      );
      const agendamento = await e.inserir(
        `INSERT INTO agendamento_cirurgico (estabelecimento_id, numero, paciente_id, cirurgiao_profissional_id,
                                            carater_cirurgia_id, tipo_cobertura, solicitado_em, situacao, atendimento_id,
                                            criado_em)
         VALUES (?, ?, ?, ?, ?, 'particular', ?, 'solicitado', ?, ?)`,
        [est, `${P}-1`, paciente, cirurgiao['id'], carater, agora, atendimento, agora],
      );
      const terceiro = await e.inserir(
        `INSERT INTO material_terceiro_reprocessamento (estabelecimento_id, descricao, tipo_proprietario, criado_em)
         VALUES (?, ?, 'paciente', ?)`,
        [est, `IMPLANTE SINTETICO ${P}`, agora],
      );
      return {
        usuario: Number(usuario['id']),
        est,
        metodo,
        insumo: Number(insumo['id']),
        setor: Number(setor['id']),
        unidade: Number(unidade['id']),
        agendamento,
        atendimento,
        paciente,
        terceiro,
      };
    });
  });

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  let caixa = 0;
  let equipamento = 0;
  let solicitacao = 0;
  let itemSol = 0;
  let pacote = 0;
  let etiqueta = '';
  let ciclo = 0;

  it('cadastra a caixa com as peças e o equipamento', async () => {
    const r = await porta.criarCaixa(ctx(), {
      codigo: 'CX-ORTO',
      descricao: 'Caixa ortopédica sintética',
      validadeDias: 30,
      metodo: m.metodo,
      itens: [
        { insumo: m.insumo, quantidade: 4, pecaMestre: true },
        { insumo: m.insumo, quantidade: 2 },
      ],
    });
    caixa = r.caixa;
    const itens = await ler(
      'SELECT sequencia, quantidade, peca_mestre, criado_por FROM caixa_instrumental_item WHERE caixa_instrumental_id = ? ORDER BY sequencia',
      [caixa],
    );
    expect(
      itens.map((i) => [Number(i['sequencia']), Number(i['quantidade']), Number(i['peca_mestre'])]),
    ).toEqual([
      [1, 4, 1],
      [2, 2, 0],
    ]);
    expect(Number(itens[0]!['criado_por'])).toBe(m.usuario);
    expect(
      (
        await erro(
          porta.criarCaixa(ctx(), {
            codigo: 'CX-ORTO',
            descricao: 'x',
            itens: [{ insumo: m.insumo, quantidade: 1 }],
          }),
        )
      ).status,
    ).toBe(422);
    equipamento = (
      await porta.criarEquipamento(ctx(), {
        codigo: 'AC1',
        descricao: 'Autoclave sintética',
        natureza: 'autoclave',
        metodo: m.metodo,
      })
    ).equipamento;
    expect(Number((await trilha('caixa_instrumental', caixa))['n'])).toBeGreaterThan(0);
  });

  it('a cirurgia pede a caixa e a CME prepara o pacote com etiqueta e conteúdo', async () => {
    const s = await porta.solicitar(ctx(), {
      tipo: 'cirurgia',
      setor: m.unidade,
      agendamento: m.agendamento,
      itens: [{ caixa, quantidade: 1 }],
    });
    solicitacao = s.solicitacao;
    expect(s.numero).toMatch(/^SME-/);
    const it1 = await um(
      'SELECT id, situacao FROM solicitacao_material_esteril_item WHERE solicitacao_material_esteril_id = ?',
      [solicitacao],
    );
    itemSol = Number(it1['id']);
    expect(it1['situacao']).toBe('pendente');
    const p = await porta.prepararPacote(ctx(), { caixa, solicitacaoItem: itemSol });
    pacote = p.pacote;
    etiqueta = p.etiqueta;
    const pk = await um(
      'SELECT situacao, codigo_etiqueta, preparado_por_usuario_id FROM pacote_esteril WHERE id = ?',
      [pacote],
    );
    expect([pk['situacao'], pk['codigo_etiqueta'], Number(pk['preparado_por_usuario_id'])]).toEqual([
      'aguardando_esterilizacao',
      etiqueta,
      m.usuario,
    ]);
    const cont = await ler(
      'SELECT quantidade_prevista, situacao FROM pacote_esteril_conteudo WHERE pacote_esteril_id = ?',
      [pacote],
    );
    expect(cont).toHaveLength(2);
    expect(
      (
        await um('SELECT situacao, pacote_esteril_id FROM solicitacao_material_esteril_item WHERE id = ?', [
          itemSol,
        ])
      )['situacao'],
    ).toBe('em_processamento');
    expect(
      (await um('SELECT situacao FROM solicitacao_material_esteril WHERE id = ?', [solicitacao]))['situacao'],
    ).toBe('em_processamento');
  });

  it('abre a carga, recusa a conclusão sem químico e libera com indicadores conformes', async () => {
    expect((await erro(porta.abrirCiclo(ctx(), { equipamento, metodo: m.metodo, pacotes: [] }))).status).toBe(
      422,
    );
    ciclo = (await porta.abrirCiclo(ctx(), { equipamento, metodo: m.metodo, pacotes: [pacote] })).ciclo;
    const c0 = await um('SELECT situacao, numero_lote, versao FROM ciclo_esterilizacao WHERE id = ?', [
      ciclo,
    ]);
    expect(c0['situacao']).toBe('em_andamento');
    expect(
      Number(
        (await um('SELECT ciclo_esterilizacao_id AS c FROM pacote_esteril WHERE id = ?', [pacote]))['c'],
      ),
    ).toBe(ciclo);
    // A mesma carga não aceita o pacote de novo.
    expect(
      (await erro(porta.abrirCiclo(ctx(), { equipamento, metodo: m.metodo, pacotes: [pacote] }))).status,
    ).toBe(422);
    const versao = Number(c0['versao']);
    const sem = await erro(
      porta.concluirCiclo(ctx(), ciclo, {
        versao,
        fisico: 'conforme',
        quimico: 'pendente',
        biologico: 'pendente',
      }),
    );
    expect(sem.status).toBe(422);
    expect(
      (await um('SELECT situacao, versao FROM ciclo_esterilizacao WHERE id = ?', [ciclo]))['situacao'],
    ).toBe('em_andamento');
    const r = await porta.concluirCiclo(ctx(), ciclo, {
      versao,
      temperatura: 134,
      tempoExposicao: 5,
      fisico: 'conforme',
      quimico: 'conforme',
      biologico: 'conforme',
    });
    expect(r.situacao).toBe('liberado');
    const c1 = await um(
      'SELECT situacao, fim_em, liberado_em, liberado_por_usuario_id, indicador_fisico, indicador_quimico FROM ciclo_esterilizacao WHERE id = ?',
      [ciclo],
    );
    expect([c1['situacao'], Number(c1['liberado_por_usuario_id']), Number(c1['indicador_quimico'])]).toEqual([
      'liberado',
      m.usuario,
      1,
    ]);
    const pk = await um('SELECT situacao, validade, esterilizado_em FROM pacote_esteril WHERE id = ?', [
      pacote,
    ]);
    expect(pk['situacao']).toBe('esteril');
    expect(pk['validade']).toBeTruthy();
    expect(
      Number(
        (await um('SELECT quantidade_reprocessamentos AS n FROM caixa_instrumental WHERE id = ?', [caixa]))[
          'n'
        ],
      ),
    ).toBe(1);
    expect(
      (await um('SELECT situacao FROM solicitacao_material_esteril_item WHERE id = ?', [itemSol]))[
        'situacao'
      ],
    ).toBe('pronto');
    const rt = await porta.rastreio(ctx(), etiqueta);
    expect(rt.pacote.faltasEtiqueta).toEqual([]);
    // O dia impresso na etiqueta é o do fuso do estabelecimento (o banco guarda o instante em UTC).
    expect(rt.pacote.esterilizadoNoDia).toBe(hojeNo('America/Sao_Paulo'));
    expect(rt.ciclo?.situacao).toBe('liberado');
  });

  it('entrega à cirurgia, registra o uso e rastreia até o paciente', async () => {
    const outro = await erro(
      porta.entregar(ctx(P2), pacote, { agendamento: m.agendamento, cme: m.setor, setor: m.setor }),
    );
    expect(outro.status).toBe(404);
    const mov = (
      await porta.entregar(ctx(), pacote, { agendamento: m.agendamento, cme: m.setor, setor: m.setor })
    ).movimento;
    const mv = await um(
      'SELECT tipo, agendamento_cirurgico_id AS ag, situacao FROM movimento_material_esteril WHERE id = ?',
      [mov],
    );
    expect([mv['tipo'], Number(mv['ag']), mv['situacao']]).toEqual(['entrega', m.agendamento, 'aberto']);
    expect((await um('SELECT situacao FROM pacote_esteril WHERE id = ?', [pacote]))['situacao']).toBe(
      'distribuido',
    );
    expect(
      (await um('SELECT situacao FROM solicitacao_material_esteril WHERE id = ?', [solicitacao]))['situacao'],
    ).toBe('entregue');
    // Entregar de novo: o pacote já saiu (422, sem novo movimento).
    expect(
      (
        await erro(
          porta.entregar(ctx(), pacote, { agendamento: m.agendamento, cme: m.setor, setor: m.setor }),
        )
      ).status,
    ).toBe(422);
    const usar = (o: object) => porta.usar(ctx(), pacote, { agendamento: m.agendamento, ...o });
    expect(
      (await erro(usar({ agendamento: m.agendamento + 999999, integridadeConferida: true }))).status,
    ).toBe(422);
    // A abertura sem a embalagem conferida, ou com o indicador externo que não virou: 422, sem baixa.
    expect((await erro(usar({ integridadeConferida: false }))).status).toBe(422);
    expect((await erro(usar({ integridadeConferida: true, indicadorExternoOk: false }))).status).toBe(422);
    const contaUsos = async () =>
      Number(
        (await um('SELECT COUNT(*) AS n FROM uso_pacote_esteril WHERE pacote_esteril_id = ?', [pacote]))['n'],
      );
    expect(await contaUsos()).toBe(0);
    const { uso } = await usar({
      integridadeConferida: true,
      indicadorExternoOk: true,
      observacao: 'aberto na sala',
    });
    const u = await um(
      `SELECT estabelecimento_id AS est, paciente_id, atendimento_id, ato_cirurgico_id, integridade_conferida,
              indicador_externo_ok, registrado_usuario_id, quantidade, observacao FROM uso_pacote_esteril WHERE id = ?`,
      [uso],
    );
    expect([
      Number(u['est']),
      Number(u['paciente_id']),
      Number(u['atendimento_id']),
      u['ato_cirurgico_id'],
      Number(u['integridade_conferida']),
      Number(u['indicador_externo_ok']),
      Number(u['registrado_usuario_id']) > 0,
      Number(u['quantidade']),
      u['observacao'],
    ]).toEqual([m.est, m.paciente, m.atendimento, null, 1, 1, true, 1, 'aberto na sala']);
    expect(await contaUsos()).toBe(1);
    // Usar de novo: o pacote já foi aberto (422, sem segunda baixa).
    expect((await erro(usar({ integridadeConferida: true }))).status).toBe(422);
    expect(await contaUsos()).toBe(1);
    expect((await um('SELECT situacao FROM pacote_esteril WHERE id = ?', [pacote]))['situacao']).toBe(
      'usado',
    );
    expect(
      (await um('SELECT situacao FROM movimento_material_esteril WHERE id = ?', [mov]))['situacao'],
    ).toBe('conferido');
    const rt = await porta.pacotesDaCirurgia(ctx(), m.agendamento);
    expect(rt).toHaveLength(1);
    expect(rt[0]!.cirurgias.map((c) => [c.paciente, c.usado])).toEqual([[m.paciente, true]]);
    expect(
      rt[0]!.usos.map((x) => [x.paciente, x.atendimento, x.integridadeConferida, x.indicadorExternoOk]),
    ).toEqual([[m.paciente, m.atendimento, true, true]]);
    expect(
      Number(
        (
          await um(
            'SELECT COUNT(*) AS n FROM movimento_material_esteril WHERE id >= ? AND estabelecimento_id = ?',
            [mov, m.est],
          )
        )['n'],
      ),
    ).toBe(1);
    expect(Number((await trilha('pacote_esteril', pacote))['n'])).toBeGreaterThan(0);
  });

  it('o painel da CME lista a caixa, o pacote e o ciclo da sessão; a solicitação entregue sai da fila', async () => {
    const pn = await porta.painel(ctx());
    expect(pn.caixas.some((c) => c.id === caixa)).toBe(true);
    expect(pn.pacotes.some((p) => p.id === pacote)).toBe(true);
    expect(pn.ciclos.some((c) => c.id === ciclo)).toBe(true);
    // A solicitação já entregue à cirurgia saiu da fila de trabalho da CME.
    expect(pn.solicitacoes.some((s) => s.id === solicitacao)).toBe(false);
    expect(Array.isArray(pn.setores) && Array.isArray(pn.unidades) && Array.isArray(pn.agendamentos)).toBe(
      true,
    );
    const outro = await porta.painel(ctx(P2));
    expect(outro.pacotes.some((p) => p.id === pacote)).toBe(false);
  });

  it('o ciclo reprovado rejeita o pacote sem apagar; a carga com implante aguarda o biológico', async () => {
    const p2 = (await porta.prepararPacote(ctx(), { caixa })).pacote;
    const c2 = (await porta.abrirCiclo(ctx(), { equipamento, metodo: m.metodo, pacotes: [p2] })).ciclo;
    const v2 = Number((await um('SELECT versao FROM ciclo_esterilizacao WHERE id = ?', [c2]))['versao']);
    const r2 = await porta.concluirCiclo(ctx(), c2, {
      versao: v2,
      fisico: 'conforme',
      quimico: 'nao_conforme',
      biologico: 'pendente',
    });
    expect(r2.situacao).toBe('reprovado');
    expect(await um('SELECT situacao, excluido_em FROM pacote_esteril WHERE id = ?', [p2])).toEqual({
      situacao: 'rejeitado',
      excluido_em: null,
    });

    const p3 = (await porta.prepararPacote(ctx(), { caixa })).pacote;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: P }, (e) =>
      e.executar('UPDATE pacote_esteril SET material_terceiro_reprocessamento_id = ? WHERE id = ?', [
        m.terceiro,
        p3,
      ]),
    );
    const c3 = (await porta.abrirCiclo(ctx(), { equipamento, metodo: m.metodo, pacotes: [p3] })).ciclo;
    const v3 = Number((await um('SELECT versao FROM ciclo_esterilizacao WHERE id = ?', [c3]))['versao']);
    const r3 = await porta.concluirCiclo(ctx(), c3, {
      versao: v3,
      fisico: 'conforme',
      quimico: 'conforme',
      biologico: 'pendente',
    });
    expect(r3.situacao).toBe('concluido');
    expect((await um('SELECT situacao FROM pacote_esteril WHERE id = ?', [p3]))['situacao']).toBe(
      'aguardando_esterilizacao',
    );
    const v3b = Number((await um('SELECT versao FROM ciclo_esterilizacao WHERE id = ?', [c3]))['versao']);
    expect((await porta.liberarCiclo(ctx(), c3, { versao: v3b, biologico: 'conforme' })).situacao).toBe(
      'liberado',
    );
    expect((await um('SELECT situacao FROM pacote_esteril WHERE id = ?', [p3]))['situacao']).toBe('esteril');
    expect((await erro(porta.rastreio(ctx(P2), etiqueta))).status).toBe(404);
  });
});
