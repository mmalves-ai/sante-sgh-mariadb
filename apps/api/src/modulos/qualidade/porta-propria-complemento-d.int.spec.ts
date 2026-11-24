// Integração do complemento D da porta própria da gestão da qualidade (modulos-proprios-2, qualidade-d) contra o
// MariaDB do cliente de teste do lote (SGH_CLIENTE_TESTE). Só dados sintéticos, no estabelecimento da massa: uma resposta
// de pesquisa ligada a uma marcação de agenda e a uma manifestação, uma inclusão de paciente no protocolo com critério e
// registro de meta, e uma manifestação corrigida pelo gravador real da porta (embrulhado por `comVersoesAnteriores`,
// como a ligação pedida ao integrador) para conferir `versoes` com a versão e os dados anteriores.
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { gravacaoDireta } from '../enfermagem/gravacao-direta.js';
import type { ContextoGestao, GravadorGestao } from './porta-gestao.js';
import { PortaGestaoPropriaCompleta, TABELAS_GESTAO_COMPLETA } from './gestao-porta-propria-completa.js';
import {
  CLIENTE_QUA,
  ctxBanco,
  encerrarMassaQualidade,
  type MassaQualidade,
  prepararMassaQualidade,
  SEM_BANCO_QUA,
} from './massa.spec-util.js';
import { comVersoesAnteriores, LeiturasGestaoComplementoD } from './porta-propria-complemento-d.js';

/** A porta completa com o embrulho das versões no gravarSgh (a ligação que o integrador faz na porta completa). */
class PortaComVersoes extends PortaGestaoPropriaCompleta {
  override gravarSgh<T>(
    c: ContextoGestao,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorGestao) => Promise<T>,
  ): Promise<T> {
    return gravacaoDireta(this.executor, c, {
      nome: 'qualidade.gestao',
      tabelas: TABELAS_GESTAO_COMPLETA,
      trilha,
      gravador: (tx, est, anotacao) => comVersoesAnteriores(this.gravador(tx, est), tx, est, anotacao),
      fn,
    });
  }
}

const T: TrilhaDaGravacao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'manifestacao_ouvidoria',
  entidadeId: null,
  correlacao: 'teste-qualidade-d',
};
const NUM = randomInt(100_000_000, 999_999_999);
const P = `qd${NUM}`;

describe.skipIf(SEM_BANCO_QUA)(
  `complemento D da gestão da qualidade no banco próprio (${CLIENTE_QUA})`,
  () => {
    let m: MassaQualidade;
    let leituras: LeiturasGestaoComplementoD;
    let porta: PortaComVersoes;
    let c: ReturnType<typeof ctxBanco>;
    let cOutro: ReturnType<typeof ctxBanco>;
    const codigoProtocolo = `SINT-QD-${randomInt(1_000_000, 9_999_999)}`;
    const agora = '2026-11-02T09:00:00';
    let protocolo = 0;
    let versaoProtocolo = 0;
    let manifestacao = 0;
    let ids: {
      pf: number;
      prof: number;
      paciente: number;
      atendimento: number;
      agenda: number;
      horario: number;
      marcacao: number;
      resposta: number;
      inclusao: number;
      registro: number;
    };

    beforeAll(async () => {
      m = await prepararMassaQualidade('D');
      leituras = new LeiturasGestaoComplementoD(m.nucleo);
      porta = new PortaComVersoes(m.nucleo);
      c = ctxBanco(m.est, m.codigoEst, m.usuario);
      cOutro = ctxBanco(m.outro, m.codigoOutro, m.usuario);
      await m.nucleo.escrever(
        { cliente: CLIENTE_QUA, correlacao: 'preparo-teste-qualidade-d' },
        async (e) => {
          const hoje = new Date();
          const garantir = async (sel: string, p: unknown[], ins: string, pi: unknown[]) =>
            (await e.uma<{ id: number }>(sel, p))?.id ?? e.inserir(ins, pi);
          const cad = (tabela: string, codigo: string, extra: string, valor: string) =>
            garantir(
              `SELECT id FROM ${tabela} WHERE codigo = ?`,
              [codigo],
              `INSERT INTO ${tabela} (codigo, descricao, ${extra}, criado_em) VALUES (?, 'Sintético', ?, ?)`,
              [codigo, valor, hoje],
            );
          await cad('canal_ouvidoria', 'sint_telefone', 'tipo_canal', 'telefone');
          await cad('tipo_manifestacao_ouvidoria', 'sint_reclamacao', 'natureza', 'reclamacao');
          protocolo = await e.inserir(
            `INSERT INTO protocolo_gerenciado (estabelecimento_id, codigo, nome, tipo, criado_em)
             VALUES (?, ?, 'Protocolo sintético QD', 'sepse', ?)`,
            [m.est, codigoProtocolo, hoje],
          );
          versaoProtocolo = await e.inserir(
            `INSERT INTO protocolo_gerenciado_versao (protocolo_gerenciado_id, operacao, dados, ocorrido_em,
               numero_versao, vigencia_inicio, motivo, usuario_id, criado_em)
             VALUES (?, 'inclusao', ?, ?, 1, ?, 'Publicação sintética', ?, ?)`,
            [protocolo, JSON.stringify({ criterios: [] }), hoje, hoje, m.usuario, hoje],
          );
          // Paciente, profissional e atendimento sintéticos (cadastros de apoio pelo código, reaproveitados).
          const pf = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
            'PESSOA SINTETICA QD',
            hoje,
          ]);
          const prof = await e.inserir(
            "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
            [pf, hoje],
          );
          const paciente = await e.inserir(
            "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
            [pf, NUM, hoje],
          );
          const categoria = await garantir(
            'SELECT id FROM categoria_atendimento WHERE codigo = ?',
            ['sintqd_int'],
            "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES ('sintqd_int', 'Categoria sintética', 'internacao', ?)",
            [hoje],
          );
          const carater = await garantir(
            'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
            ['sqd'],
            "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('sqd', 'Caráter sintético', 'teste', ?)",
            [hoje],
          );
          const fonte = await garantir(
            'SELECT id FROM fonte_pagadora WHERE codigo = ?',
            ['SINTQD'],
            "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES ('SINTQD', 'Fonte sintética QD', 'particular', ?)",
            [hoje],
          );
          const atendimento = await e.inserir(
            `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
               carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
            [m.est, String(NUM), paciente, categoria, carater, fonte, prof, hoje, hoje],
          );
          // A agenda de exame com uma marcação do dia 2026-01-15.
          const catAgenda = await garantir(
            'SELECT id FROM categoria_agenda WHERE codigo = ?',
            ['sintqd_exame'],
            "INSERT INTO categoria_agenda (codigo, descricao, natureza, criado_em) VALUES ('sintqd_exame', 'EXAME SINTETICO', 'exame', ?)",
            [hoje],
          );
          const agenda = await e.inserir(
            'INSERT INTO agenda_servico (estabelecimento_id, nome, categoria_agenda_id, profissional_id, duracao_horario_minutos, criado_em) VALUES (?, ?, ?, ?, 20, ?)',
            [m.est, `AGENDA SINTETICA ${P}`, catAgenda, prof, hoje],
          );
          const tipo = await garantir(
            'SELECT id FROM tipo_marcacao WHERE codigo = ?',
            ['sintqd'],
            "INSERT INTO tipo_marcacao (codigo, descricao, natureza, criado_em) VALUES ('sintqd', 'EXAME', 'primeira_vez', ?)",
            [hoje],
          );
          const canal = await garantir(
            'SELECT id FROM canal_marcacao WHERE codigo = ?',
            ['sintqd'],
            "INSERT INTO canal_marcacao (codigo, descricao, criado_em) VALUES ('sintqd', 'CANAL SINTETICO', ?)",
            [hoje],
          );
          const sit = await e.uma<{ id: number }>('SELECT MIN(id) AS id FROM situacao_marcacao', []);
          const inicio = new Date('2026-01-15T13:00:00.000Z');
          const horario = await e.inserir(
            'INSERT INTO horario_agenda (estabelecimento_id, agenda_servico_id, data_referencia, inicio_em, fim_em, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
            [m.est, agenda, '2026-01-15', inicio, new Date(inicio.getTime() + 20 * 60_000), hoje],
          );
          const marcacao = await e.inserir(
            `INSERT INTO marcacao_horario (estabelecimento_id, numero, horario_agenda_id, paciente_id, tipo_marcacao_id,
               situacao_marcacao_id, canal_marcacao_id, fonte_pagadora_id, duracao_minutos, marcado_em, responsavel_usuario_id, criado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 20, ?, ?, ?)`,
            [m.est, P, horario, paciente, tipo, Number(sit?.id), canal, fonte, hoje, m.usuario, hoje],
          );
          const modelo = await garantir(
            'SELECT id FROM modelo_pesquisa_satisfacao WHERE codigo = ?',
            ['SINT-QD-PS'],
            "INSERT INTO modelo_pesquisa_satisfacao (codigo, nome, publico, canal_aplicacao, situacao, criado_em) VALUES ('SINT-QD-PS', 'Pesquisa sintética', 'geral', 'tablet', 'vigente', ?)",
            [hoje],
          );
          const resposta = await e.inserir(
            `INSERT INTO resposta_pesquisa_satisfacao (estabelecimento_id, modelo_pesquisa_satisfacao_id, canal, paciente_id,
               marcacao_horario_id, nota_recomendacao, comentario, respondida_em, criado_em)
             VALUES (?, ?, 'totem', ?, ?, 4, 'Comentário sintético.', ?, ?)`,
            [m.est, modelo, paciente, marcacao, new Date('2026-01-16T12:00:00.000Z'), hoje],
          );
          // A inclusão no protocolo em 2026-01-20, com um critério e o registro de uma meta.
          const quando = new Date('2026-01-20T13:00:00.000Z');
          const inclusao = await e.inserir(
            `INSERT INTO inclusao_protocolo_paciente (estabelecimento_id, protocolo_gerenciado_id, paciente_id, atendimento_id,
               forma_inclusao, horario_zero_em, situacao, aceito_em, criado_em, criado_por)
             VALUES (?, ?, ?, ?, 'manual', ?, 'ativo', ?, ?, ?)`,
            [m.est, protocolo, paciente, atendimento, quando, quando, quando, m.usuario],
          );
          await e.inserir(
            `INSERT INTO inclusao_protocolo_criterio (inclusao_protocolo_paciente_id, sequencia, descricao, identificador, criado_em)
             VALUES (?, 1, 'Febre sintética', 'febre', ?)`,
            [inclusao, quando],
          );
          const registro = await e.inserir(
            `INSERT INTO inclusao_protocolo_registro (inclusao_protocolo_paciente_id, tipo, codigo, situacao, ocorrido_em,
               usuario_id, criado_em)
             VALUES (?, 'meta', 'lactato', 'cumprida', ?, ?, ?)`,
            [
              inclusao,
              new Date(quando.getTime() + 30 * 60_000),
              m.usuario,
              new Date(quando.getTime() + 31 * 60_000),
            ],
          );
          ids = {
            pf,
            prof,
            paciente,
            atendimento,
            agenda,
            horario,
            marcacao,
            resposta,
            inclusao,
            registro,
          };
        },
      );
      const r = await porta.gravarSgh(c, T, (g) =>
        g.registrarManifestacao({
          protocoloDe: (k: number) => `OUV-2026-${String(700000 + k).padStart(6, '0')}`,
          canal: 'sintTelefone',
          tipo: 'sintReclamacao',
          identificada: true,
          paciente: null,
          manifestante: 'MANIFESTANTE SINTETICO',
          contato: 'sintetico@exemplo.invalid',
          area: 'POSTO SINTETICO',
          relato: 'Relato sintético original.',
          recebidaEm: '2026-11-02T08:30',
          prazoEm: '2026-11-12T23:59:59',
          pesquisa: null,
          agora,
          usuario: m.login,
        }),
      );
      manifestacao = r.id;
      await m.nucleo.escrever(
        { cliente: CLIENTE_QUA, correlacao: 'preparo-teste-qualidade-d-ligacao' },
        (e) =>
          e.executar('UPDATE resposta_pesquisa_satisfacao SET manifestacao_ouvidoria_id = ? WHERE id = ?', [
            manifestacao,
            ids.resposta,
          ]),
      );
    }, 60_000);

    afterAll(async () => {
      // Só o sintético desta execução, na ordem das chaves; a trilha fica (só de acréscimo). A versão publicada do
      // protocolo é histórico: se o privilégio recusar, a linha fica no estabelecimento da massa (código SINT-QD-*).
      if (m && ids)
        await m.nucleo.escrever(
          { cliente: CLIENTE_QUA, correlacao: 'limpeza-teste-qualidade-d' },
          async (e) => {
            await e.executar('DELETE FROM resposta_pesquisa_satisfacao WHERE id = ?', [ids.resposta]);
            await e.executar('DELETE FROM marcacao_horario WHERE id = ?', [ids.marcacao]);
            await e.executar('DELETE FROM horario_agenda WHERE id = ?', [ids.horario]);
            await e.executar('DELETE FROM agenda_servico WHERE id = ?', [ids.agenda]);
            await e.executar(
              'DELETE FROM inclusao_protocolo_registro WHERE inclusao_protocolo_paciente_id = ?',
              [ids.inclusao],
            );
            await e.executar(
              'DELETE FROM inclusao_protocolo_criterio WHERE inclusao_protocolo_paciente_id = ?',
              [ids.inclusao],
            );
            await e.executar('DELETE FROM inclusao_protocolo_paciente WHERE id = ?', [ids.inclusao]);
            await e.executar('DELETE FROM atendimento WHERE id = ?', [ids.atendimento]);
            await e.executar('DELETE FROM paciente WHERE id = ?', [ids.paciente]);
            await e.executar('DELETE FROM profissional WHERE id = ?', [ids.prof]);
            await e.executar('DELETE FROM pessoa_fisica WHERE id = ?', [ids.pf]);
          },
        );
      if (m && protocolo)
        await m.nucleo
          .escrever(
            { cliente: CLIENTE_QUA, correlacao: 'limpeza-teste-qualidade-d-protocolo' },
            async (e) => {
              await e.executar('DELETE FROM protocolo_gerenciado_versao WHERE protocolo_gerenciado_id = ?', [
                protocolo,
              ]);
              await e.executar('DELETE FROM protocolo_gerenciado WHERE id = ?', [protocolo]);
            },
          )
          .catch(() => undefined);
      await encerrarMassaQualidade(m);
    });

    it('pesquisas: a resposta ligada à marcação volta mapeada pelo dia do atendimento; o outro estabelecimento não a vê', async () => {
      const r = await leituras.pesquisas(c, '2026-01-15', '2026-01-15');
      expect(r.cortada).toBe(false);
      expect(r.itens.find((x) => x.id === ids.resposta)).toEqual({
        id: ids.resposta,
        paciente: ids.paciente,
        tipo: 'exame',
        agenda: `AGENDA SINTETICA ${P}`,
        dataAtendimento: '2026-01-15',
        nota: 4,
        comentario: 'Comentário sintético.',
        respondidaEm: expect.stringMatching(/^2026-01-16T\d{2}:\d{2}:\d{2}$/) as unknown as string,
        manifestacao,
      });
      expect(
        (await leituras.pesquisas(c, '2026-01-16', '2026-01-31')).itens.some((x) => x.id === ids.resposta),
      ).toBe(false);
      expect((await leituras.pesquisas(cOutro, '2026-01-01', '2026-01-31')).itens).toEqual([]);
      expect(await leituras.pesquisa(c, ids.resposta)).toMatchObject({
        id: ids.resposta,
        paciente: ids.paciente,
        nota: 4,
        comentario: 'Comentário sintético.',
      });
      expect(await leituras.pesquisa(cOutro, ids.resposta)).toBeNull();
      expect(await leituras.pesquisa(c, 999_999_999)).toBeNull();
    });

    it('versões: a correção da manifestação pelo gravador guarda a versão anterior, que `versoes` devolve', async () => {
      expect(await leituras.versoes(c, 'manifestacao_ouvidoria', manifestacao)).toEqual([]);
      const r = await porta.gravarSgh(c, { ...T, entidadeId: manifestacao }, (g) =>
        g.corrigirManifestacao({
          id: manifestacao,
          versao: 1,
          justificativa: 'Correção sintética do relato.',
          agora,
          usuario: m.login,
          tipo: 'sintReclamacao',
          area: 'POSTO SINTETICO',
          relato: 'Relato sintético corrigido.',
        }),
      );
      expect(r).toEqual({ versao: 2 });
      const vs = await leituras.versoes(c, 'manifestacao_ouvidoria', manifestacao);
      expect(vs).toHaveLength(1);
      expect(vs[0]).toMatchObject({
        versao: 1,
        acao: 'correcao',
        motivo: 'Correção sintética do relato.',
        alteradoPor: m.login,
        dados: { id: manifestacao, versao: 1, relato: 'Relato sintético original.' },
      });
      expect(vs[0]?.alteradoEm).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
      expect(await leituras.versoes(cOutro, 'manifestacao_ouvidoria', manifestacao)).toEqual([]);
      expect(await leituras.versoes(c, 'auditoria_interna', manifestacao)).toEqual([]);
    });

    it('protocolos gerenciados: a versão publicada e a inclusão do período com o critério e a meta; o outro não vê', async () => {
      const r = await leituras.protocolosGerenciados(c, '2026-01-01T00:00:00', '2026-02-01T00:00:00');
      const v = r.versoes.find((x) => x.id === versaoProtocolo);
      expect(v).toMatchObject({
        versao: 1,
        nome: 'Protocolo sintético QD',
        notas: 'Publicação sintética',
        autor: m.login,
      });
      expect(v?.impressao).toMatch(/^[0-9a-f]{64}$/);
      expect(r.protocolos.find((x) => x.id === ids.inclusao)).toMatchObject({
        id: ids.inclusao,
        cabecalho: String(ids.atendimento),
        reg: ids.atendimento,
        paciente: ids.paciente,
        gerenciado: protocolo,
        origem: 'enfermeiro',
        criterios: ['febre'],
        incluidoPor: m.login,
        eventos: [
          {
            id: ids.registro,
            tipo: 'meta',
            codigo: 'lactato',
            situacao: 'cumprida',
            prazoEm: null,
            motivo: null,
            por: m.login,
          },
        ],
      });
      // `fim` exclusivo: o mês seguinte não traz a inclusão.
      expect(
        (
          await leituras.protocolosGerenciados(c, '2026-02-01T00:00:00', '2026-03-01T00:00:00')
        ).protocolos.some((x) => x.id === ids.inclusao),
      ).toBe(false);
      const outro = await leituras.protocolosGerenciados(
        cOutro,
        '2026-01-01T00:00:00',
        '2026-02-01T00:00:00',
      );
      expect(outro.versoes.some((x) => x.id === versaoProtocolo)).toBe(false);
      expect(outro.protocolos).toEqual([]);
    });
  },
);
