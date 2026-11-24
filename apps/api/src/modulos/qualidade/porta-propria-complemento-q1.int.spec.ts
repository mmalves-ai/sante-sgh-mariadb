// Integração do complemento Q1 da porta própria da gestão da qualidade (modulos-proprios-3, qualidade-q1) contra o
// MariaDB do cliente de teste do lote (SGH_CLIENTE_TESTE), com a migração 18_QUA/96 aplicada. Só dados sintéticos, no
// estabelecimento da massa: uma comissão com uma reunião realizada e um sorteio de revisão, e uma auditoria interna (uma
// segunda com não conformidade ligada). As gravações passam pelo gravador real dentro da transação da gestão, com as
// tabelas do complemento somadas (a ligação pedida ao integrador); a versão anterior é conferida pela leitura `versoes`.
import { randomInt } from 'node:crypto';
import { ErroOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gravacaoDireta } from '../enfermagem/gravacao-direta.js';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { PortaGestaoPropriaCompleta, TABELAS_GESTAO_COMPLETA } from './gestao-porta-propria-completa.js';
import {
  CLIENTE_QUA,
  ctxBanco,
  encerrarMassaQualidade,
  type MassaQualidade,
  prepararMassaQualidade,
  SEM_BANCO_QUA,
} from './massa.spec-util.js';
import type { ContextoGestao, GravadorGestao } from './porta-gestao.js';
import { LeiturasGestaoComplementoD } from './porta-propria-complemento-d.js';
import {
  gravacoesComplementoQ1,
  LeiturasGestaoComplementoQ1,
  TABELAS_COMPLEMENTO_Q1,
} from './porta-propria-complemento-q1.js';

/** A porta completa com as gravações do complemento no gravador (a ligação que o integrador faz na porta completa). */
class PortaComQ1 extends PortaGestaoPropriaCompleta {
  override gravarSgh<T>(
    c: ContextoGestao,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorGestao) => Promise<T>,
  ): Promise<T> {
    return gravacaoDireta(this.executor, c, {
      nome: 'qualidade.gestao',
      tabelas: [...TABELAS_GESTAO_COMPLETA, ...TABELAS_COMPLEMENTO_Q1],
      trilha,
      gravador: (tx, est, anotacao) => ({
        ...this.gravador(tx, est, anotacao),
        ...gravacoesComplementoQ1(tx, est, anotacao),
      }),
      fn,
    });
  }
}

const T: TrilhaDaGravacao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'sorteio_revisao_prontuario',
  entidadeId: null,
  correlacao: 'teste-qualidade-q1',
};
const NUM = randomInt(100_000_000, 999_999_999);
const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? `${e.problema.status}:${e.problema.codigo}` : String(e);
  }
};

describe.skipIf(SEM_BANCO_QUA)(`complemento Q1 da gestão da qualidade no banco próprio (${CLIENTE_QUA})`, () => {
  let m: MassaQualidade;
  let porta: PortaComQ1;
  let c: ReturnType<typeof ctxBanco>;
  let cOutro: ReturnType<typeof ctxBanco>;
  let ids: { comissao: number; reuniao: number; sorteio: number; auditoria: number; auditoriaNc: number; nc: number };
  const agora = '2026-11-02T09:00:00';

  beforeAll(async () => {
    m = await prepararMassaQualidade('Q1');
    porta = new PortaComQ1(m.nucleo);
    c = ctxBanco(m.est, m.codigoEst, m.usuario);
    cOutro = ctxBanco(m.outro, m.codigoOutro, m.usuario);
    ids = await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'preparo-teste-qualidade-q1' }, async (e) => {
      const hoje = new Date();
      const garantir = async (sel: string, p: unknown[], ins: string, pi: unknown[]) =>
        (await e.uma<{ id: number }>(sel, p))?.id ?? e.inserir(ins, pi);
      const tipo = await garantir(
        'SELECT id FROM tipo_comissao WHERE codigo = ?',
        ['sintq1'],
        'INSERT INTO tipo_comissao (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        ['sintq1', 'Tipo de comissão sintético', hoje],
      );
      const categoria = await garantir(
        'SELECT id FROM categoria_auditoria_interna WHERE codigo = ?',
        ['sintq1'],
        'INSERT INTO categoria_auditoria_interna (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        ['sintq1', 'Categoria de auditoria sintética', hoje],
      );
      const comissao = await e.inserir(
        'INSERT INTO comissao_hospitalar (estabelecimento_id, tipo_comissao_id, nome, criado_em) VALUES (?, ?, ?, ?)',
        [m.est, tipo, `COMISSAO SINT Q1 ${NUM}`, hoje],
      );
      const reuniao = await e.inserir(
        `INSERT INTO reuniao_comissao (comissao_hospitalar_id, situacao, agendada_para, realizada_em, pauta, ata, criado_em)
         VALUES (?, 'realizada', ?, ?, 'Pauta sintética', 'Ata sintética', ?)`,
        [comissao, '2026-10-10 10:00:00', '2026-10-10 10:00:00', hoje],
      );
      const sorteio = await e.inserir(
        `INSERT INTO sorteio_revisao_prontuario (estabelecimento_id, comissao_hospitalar_id, competencia,
           universo_quantidade, quantidade, semente, hash_universo, sorteado_em, sorteado_por_usuario_id, criado_em)
         VALUES (?, ?, '2026-10-01', 10, 2, 'semente-sint', ?, ?, ?, ?)`,
        [m.est, comissao, '0'.repeat(64), hoje, m.usuario, hoje],
      );
      const auditoria = (n: string) =>
        e.inserir(
          `INSERT INTO auditoria_interna (estabelecimento_id, numero, titulo, categoria_auditoria_interna_id,
             inicio_previsto, fim_previsto, auditor_lider_usuario_id, situacao, criado_em)
           VALUES (?, ?, 'Auditoria sintética', ?, '2026-10-01', '2026-10-02', ?, 'em_execucao', ?)`,
          [m.est, n, categoria, m.usuario, hoje],
        );
      const aud = await auditoria(`SQ1-${NUM}-A`);
      const audNc = await auditoria(`SQ1-${NUM}-B`);
      const nc = await e.inserir(
        `INSERT INTO nao_conformidade_qualidade (estabelecimento_id, numero, tipo_origem, auditoria_interna_id,
           setor_funcional_id, descricao, classificacao, aberta_em, criado_em)
         VALUES (?, ?, 'auditoria', ?, ?, 'Não conformidade sintética', 'menor', ?, ?)`,
        [m.est, `SQ1${NUM}`.slice(0, 20), audNc, m.setor, hoje, hoje],
      );
      return { comissao, reuniao, sorteio, auditoria: aud, auditoriaNc: audNc, nc };
    });
  });

  afterAll(async () => {
    if (m && ids)
      await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'limpeza-teste-qualidade-q1' }, async (e) => {
        await e.executar('DELETE FROM nao_conformidade_qualidade WHERE id = ?', [ids.nc]);
        await e.executar('DELETE FROM auditoria_interna WHERE id IN (?, ?)', [ids.auditoria, ids.auditoriaNc]);
        await e.executar('DELETE FROM sorteio_revisao_prontuario WHERE id = ?', [ids.sorteio]);
        await e.executar('DELETE FROM reuniao_comissao WHERE id = ?', [ids.reuniao]);
        await e.executar('DELETE FROM comissao_hospitalar WHERE id = ?', [ids.comissao]);
      });
    await encerrarMassaQualidade(m);
  });

  it('altas do período: a consulta roda no modelo e o estabelecimento sem altas devolve vazio, sem corte', async () => {
    const leituras = new LeiturasGestaoComplementoQ1(m.nucleo);
    expect(await leituras.altasParaRevisao(c, '2026-10-01', '2026-11-01')).toEqual({ itens: [], cortada: false });
  });

  it('cancela o sorteio com o motivo; a versão anterior fica na trilha; o cancelado não se cancela de novo', async () => {
    const m1 = { id: ids.sorteio, versao: 1, motivo: 'Sorteio lançado errado', agora, usuario: m.login };
    expect(await codigo(porta.gravarSgh(cOutro, T, (g) => g.cancelarSorteioRevisao(m1)))).toBe(
      '409:versao-desatualizada',
    );
    expect(await porta.gravarSgh(c, T, (g) => g.cancelarSorteioRevisao(m1))).toEqual({ versao: 2 });
    const linha = await m.nucleo.lerSomente(c, (l) =>
      l.uma('SELECT situacao, justificativa FROM sorteio_revisao_prontuario WHERE id = ?', [ids.sorteio]),
    );
    expect(linha).toMatchObject({ situacao: 'cancelado', justificativa: 'Sorteio lançado errado' });
    const versoes = await new LeiturasGestaoComplementoD(m.nucleo).versoes(c, 'sorteio_revisao_prontuario', ids.sorteio);
    expect(versoes).toHaveLength(1);
    expect(versoes[0]).toMatchObject({ versao: 1, acao: 'cancelamento', motivo: 'Sorteio lançado errado' });
    expect(await codigo(porta.gravarSgh(c, T, (g) => g.cancelarSorteioRevisao({ ...m1, versao: 2 })))).toBe(
      '409:versao-desatualizada',
    );
  });

  it('assina a ata da reunião realizada uma vez só', async () => {
    const r = { id: ids.reuniao, versao: 1, agora, usuario: m.login };
    expect(await porta.gravarSgh(c, T, (g) => g.assinarAta(r))).toEqual({ versao: 2 });
    const linha = await m.nucleo.lerSomente(c, (l) =>
      l.uma<{ ata_assinada_por_usuario_id: number; assinada: number }>(
        'SELECT ata_assinada_por_usuario_id, ata_assinada_em IS NOT NULL AS assinada FROM reuniao_comissao WHERE id = ?',
        [ids.reuniao],
      ),
    );
    expect(Number(linha?.ata_assinada_por_usuario_id)).toBe(m.usuario);
    expect(Number(linha?.assinada)).toBe(1);
    expect(await codigo(porta.gravarSgh(c, T, (g) => g.assinarAta({ ...r, versao: 2 })))).toBe(
      '409:versao-desatualizada',
    );
  });

  it('cancela a auditoria sem dependentes e recusa a que tem não conformidade ligada', async () => {
    const a = { id: ids.auditoria, versao: 1, justificativa: 'Auditoria duplicada', agora, usuario: m.login };
    expect(await porta.gravarSgh(c, T, (g) => g.cancelarAuditoria(a))).toEqual({ versao: 2 });
    const linha = await m.nucleo.lerSomente(c, (l) =>
      l.uma('SELECT situacao, motivo_cancelamento FROM auditoria_interna WHERE id = ?', [ids.auditoria]),
    );
    expect(linha).toMatchObject({ situacao: 'cancelada', motivo_cancelamento: 'Auditoria duplicada' });
    const versoes = await new LeiturasGestaoComplementoD(m.nucleo).versoes(c, 'auditoria_interna', ids.auditoria);
    expect(versoes[0]).toMatchObject({ versao: 1, acao: 'cancelamento' });
    expect(
      await codigo(porta.gravarSgh(c, T, (g) => g.cancelarAuditoria({ ...a, id: ids.auditoriaNc }))),
    ).toBe('409:com-dependentes');
  });
});
