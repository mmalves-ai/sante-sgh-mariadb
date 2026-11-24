// Integração do complemento Q4 da porta própria da gestão da qualidade (modulos-proprios-3, qualidade-q4) contra o
// MariaDB do cliente de teste do lote (SGH_CLIENTE_TESTE). Só dados sintéticos: uma comissão em cada estabelecimento da
// massa, duas reuniões na do estabelecimento da sessão (uma com a ata assinada) e uma na do outro. Confere a leitura
// das reuniões (ordem, estabelecimento, nulo do inexistente) e a retificação da ata pela gravação real da porta
// completa com o gravador do complemento (a ligação pedida ao integrador): texto novo, versão, assinatura limpa e
// guardada como anterior, a versão anterior na trilha (lida por `versoes`) e a recusa da versão desatualizada.
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroOperacao } from '@sgh/nucleo';
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
import { LeiturasGestaoComplementoD } from './porta-propria-complemento-d.js';
import {
  gravadorComplementoQ4,
  LeiturasGestaoComplementoQ4,
  TABELAS_COMPLEMENTO_Q4,
} from './porta-propria-complemento-q4.js';

/** A porta completa com a retificação da ata do complemento no gravador (a ligação que o integrador faz). */
class PortaComReunioes extends PortaGestaoPropriaCompleta {
  override gravarSgh<T>(
    c: ContextoGestao,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorGestao) => Promise<T>,
  ): Promise<T> {
    return gravacaoDireta(this.executor, c, {
      nome: 'qualidade.gestao',
      tabelas: [...TABELAS_GESTAO_COMPLETA, ...TABELAS_COMPLEMENTO_Q4],
      trilha,
      gravador: (tx, est, anotacao = { motivo: null, dados: null }) => ({
        ...this.gravador(tx, est, anotacao),
        ...gravadorComplementoQ4(tx, est, anotacao),
      }),
      fn,
    });
  }
}

const T: TrilhaDaGravacao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'reuniao_comissao',
  entidadeId: null,
  correlacao: 'teste-qualidade-q4',
};
const NUM = randomInt(100_000_000, 999_999_999);

describe.skipIf(SEM_BANCO_QUA)(
  `complemento Q4 da gestão da qualidade no banco próprio (${CLIENTE_QUA})`,
  () => {
    let m: MassaQualidade;
    let leituras: LeiturasGestaoComplementoQ4;
    let porta: PortaComReunioes;
    let c: ReturnType<typeof ctxBanco>;
    let cOutro: ReturnType<typeof ctxBanco>;
    let ids: { comissao: number; comissaoOutro: number; antiga: number; recente: number; doOutro: number };

    beforeAll(async () => {
      m = await prepararMassaQualidade('Q4');
      leituras = new LeiturasGestaoComplementoQ4(m.nucleo);
      porta = new PortaComReunioes(m.nucleo);
      c = ctxBanco(m.est, m.codigoEst, m.usuario);
      cOutro = ctxBanco(m.outro, m.codigoOutro, m.usuario);
      ids = await m.nucleo.escrever(
        { cliente: CLIENTE_QUA, correlacao: 'preparo-teste-qualidade-q4' },
        async (e) => {
          const hoje = new Date();
          const tipo =
            (await e.uma<{ id: number }>('SELECT id FROM tipo_comissao WHERE codigo = ?', ['sint_q4']))?.id ??
            (await e.inserir(
              "INSERT INTO tipo_comissao (codigo, descricao, criado_em) VALUES ('sint_q4', 'Comissão sintética', ?)",
              [hoje],
            ));
          const comissao = (est: number) =>
            e.inserir(
              `INSERT INTO comissao_hospitalar (estabelecimento_id, tipo_comissao_id, nome, criado_em)
               VALUES (?, ?, ?, ?)`,
              [est, tipo, `COMISSAO SINTETICA Q4 ${NUM}`, hoje],
            );
          const reuniao = (com: number, realizada: string, ata: string) =>
            e.inserir(
              `INSERT INTO reuniao_comissao (comissao_hospitalar_id, tipo, situacao, agendada_para, realizada_em, pauta,
                 ata, presentes_registrados, membros_quantidade, presentes_quantidade, criado_em, criado_por)
               VALUES (?, 'ordinaria', 'realizada', ?, ?, 'Pauta sintética', ?, '["MEMBRO SINT A","MEMBRO SINT B"]',
                 3, 2, ?, ?)`,
              [com, realizada, realizada, ata, hoje, m.usuario],
            );
          const com = await comissao(m.est);
          const comOutro = await comissao(m.outro);
          const antiga = await reuniao(com, '2026-09-10 14:00:00', 'Ata sintética antiga');
          const recente = await reuniao(com, '2026-10-08 14:00:00', 'Ata sintética recente');
          // A recente com a ata assinada pelo gestor da massa.
          await e.executar(
            'UPDATE reuniao_comissao SET ata_assinada_em = ?, ata_assinada_por_usuario_id = ? WHERE id = ?',
            ['2026-10-09 09:00:00', m.gestor, recente],
          );
          const doOutro = await reuniao(comOutro, '2026-10-01 14:00:00', 'Ata sintética do outro');
          return { comissao: com, comissaoOutro: comOutro, antiga, recente, doOutro };
        },
      );
    });

    afterAll(async () => {
      await encerrarMassaQualidade(m);
    });

    it('as reuniões da comissão vêm da mais recente para a mais antiga, só no estabelecimento da sessão', async () => {
      const rs = await leituras.reunioes(c, ids.comissao);
      expect(rs.map((x) => x.id)).toEqual([ids.recente, ids.antiga]);
      expect(rs[1]).toMatchObject({
        comissao: ids.comissao,
        tipo: 'ordinaria',
        realizadaEm: '2026-09-10T14:00:00',
        pauta: 'Pauta sintética',
        ata: 'Ata sintética antiga',
        presentes: '["MEMBRO SINT A","MEMBRO SINT B"]',
        membrosTotal: 3,
        presentesTotal: 2,
        registradaPor: m.login,
        versao: 1,
        ataAssinadaEm: null,
        canceladaEm: null,
      });
      expect(rs[0]).toMatchObject({ ataAssinadaEm: '2026-10-09T09:00:00', ataAssinadaPor: m.loginGestor });
      expect(await leituras.reunioes(cOutro, ids.comissao)).toEqual([]);
      expect(await leituras.reuniao(cOutro, ids.antiga)).toBeNull();
      expect((await leituras.reuniao(cOutro, ids.doOutro))?.ata).toBe('Ata sintética do outro');
      expect(await leituras.reuniao(c, ids.doOutro)).toBeNull();
    });

    it('retificar a ata grava o texto novo e a versão anterior na trilha', async () => {
      const r = await porta.gravarSgh(c, T, (g) =>
        g.retificarAta({
          id: ids.antiga,
          versao: 1,
          pauta: 'Pauta sintética retificada',
          ata: 'Ata sintética retificada',
          presentes: '["MEMBRO SINT A"]',
          presentesTotal: 1,
          convidados: 'Convidado sintético',
          deliberacoes: 'Deliberação sintética',
          justificativa: 'Correção sintética do texto',
          assinaturaAtual: null,
          agora: '2026-11-02T09:00:00',
          usuario: m.login,
        }),
      );
      expect(r).toEqual({ versao: 2 });
      expect(await leituras.reuniao(c, ids.antiga)).toMatchObject({
        ata: 'Ata sintética retificada',
        pauta: 'Pauta sintética retificada',
        presentes: '["MEMBRO SINT A"]',
        presentesTotal: 1,
        membrosTotal: 3,
        convidados: 'Convidado sintético',
        deliberacoes: 'Deliberação sintética',
        versao: 2,
      });
      const vs = await new LeiturasGestaoComplementoD(m.nucleo).versoes(c, 'reuniao_comissao', ids.antiga);
      expect(vs).toHaveLength(1);
      expect(vs[0]).toMatchObject({
        versao: 1,
        acao: 'retificacao',
        motivo: 'Correção sintética do texto',
        alteradoPor: m.login,
      });
      expect(vs[0]?.dados).toMatchObject({ ata: 'Ata sintética antiga', versao: 1 });
    });

    it('retificar a ata assinada limpa a assinatura e a guarda como a anterior', async () => {
      await porta.gravarSgh(c, T, (g) =>
        g.retificarAta({
          id: ids.recente,
          versao: 1,
          pauta: 'Pauta sintética',
          ata: 'Ata sintética recente retificada',
          presentes: '["MEMBRO SINT A","MEMBRO SINT B"]',
          presentesTotal: 2,
          convidados: null,
          deliberacoes: null,
          justificativa: 'Retificação sintética da ata assinada',
          assinaturaAtual: { em: '2026-10-09T09:00:00', por: m.loginGestor },
          agora: '2026-11-02T09:05:00',
          usuario: m.login,
        }),
      );
      expect(await leituras.reuniao(c, ids.recente)).toMatchObject({
        ata: 'Ata sintética recente retificada',
        versao: 2,
        ataAssinadaEm: null,
        ataAssinadaPor: null,
        assinaturaAnteriorEm: '2026-10-09T09:00:00',
        assinaturaAnteriorPor: m.loginGestor,
      });
    });

    it('a versão desatualizada e a reunião de outro estabelecimento recusam sem gravar', async () => {
      const tentar = (id: number, versao: number) =>
        porta
          .gravarSgh(c, T, (g) =>
            g.retificarAta({
              id,
              versao,
              pauta: 'X',
              ata: 'X',
              presentes: '[]',
              presentesTotal: 0,
              convidados: null,
              deliberacoes: null,
              justificativa: 'Tentativa sintética',
              assinaturaAtual: null,
              agora: '2026-11-02T09:10:00',
              usuario: m.login,
            }),
          )
          .catch((e: unknown) => e);
      for (const e of [await tentar(ids.antiga, 1), await tentar(ids.doOutro, 1)]) {
        expect(e).toBeInstanceOf(ErroOperacao);
        expect((e as ErroOperacao).problema.codigo).toBe('versao-desatualizada');
      }
      expect((await leituras.reuniao(c, ids.antiga))?.versao).toBe(2);
      expect((await leituras.reuniao(cOutro, ids.doOutro))?.ata).toBe('Ata sintética do outro');
    });
  },
);
