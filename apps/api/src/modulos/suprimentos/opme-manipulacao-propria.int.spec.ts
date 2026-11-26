// Integração das gravações do OPME e da manipulação na porta própria contra o MariaDB real (cliente de teste do lote;
// massa SINTÉTICA, nenhuma pessoa real): contrato de efeito da solicitação e das etapas, do consumo em sala ligado ao
// movimento da saída, da devolução, da abertura, da conferência e da baixa da ordem de manipulação; recusas e
// isolamento por estabelecimento. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, garantirSequencia, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { PortaManipulacaoPropria } from './manipulacao-porta-propria.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  inserirMinimo,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from './massa-propria.spec-util.js';
import { PortaOpmePropria } from './opme-porta-propria.js';

const RODADA = Date.now().toString(36);
let k = 0;
const chave = () => `f24sf-${RODADA}-${++k}`;
const ESTS = "SELECT id FROM estabelecimento WHERE codigo LIKE 'F22L0314%'";

/** Apaga o que este arquivo grava (antes da massa comum, que apaga o resto). */
async function limparOpme(e: Escritor): Promise<void> {
  for (const sql of [
    `DELETE FROM conferencia_manipulacao WHERE ordem_manipulacao_id IN (SELECT id FROM ordem_manipulacao WHERE estabelecimento_id IN (${ESTS}))`,
    `DELETE FROM ordem_manipulacao_insumo WHERE ordem_manipulacao_id IN (SELECT id FROM ordem_manipulacao WHERE estabelecimento_id IN (${ESTS}))`,
    `DELETE FROM ordem_manipulacao WHERE estabelecimento_id IN (${ESTS})`,
    `DELETE FROM etapa_solicitacao_opme WHERE estabelecimento_id IN (${ESTS})`,
    `DELETE FROM recebimento_material_terceiro WHERE estabelecimento_id IN (${ESTS})`,
    `DELETE ri FROM remessa_consignada_item ri JOIN remessa_consignada r ON r.id = ri.remessa_consignada_id WHERE r.estabelecimento_id IN (${ESTS})`,
    `DELETE FROM remessa_consignada WHERE estabelecimento_id IN (${ESTS})`,
    `DELETE FROM nota_entrada WHERE estabelecimento_id IN (${ESTS}) AND numero >= 970000`,
    `DELETE FROM pedido_compra WHERE estabelecimento_id IN (${ESTS}) AND numero >= 970000`,
    `DELETE FROM setor_funcional WHERE estabelecimento_id IN (${ESTS}) AND codigo LIKE '%-CMEOPME'`,
    `DELETE FROM consumo_opme WHERE estabelecimento_id IN (${ESTS})`,
    `DELETE FROM autorizacao_opme WHERE estabelecimento_id IN (${ESTS})`,
    `DELETE FROM solicitacao_opme_item WHERE solicitacao_opme_id IN (SELECT id FROM solicitacao_opme WHERE estabelecimento_id IN (${ESTS}))`,
    `DELETE FROM solicitacao_opme WHERE estabelecimento_id IN (${ESTS})`,
    `DELETE FROM agendamento_cirurgico WHERE estabelecimento_id IN (${ESTS})`,
  ])
    await e.executar(sql, []);
}

/** O cadastro do paciente e da cirurgia: depois da massa comum, que apaga os documentos que apontam o atendimento. */
async function limparAtendimento(e: Escritor): Promise<void> {
  for (const sql of [
    `DELETE FROM avaliacao_farmaceutica_item WHERE avaliacao_farmaceutica_id IN (SELECT id FROM avaliacao_farmaceutica WHERE estabelecimento_id IN (${ESTS}))`,
    `DELETE FROM avaliacao_farmaceutica WHERE estabelecimento_id IN (${ESTS})`,
    `DELETE pi FROM prescricao_item pi JOIN prescricao p ON p.id = pi.prescricao_id WHERE p.estabelecimento_id IN (${ESTS})`,
    `DELETE FROM prescricao WHERE estabelecimento_id IN (${ESTS})`,
    `DELETE FROM atendimento WHERE estabelecimento_id IN (${ESTS})`,
    `DELETE FROM usuario_vinculo_profissional WHERE estabelecimento_id IN (${ESTS})`,
    `DELETE FROM profissional WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome LIKE '%SINTETICO F24SF')`,
    `DELETE FROM paciente WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome LIKE '%SINTETICO F24SF')`,
    `DELETE FROM pessoa_fisica WHERE nome LIKE '%SINTETICO F24SF'`,
  ])
    await e.executar(sql, []);
}

describe.skipIf(SEM_BANCO)('gravações do OPME e da manipulação na porta própria (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let m: MassaSuprimentos;
  let opme: PortaOpmePropria;
  let manip: PortaManipulacaoPropria;
  const ids: Record<string, number> = {};
  const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-f24sf' }, (l) => l.consultar<T>(sql, p));
  const trilha = (entidade: string) =>
    ({
      estabelecimento: null,
      usuario: null,
      acao: 'operacao',
      entidade,
      entidadeId: null,
      dadosDepois: { evento: 'teste' },
      correlacao: null,
    }) as unknown as TrilhaDaGravacao;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f24sf-limpa' }, limparOpme);
    await limparMassa(nucleo, null);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f24sf-limpa' }, limparAtendimento);
    m = await montarMassa(nucleo);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f24sf-massa' }, async (e) => {
      const x = (t: string, v: Record<string, unknown>) => inserirMinimo(e, t, v, m.marca);
      const pessoa = (nome: string) => x('pessoa_fisica', { nome });
      ids.paciente = await x('paciente', {
        pessoa_fisica_id: await pessoa('PACIENTE SINTETICO F24SF'),
        numero_prontuario: 925_000_000 + (Date.now() % 900_000),
      });
      ids.medico = await x('profissional', {
        pessoa_fisica_id: await pessoa('MEDICO SINTETICO F24SF'),
        tipo: 'corpo_clinico',
      });
      ids.farma2 = await x('profissional', {
        pessoa_fisica_id: await pessoa('FARMA SINTETICO F24SF'),
        tipo: 'corpo_clinico',
      });
      const fonte = await x('fonte_pagadora', {
        codigo: `${m.marca}OP`,
        tipo: 'operadora',
        situacao: 'ativa',
      });
      const cat = await x('categoria_atendimento', { codigo: `${m.marca}CA`, tipo_base: 'internacao' });
      const tiss = await x('carater_atendimento_tiss', { codigo_tiss: `${m.marca}`.slice(-2) });
      ids.atendimento = await x('atendimento', {
        estabelecimento_id: m.estA,
        paciente_id: ids.paciente,
        categoria_atendimento_id: cat,
        carater_atendimento_tiss_id: tiss,
        fonte_pagadora_id: fonte,
        profissional_id: ids.medico,
      });
      ids.agenda = await x('agendamento_cirurgico', {
        estabelecimento_id: m.estA,
        paciente_id: ids.paciente,
        atendimento_id: ids.atendimento,
        cirurgiao_profissional_id: ids.medico,
        fonte_pagadora_id: fonte,
        carater_cirurgia_id: await x('carater_cirurgia', { codigo: `${m.marca}CC` }),
        inicio_previsto_em: '2026-11-20 08:00:00',
      });
      ids.fabricante = await x('fabricante', { nome: `FABRICANTE ${m.marca}`, ativo: true });
      await e.executar(
        'UPDATE saldo_estoque SET quantidade = 5, custo_medio = 100 WHERE local_estoque_id = ? AND insumo_id = ?',
        [m.localA2, m.insumoOpme],
      );
      for (const tipo of ['solicitacao_opme', 'ordem_manipulacao'])
        await garantirSequencia(e, { tipo, estabelecimento: m.estA }, { usuario: null, agora: new Date() });
      await e.inserir(
        `INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, '2026-01-01', NOW(3)), (?, ?, ?, '2026-01-01', NOW(3))`,
        [m.usuario, m.estA, ids.medico, m.usuario2, m.estA, ids.farma2],
      );
      const presc = (ids.prescricao = await x('prescricao', {
        estabelecimento_id: m.estA,
        paciente_id: ids.paciente,
        atendimento_id: ids.atendimento,
        prescritor_profissional_id: ids.medico,
        situacao: 'vigente',
        vigencia_inicio_em: new Date(Date.now() - 3_600_000),
        vigencia_fim_em: new Date(Date.now() + 82_800_000),
      }));
      ids.itemPrescrito = await x('prescricao_item', {
        prescricao_id: presc,
        sequencia: 1,
        tipo_item_prescricao_id: await x('tipo_item_prescricao', {
          codigo: `${m.marca}TI`,
          categoria: 'medicamento',
        }),
        lancamento_profissional_id: ids.medico,
      });
    });
    opme = new PortaOpmePropria(nucleo);
    manip = new PortaManipulacaoPropria(nucleo);
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f24sf-limpa' }, limparOpme);
    await limparMassa(nucleo, m);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f24sf-limpa' }, limparAtendimento);
    await nucleo.encerrar();
  });

  it('OPME: solicitação, autorização, consumo em sala ligado ao movimento e devolução', async () => {
    const c = contexto(m);
    const ch = chave();
    const nova = {
      agendamento: ids.agenda!,
      sala: 1,
      dataHora: '2026-11-20T08:00',
      reg: ids.atendimento!,
      paciente: ids.paciente!,
      item: m.insumoOpme,
      tuss: '70000001',
      quantidade: 2,
      fornecedor: m.fornecedor,
      justificativa: 'Implante sintetico para teste de integracao.',
      consignado: true,
      em: '2026-11-19T10:00',
      usuario: 'x',
      chave: ch,
    };
    const s = await opme.gravarSgh(c, trilha('solicitacao_opme'), (g) => g.solicitar(nova));
    expect(s.repetida).toBe(false);
    // A repetição pela chave devolve a mesma solicitação, sem gravar outra.
    expect(await opme.gravarSgh(c, trilha('solicitacao_opme'), (g) => g.solicitar(nova))).toMatchObject({
      id: s.id,
      repetida: true,
    });
    // A mesma chave com outro pedido, de outro usuário ou de outro estabelecimento: idempotência divergente.
    expect(
      await codigoDe(
        opme.gravarSgh(c, trilha('solicitacao_opme'), (g) => g.solicitar({ ...nova, quantidade: 3 })),
      ),
    ).toBe('idempotencia-divergente');
    expect(
      await codigoDe(
        opme.gravarSgh({ ...c, usuario: m.usuario2 }, trilha('solicitacao_opme'), (g) => g.solicitar(nova)),
      ),
    ).toBe('idempotencia-divergente');
    expect(
      await codigoDe(
        opme.gravarSgh(contexto(m, m.estB), trilha('solicitacao_opme'), (g) => g.solicitar(nova)),
      ),
    ).toBe('idempotencia-divergente');
    const lida = await opme.solicitacao(c, s.id);
    expect(lida).toMatchObject({
      situacao: 'solicitada',
      quantidade: 2,
      tuss: '70000001',
      fornecedor: m.fornecedor,
    });
    expect(lida!.etapas.map((e) => e.etapa)).toEqual(['solicitacao']);
    expect(await opme.solicitacao(contexto(m, m.estB), s.id)).toBeNull();
    // A nota fiscal sem a chave da nota: recusa com o motivo, nada gravado.
    expect(
      await codigoDe(
        opme.gravarSgh(c, trilha('solicitacao_opme'), (g) =>
          g.avancar({
            solicitacao: s.id,
            versaoVista: 1,
            etapa: 'nf',
            em: '2026-11-19T11:00',
            usuario: 'x',
            chave: chave(),
            mudanca: { situacao: 'faturada' },
          }),
        ),
      ),
    ).toBe('sem-nf');
    const pedidoAut = {
      solicitacao: s.id,
      etapa: 'autorizacao' as const,
      em: '2026-11-19T12:00',
      quantidade: 2,
      senha: 'SENHA1',
      guia: 'G123',
      validade: '2026-12-31',
    };
    const chAut = chave();
    const etapaAut = await opme.gravarSgh(c, trilha('autorizacao_opme'), (g) =>
      g.avancar({
        ...pedidoAut,
        versaoVista: lida!.versao,
        usuario: 'x',
        chave: chAut,
        mudanca: {
          situacao: 'autorizada',
          autorizada: 2,
          senha: 'SENHA1',
          guia: 'G123',
          validade: '2026-12-31',
        },
      }),
    );
    // O reenvio da etapa pela chave: o mesmo pedido devolve a etapa; outro pedido ou outro estabelecimento recusa.
    expect(
      await opme.gravarSgh(c, trilha('autorizacao_opme'), (g) => g.etapaPelaChave(chAut, pedidoAut)),
    ).toMatchObject({ id: etapaAut.etapa, solicitacao: s.id });
    expect(
      await codigoDe(
        opme.gravarSgh(c, trilha('autorizacao_opme'), (g) =>
          g.etapaPelaChave(chAut, { ...pedidoAut, senha: 'OUTRA' }),
        ),
      ),
    ).toBe('idempotencia-divergente');
    expect(
      await codigoDe(
        opme.gravarSgh(contexto(m, m.estB), trilha('autorizacao_opme'), (g) =>
          g.etapaPelaChave(chAut, pedidoAut),
        ),
      ),
    ).toBe('idempotencia-divergente');
    const aut = await opme.solicitacao(c, s.id);
    expect(aut).toMatchObject({
      situacao: 'autorizada',
      autorizada: 2,
      senha: 'SENHA1',
      guia: 'G123',
      validadeSenha: '2026-12-31',
    });
    // Versão vista antiga: recusa.
    expect(
      await codigoDe(
        opme.gravarSgh(c, trilha('solicitacao_opme'), (g) =>
          g.avancar({
            solicitacao: s.id,
            versaoVista: lida!.versao,
            etapa: 'cancelamento',
            em: '2026-11-19T13:00',
            usuario: 'x',
            chave: chave(),
            mudanca: { situacao: 'cancelada' },
          }),
        ),
      ),
    ).toBe('opme-mudou');

    const chConsumo = chave();
    const saida = {
      destino: 1,
      origem: 'E',
      local: m.localA2,
      centroCusto: m.centroCusto,
      localConsumo: 1,
      atendimento: ids.atendimento,
      itens: [{ item: m.insumoOpme, quantidade: 1, lotes: [] }],
      opme: {
        agendamento: ids.agenda,
        sala: 1,
        dataHora: '2026-11-20T08:00',
        paciente: ids.paciente,
        cirurgiao: ids.medico,
        solicitacao: s.id,
        versaoVista: aut!.versao,
        lote: 'LOTE-OPME-1',
        serie: 'SERIE-1',
        fabricante: `FABRICANTE ${m.marca}`,
        modelo: 'MODELO SINTETICO X1',
        registroAnvisa: '1234567890123',
        validade: '2027-12-31',
        codigoLido: null,
        consignado: false,
        fornecedor: m.fornecedor,
        semAutorizacao: null,
        chave: chConsumo,
      },
    };
    const r = await opme.executar(c, 'suprimentos.registrarSaida', saida, {
      ...c,
      chaveIdempotencia: chConsumo,
    });
    const consumo = await opme.consumoPelaChave(c, chConsumo);
    // O modelo do material fica no consumo (rastreio: fabricante, modelo, lote e série).
    const [mod] = await ler<{ modelo: unknown }>(
      'SELECT modelo FROM consumo_opme WHERE estabelecimento_id = ? ORDER BY id DESC LIMIT 1',
      [m.estA],
    );
    expect(mod!.modelo).toBe('MODELO SINTETICO X1');
    expect(consumo).toMatchObject({
      id: Number(r.resultado['consumo']),
      solicitacao: s.id,
      quantidade: 1,
      devolvida: 0,
      lote: 'LOTE-OPME-1',
      serie: 'SERIE-1',
      fabricante: `FABRICANTE ${m.marca}`,
      saida: { id: Number(r.resultado['id']) },
      paciente: ids.paciente,
    });
    const [mv] = await ler<{ q: unknown }>(
      'SELECT me.quantidade AS q FROM consumo_opme co JOIN movimento_estoque me ON me.id = co.movimento_estoque_id WHERE co.id = ?',
      [consumo!.id],
    );
    expect(Number(mv?.q)).toBe(1);
    expect((await opme.solicitacao(c, s.id))!.situacao).toBe('consumida');
    expect(await opme.localDaSaida(c, consumo!.saida)).toBe(m.localA2);
    expect(await opme.consumo(contexto(m, m.estB), consumo!.id)).toBeNull();
    const rast = await opme.rastreioReverso(c, {
      item: m.insumoOpme,
      lote: 'LOTE-OPME-1',
      serie: null,
      registroAnvisa: null,
    });
    expect(rast.expostos.map((x) => x.consumo)).toEqual([consumo!.id]);

    await opme.executar(
      c,
      'suprimentos.registrarDevolucao',
      {
        saida: consumo!.saida.id,
        local: m.localA2,
        itens: [{ lancamentoSaida: consumo!.lancamento, item: m.insumoOpme, quantidade: 1, lotes: [] }],
        opme: { consumo: consumo!.id, motivo: 'Material nao usado na cirurgia sintetica.', chave: null },
      },
      { ...c, chaveIdempotencia: chave() },
    );
    expect(await opme.consumo(c, consumo!.id)).toMatchObject({ devolvida: 1 });
    const [co] = await ler<{ situacao: unknown }>('SELECT situacao FROM consumo_opme WHERE id = ?', [
      consumo!.id,
    ]);
    expect(co?.situacao).toBe('devolvido');
    expect((await opme.solicitacao(c, s.id))!.situacao).toBe('devolvida');
    // Cirurgia de outro paciente na saída deste atendimento: recusa (o rastreio reverso e a conta dependem do vínculo).
    const agOutro = await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f24sf-massa' }, async (e) => {
      const x = (t: string, v: Record<string, unknown>) => inserirMinimo(e, t, v, m.marca);
      const pac = await x('paciente', {
        pessoa_fisica_id: await x('pessoa_fisica', { nome: 'OUTRO SINTETICO F24SF' }),
        numero_prontuario: 926_000_000 + (Date.now() % 900_000),
      });
      return x('agendamento_cirurgico', {
        estabelecimento_id: m.estA,
        numero: `AG2-${RODADA}`.slice(0, 20),
        paciente_id: pac,
        atendimento_id: null,
        cirurgiao_profissional_id: ids.medico,
        tipo_cobertura: 'particular',
        carater_cirurgia_id: await x('carater_cirurgia', { codigo: `${m.marca}C2` }),
        inicio_previsto_em: '2026-11-20 09:00:00',
      });
    });
    expect(
      await codigoDe(
        opme.executar(
          c,
          'suprimentos.registrarSaida',
          { ...saida, opme: { ...saida.opme, agendamento: agOutro, solicitacao: null, versaoVista: null } },
          { ...c, chaveIdempotencia: chave() },
        ),
      ),
    ).toBe('agendamento-de-outro-atendimento');
    // Fabricante fora do cadastro: recusa, nada gravado.
    const outra = {
      ...saida,
      opme: { ...saida.opme, solicitacao: null, versaoVista: null, fabricante: 'FABRICANTE DESCONHECIDO' },
    };
    expect(
      await codigoDe(
        opme.executar(c, 'suprimentos.registrarSaida', outra, { ...c, chaveIdempotencia: chave() }),
      ),
    ).toBe('fabricante-nao-cadastrado');
    expect(await opme.podeGravar(c, 'opme.desconhecida')).toMatchObject({ pode: false });
  });

  it('OPME (C3-021): pedido de compra, consignação, esterilização na CME e nota fiscal ligados aos documentos reais', async () => {
    const c = contexto(m);
    const num = 970_000 + (Date.now() % 20_000);
    const s = await opme.gravarSgh(c, trilha('solicitacao_opme'), (g) =>
      g.solicitar({
        agendamento: ids.agenda!,
        sala: 1,
        dataHora: '2026-11-21T08:00',
        reg: ids.atendimento!,
        paciente: ids.paciente!,
        item: m.insumoOpme,
        tuss: '70000002',
        quantidade: 1,
        fornecedor: m.fornecedor,
        justificativa: 'Implante sintetico das etapas logisticas.',
        consignado: true,
        em: '2026-11-20T09:00',
        usuario: 'x',
        chave: chave(),
      }),
    );
    let v = (await opme.solicitacao(c, s.id))!.versao;
    const avancar = (
      etapa: 'autorizacao' | 'pedido' | 'consignacao' | 'cme' | 'nf',
      x: Record<string, unknown>,
      situacao: string,
    ) =>
      opme.gravarSgh(c, trilha('etapa_solicitacao_opme'), (g) =>
        g.avancar({
          solicitacao: s.id,
          versaoVista: v,
          etapa,
          em: '2026-11-20T10:00',
          usuario: 'x',
          chave: chave(),
          ...x,
          mudanca: { situacao: situacao as 'autorizada' },
        } as never),
      );
    v = (
      await avancar(
        'autorizacao',
        { quantidade: 1, senha: 'S2', guia: 'G2', validade: '2026-12-31' },
        'autorizada',
      )
    ).versao;
    // Os documentos reais (massa sintética): pedido, remessa consignada com o material, a CME e a nota de entrada.
    const docs = await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f24sf-c3021' }, async (e) => {
      const x = (t: string, val: Record<string, unknown>) => inserirMinimo(e, t, val, m.marca);
      const tipoEntrada = await e.uma<{ id: unknown }>(
        'SELECT id FROM tipo_entrada_estoque ORDER BY id LIMIT 1',
        [],
      );
      const pedido = await x('pedido_compra', {
        estabelecimento_id: m.estA,
        centro_custo_id: m.centroCusto,
        empresa_fornecedora_id: m.fornecedor,
        ano: 2026,
        numero: num,
        data_pedido: '2026-11-20',
      });
      const remessa = await x('remessa_consignada', {
        estabelecimento_id: m.estA,
        empresa_fornecedora_id: m.fornecedor,
        local_estoque_id: m.localA2,
        numero: num,
        recebida_em: '2026-11-20 07:00:00',
        situacao: 'aberta',
      });
      await x('remessa_consignada_item', {
        remessa_consignada_id: remessa,
        insumo_id: m.insumoOpme,
        unidade_medida_id: m.unidade,
        numero_serie: `SER-${m.marca}`,
        quantidade: 1,
      });
      const cme = await x('setor_funcional', {
        estabelecimento_id: m.estA,
        codigo: `${m.marca}-CMEOPME`,
        tipo: 'apoio_tecnico',
      });
      const receb = await x('recebimento_material_terceiro', {
        estabelecimento_id: m.estA,
        numero: num,
        empresa_fornecedora_id: m.fornecedor,
        agendamento_cirurgico_id: ids.agenda,
        cme_setor_funcional_id: cme,
        recebido_por_usuario_id: m.usuario,
        recebido_em: '2026-11-20 07:30:00',
        situacao: 'em_reprocessamento',
      });
      const nota = await x('nota_entrada', {
        estabelecimento_id: m.estA,
        local_estoque_id: m.localA2,
        tipo_entrada_estoque_id: Number(tipoEntrada!.id),
        empresa_fornecedora_id: m.fornecedor,
        numero: num,
      });
      const [ne] = await e.consultar<{ em: unknown }>(
        'SELECT criado_em AS em FROM nota_entrada WHERE id = ?',
        [nota],
      );
      return {
        pedido,
        remessa,
        receb,
        nota,
        notaEm: new Date(String(ne!.em instanceof Date ? (ne!.em as Date).toISOString() : ne!.em)),
      };
    });
    const contar = async () =>
      Number(
        (
          await ler<{ q: unknown }>(
            'SELECT COUNT(*) AS q FROM etapa_solicitacao_opme WHERE solicitacao_opme_id = ?',
            [s.id],
          )
        )[0]!.q,
      );
    // Recusas sem escrita: pedido que não existe; a CME ainda reprocessando.
    expect(await codigoDe(avancar('pedido', { pedido: { ano: 2026, doc: num + 1 } }, 'pedido'))).toBe(
      'pedido-inexistente',
    );
    expect(await codigoDe(avancar('cme', {}, 'cme'))).toBe('cme-em-processamento');
    expect(await contar()).toBe(0);
    // Pedido de compra ligado pela chave.
    const ep = await avancar('pedido', { pedido: { ano: 2026, doc: num } }, 'pedido');
    v = ep.versao;
    let lida = (await opme.solicitacao(c, s.id))!;
    expect(lida.situacao).toBe('pedido');
    expect(lida.etapas.find((e) => e.etapa === 'pedido')).toMatchObject({ pedido: { ano: 2026, doc: num } });
    // Consignação: outro fornecedor sem remessa recusa; o do pedido liga a remessa com o material.
    expect(await codigoDe(avancar('consignacao', { fornecedor: m.fornecedor2 }, 'consignada'))).toBe(
      'sem-remessa-consignada',
    );
    v = (await avancar('consignacao', { fornecedor: m.fornecedor }, 'consignada')).versao;
    expect((await opme.solicitacao(c, s.id))!.situacao).toBe('consignada');
    // A CME libera: a etapa liga o recebimento disponível.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f24sf-c3021' }, (e) =>
      e.executar("UPDATE recebimento_material_terceiro SET situacao = 'disponivel' WHERE id = ?", [
        docs.receb,
      ]),
    );
    v = (await avancar('cme', {}, 'cme')).versao;
    lida = (await opme.solicitacao(c, s.id))!;
    expect(lida.situacao).toBe('cme');
    // A nota fiscal antes do consumo fica registrada sem fechar a solicitação.
    const em = docs.notaEm;
    v = (
      await avancar('nf', { nf: { ano: em.getUTCFullYear(), mes: em.getUTCMonth() + 1, doc: num } }, 'cme')
    ).versao;
    lida = (await opme.solicitacao(c, s.id))!;
    expect(lida.situacao).toBe('cme');
    expect(lida.etapas.map((e) => e.etapa)).toEqual([
      'solicitacao',
      'autorizacao',
      'pedido',
      'consignacao',
      'cme',
      'nf',
    ]);
    expect(lida.etapas.find((e) => e.etapa === 'nf')!.nf).toMatchObject({ doc: num });
    // O contrato de efeito: uma linha por etapa, cada uma com o documento real e o fornecedor.
    const linhas = await ler<Record<string, unknown>>(
      `SELECT etapa, pedido_compra_id AS p, remessa_consignada_id AS r, recebimento_material_terceiro_id AS t,
              nota_entrada_id AS n, empresa_fornecedora_id AS f, registrado_por_usuario_id AS u
         FROM etapa_solicitacao_opme WHERE solicitacao_opme_id = ? ORDER BY id`,
      [s.id],
    );
    expect(
      linhas.map((l) => [
        l['etapa'],
        Number(l['p'] ?? 0),
        Number(l['r'] ?? 0),
        Number(l['t'] ?? 0),
        Number(l['n'] ?? 0),
      ]),
    ).toEqual([
      ['pedido', docs.pedido, 0, 0, 0],
      ['consignacao', 0, docs.remessa, 0, 0],
      ['esterilizacao', 0, 0, docs.receb, 0],
      ['nota_fiscal', 0, 0, 0, docs.nota],
    ]);
    expect(linhas.every((l) => Number(l['f']) === m.fornecedor && Number(l['u']) === m.usuario)).toBe(true);
    const [cab] = await ler<{ situacao: unknown; versao: unknown }>(
      'SELECT situacao, versao FROM solicitacao_opme WHERE id = ?',
      [s.id],
    );
    expect(cab).toMatchObject({ situacao: 'autorizada' });
    expect(Number(cab!.versao)).toBe(v);
    // Outro estabelecimento não enxerga a solicitação.
    expect(await opme.solicitacao(contexto(m, m.estB), s.id)).toBeNull();
  });

  it('manipulação: abertura, dupla conferência por outro farmacêutico e baixa do insumo', async () => {
    const c = contexto(m);
    const c2 = { ...contexto(m), usuario: m.usuario2 };
    const ch = chave();
    const nova = {
      itemPrescrito: ids.itemPrescrito!,
      avaliacao: 1,
      reg: ids.atendimento!,
      produto: null,
      capela: m.capelaA,
      grupo: m.grupoManipulacao,
      insumo: m.insumo,
      local: m.localA,
      loteInsumo: `${m.marca}L1`,
      validadeInsumo: '2027-03-31',
      quantidade: 1,
      dose: '10 mg',
      validadeSobra: null,
      em: '2026-11-20T09:00',
      usuario: 'x',
      chave: ch,
    };
    const o = await manip.gravarSgh(c, trilha('ordem_manipulacao'), (g) => g.abrir(nova));
    expect(await manip.gravarSgh(c, trilha('ordem_manipulacao'), (g) => g.ordemPelaChave(ch))).toMatchObject({
      id: o.id,
    });
    const lida = await manip.ordem(c, o.id);
    expect(lida).toMatchObject({
      situacao: 'aberta',
      insumo: m.insumo,
      dose: '10 mg',
      loteInsumo: `${m.marca}L1`,
      quantidade: 1,
    });
    expect(await manip.ordem(contexto(m, m.estB), o.id)).toBeNull();
    expect((await manip.ordens(c, '2026-11-20', '2026-11-20')).itens.map((x) => x.id)).toContain(o.id);
    // Quem preparou não confere.
    expect(
      await codigoDe(
        manip.gravarSgh(c, trilha('ordem_manipulacao'), (g) =>
          g.conferir({
            ordem: o.id,
            versaoVista: 1,
            situacao: 'conferida',
            observacao: null,
            em: '2026-11-20T09:10',
            usuario: 'x',
          }),
        ),
      ),
    ).toBe('mesmo-farmaceutico');
    await manip.gravarSgh(c2, trilha('ordem_manipulacao'), (g) =>
      g.conferir({
        ordem: o.id,
        versaoVista: 1,
        situacao: 'conferida',
        observacao: 'Conferida.',
        em: '2026-11-20T09:10',
        usuario: 'x',
      }),
    );
    const conf = await manip.ordem(c, o.id);
    expect(conf).toMatchObject({ situacao: 'conferida', observacao: 'Conferida.', versao: 2 });
    const r = await manip.executar(
      c,
      'suprimentos.registrarSaida',
      {
        destino: 1,
        origem: 'E',
        local: m.localA,
        centroCusto: m.centroCusto,
        localConsumo: 1,
        atendimento: ids.atendimento,
        itens: [
          {
            item: m.insumo,
            quantidade: 1,
            lotes: [{ lote: `${m.marca}L1`, validade: '2027-03-31', quantidade: 1 }],
          },
        ],
        manipulacao: { ordem: o.id, versaoVista: 2 },
      },
      { ...c, chaveIdempotencia: chave() },
    );
    expect(Number(r.resultado['ordem'])).toBe(o.id);
    const baixada = await manip.ordem(c, o.id);
    expect(baixada!.situacao).toBe('baixada');
    expect(baixada!.lancamento).not.toBeNull();
    expect(await manip.itensAManipular(c, '2026-01-01')).toMatchObject({ cortada: false });
    expect(await manip.vinculos(c, 'login-inexistente-f24sf')).toEqual([]);
  });

  it('manipulação: a ordem aberta a partir da avaliação farmacêutica grava o atendimento e o paciente da avaliação', async () => {
    const c = contexto(m);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f24sf-massa' }, async (e) => {
      const x = (t: string, v: Record<string, unknown>) => inserirMinimo(e, t, v, m.marca);
      const av = await x('avaliacao_farmaceutica', {
        estabelecimento_id: m.estA,
        prescricao_id: ids.prescricao,
        atendimento_id: ids.atendimento,
        paciente_id: ids.paciente,
        situacao: 'pendente',
        recebida_em: new Date(Date.now() - 600_000),
      });
      await x('avaliacao_farmaceutica_item', {
        avaliacao_farmaceutica_id: av,
        sequencia: 1,
        prescricao_item_id: ids.itemPrescrito,
        parecer: 'aprovado',
        avaliado_em: new Date(Date.now() - 300_000),
      });
    });
    const av = await manip.gravarSgh(c, trilha('ordem_manipulacao'), (g) => g.avaliacao(ids.itemPrescrito!));
    expect(av).not.toBeNull();
    // O campo é o atendimento (a tela abre a ordem com ele), nunca o id da avaliação.
    expect(av!.reg).toBe(ids.atendimento);
    expect(await manip.avaliacao(contexto(m, m.estB), ids.itemPrescrito!)).toBeNull();
    const o = await manip.gravarSgh(c, trilha('ordem_manipulacao'), (g) =>
      g.abrir({
        itemPrescrito: ids.itemPrescrito!,
        avaliacao: av!.id,
        reg: av!.reg,
        produto: av!.produto,
        capela: m.capelaA,
        grupo: m.grupoManipulacao,
        insumo: m.insumo,
        local: m.localA,
        loteInsumo: `${m.marca}L1`,
        validadeInsumo: '2027-03-31',
        quantidade: 1,
        dose: '5 mg',
        validadeSobra: null,
        em: '2026-11-20T10:00',
        usuario: 'x',
        chave: chave(),
      }),
    );
    const [g] = await ler<{ atendimento_id: unknown; paciente_id: unknown }>(
      'SELECT atendimento_id, paciente_id FROM ordem_manipulacao WHERE id = ?',
      [o.id],
    );
    expect(Number(g!.atendimento_id)).toBe(ids.atendimento);
    expect(Number(g!.paciente_id)).toBe(ids.paciente);
  });
});
