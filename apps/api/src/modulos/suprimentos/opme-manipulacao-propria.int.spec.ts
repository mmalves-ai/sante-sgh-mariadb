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
    // Etapa sem estrutura no banco: recusa com o motivo.
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
    ).toBe('modelo-pendente');
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
        modelo: null,
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
