// Integração do complemento Q2 da porta própria da gestão da qualidade (modulos-proprios-3, qualidade-q2) contra o
// MariaDB do cliente de teste do lote (SGH_CLIENTE_TESTE). Só dados sintéticos, no estabelecimento da massa: um
// documento controlado com três revisões publicadas (obsoleta, retirada e vigente vencida), a ciência de um
// colaborador sintético na vigente, uma comissão com membro e reunião ordinária realizada; confere as leituras e a
// contagem do painel, e que o outro estabelecimento não vê nada.
import { createHash, randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE_QUA,
  ctxBanco,
  encerrarMassaQualidade,
  type MassaQualidade,
  prepararMassaQualidade,
  SEM_BANCO_QUA,
} from './massa.spec-util.js';
import { LeiturasGestaoComplementoQ2 } from './porta-propria-complemento-q2.js';

const NUM = randomInt(100_000_000, 999_999_999);
const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

describe.skipIf(SEM_BANCO_QUA)(
  `complemento Q2 da gestão da qualidade no banco próprio (${CLIENTE_QUA})`,
  () => {
    let m: MassaQualidade;
    let leituras: LeiturasGestaoComplementoQ2;
    let c: ReturnType<typeof ctxBanco>;
    let cOutro: ReturnType<typeof ctxBanco>;
    const codigo = `DOC-Q2-${NUM}`;
    const AGORA = '2026-11-10T08:00:00';
    let base: Awaited<ReturnType<LeiturasGestaoComplementoQ2['contagem']>>;
    let baseGestor: typeof base;
    const ids = { tipoDoc: 0, doc: 0, v1: 0, v2: 0, v3: 0, colab: 0, tipoCom: 0, comissao: 0 };

    beforeAll(async () => {
      // A massa do complemento D (o código do estabelecimento novo segue o formato do cadastro; o par 'D' já existe).
      m = await prepararMassaQualidade('D');
      leituras = new LeiturasGestaoComplementoQ2(m.nucleo);
      c = ctxBanco(m.est, m.codigoEst, m.usuario);
      cOutro = ctxBanco(m.outro, m.codigoOutro, m.usuario);
      base = await leituras.contagem(c, AGORA, m.login);
      baseGestor = await leituras.contagem(c, AGORA, m.loginGestor);
      await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'preparo-q2' }, async (e) => {
        const agora = new Date();
        ids.tipoDoc = await e.inserir(
          "INSERT INTO tipo_documento_qualidade (codigo, descricao, categoria, criado_em) VALUES (?, 'TIPO SINT', 'protocolo', ?)",
          [`TDQ${NUM}`, agora],
        );
        ids.doc = await e.inserir(
          `INSERT INTO documento_qualidade (estabelecimento_id, codigo, titulo, tipo_documento_qualidade_id, dono_usuario_id,
             setor_funcional_id, exige_ciencia, situacao, criado_em) VALUES (?, ?, 'Documento sintético', ?, ?, ?, TRUE, 'vigente', ?)`,
          [m.est, codigo, ids.tipoDoc, m.usuario, m.setor, agora],
        );
        const versao = (
          num: string,
          situacao: string,
          conteudo: string,
          dados: string | null,
          revisao: string,
        ) =>
          e.inserir(
            `INSERT INTO documento_qualidade_versao (documento_qualidade_id, operacao, dados, ocorrido_em, numero_versao, situacao,
               formato, conteudo, elaborador_usuario_id, aprovador_usuario_id, publicado_em, proxima_revisao, criado_em, alterado_em)
             VALUES (?, 'inclusao', ?, ?, ?, ?, 'texto', ?, ?, ?, ?, ?, ?, ?)`,
            [
              ids.doc,
              dados,
              agora,
              num,
              situacao,
              conteudo,
              m.usuario,
              m.gestor,
              '2026-10-01 08:00:00',
              revisao,
              agora,
              situacao === 'vigente' ? null : '2026-10-20 10:00:00',
            ],
          );
        ids.v1 = await versao('1', 'obsoleta', 'texto um', null, '2027-01-01');
        ids.v2 = await versao(
          '2',
          'cancelada',
          'texto dois',
          '{"motivoRetirada":"Retirada sintetica"}',
          '2027-01-01',
        );
        ids.v3 = await versao('3', 'vigente', 'texto três', null, '2020-01-01');
        await e.executar('UPDATE documento_qualidade SET documento_qualidade_versao_id = ? WHERE id = ?', [
          ids.v3,
          ids.doc,
        ]);
        const sexo = await e.uma<{ id: number }>('SELECT MIN(id) AS id FROM sexo', []);
        ids.colab = await e.inserir(
          `INSERT INTO colaborador (nome, cpf, data_nascimento, sexo_id, grau_instrucao, usuario_id, criado_em)
           VALUES ('COLABORADOR SINTETICO Q2', ?, '1990-01-01', ?, '07', ?, ?)`,
          [String(NUM).padStart(11, '0'), sexo?.id, m.usuario, agora],
        );
        await e.inserir(
          `INSERT INTO documento_qualidade_ciencia (documento_qualidade_versao_id, colaborador_id, ciencia_em, criado_em)
           VALUES (?, ?, '2026-10-05 10:00:00', ?)`,
          [ids.v3, ids.colab, agora],
        );
        ids.tipoCom = await e.inserir(
          "INSERT INTO tipo_comissao (codigo, descricao, criado_em) VALUES (?, 'COMISSAO SINT', ?)",
          [`TC${NUM}`, agora],
        );
        ids.comissao = await e.inserir(
          `INSERT INTO comissao_hospitalar (estabelecimento_id, tipo_comissao_id, nome, periodicidade_reuniao, criado_em)
           VALUES (?, ?, ?, 'mensal', ?)`,
          [m.est, ids.tipoCom, `COMISSAO Q2 ${NUM}`, agora],
        );
        await e.inserir(
          `INSERT INTO comissao_membro (comissao_hospitalar_id, colaborador_id, papel, vigencia_inicio, criado_em)
           VALUES (?, ?, 'presidente', '2026-01-01', ?)`,
          [ids.comissao, ids.colab, agora],
        );
        await e.inserir(
          `INSERT INTO reuniao_comissao (comissao_hospitalar_id, tipo, situacao, agendada_para, realizada_em, pauta, criado_em)
           VALUES (?, 'ordinaria', 'realizada', '2026-10-01 14:00:00', '2026-10-01 14:00:00', 'Pauta sintética', ?)`,
          [ids.comissao, agora],
        );
      });
    });

    afterAll(async () => {
      if (!m) return;
      await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'limpeza-q2' }, async (e) => {
        await e.executar('DELETE FROM reuniao_comissao WHERE comissao_hospitalar_id = ?', [ids.comissao]);
        await e.executar('DELETE FROM comissao_membro WHERE comissao_hospitalar_id = ?', [ids.comissao]);
        await e.executar('DELETE FROM comissao_hospitalar WHERE id = ?', [ids.comissao]);
        await e.executar('DELETE FROM tipo_comissao WHERE id = ?', [ids.tipoCom]);
        await e.executar('DELETE FROM documento_qualidade_ciencia WHERE colaborador_id = ?', [ids.colab]);
        await e.executar('UPDATE documento_qualidade SET documento_qualidade_versao_id = NULL WHERE id = ?', [
          ids.doc,
        ]);
        await e.executar('DELETE FROM documento_qualidade_versao WHERE documento_qualidade_id = ?', [
          ids.doc,
        ]);
        await e.executar('DELETE FROM documento_qualidade WHERE id = ?', [ids.doc]);
        await e.executar('DELETE FROM tipo_documento_qualidade WHERE id = ?', [ids.tipoDoc]);
        await e.executar('DELETE FROM colaborador WHERE id = ?', [ids.colab]);
      });
      await encerrarMassaQualidade(m);
    });

    it('as revisões do código, da mais nova para a mais antiga, com situação, retirada e logins', async () => {
      const xs = await leituras.documentosDoCodigo(c, codigo);
      expect(xs.map((d) => [d.id, d.revisao, d.situacao])).toEqual([
        [ids.v3, 3, 'vigente'],
        [ids.v2, 2, 'retirado'],
        [ids.v1, 1, 'obsoleto'],
      ]);
      expect(xs[1]).toMatchObject({
        motivoRetirada: 'Retirada sintetica',
        encerradoEm: '2026-10-20T10:00:00',
      });
      expect(xs[0]).toMatchObject({
        tipo: `TDQ${NUM}`,
        area: 'POSTO SINTETICO',
        elaboradoPor: m.login.toUpperCase(),
        aprovadoPor: m.loginGestor.toUpperCase(),
        publicadoEm: '2026-10-01T08:00:00',
        vigenciaAte: '2020-01-01',
        exigeCiencia: true,
        encerradoEm: null,
        conteudo: null,
      });
      expect(await leituras.documentosDoCodigo(cOutro, codigo)).toEqual([]);
    });

    it('a revisão pelo id traz o conteúdo e o SHA-256 do texto; no outro estabelecimento é nula', async () => {
      const d = await leituras.documento(c, ids.v3);
      expect(d).toMatchObject({ conteudo: 'texto três', hash: sha256('texto três') });
      expect(await leituras.documento(cOutro, ids.v3)).toBeNull();
    });

    it('a lista filtra pela situação, tipo e busca, com o total e a página', async () => {
      const todas = await leituras.documentos(c, { busca: codigo.toUpperCase(), pagina: 1, porPagina: 2 });
      expect(todas.total).toBe(3);
      expect(todas.itens.map((d) => d.revisao)).toEqual([3, 2]);
      const vig = await leituras.documentos(c, {
        situacao: 'vigente',
        tipo: `TDQ${NUM}`,
        pagina: 1,
        porPagina: 10,
      });
      expect(vig.itens.map((d) => d.id)).toEqual([ids.v3]);
      expect(
        (await leituras.documentos(c, { situacao: 'retirado', busca: codigo, pagina: 1, porPagina: 10 }))
          .total,
      ).toBe(1);
    });

    it('ciências e cientes pelo login da conta do colaborador', async () => {
      const mapa = await leituras.ciencias(c, [ids.v3, ids.v1], m.login.toLowerCase());
      expect(mapa.get(ids.v3)).toEqual({ total: 1, sessao: true });
      expect(mapa.has(ids.v1)).toBe(false);
      expect((await leituras.ciencias(c, [ids.v3], m.loginGestor)).get(ids.v3)).toEqual({
        total: 1,
        sessao: false,
      });
      expect(await leituras.cientes(c, ids.v3)).toEqual([
        { usuario: m.login.toUpperCase(), cienteEm: '2026-10-05T10:00:00' },
      ]);
      expect((await leituras.ciencias(cOutro, [ids.v3], m.login)).size).toBe(0);
    });

    it('a comissão com a composição vigente e a última reunião ordinária', async () => {
      const k = await leituras.comissao(c, ids.comissao);
      expect(k).toMatchObject({
        tipo: `TC${NUM}`,
        periodicidade: 'mensal',
        ativa: true,
        ultimaOrdinaria: '2026-10-01T14:00:00',
        ultimaReuniao: '2026-10-01T14:00:00',
      });
      expect(JSON.parse(k!.membros)).toEqual([
        { nome: 'COLABORADOR SINTETICO Q2', funcao: 'presidente', login: m.login.toUpperCase() },
      ]);
      expect((await leituras.comissoes(c)).map((x) => x.id)).toContain(ids.comissao);
      expect(await leituras.comissao(cOutro, ids.comissao)).toBeNull();
    });

    it('o histórico da análise de indicador sem análise é vazio (nunca erro)', async () => {
      expect(await leituras.historicoAnalises(c, `IND-INEXISTENTE-${NUM}`)).toEqual([]);
    });

    it('a contagem do painel: a vigente com revisão vencida soma e a ciência pendente só de quem não registrou', async () => {
      const mais = (b: typeof base, docs: number, pend: number) => ({
        ...b,
        documentosVigentes: b.documentosVigentes + docs,
        documentosRevisaoVencida: b.documentosRevisaoVencida + docs,
        cienciasPendentesSessao: b.cienciasPendentesSessao + pend,
      });
      expect(await leituras.contagem(c, AGORA, m.login)).toEqual(mais(base, 1, 0));
      expect(await leituras.contagem(c, AGORA, m.loginGestor)).toEqual(mais(baseGestor, 1, 1));
    });
  },
);
