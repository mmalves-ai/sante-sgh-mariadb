// Contrato de efeito da manutenção corretiva (04-HOT L135) no MariaDB real (cliente f22_o3), com massa SINTÉTICA:
// a oficina com as pessoas (alçada do aprovador) e os serviços; o orçamento (substituição do pendente, recusa do autor,
// acima da alçada, aprovação pelo aprovador vigente, evento na OS); a remessa ao fornecedor (OS aguardando fornecedor,
// termo, CFOP) e o retorno (OS de volta ao atendimento, remessa no histórico), com a trilha de auditoria.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import {
  conferirMembro,
  planejarDecisao,
  planejarOrcamento,
  planejarRemessa,
  planejarRetorno,
} from '@sgh/dominio-manutencao';
import type { SituacaoOs } from '@sgh/contratos';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE_MAN,
  contextoMan,
  encerrarMassaManutencao,
  escreverBanco,
  lerBanco,
  type MassaManutencao,
  prepararMassaManutencao,
  SEM_BANCO_MAN,
  trilhaMan,
} from './massa.spec-util.js';
import { type Plano, PortaOficinaOrcamentoPropria } from './oficina-orcamento-propria.js';
import { PortaManutencaoPropria } from './porta-propria.js';

const codigoDe = (e: unknown) => (e as { problema?: { codigo?: string } }).problema?.codigo;

describe.skipIf(SEM_BANCO_MAN)('oficina, orçamento e conserto externo (MariaDB)', () => {
  let m: MassaManutencao | null = null;
  let porta: PortaOficinaOrcamentoPropria;
  let base: PortaManutencaoPropria;
  let aprovador = 0;
  let loginAprovador = '';
  let servico = 0;
  const M = () => m!;
  const c = () => contextoMan(M());
  const comoAprovador = () => ({ ...contextoMan(M()), usuario: aprovador });
  const um = async <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
    (await lerBanco<T>(M(), sql, p))!;
  const trilhas = async (tabela: string, id: number) =>
    Number(
      (
        await um<{ q: number }>(
          'SELECT COUNT(*) AS q FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ?',
          [tabela, id],
        )
      ).q,
    );
  /** Apaga só as linhas desta função nos estabelecimentos sintéticos (L0303MO e L0303MOX), antes da massa comum. */
  const limpar = async (nucleo: NucleoProprio) => {
    const ests = "(SELECT id FROM estabelecimento WHERE codigo IN ('L0303MO', 'L0303MOX'))";
    await nucleo.escrever({ cliente: CLIENTE_MAN, correlacao: 'limpeza-c2089' }, async (e) => {
      await e.executar(`DELETE FROM remessa_conserto_manutencao WHERE estabelecimento_id IN ${ests}`, []);
      await e.executar(
        `DELETE FROM orcamento_ordem_servico_manutencao WHERE estabelecimento_id IN ${ests}`,
        [],
      );
      await e.executar(
        `DELETE u FROM oficina_manutencao_usuario u JOIN oficina_manutencao o ON o.id = u.oficina_manutencao_id WHERE o.estabelecimento_id IN ${ests}`,
        [],
      );
      await e.executar(
        `DELETE s FROM oficina_manutencao_servico s JOIN oficina_manutencao o ON o.id = s.oficina_manutencao_id WHERE o.estabelecimento_id IN ${ests}`,
        [],
      );
    });
  };

  beforeAll(async () => {
    const previa = new NucleoProprio();
    await limpar(previa);
    await previa.encerrar();
    m = await prepararMassaManutencao('O');
    porta = new PortaOficinaOrcamentoPropria(m.nucleo);
    base = new PortaManutencaoPropria(m.nucleo);
    loginAprovador = 'l0303mo.aprovador';
    const ja = await lerBanco<{ id: number }>(m, 'SELECT id FROM usuario WHERE login = ?', [loginAprovador]);
    aprovador = ja
      ? Number(ja.id)
      : await escreverBanco(
          m,
          "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, 'APROVADOR SINTETICO', 'servico', NOW(3))",
          [loginAprovador],
        );
    const s = await lerBanco<{ id: number }>(
      m,
      "SELECT id FROM servico_manutencao WHERE codigo = 'L0303M-SRV'",
      [],
    );
    servico = s
      ? Number(s.id)
      : await escreverBanco(
          m,
          "INSERT INTO servico_manutencao (codigo, nome, criado_em) VALUES ('L0303M-SRV', 'CONSERTO SINTETICO', NOW(3))",
          [],
        );
  }, 120_000);
  afterAll(async () => {
    if (m) await limpar(m.nucleo);
    await encerrarMassaManutencao(m);
  });

  const conferirMembros = (membros: readonly Parameters<typeof conferirMembro>[0][]): Plano => {
    for (const x of membros) {
      const k = conferirMembro(x);
      if (k) return k;
    }
    return { ok: true };
  };
  const gravarOficina = (
    id: number | null,
    versao: number | null,
    membros: { login: string; funcao: 'aprovador' | 'tecnico'; alcada: number | null }[],
  ) =>
    porta.gravar(
      c(),
      (r: { id: number }) => trilhaMan(M(), 'oficina_manutencao', r.id),
      (g) =>
        g.gravarOficina(
          id,
          versao,
          {
            codigo: 'l0303m-ext',
            nome: 'Oficina externa sintética',
            terceirizada: true,
            fornecedor: M().fornecedor,
            especialidade: null,
            email: null,
            telefone: null,
            ramal: null,
            notificaPorEmail: false,
            exigeAvaliacao: false,
            ativo: true,
            membros: membros.map((x) => ({ ...x, vigenciaInicio: '2026-01-01', vigenciaFim: null })),
            servicos: [{ servico, tempoPadraoMinutos: 90 }],
          },
          (ms) => conferirMembros(ms.map((x) => ({ ...x, usuario: 0, ativo: true }))),
        ),
    );

  it('cadastra a oficina com as pessoas e os serviços; a pessoa que sai fica inativa com o fim da vigência', async () => {
    const r = await gravarOficina(null, null, [
      { login: loginAprovador, funcao: 'aprovador', alcada: 1000 },
      { login: M().loginUsuario, funcao: 'tecnico', alcada: null },
    ]);
    const o = await um(
      'SELECT codigo, terceirizada, empresa_fornecedora_id, versao FROM oficina_manutencao WHERE id = ?',
      [r.id],
    );
    expect(o).toMatchObject({ codigo: 'L0303M-EXT', empresa_fornecedora_id: M().fornecedor, versao: 1 });
    const membros = await um<{ q: number; alcada: string }>(
      "SELECT COUNT(*) AS q, MAX(CASE WHEN funcao = 'aprovador' THEN alcada_aprovacao END) AS alcada FROM oficina_manutencao_usuario WHERE oficina_manutencao_id = ? AND ativo",
      [r.id],
    );
    expect(Number(membros.q)).toBe(2);
    expect(Number(membros.alcada)).toBe(1000);
    expect(
      Number(
        (
          await um<{ q: number }>(
            'SELECT COUNT(*) AS q FROM oficina_manutencao_servico WHERE oficina_manutencao_id = ? AND tempo_padrao_minutos = 90',
            [r.id],
          )
        ).q,
      ),
    ).toBe(1);
    expect(await trilhas('oficina_manutencao', r.id)).toBe(1);
    // A alçada só do aprovador (domínio, antes de gravar) e o código repetido (UNIQUE).
    await expect(
      gravarOficina(r.id, 1, [{ login: M().loginUsuario, funcao: 'tecnico', alcada: 10 }]),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'alcada-so-do-aprovador');
    await expect(gravarOficina(null, null, [])).rejects.toSatisfy((e) => codigoDe(e) === 'codigo-repetido');
    // Altera só com o aprovador: o técnico fica inativo, com o fim da vigência; nada é apagado.
    const a = await gravarOficina(r.id, 1, [{ login: loginAprovador, funcao: 'aprovador', alcada: 1000 }]);
    expect(a.versao).toBe(2);
    const t = await um<{ ativo: number; fim: unknown }>(
      "SELECT ativo, vigencia_fim AS fim FROM oficina_manutencao_usuario WHERE oficina_manutencao_id = ? AND funcao = 'tecnico'",
      [r.id],
    );
    expect(Number(t.ativo)).toBe(0);
    expect(t.fim).not.toBeNull();
    const det = await porta.oficina(c(), r.id);
    expect(det?.membros.filter((x) => x.ativo).map((x) => x.funcao)).toEqual(['aprovador']);
    expect(await porta.oficina(contextoMan(M(), M().outro), r.id)).toBeNull();
  });

  it('orçamento: substitui o pendente, recusa o autor e o valor acima da alçada, aprova e põe o evento na OS; remessa e retorno', async () => {
    const oficina = Number(
      (
        await um<{ id: number }>(
          "SELECT id FROM oficina_manutencao WHERE estabelecimento_id = ? AND codigo = 'L0303M-EXT'",
          [M().est],
        )
      ).id,
    );
    const equipamento = await base.gravarSgh(
      c(),
      (r: { id: number }) => trilhaMan(M(), 'equipamento_saude', r.id),
      (g) =>
        g.incluirEquipamento({
          codigo: 'L0303M-O-EQ1',
          nome: 'MONITOR SINTETICO',
          tipo: 'medico',
          criticidade: 'critica',
          classeRisco: 'III',
          fabricante: 'L0303M FABRICANTE SINTETICO',
          modelo: 'MX-1',
          numeroSerie: 'NS-O-1',
          registroAnvisa: null,
          unidade: null,
          centroCusto: M().centro,
          localizacao: 'LEITO 1',
          recurso: null,
          bemPatrimonial: null,
          instalacao: '2020-01-10',
          garantiaAte: null,
          situacao: 'ativo',
          motivo: null,
          usuario: M().loginUsuario,
        }),
    );
    const os = await escreverBanco(
      M(),
      `INSERT INTO ordem_servico_manutencao (estabelecimento_id, numero, natureza, solicitante_setor_funcional_id,
         solicitante_usuario_id, equipamento_saude_id, oficina_manutencao_id, descricao, prioridade_sugerida, situacao,
         solicitado_em, criado_em)
       VALUES (?, 'L0303M-O-1', 'corretiva', ?, ?, ?, ?, 'Não liga', 'alta', 'em_atendimento', NOW(3), NOW(3))`,
      [M().est, M().setor, M().usuario, equipamento.id, oficina],
    );
    const versaoOs = async (osId = os) =>
      Number(
        (await um<{ v: number }>('SELECT versao AS v FROM ordem_servico_manutencao WHERE id = ?', [osId])).v,
      );
    const orcar = async (valor: number, osId = os) =>
      porta.gravar(
        c(),
        (r: { id: number }) => trilhaMan(M(), 'orcamento_ordem_servico_manutencao', r.id),
        async (g) =>
          g.registrarOrcamento(
            {
              os: osId,
              versaoOs: await versaoOs(osId),
              fornecedor: M().fornecedor,
              descricao: 'Troca da fonte',
              valor,
              prazoDias: 10,
              validade: null,
            },
            (o, haAprovado, hoje) =>
              planejarOrcamento({
                situacaoOs: o.situacao as SituacaoOs,
                valor,
                descricao: 'Troca da fonte',
                validade: null,
                hoje,
                haAprovado,
              }),
          ),
      );
    const decidir = (
      ctx: ReturnType<typeof c>,
      id: number,
      versao: number,
      decisao: 'aprovado' | 'reprovado',
      administrador = false,
    ) =>
      porta.gravar(
        ctx,
        (r: { id: number }) => trilhaMan(M(), 'orcamento_ordem_servico_manutencao', r.id),
        (g) =>
          g.decidirOrcamento({ orcamento: id, versao, decisao, justificativa: null }, (orc, membros, hoje) =>
            planejarDecisao({
              decisao,
              orcamento: orc,
              quem: ctx.usuario!,
              administrador,
              membros,
              justificativa: null,
              hoje,
            }),
          ),
      );
    type SemOrc = { motivo: 'garantia' | 'contrato' | 'comodato'; justificativa: string } | null;
    const enviar = async (osId = os, semOrcamento: SemOrc = null) =>
      porta.gravar(
        c(),
        (r: { id: number }) => trilhaMan(M(), 'remessa_conserto_manutencao', r.id),
        async (g) =>
          g.enviarRemessa(
            {
              os: osId,
              versaoOs: await versaoOs(osId),
              fornecedor: M().fornecedor,
              termo: 'Com cabo de força e sensor',
              notaFiscal: '123',
              cfop: '5915',
              previsaoRetorno: '2099-01-01',
              semOrcamento,
            },
            (o, aberta, orc, agora) =>
              planejarRemessa({
                situacaoOs: o.situacao as SituacaoOs,
                temEquipamento: o.equipamento !== null,
                remessaAberta: aberta,
                orcamento: orc,
                enviadoEm: agora,
                previsaoRetorno: '2099-01-01',
                termo: 'Com cabo de força e sensor',
                semOrcamento,
              }),
          ),
      );
    // Remessa sem orçamento nenhum: recusada (o conserto externo pago exige o orçamento aprovado).
    await expect(enviar()).rejects.toSatisfy((e) => codigoDe(e) === 'sem-orcamento');
    // Remessa antes de decidir o orçamento: recusada.
    const primeiro = await orcar(1500);
    await expect(enviar()).rejects.toSatisfy((e) => codigoDe(e) === 'orcamento-pendente');
    const segundo = await orcar(800);
    const sit = async (id: number) =>
      (
        await um<{ s: string }>('SELECT situacao AS s FROM orcamento_ordem_servico_manutencao WHERE id = ?', [
          id,
        ])
      ).s;
    expect(await sit(primeiro.id)).toBe('substituido');
    expect(await sit(segundo.id)).toBe('pendente');
    // O autor não decide; o aprovador decide dentro da alçada (1000 ≥ 800).
    await expect(decidir(c(), segundo.id, 1, 'aprovado')).rejects.toSatisfy(
      (e) => codigoDe(e) === 'sem-alcada' || codigoDe(e) === 'mesmo-autor',
    );
    await expect(decidir(comoAprovador(), primeiro.id, 2, 'aprovado')).rejects.toSatisfy(
      (e) => codigoDe(e) === 'orcamento-decidido',
    );
    const ap = await decidir(comoAprovador(), segundo.id, 1, 'aprovado');
    expect(ap.versao).toBe(2);
    const orc = await um(
      'SELECT situacao, decidido_por_usuario_id AS quem, valor FROM orcamento_ordem_servico_manutencao WHERE id = ?',
      [segundo.id],
    );
    expect(orc).toMatchObject({ situacao: 'aprovado', quem: aprovador });
    expect(
      Number(
        (
          await um<{ q: number }>(
            "SELECT COUNT(*) AS q FROM ordem_servico_manutencao_evento WHERE ordem_servico_manutencao_id = ? AND tipo_evento = 'orcamento_aprovado' AND usuario_id = ?",
            [os, aprovador],
          )
        ).q,
      ),
    ).toBe(1);
    expect(await trilhas('orcamento_ordem_servico_manutencao', segundo.id)).toBe(2);
    await expect(orcar(100)).rejects.toSatisfy((e) => codigoDe(e) === 'ja-aprovado');

    // Remessa: OS aguardando o fornecedor, ligada ao orçamento aprovado; a segunda remessa é recusada.
    const rem = await enviar();
    const r1 = await um(
      'SELECT situacao, cfop_remessa AS cfop, orcamento_ordem_servico_manutencao_id AS orc, equipamento_saude_id AS eq FROM remessa_conserto_manutencao WHERE id = ?',
      [rem.id],
    );
    expect(r1).toMatchObject({ situacao: 'enviado', cfop: '5915', orc: segundo.id, eq: equipamento.id });
    expect(
      await um('SELECT motivo_sem_orcamento AS m FROM remessa_conserto_manutencao WHERE id = ?', [rem.id]),
    ).toMatchObject({ m: null });
    expect(
      (await um<{ s: string }>('SELECT situacao AS s FROM ordem_servico_manutencao WHERE id = ?', [os])).s,
    ).toBe('aguardando_terceiro');
    await expect(enviar()).rejects.toSatisfy((e) => codigoDe(e) === 'situacao-nao-permite');
    expect((await porta.remessasAbertas(c())).map((x) => x.os)).toContain(os);

    // Retorno sem conserto exige justificativa; com ela, fecha a remessa e devolve a OS ao atendimento.
    const retornar = (observacao: string | null) =>
      porta.gravar(
        c(),
        (r: { id: number }) => trilhaMan(M(), 'remessa_conserto_manutencao', r.id),
        (g) =>
          g.registrarRetorno(
            {
              remessa: rem.id,
              versao: 1,
              retornadoEm: null,
              notaFiscal: '456',
              resultado: 'sem_conserto',
              observacao,
            },
            (x, em, agora) =>
              planejarRetorno({
                situacaoRemessa: x.situacao,
                enviadoEm: x.enviadoEm,
                retornadoEm: em,
                agora,
                resultado: 'sem_conserto',
                observacao,
              }),
          ),
      );
    await expect(retornar('curta')).rejects.toSatisfy((e) => codigoDe(e) === 'justificativa-curta');
    await retornar('Peça descontinuada pelo fabricante');
    const r2 = await um(
      'SELECT situacao, resultado_retorno AS res, nota_fiscal_retorno AS nf FROM remessa_conserto_manutencao WHERE id = ?',
      [rem.id],
    );
    expect(r2).toMatchObject({ situacao: 'retornado', res: 'sem_conserto', nf: '456' });
    expect(
      (await um<{ s: string }>('SELECT situacao AS s FROM ordem_servico_manutencao WHERE id = ?', [os])).s,
    ).toBe('em_atendimento');
    const ev = await um<{ e: number; r: number }>(
      "SELECT SUM(tipo_evento = 'envio_externo') AS e, SUM(tipo_evento = 'retorno_externo') AS r FROM ordem_servico_manutencao_evento WHERE ordem_servico_manutencao_id = ?",
      [os],
    );
    expect([Number(ev.e), Number(ev.r)]).toEqual([1, 1]);
    expect(await trilhas('remessa_conserto_manutencao', rem.id)).toBe(2);
    const vis = await porta.corretiva(c(), os);
    expect(vis?.orcamentos.map((x) => x.situacao)).toEqual(['aprovado', 'substituido']);
    expect(vis?.remessas[0]).toMatchObject({
      situacao: 'retornado',
      resultado: 'sem_conserto',
      atrasada: false,
    });
    expect(await porta.corretiva(contextoMan(M(), M().outro), os)).toBeNull();

    // Segunda OS: a saída em garantia, sem orçamento, exige justificativa e fica gravada com o motivo.
    const os2 = await escreverBanco(
      M(),
      `INSERT INTO ordem_servico_manutencao (estabelecimento_id, numero, natureza, solicitante_setor_funcional_id,
         solicitante_usuario_id, equipamento_saude_id, oficina_manutencao_id, descricao, prioridade_sugerida, situacao,
         solicitado_em, criado_em)
       VALUES (?, 'L0303M-O-2', 'corretiva', ?, ?, ?, ?, 'Tela apagada', 'alta', 'em_atendimento', NOW(3), NOW(3))`,
      [M().est, M().setor, M().usuario, equipamento.id, oficina],
    );
    await expect(enviar(os2, { motivo: 'garantia', justificativa: 'curta' })).rejects.toSatisfy(
      (e) => codigoDe(e) === 'justificativa-sem-orcamento',
    );
    const rem2 = await enviar(os2, { motivo: 'garantia', justificativa: 'Dentro da garantia do fabricante' });
    expect(
      await um(
        'SELECT orcamento_ordem_servico_manutencao_id AS orc, motivo_sem_orcamento AS m, justificativa_sem_orcamento AS j FROM remessa_conserto_manutencao WHERE id = ?',
        [rem2.id],
      ),
    ).toMatchObject({ orc: null, m: 'garantia', j: 'Dentro da garantia do fabricante' });
    expect(await trilhas('remessa_conserto_manutencao', rem2.id)).toBe(1);

    // O administrador da plataforma decide acima da alçada (5000 > 1000) e mesmo sendo o autor (ADR 0002);
    // o aprovador comum, não.
    const caro = await orcar(5000, os2);
    await expect(decidir(comoAprovador(), caro.id, 1, 'aprovado')).rejects.toSatisfy(
      (e) => codigoDe(e) === 'acima-da-alcada',
    );
    await decidir(c(), caro.id, 1, 'aprovado', true);
    expect(
      await um(
        'SELECT situacao, decidido_por_usuario_id AS quem FROM orcamento_ordem_servico_manutencao WHERE id = ?',
        [caro.id],
      ),
    ).toMatchObject({ situacao: 'aprovado', quem: M().usuario });
  });
});
