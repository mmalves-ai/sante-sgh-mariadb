// Integração da porta PRÓPRIA da gestão da qualidade (F2.4, 3ª etapa) contra o MariaDB do cliente de teste do lote
// (SGH_CLIENTE_TESTE). Constrói sobre o modelo próprio: a matriz de riscos, as não conformidades com o plano de ação,
// as notificações do período por tipo e as do envio ao sistema nacional. O que o modelo ainda não cobre continua
// falhando fechado (503 na leitura, 409 na gravação, sem gravar nada). Só dados sintéticos.
import { ErroOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import {
  CLIENTE_QUA,
  ctxBanco,
  encerrarMassaQualidade,
  type MassaQualidade,
  prepararMassaQualidade,
  SEM_BANCO_QUA,
  semFalhaFechada,
} from './massa.spec-util.js';
import { PortaGestaoPropria, prioridadeDoRisco } from './porta-gestao-propria.js';
import { PortaQualidadePropria } from './porta-propria.js';
import type { RiscoNovo } from './tipos.js';

const T: TrilhaDaGravacao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'risco_institucional',
  entidadeId: null,
  correlacao: 'teste-f24-gestao',
};
const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
};

const CONSTRUIDAS = [
  'ler',
  'pendente',
  'gravador',
  'registrarRisco',
  'registrarNaoConformidade',
  'relogio',
  'feriados',
  'notificacaoExiste',
  'nomesPacientes',
  'riscos',
  'risco',
  'naoConformidades',
  'naoConformidade',
  'naoConformidadesPorOrigem',
  'notificacoesPorTipo',
  'incidentesNotivisa',
  'manifestacoes',
  'manifestacao',
  'ouvidoria',
];

describe.skipIf(SEM_BANCO_QUA)(
  `porta própria da gestão da qualidade contra o MariaDB (${CLIENTE_QUA})`,
  () => {
    let m: MassaQualidade;
    let porta: PortaGestaoPropria;
    let c: ReturnType<typeof ctxBanco>;
    let cOutro: ReturnType<typeof ctxBanco>;
    let agora: string;
    const risco = (x: Partial<RiscoNovo> = {}): RiscoNovo => ({
      id: null,
      versao: null,
      titulo: 'Queda de paciente no banho',
      descricao: 'Risco sintético de queda no banho sem barra de apoio.',
      area: 'posto sintetico',
      categoria: 'assistencial',
      gravidade: 4,
      urgencia: 4,
      tendencia: 4,
      controles: null,
      responsavel: m.loginGestor,
      situacao: 'identificado',
      reavaliarEm: '2027-01-31',
      justificativa: null,
      agora,
      usuario: m.login,
      ...x,
    });

    beforeAll(async () => {
      m = await prepararMassaQualidade('G');
      porta = new PortaGestaoPropria(m.nucleo);
      c = ctxBanco(m.est, m.codigoEst, m.usuario);
      cOutro = ctxBanco(m.outro, m.codigoOutro, m.usuario);
      agora = await porta.relogio(c);
      // A categoria da matriz é cadastro do cliente (configuração): garantida pela massa, nunca apagada.
      await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'preparo-teste-f24-gestao' }, async (e) => {
        const ja = await e.uma("SELECT id FROM categoria_risco_institucional WHERE codigo = 'assistencial'");
        if (!ja)
          await e.inserir(
            "INSERT INTO categoria_risco_institucional (codigo, descricao, criado_em) VALUES ('assistencial', 'Assistencial', ?)",
            [new Date()],
          );
        const tipo = await e.uma<{ id: number }>("SELECT id FROM tipo_incidente WHERE codigo = 'queda'");
        const cl = await e.uma<{ id: number }>(
          "SELECT id FROM classificacao_incidente WHERE codigo = 'evento_adverso'",
        );
        const dano = await e.uma<{ id: number }>("SELECT id FROM grau_dano WHERE codigo = 'leve'");
        const ins = (numero: string, situacao: string, motivo: string | null) =>
          e.inserir(
            `INSERT INTO notificacao_incidente (estabelecimento_id, numero, registrada_em, ocorrido_em, setor_funcional_id,
             tipo_incidente_id, percebido_grau_dano_id, classificacao_incidente_id, grau_dano_id, descricao, situacao,
             motivo_descarte, criado_em)
           VALUES (?, ?, '2026-10-05 10:00:00', '2026-10-04 22:00:00', ?, ?, ?, ?, ?, 'Relato sintético.', ?, ?, ?)`,
            [m.est, numero, m.setor, tipo?.id, dano?.id, cl?.id, dano?.id, situacao, motivo, new Date()],
          );
        const enviada = await ins('NSP-SINT-G1', 'triada', null);
        await ins('NSP-SINT-G2', 'descartada', 'duplicada');
        await e.inserir(
          `INSERT INTO notificacao_incidente_envio (notificacao_incidente_id, operacao, ocorrido_em, tipo_envio, situacao,
           enviado_em, protocolo, criado_em) VALUES (?, 'inclusao', '2026-10-06 09:00:00', 'inicial', 'transcrita',
           '2026-10-06 09:00:00', '2026000777', ?)`,
          [enviada, new Date()],
        );
      });
    }, 60_000);
    afterAll(() => encerrarMassaQualidade(m));

    it('o risco é gravado com a pontuação GUT, a prioridade, a área pelo setor e o responsável pela conta', async () => {
      const r = await porta.gravarSgh(c, T, (g) => g.registrarRisco(risco()));
      expect(r).toMatchObject({ versao: 1, criado: true });
      const lido = await porta.risco(c, r.id);
      expect(lido).toMatchObject({
        area: 'POSTO SINTETICO',
        categoria: 'assistencial',
        pontuacao: 64,
        responsavel: `USUARIO SINTETICO ${m.loginGestor.toUpperCase()}`,
        situacao: 'identificado',
        reavaliarEm: '2027-01-31',
        registradoPor: m.login,
        controles: null,
      });
      expect(prioridadeDoRisco(64)).toBe('critica');
      const pg = await porta.riscos(c, { pagina: 1, porPagina: 10, situacao: 'identificado' });
      expect(pg.total).toBe(1);
      expect((await porta.riscos(c, { pagina: 1, porPagina: 10, situacao: 'emTratamento' })).total).toBe(0);
      // Outro estabelecimento não enxerga o risco.
      expect(await porta.risco(cOutro, r.id)).toBeNull();
      // A atualização confere a versão vista na tela.
      const v2 = await porta.gravarSgh(c, T, (g) =>
        g.registrarRisco(risco({ id: r.id, versao: 1, situacao: 'emTratamento', gravidade: 2 })),
      );
      expect(v2).toMatchObject({ id: r.id, versao: 2, criado: false });
      expect(await porta.risco(c, r.id)).toMatchObject({ situacao: 'emTratamento', pontuacao: 32 });
      expect(
        await codigo(porta.gravarSgh(c, T, (g) => g.registrarRisco(risco({ id: r.id, versao: 1 })))),
      ).toBe('versao-desatualizada');
    });

    it('o risco recusa área, responsável e controles em texto que o modelo não cobre, sem gravar nada', async () => {
      const antes = (await porta.riscos(c, { pagina: 1, porPagina: 50 })).total;
      expect(
        await codigo(porta.gravarSgh(c, T, (g) => g.registrarRisco(risco({ area: 'SETOR QUE NAO EXISTE' })))),
      ).toBe('area-inexistente');
      expect(
        await codigo(
          porta.gravarSgh(c, T, (g) => g.registrarRisco(risco({ responsavel: 'NINGUEM SINTETICO' }))),
        ),
      ).toBe('responsavel-inexistente');
      expect(
        await codigo(porta.gravarSgh(c, T, (g) => g.registrarRisco(risco({ controles: 'Barra de apoio' })))),
      ).toBe('modelo-pendente');
      expect((await porta.riscos(c, { pagina: 1, porPagina: 50 })).total).toBe(antes);
    });

    it('a não conformidade nasce da origem, ganha plano de ação e conta como dependente do risco', async () => {
      const rid = (
        await porta.gravarSgh(c, T, (g) => g.registrarRisco(risco({ titulo: 'Risco origem da NC' })))
      ).id;
      const base = {
        id: null,
        versao: null,
        origem: 'risco',
        idOrigem: rid,
        descricao: 'Barra de apoio ausente no banheiro do posto.',
        area: 'POSTO SINTETICO',
        classificacao: 'menor',
        acaoImediata: null,
        causa: null,
        plano: null,
        responsavel: null,
        prazo: null,
        situacao: 'aberta',
        eficacia: null,
        eficaciaTexto: null,
        agora,
        usuario: m.login,
      };
      const nc = await porta.gravarSgh(c, T, (g) => g.registrarNaoConformidade(base));
      expect(nc).toMatchObject({ versao: 1, criada: true });
      expect(await porta.naoConformidade(c, nc.id)).toMatchObject({
        origem: 'risco',
        idOrigem: rid,
        situacao: 'aberta',
        plano: null,
      });
      expect((await porta.naoConformidadesPorOrigem(c, 'risco', [rid])).get(rid)).toBe(1);
      expect(await porta.dependentes(c, 'risco_institucional', rid)).toEqual([
        {
          grupo: 'Não conformidades do risco',
          dependente: 'nao_conformidade_qualidade',
          quantidade: 1,
          ids: [nc.id],
        },
      ]);
      // Em tratamento sem responsável e prazo: recusa sem gravar.
      expect(
        await codigo(
          porta.gravarSgh(c, T, (g) =>
            g.registrarNaoConformidade({ ...base, id: nc.id, versao: 1, situacao: 'emTratamento' }),
          ),
        ),
      ).toBe('responsavel-e-prazo');
      const v = await porta.gravarSgh(c, T, (g) =>
        g.registrarNaoConformidade({
          ...base,
          id: nc.id,
          versao: 1,
          situacao: 'emTratamento',
          plano: 'Instalar barra de apoio e revisar os demais banheiros.',
          responsavel: m.loginGestor,
          prazo: '2026-12-15',
        }),
      );
      expect(v.criada).toBe(false);
      const lida = await porta.naoConformidade(c, nc.id);
      expect(lida).toMatchObject({
        situacao: 'emTratamento',
        plano: 'Instalar barra de apoio e revisar os demais banheiros.',
        prazo: '2026-12-15',
        versao: v.versao,
      });
      expect(
        (await porta.naoConformidades(c, { pagina: 1, porPagina: 10, origem: 'risco', idOrigem: rid })).total,
      ).toBe(1);
      expect(
        (await porta.naoConformidades(c, { pagina: 1, porPagina: 10, situacao: 'encerrada' })).total,
      ).toBe(0);
      expect(await porta.naoConformidade(cOutro, nc.id)).toBeNull();
      expect(
        await codigo(
          porta.gravarSgh(c, T, (g) => g.registrarNaoConformidade({ ...base, idOrigem: 999_999_999 })),
        ),
      ).toBe('origem-inexistente');
    });

    it('as notificações do período por tipo e as do envio nacional, sem as descartadas', async () => {
      expect(await porta.notificacoesPorTipo(c, '2026-10-01', '2026-11-01')).toEqual([
        { tipo: 'queda', classificacao: 'eventoAdverso', total: 1 },
      ]);
      expect(await porta.notificacoesPorTipo(c, '2026-11-01', '2026-12-01')).toEqual([]);
      const r = await porta.incidentesNotivisa(c, '2026-10-01', '2026-11-01');
      expect(r).toEqual({
        cortada: false,
        itens: [
          {
            numero: 'NSP-SINT-G1',
            ocorridoEm: '2026-10-04T22:00:00',
            tipo: 'queda',
            classificacao: 'eventoAdverso',
            dano: 'leve',
            neverEvent: false,
            transcritaEm: '2026-10-06T09:00:00',
            numeroNotivisa: '2026000777',
          },
        ],
      });
      expect((await porta.incidentesNotivisa(cOutro, '2026-10-01', '2026-11-01')).itens).toEqual([]);
    });

    it('a etapa 2 da notificação lê a análise com os fatores e as ações do plano do banco (nunca vazio presumido)', async () => {
      const q = new PortaQualidadePropria(m.nucleo);
      const ids = await m.nucleo.escrever(
        { cliente: CLIENTE_QUA, correlacao: 'preparo-teste-f24-etapa2' },
        async (e) => {
          const agoraBanco = new Date();
          const ni = await e.uma<{ id: number }>(
            'SELECT id FROM notificacao_incidente WHERE estabelecimento_id = ? AND numero = ?',
            [m.est, 'NSP-SINT-G1'],
          );
          let fator = await e.uma<{ id: number }>(
            "SELECT id FROM fator_contribuinte WHERE codigo = 'sint_profissional'",
          );
          if (!fator)
            fator = {
              id: await e.inserir(
                "INSERT INTO fator_contribuinte (codigo, descricao, categoria, criado_em) VALUES ('sint_profissional', 'Fator sintético', 'profissional', ?)",
                [agoraBanco],
              ),
            };
          const analise = await e.inserir(
            `INSERT INTO analise_incidente (estabelecimento_id, notificacao_incidente_id, responsavel_usuario_id, metodo, conteudo,
           causa_raiz, licoes_aprendidas, situacao, concluida_em, criado_em, criado_por, alterado_em, alterado_por)
         VALUES (?, ?, ?, 'cinco_porques', '{"porques":["sintetico"]}', 'Falta de barra de apoio.', 'Revisar banheiros.',
                 'concluida', '2026-10-20 10:00:00', ?, ?, ?, ?)`,
            [m.est, ni?.id, m.gestor, agoraBanco, m.usuario, agoraBanco, m.gestor],
          );
          await e.inserir(
            "INSERT INTO analise_incidente_causa (analise_incidente_id, sequencia, fator_contribuinte_id, descricao, criado_em) VALUES (?, 1, ?, 'Causa sintética.', ?)",
            [analise, fator.id, agoraBanco],
          );
          const plano = await e.inserir(
            `INSERT INTO plano_acao_qualidade (estabelecimento_id, numero, titulo, tipo_origem, notificacao_incidente_id,
           responsavel_usuario_id, prazo, criado_em) VALUES (?, 'PA-SINT-1', 'Plano sintético', 'incidente', ?, ?, '2026-12-31', ?)`,
            [m.est, ni?.id, m.gestor, agoraBanco],
          );
          await e.inserir(
            `INSERT INTO acao_plano_qualidade (plano_acao_qualidade_id, sequencia, o_que, por_que, onde, como, responsavel_usuario_id,
           prazo, prazo_original, situacao, criado_em, criado_por) VALUES (?, 1, 'Instalar barra', 'Evitar queda', 'Banheiro',
           'Manutenção predial', ?, '2026-01-10', '2026-01-10', 'planejada', ?, ?)`,
            [plano, m.gestor, agoraBanco, m.usuario],
          );
          return { notificacao: Number(ni?.id) };
        },
      );
      expect(await q.analise(c, ids.notificacao)).toMatchObject({
        notificacao: ids.notificacao,
        metodo: 'cincoPorques',
        conteudo: expect.stringContaining('sintetico'),
        causaRaiz: 'Falta de barra de apoio.',
        fatores: ['individuo'],
        licoes: 'Revisar banheiros.',
        situacao: 'concluida',
        registradaPor: m.login,
        concluidaEm: '2026-10-20T10:00:00',
        concluidaPor: m.loginGestor,
      });
      expect(await q.analise(cOutro, ids.notificacao)).toBeNull();
      const acoes = await q.acoes(c, ids.notificacao);
      expect(acoes).toHaveLength(1);
      expect(acoes[0]).toMatchObject({
        oQue: 'Instalar barra',
        quando: '2026-01-10',
        quem: m.loginGestor,
        situacao: 'planejada',
        criadaPor: m.login,
      });
      expect((await q.acoesDoResponsavel(c, m.loginGestor)).map((a) => a.oQue)).toEqual(['Instalar barra']);
      expect(await q.acoesDoResponsavel(c, m.login)).toEqual([]);
      expect(await q.painelAcoes(c, '2026-11-21')).toEqual([
        { situacao: 'planejada', eficacia: null, vencida: true, quantidade: 1 },
      ]);
      expect(await codigo(q.queixas())).toBe('modelo-pendente');
      expect(await codigo(q.resolvidas())).toBe('modelo-pendente');
    });

    it('a ouvidoria lê as manifestações com a situação, a área encaminhada, a resposta e a busca pelo protocolo', async () => {
      await m.nucleo.escrever(
        { cliente: CLIENTE_QUA, correlacao: 'preparo-teste-f24-ouvidoria' },
        async (e) => {
          const agoraBanco = new Date();
          const cad = async (tabela: string, codigo: string, extra: string, valores: unknown[]) =>
            (await e.uma<{ id: number }>(`SELECT id FROM ${tabela} WHERE codigo = ?`, [codigo]))?.id ??
            e.inserir(
              `INSERT INTO ${tabela} (codigo, descricao, ${extra}, criado_em) VALUES (?, 'Sintético', ${valores.map(() => '?').join(', ')}, ?)`,
              [codigo, ...valores, agoraBanco],
            );
          const canal = await cad('canal_ouvidoria', 'sint_telefone', 'tipo_canal', ['telefone']);
          const tipo = await cad('tipo_manifestacao_ouvidoria', 'sint_reclamacao', 'natureza', [
            'reclamacao',
          ]);
          const man = (numero: string, situacao: string, resposta: string | null) =>
            e.inserir(
              `INSERT INTO manifestacao_ouvidoria (estabelecimento_id, numero, tipo_manifestacao_ouvidoria_id, canal_ouvidoria_id,
             identificada, setor_funcional_id, relato, recebida_em, registrante_usuario_id, prazo_resposta, situacao, resposta,
             respondida_em, criado_em) VALUES (?, ?, ?, ?, FALSE, ?, 'Relato sintético da espera.', '2026-10-10 09:00:00', ?,
             '2026-10-20', ?, ?, ?, ?)`,
              [
                m.est,
                numero,
                tipo,
                canal,
                m.setor,
                m.usuario,
                situacao,
                resposta,
                resposta ? '2026-10-15 10:00:00' : null,
                agoraBanco,
              ],
            );
          const aberta = await man('OUV-2026-000001', 'encaminhada', null);
          await e.inserir(
            `INSERT INTO manifestacao_ouvidoria_evento (manifestacao_ouvidoria_id, operacao, ocorrido_em, usuario_id, tipo_evento,
           destino_setor_funcional_id, motivo, criado_em) VALUES (?, 'inclusao', '2026-10-11 09:00:00', ?, 'transferencia_setor', ?, 'Para o posto.', ?)`,
            [aberta, m.usuario, m.setor, agoraBanco],
          );
          const resp = await man('OUV-2026-000002', 'respondida', 'Resposta sintética ao manifestante.');
          await e.inserir(
            `INSERT INTO manifestacao_ouvidoria_evento (manifestacao_ouvidoria_id, operacao, ocorrido_em, usuario_id, tipo_evento, criado_em)
         VALUES (?, 'inclusao', '2026-10-15 10:00:00', ?, 'resposta', ?)`,
            [resp, m.gestor, agoraBanco],
          );
        },
      );
      const todas = await porta.manifestacoes(c, { pagina: 1, porPagina: 10 });
      expect(todas.total).toBe(2);
      expect(todas.itens.map((x) => [x.protocolo, x.situacao])).toEqual([
        ['OUV-2026-000001', 'encaminhada'],
        ['OUV-2026-000002', 'respondida'],
      ]);
      expect(todas.itens[0]).toMatchObject({
        canal: 'sintTelefone',
        tipo: 'sintReclamacao',
        identificada: false,
        area: 'POSTO SINTETICO',
        encaminhadaA: 'POSTO SINTETICO',
        observacao: 'Para o posto.',
        prazoEm: '2026-10-20T23:59:59',
        registradaPor: m.login,
        canceladaEm: null,
      });
      expect(todas.itens[1]).toMatchObject({
        respondidaPor: m.loginGestor,
        respondidaEm: '2026-10-15T10:00:00',
        procedente: null,
      });
      expect(
        (await porta.manifestacoes(c, { pagina: 1, porPagina: 10, busca: 'ouv-2026-000002' })).itens.map(
          (x) => x.protocolo,
        ),
      ).toEqual(['OUV-2026-000002']);
      expect((await porta.manifestacoes(c, { pagina: 1, porPagina: 10, situacao: 'respondida' })).total).toBe(
        1,
      );
      expect(
        (
          await porta.manifestacoes(c, {
            pagina: 1,
            porPagina: 10,
            busca: 'espera',
            recebidaDe: '2026-11-01',
          })
        ).total,
      ).toBe(0);
      expect((await porta.manifestacoes(cOutro, { pagina: 1, porPagina: 10 })).total).toBe(0);
      expect(await porta.manifestacao(c, todas.itens[0]!.id)).toMatchObject({ protocolo: 'OUV-2026-000001' });
    });

    it('a ouvidoria grava a manifestação, o encaminhamento, a resposta com a procedência e o cancelamento, com a versão', async () => {
      const base = {
        protocoloDe: (k: number) => `OUV-2026-${String(900000 + k).padStart(6, '0')}`,
        canal: 'sintTelefone',
        tipo: 'sintReclamacao',
        identificada: true,
        paciente: null,
        manifestante: 'MANIFESTANTE SINTETICO',
        contato: 'sintetico@exemplo.invalid',
        area: 'POSTO SINTETICO',
        relato: 'Relato sintético gravado pela porta.',
        recebidaEm: '2026-11-02T08:30',
        prazoEm: '2026-11-12T23:59:59',
        pesquisa: null,
        agora,
        usuario: m.login,
      };
      const r = await porta.gravarSgh(c, T, (g) => g.registrarManifestacao(base));
      expect(r.protocolo).toMatch(/^OUV-2026-9\d{5}$/);
      expect(await porta.manifestacao(c, r.id)).toMatchObject({
        situacao: 'aberta',
        contato: 'sintetico@exemplo.invalid',
        manifestante: 'MANIFESTANTE SINTETICO',
        versao: 1,
      });
      const v2 = await porta.gravarSgh(c, T, (g) =>
        g.encaminharManifestacao({ id: r.id, versao: 1, encaminhadaA: 'posto sintetico', observacao: null }),
      );
      expect(await porta.manifestacao(c, r.id)).toMatchObject({
        situacao: 'encaminhada',
        encaminhadaA: 'POSTO SINTETICO',
        versao: v2.versao,
      });
      expect(
        await codigo(
          porta.gravarSgh(c, T, (g) =>
            g.encaminharManifestacao({
              id: r.id,
              versao: 1,
              encaminhadaA: 'POSTO SINTETICO',
              observacao: null,
            }),
          ),
        ),
      ).toBe('versao-desatualizada');
      const v3 = await porta.gravarSgh(c, T, (g) =>
        g.responderManifestacao({
          id: r.id,
          versao: v2.versao,
          resposta: 'Resposta sintética gravada.',
          procedente: true,
          agora,
          usuario: m.loginGestor,
        }),
      );
      expect(await porta.manifestacao(c, r.id)).toMatchObject({
        situacao: 'respondida',
        procedente: true,
        respondidaPor: m.loginGestor,
        versao: v3.versao,
      });
      const r2 = await porta.gravarSgh(c, T, (g) =>
        g.registrarManifestacao({ ...base, identificada: false, manifestante: null, contato: null }),
      );
      await porta.gravarSgh(c, T, (g) =>
        g.cancelarManifestacao({
          id: r2.id,
          versao: 1,
          justificativa: 'Registro em duplicidade.',
          agora,
          usuario: m.login,
        }),
      );
      expect(await porta.manifestacao(c, r2.id)).toMatchObject({
        situacao: 'aberta',
        motivoCancelamento: 'Registro em duplicidade.',
        identificada: false,
        contato: null,
      });
      expect((await porta.manifestacao(c, r2.id))?.canceladaEm).not.toBeNull();
    });

    it('salvar sem mudar mantém o setor e o responsável gravados; homônimo novo recusa como ambíguo', async () => {
      const r = await porta.gravarSgh(c, T, (g) =>
        g.registrarRisco(risco({ titulo: 'Risco com homônimos' })),
      );
      const nomeGestor = `USUARIO SINTETICO ${m.loginGestor.toUpperCase()}`;
      const loginHomonimo = `${m.loginGestor}.homonimo`;
      const prep = { cliente: CLIENTE_QUA, correlacao: 'preparo-teste-f24-homonimos' };
      // Setor e conta homônimos (comum em dado vindo do conector), criados só para este teste e apagados ao fim.
      await m.nucleo.escrever(prep, async (e) => {
        await e.inserir(
          "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, 'Q1H', 'POSTO SINTETICO', 'assistencial', ?)",
          [m.est, new Date()],
        );
        await e.inserir(
          "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, ?, 'pessoa', TRUE, ?)",
          [loginHomonimo, nomeGestor, new Date()],
        );
      });
      try {
        const lido = await porta.risco(c, r.id);
        expect(lido).toMatchObject({ area: 'POSTO SINTETICO', responsavel: nomeGestor });
        // A tela devolve o que leu (nome do setor e do responsável): a gravação mantém os ids, sem recusar nem trocar.
        const v2 = await porta.gravarSgh(c, T, (g) =>
          g.registrarRisco(
            risco({
              id: r.id,
              versao: 1,
              titulo: 'Risco com homônimos',
              area: lido!.area,
              responsavel: lido!.responsavel,
            }),
          ),
        );
        expect(v2).toMatchObject({ versao: 2, criado: false });
        const gravado = await m.nucleo.escrever(prep, (e) =>
          e.uma<{ setor_funcional_id: number; responsavel_usuario_id: number }>(
            'SELECT setor_funcional_id, responsavel_usuario_id FROM risco_institucional WHERE id = ?',
            [r.id],
          ),
        );
        expect(Number(gravado?.setor_funcional_id)).toBe(m.setor);
        expect(Number(gravado?.responsavel_usuario_id)).toBe(m.gestor);
        // Registro novo pelo nome repetido não escolhe em silêncio: recusa e pede o código ou o login.
        expect(
          await codigo(porta.gravarSgh(c, T, (g) => g.registrarRisco(risco({ titulo: 'Outro risco' })))),
        ).toBe('area-ambigua');
        expect(
          await codigo(
            porta.gravarSgh(c, T, (g) =>
              g.registrarRisco(risco({ titulo: 'Outro risco', area: 'Q1', responsavel: nomeGestor })),
            ),
          ),
        ).toBe('responsavel-ambiguo');
        expect(
          await porta.gravarSgh(c, T, (g) => g.registrarRisco(risco({ titulo: 'Outro risco', area: 'Q1H' }))),
        ).toMatchObject({
          criado: true,
        });
      } finally {
        await m.nucleo.escrever(prep, async (e) => {
          await e.executar(
            "DELETE FROM risco_institucional WHERE estabelecimento_id = ? AND titulo = 'Outro risco'",
            [m.est],
          );
          await e.executar("DELETE FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = 'Q1H'", [
            m.est,
          ]);
          await e.executar('DELETE FROM usuario WHERE login = ?', [loginHomonimo]);
        });
      }
    });

    it('a manifestação da resposta da pesquisa liga a resposta pelo Executor (versão e autoria) e a sequência leva a autoria', async () => {
      const prep = { cliente: CLIENTE_QUA, correlacao: 'preparo-teste-f24-pesquisa' };
      const { modelo, resposta } = await m.nucleo.escrever(prep, async (e) => {
        const modelo = await e.inserir(
          "INSERT INTO modelo_pesquisa_satisfacao (codigo, nome, publico, canal_aplicacao, situacao, criado_em) VALUES ('SINT-F24-PS', 'Pesquisa sintética', 'geral', 'tablet', 'vigente', ?)",
          [new Date()],
        );
        const resposta = await e.inserir(
          "INSERT INTO resposta_pesquisa_satisfacao (estabelecimento_id, modelo_pesquisa_satisfacao_id, canal, anonima, respondida_em, comentario, criado_em) VALUES (?, ?, 'totem', TRUE, ?, 'Comentário sintético.', ?)",
          [m.est, modelo, new Date(), new Date()],
        );
        return { modelo, resposta };
      });
      try {
        const base = {
          protocoloDe: (k: number) => `OUV-2026-${String(800000 + k).padStart(6, '0')}`,
          canal: 'sintTelefone',
          tipo: 'sintReclamacao',
          identificada: false,
          paciente: null,
          manifestante: null,
          contato: null,
          area: 'POSTO SINTETICO',
          relato: 'Relato sintético vindo da pesquisa.',
          recebidaEm: '2026-11-02T08:30',
          prazoEm: '2026-11-12T23:59:59',
          pesquisa: resposta,
          agora,
          usuario: m.login,
        };
        const r = await porta.gravarSgh(c, T, (g) => g.registrarManifestacao(base));
        const lida = await m.nucleo.escrever(prep, (e) =>
          e.uma<{
            manifestacao_ouvidoria_id: number;
            versao: number;
            alterado_por: number | null;
            alterado_em: unknown;
          }>(
            'SELECT manifestacao_ouvidoria_id, versao, alterado_por, alterado_em FROM resposta_pesquisa_satisfacao WHERE id = ?',
            [resposta],
          ),
        );
        expect(Number(lida?.manifestacao_ouvidoria_id)).toBe(r.id);
        expect(Number(lida?.versao)).toBe(2);
        expect(Number(lida?.alterado_por)).toBe(m.usuario);
        expect(lida?.alterado_em).not.toBeNull();
        const seq = await m.nucleo.escrever(prep, (e) =>
          e.consultar(
            "SELECT criado_por FROM sequencia_negocio WHERE estabelecimento_id = ? AND tipo LIKE 'manifestacao\\_ouvidoria\\_%'",
            [m.est],
          ),
        );
        expect(seq.length).toBeGreaterThan(0);
        expect(seq.every((s) => s['criado_por'] !== null)).toBe(true);
        expect(await codigo(porta.gravarSgh(c, T, (g) => g.registrarManifestacao(base)))).toBe(
          'pesquisa-ja-convertida',
        );
      } finally {
        await m.nucleo.escrever(prep, async (e) => {
          await e.executar(
            'UPDATE resposta_pesquisa_satisfacao SET manifestacao_ouvidoria_id = NULL WHERE id = ?',
            [resposta],
          );
          await e.executar(
            "DELETE v FROM manifestacao_ouvidoria_evento v JOIN manifestacao_ouvidoria o ON o.id = v.manifestacao_ouvidoria_id WHERE o.estabelecimento_id = ? AND o.relato = 'Relato sintético vindo da pesquisa.'",
            [m.est],
          );
          await e.executar(
            "DELETE FROM manifestacao_ouvidoria WHERE estabelecimento_id = ? AND relato = 'Relato sintético vindo da pesquisa.'",
            [m.est],
          );
          await e.executar('DELETE FROM resposta_pesquisa_satisfacao WHERE id = ?', [resposta]);
          await e.executar('DELETE FROM modelo_pesquisa_satisfacao WHERE id = ?', [modelo]);
        });
      }
    });

    it('o que o modelo não cobre falha fechado: 409 na gravação (nada gravado) e 503 na leitura', async () => {
      expect(await porta.podeGravar()).toMatchObject({ pode: true });
      expect(
        await codigo(
          porta.gravarSgh(c, T, (g) =>
            g.cancelarNaoConformidade({
              id: 1,
              versao: 1,
              justificativa: 'x',
              agora,
              usuario: m.login,
              duplicadaDe: null,
            }),
          ),
        ),
      ).toBe('modelo-pendente');
      expect(await codigo(porta.relogio({ ...c, estabelecimento: null }))).toBe('sem-estabelecimento');
      const r = await semFalhaFechada(porta, CONSTRUIDAS, c);
      expect(r.chamadas).toBeGreaterThan(20);
      expect(r.erradas).toEqual([]);
    });
  },
);
