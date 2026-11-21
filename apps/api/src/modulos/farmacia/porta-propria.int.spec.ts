// Integração da porta própria da farmácia contra o MariaDB real (cliente f22_o2). Massa SINTÉTICA com o código
// "L0206F" (nenhuma pessoa real): uma unidade de internação, a farmácia central e o almoxarifado, um controlado da
// lista A1 com dois lotes (um vencido) e saldo, e uma avaliação farmacêutica com uma intervenção aceita e outra
// aberta para o prescritor vinculado, três itens prescritos e um farmacêutico com vínculo. Confere as leituras
// (estabelecimento da sessão, excluídos, validade e saldo), o contrato de efeito da triagem, da decisão, da intervenção
// e da resposta (linhas, versao, trilha e outbox; recusas de item avaliado, de outro estabelecimento, do autor e de
// quem não é o prescritor) e as recusas das gravações que esperam o modelo ('modelo-pendente', sem gravar nada).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type ContextoNucleo, type ContextoOperacao, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaFarmaciaPropria } from './porta-propria.js';

const CLIENTE = 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0206F';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));

describe.skipIf(SEM_BANCO)('porta própria da farmácia (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaFarmaciaPropria;
  const ids = {
    est: 0,
    outroEst: 0,
    usuario: 0,
    farmacia: 0,
    almox: 0,
    insumo: 0,
    loteBom: 0,
    atendimento: 0,
    prescricao: 0,
    avaliacao: 0,
    profissional: 0,
    farmaceutico: 0,
    usuarioFarma: 0,
    itens: [] as number[],
    intervencoes: [] as number[],
  };
  let ctx: ContextoNucleo;
  /** O farmacêutico (outro usuário: quem intervém não responde). */
  let ctxF: ContextoNucleo;

  const limpar = (e: Escritor) =>
    (async () => {
      await e.executar('DELETE FROM idempotencia_operacao WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM integracao_mensagem WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM trilha_auditoria WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar(
        'DELETE iv FROM intervencao_farmaceutica iv JOIN avaliacao_farmaceutica a ON a.id = iv.avaliacao_farmaceutica_id WHERE a.estabelecimento_id = ?',
        [ids.est],
      );
      await e.executar(
        'DELETE ai FROM avaliacao_farmaceutica_item ai JOIN avaliacao_farmaceutica a ON a.id = ai.avaliacao_farmaceutica_id WHERE a.estabelecimento_id = ?',
        [ids.est],
      );
      await e.executar('DELETE FROM avaliacao_farmaceutica WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar(
        'DELETE pi FROM prescricao_item pi JOIN prescricao p ON p.id = pi.prescricao_id WHERE p.estabelecimento_id = ?',
        [ids.est],
      );
      await e.executar('DELETE FROM prescricao WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM usuario_vinculo_profissional WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM saldo_lote WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM saldo_estoque WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM lote_insumo WHERE estabelecimento_id = ?', [ids.est]);
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe('cliente_f22_o2');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-06-far' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
        );
      ids.est = await est(P);
      ids.outroEst = await est(`${P}B`);
      await limpar(e);
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['l0206f.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['l0206f.teste', 'USUARIO SINTETICO L0206F', agora],
      );
      const ua = await garantir(
        e,
        'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-UA`],
        "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, ?, ?, 'internacao', ?)",
        [ids.est, `${P}-UA`, 'UTI SINTETICA', agora],
      );
      await garantir(
        e,
        'SELECT id FROM unidade_internacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, 'UTI-SINT'],
        "INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, criado_em) VALUES (?, ?, ?, ?, 'uti_adulto', ?)",
        [ids.est, ua, 'UTI-SINT', 'UTI SINTETICA L0206F', agora],
      );
      const local = (codigo: string, tipo: string) =>
        garantir(
          e,
          'SELECT id FROM local_estoque WHERE estabelecimento_id = ? AND codigo = ?',
          [ids.est, codigo],
          'INSERT INTO local_estoque (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, ?, ?)',
          [ids.est, codigo, `LOCAL ${codigo} SINTETICO`, tipo, agora],
        );
      ids.farmacia = await local(`${P}-FC`, 'farmacia_central');
      ids.almox = await local(`${P}-AL`, 'almoxarifado');
      const grupo = await garantir(
        e,
        'SELECT id FROM grupo_insumo WHERE codigo = ?',
        [`${P}-MED`],
        "INSERT INTO grupo_insumo (codigo, descricao, natureza, criado_em) VALUES (?, 'MEDICAMENTOS L0206F', 'medicamento', ?)",
        [`${P}-MED`, agora],
      );
      const um = await garantir(
        e,
        'SELECT id FROM unidade_medida WHERE codigo = ?',
        [`${P}-AMP`],
        "INSERT INTO unidade_medida (codigo, descricao, sigla, criado_em) VALUES (?, 'AMPOLA L0206F', ?, ?)",
        [`${P}-AMP`, 'AMPF6', agora],
      );
      const listaA1 = await garantir(
        e,
        "SELECT id FROM lista_controle_especial WHERE codigo_lista = 'A1'",
        [],
        "INSERT INTO lista_controle_especial (codigo_lista, descricao, vigencia_inicio, versao_fonte, criado_em) VALUES ('A1', 'ENTORPECENTES', '2020-01-01', 'teste', ?)",
        [agora],
      );
      ids.insumo = await garantir(
        e,
        'SELECT id FROM insumo WHERE codigo = ?',
        [`${P}-MORF`],
        `INSERT INTO insumo (codigo, nome, tipo, grupo_insumo_id, estoque_unidade_medida_id, lista_controle_especial_id,
           controla_lote, controla_validade, controlado, codigo_gtin, criado_em)
         VALUES (?, 'MORFINA SINTETICA L0206F', 'medicamento', ?, ?, ?, TRUE, TRUE, TRUE, '7890000020601', ?)`,
        [`${P}-MORF`, grupo, um, listaA1, agora],
      );
      const lote = (numero: string, validade: string) =>
        e.inserir(
          'INSERT INTO lote_insumo (estabelecimento_id, insumo_id, numero_lote, validade, criado_em) VALUES (?, ?, ?, ?, ?)',
          [ids.est, ids.insumo, numero, validade, agora],
        );
      ids.loteBom = await lote('MF-BOM', '2099-12-31');
      const loteVencido = await lote('MF-VENC', '2020-01-31');
      for (const [l, q] of [
        [ids.loteBom, 30],
        [loteVencido, 5],
      ] as const)
        await e.inserir(
          `INSERT INTO saldo_lote (estabelecimento_id, local_estoque_id, lote_insumo_id, quantidade, competencia, criado_em)
           VALUES (?, ?, ?, ?, '2026-11-01', ?)`,
          [ids.est, ids.farmacia, l, q, agora],
        );
      await e.inserir(
        'INSERT INTO saldo_estoque (estabelecimento_id, local_estoque_id, insumo_id, quantidade, criado_em) VALUES (?, ?, ?, 35, ?)',
        [ids.est, ids.farmacia, ids.insumo, agora],
      );
      // Atendimento, prescrição e a avaliação com duas intervenções (uma aceita, outra aberta para o prescritor).
      const tiss = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['L7'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('L7', 'CARATER L0206F', 'teste', ?)",
        [agora],
      );
      const catAt = await garantir(
        e,
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        [`${P}-INT`],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, 'INTERNACAO L0206F', 'internacao', ?)",
        [`${P}-INT`, agora],
      );
      const fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}-OP`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, 'OPERADORA L0206F', 'operadora', 'ativa', ?)",
        [`${P}-OP`, agora],
      );
      const pessoa = (nome: string) =>
        garantir(e, 'SELECT id FROM pessoa_fisica WHERE nome = ?', [nome], 'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [nome, agora]);
      const pp = await pessoa(`PACIENTE SINTETICO ${P}`);
      const pm = await pessoa(`MEDICO SINTETICO ${P}`);
      const paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
        [pp, 920_206_201, agora],
      );
      ids.profissional = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pm],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pm, agora],
      );
      await e.inserir(
        `INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, '2026-01-01', ?)`,
        [ids.usuario, ids.est, ids.profissional, agora],
      );
      const entrada = new Date('2026-11-20T09:00:00Z');
      ids.atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ids.est, `${P}-AT1`, paciente, catAt, tiss, fonte, ids.profissional, entrada, agora],
      );
      ids.prescricao = await e.inserir(
        `INSERT INTO prescricao (estabelecimento_id, numero, paciente_id, atendimento_id, prescritor_profissional_id,
           situacao, prescrito_em, vigencia_inicio_em, vigencia_fim_em, criado_em)
         VALUES (?, ?, ?, ?, ?, 'vigente', ?, ?, ?, ?)`,
        [ids.est, 920_206_301, paciente, ids.atendimento, ids.profissional, entrada, entrada,
          new Date('2026-11-21T09:00:00Z'), agora],
      );
      // O farmacêutico: outro usuário, com vínculo a outro profissional.
      const pf = await pessoa(`FARMACEUTICO SINTETICO ${P}`);
      ids.farmaceutico = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pf, agora],
      );
      ids.usuarioFarma = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['l0206f.farma'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['l0206f.farma', 'FARMACEUTICO SINTETICO L0206F', agora],
      );
      await e.inserir(
        `INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, '2026-01-01', ?)`,
        [ids.usuarioFarma, ids.est, ids.farmaceutico, agora],
      );
      // Três itens prescritos: dois vigentes e um cancelado (o cancelado não segura a conclusão da avaliação).
      const tipoItem = await garantir(
        e,
        'SELECT id FROM tipo_item_prescricao WHERE codigo = ?',
        [`${P}-MED`],
        "INSERT INTO tipo_item_prescricao (codigo, descricao, categoria, criado_em) VALUES (?, 'MEDICAMENTO L0206F', 'medicamento', ?)",
        [`${P}-MED`, agora],
      );
      for (const [seq, situacao] of [
        [1, 'ativo'],
        [2, 'ativo'],
        [3, 'cancelado'],
      ] as const)
        ids.itens.push(
          await e.inserir(
            `INSERT INTO prescricao_item (prescricao_id, sequencia, tipo_item_prescricao_id, inicio_em,
               lancamento_profissional_id, situacao, criado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [ids.prescricao, seq, tipoItem, entrada, ids.profissional, situacao, agora],
          ),
        );
      ids.avaliacao = await e.inserir(
        `INSERT INTO avaliacao_farmaceutica (estabelecimento_id, prescricao_id, atendimento_id, paciente_id, recebida_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [ids.est, ids.prescricao, ids.atendimento, paciente, entrada, agora],
      );
      const tipo = await garantir(
        e,
        'SELECT id FROM tipo_intervencao_farmaceutica WHERE codigo = ?',
        [`${P}-DOSE`],
        "INSERT INTO tipo_intervencao_farmaceutica (codigo, descricao, categoria, criado_em) VALUES (?, 'AJUSTE DE DOSE L0206F', 'dose', ?)",
        [`${P}-DOSE`, agora],
      );
      for (const [seq, aceite] of [
        [1, 'aceita'],
        [2, 'pendente'],
      ] as const)
        ids.intervencoes.push(
          await e.inserir(
            `INSERT INTO intervencao_farmaceutica (avaliacao_farmaceutica_id, sequencia, tipo_intervencao_farmaceutica_id,
               farmaceutico_profissional_id, realizada_em, proposta, prescritor_profissional_id, aceite, aceite_em,
               criado_em, criado_por)
             VALUES (?, ?, ?, ?, ?, 'Reduzir a dose (texto sintético)', ?, ?, ?, ?, ?)`,
            [ids.avaliacao, seq, tipo, ids.profissional, entrada, ids.profissional, aceite,
              aceite === 'aceita' ? entrada : null, agora, ids.usuario],
          ),
        );
    });
    ctx = { cliente: CLIENTE, estabelecimento: ids.est, usuario: ids.usuario, correlacao: 'teste-02-06-far' };
    ctxF = { ...ctx, usuario: ids.usuarioFarma };
    porta = new PortaFarmaciaPropria(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-02-06-far' }, limpar);
    await nucleo.encerrar();
  });

  it('unidades, locais que dispensam, lotes válidos com saldo, cadastro do item e controlados', async () => {
    expect((await porta.unidades(ctx)).find((u) => u.unidade === 'UTI-SINT')).toMatchObject({ internados: 0 });
    const locais = await porta.locais(ctx);
    expect(locais.map((l) => l.codigo)).toContain(ids.farmacia);
    expect(locais.map((l) => l.codigo)).not.toContain(ids.almox);
    // O lote vencido não é oferecido; o local de outro estabelecimento não vê nada.
    expect(await porta.lotes(ctx, ids.insumo, ids.farmacia)).toEqual([
      { id: ids.loteBom, lote: 'MF-BOM', validade: '2099-12-31', quantidade: 30 },
    ]);
    expect(await porta.lotes({ ...ctx, estabelecimento: ids.outroEst }, ids.insumo, ids.farmacia)).toEqual([]);
    const itens = await porta.itens(ctx, [ids.insumo, 0]);
    expect(itens.get(ids.insumo)).toEqual({
      codigo: ids.insumo,
      rastreavel: true,
      portaria: 'A1',
      psico: true,
      antimicrobiano: false,
      barras: '7890000020601',
      envioAvaliacao: null,
    });
    expect((await porta.controlados(ctx)).find((x) => x.item === ids.insumo)).toEqual({
      item: ids.insumo,
      nome: 'MORFINA SINTETICA L0206F',
      portaria: 'A1',
      estoque: 35,
    });
  });

  it('intervenções da avaliação: a aceita, a aberta para o prescritor vinculado e os totais', async () => {
    const [aceita, aberta] = ids.intervencoes as [number, number];
    expect(await porta.intervencao(ctx, aceita)).toMatchObject({
      id: aceita,
      avaliacao: ids.avaliacao,
      tipo: `${P}-DOSE`,
      estado: 'respondida',
      resposta: 'aceita',
      autor: 'l0206f.teste',
      prescritor: 'l0206f.teste',
      atendimento: ids.atendimento,
    });
    expect((await porta.intervencoesDoPrescritor(ctx, 'l0206f.teste')).map((x) => x.id)).toEqual([aberta]);
    expect(await porta.intervencoesDoPrescritor(ctx, 'outro.login')).toEqual([]);
    expect(await porta.intervencao({ ...ctx, estabelecimento: ids.outroEst }, aceita)).toBeNull();
    expect(await porta.totaisIntervencoes(ctx, new Date('2026-11-01T00:00:00Z'))).toEqual({
      abertas: 1,
      aceitas: 1,
      recusadas: 0,
    });
  });

  const ler = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-02-06-far' }, (l) => l.uma<Record<string, unknown>>(sql, p));
  const contar = async (sql: string, p: unknown[]) => Number((await ler(sql, p))?.['n']);
  const trilhaDe = (entidade: string, id: number) =>
    contar('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ? AND estabelecimento_id = ?', [
      entidade,
      id,
      ids.est,
    ]);
  const outbox = (ponto: string) =>
    contar('SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = ? AND estabelecimento_id = ?', [ponto, ids.est]);

  it('triagem e decisão: parecer por item, cabeçalho em avaliação e concluído, trilha, outbox e recusas', async () => {
    const [item1, item2, item3] = ids.itens as [number, number, number];
    const triagem = (item: number, destino: 'automatica' | 'humana') => ({
      item,
      horario: null,
      classe: 'comum' as const,
      destino,
      prioridade: 0,
      achados: [],
      regra: 'baixo-risco',
    });
    const t = await porta.gravarSgh(ctxF, null, (g) =>
      g.triar({ itens: [triagem(item1, 'automatica'), triagem(item2, 'humana')] }),
    );
    // O automático ganha o parecer; o humano fica na avaliação que já estava pendente (não é novo).
    expect(t).toEqual({ novos: 1 });
    expect(
      await ler('SELECT parecer, liberador_profissional_id, versao FROM avaliacao_farmaceutica_item WHERE prescricao_item_id = ?', [item1]),
    ).toMatchObject({ parecer: 'aprovado', versao: 1 });
    expect(await ler('SELECT situacao, versao FROM avaliacao_farmaceutica WHERE id = ?', [ids.avaliacao])).toMatchObject({
      situacao: 'em_avaliacao',
      versao: 2,
    });
    expect(await trilhaDe('avaliacao_farmaceutica', ids.avaliacao)).toBe(1);
    expect(await outbox('farmacia.avaliacao.triada')).toBe(1);
    // Repetir a triagem não grava de novo.
    expect(await porta.gravarSgh(ctxF, null, (g) => g.triar({ itens: [triagem(item1, 'automatica')] }))).toEqual({
      novos: 0,
    });
    const decidir = (c: ContextoNucleo, item: number, decisao: 'valido' | 'nao-aprovado' | 'pendencia-revisao-medica') =>
      porta.gravarSgh(c, null, (g) =>
        g.decidir({
          item,
          decisao,
          justificativa: 'Dose acima do teto do cadastro (texto sintético)',
          farmaceutico: 'l0206f.farma',
          triagem: triagem(item, 'humana'),
        }),
      );
    // A pendência de revisão médica espera o modelo: nada é gravado.
    expect(codigoDe(await decidir(ctxF, item3, 'pendencia-revisao-medica').catch((e: unknown) => e))).toBe('modelo-pendente');
    expect(await contar('SELECT COUNT(*) AS n FROM avaliacao_farmaceutica_item WHERE prescricao_item_id = ?', [item3])).toBe(0);
    const d = await decidir(ctxF, item2, 'nao-aprovado');
    const linha = await ler(
      'SELECT id, parecer, justificativa, liberador_profissional_id, versao FROM avaliacao_farmaceutica_item WHERE prescricao_item_id = ?',
      [item2],
    );
    expect(Number(linha?.['id'])).toBe(d.id);
    expect(linha).toMatchObject({ parecer: 'recusado', versao: 1 });
    expect(Number(linha?.['liberador_profissional_id'])).toBe(ids.farmaceutico);
    // Todos os itens vigentes com parecer: a avaliação conclui reprovada, com o farmacêutico.
    const cab = await ler(
      'SELECT situacao, versao, farmaceutico_profissional_id, concluida_em FROM avaliacao_farmaceutica WHERE id = ?',
      [ids.avaliacao],
    );
    expect(cab).toMatchObject({ situacao: 'reprovada', versao: 3 });
    expect(Number(cab?.['farmaceutico_profissional_id'])).toBe(ids.farmaceutico);
    expect(cab?.['concluida_em']).not.toBeNull();
    expect(await trilhaDe('avaliacao_farmaceutica_item', d.id)).toBe(1);
    expect(await outbox('farmacia.avaliacao.decidida')).toBe(1);
    // A leitura vê a decisão; recusas: item já avaliado, outro estabelecimento.
    expect((await porta.avaliacoes(ctx, [item2])).get(item2)).toMatchObject({ estado: 'decidido', decisao: 'nao-aprovado' });
    expect(codigoDe(await decidir(ctxF, item2, 'valido').catch((e: unknown) => e))).toBe('ja-avaliado');
    expect(
      codigoDe(await decidir({ ...ctxF, estabelecimento: ids.outroEst }, item1, 'valido').catch((e: unknown) => e)),
    ).toBe('item-inexistente');
  });

  it('intervenção e resposta: linha, versao, trilha, outbox e as recusas', async () => {
    const [item1] = ids.itens as [number];
    const r = await porta.gravarSgh(ctxF, null, (g) =>
      g.intervir({ item: item1, tipo: 'ajuste-dose', texto: 'Reduzir a dose (texto sintético)', autor: 'l0206f.farma' }),
    );
    expect(r.prescritor).toBe('l0206f.teste');
    const iv = await ler(
      `SELECT iv.sequencia, iv.aceite, iv.versao, iv.farmaceutico_profissional_id, iv.prescritor_profissional_id, ti.categoria
         FROM intervencao_farmaceutica iv JOIN tipo_intervencao_farmaceutica ti ON ti.id = iv.tipo_intervencao_farmaceutica_id
        WHERE iv.id = ?`,
      [r.id],
    );
    expect(iv).toMatchObject({ sequencia: 3, aceite: 'pendente', versao: 1, categoria: 'dose' });
    expect(Number(iv?.['farmaceutico_profissional_id'])).toBe(ids.farmaceutico);
    expect(Number(iv?.['prescritor_profissional_id'])).toBe(ids.profissional);
    expect(await trilhaDe('intervencao_farmaceutica', r.id)).toBe(1);
    expect(await outbox('farmacia.intervencao.registrada')).toBe(1);
    expect(
      codigoDe(
        await porta
          .gravarSgh({ ...ctxF, estabelecimento: ids.outroEst }, null, (g) =>
            g.intervir({ item: item1, tipo: 'outra', texto: 'x', autor: 'l0206f.farma' }),
          )
          .catch((e: unknown) => e),
      ),
    ).toBe('item-inexistente');
    const responder = (c: ContextoNucleo, respondente: string, justificativa: string, id = r.id) =>
      porta
        .gravarSgh(c, null, (g) => g.responder({ id, resposta: 'recusada', justificativa, respondente }))
        .catch((e: unknown) => e);
    expect(codigoDe(await responder(ctxF, 'l0206f.farma', 'Mantida a dose do protocolo'))).toBe('nao-e-o-prescritor');
    expect(codigoDe(await responder(ctx, 'l0206f.teste', 'curta'))).toBe('sem-justificativa');
    expect(codigoDe(await responder({ ...ctx, estabelecimento: ids.outroEst }, 'l0206f.teste', 'Mantida a dose do protocolo'))).toBe(
      'intervencao-inexistente',
    );
    expect(await responder(ctx, 'l0206f.teste', 'Mantida a dose do protocolo')).toBeUndefined();
    expect(
      await ler('SELECT aceite, versao, justificativa_recusa, aceite_em FROM intervencao_farmaceutica WHERE id = ?', [r.id]),
    ).toMatchObject({ aceite: 'recusada', versao: 2, justificativa_recusa: 'Mantida a dose do protocolo' });
    expect(await trilhaDe('intervencao_farmaceutica', r.id)).toBe(2);
    expect(await outbox('farmacia.intervencao.respondida')).toBe(1);
    expect(await porta.intervencao(ctx, r.id)).toMatchObject({
      estado: 'respondida',
      resposta: 'recusada',
      autor: 'l0206f.farma',
      respondente: 'l0206f.teste',
    });
    // Já respondida: recusa; quem fez a intervenção (aberta, semeada pelo próprio prescritor) não a responde.
    expect(codigoDe(await responder(ctx, 'l0206f.teste', 'Mantida a dose do protocolo'))).toBe('intervencao-respondida');
    expect(codigoDe(await responder(ctx, 'l0206f.teste', 'Mantida a dose do protocolo', ids.intervencoes[1]))).toBe(
      'resposta-do-autor',
    );
  });

  it('gravações: entrada inválida recusada antes; as que esperam o modelo recusam sem gravar', async () => {
    const opCtx: ContextoOperacao = { ...ctx, chaveIdempotencia: 'teste-02-06-far-1' };
    expect(codigoDe(await porta.executar(ctx, 'suprimentos.devolverDose', {}, opCtx).catch((e: unknown) => e))).toBe(
      'entrada-invalida',
    );
    expect(codigoDe(await porta.executar(ctx, 'suprimentos.inexistente', {}, opCtx).catch((e: unknown) => e))).toBe(
      'operacao-desconhecida',
    );
    expect((await porta.podeGravar(ctx, 'suprimentos.dispensarHorario')).codigo).toBe('modelo-pendente');
    const antes = await contar('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?', [ids.est]);
    const r = await porta
      .gravarSgh(ctxF, null, (g) => g.escriturarSngpc({ inicio: '2026-11-01', fim: '2026-11-30', autor: 'l0206f.farma' }))
      .catch((e: unknown) => e);
    expect(codigoDe(r)).toBe('modelo-pendente');
    expect(await contar('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?', [ids.est])).toBe(antes);
  });
});
