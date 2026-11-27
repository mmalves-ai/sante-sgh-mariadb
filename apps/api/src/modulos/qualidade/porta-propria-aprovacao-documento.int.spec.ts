// Contrato de efeito do fluxo de aprovação por etapas do documento da qualidade no banco próprio (F3.9
// publicarDocumento, C2-060): a submissão grava a revisão em revisão e as três etapas (elaboração aprovada pelo autor,
// revisão e aprovação pendentes), nada vigente; a decisão fora de ordem ou de quem não é o designado recusa sem gravar;
// a revisão aprovada passa à aprovação; a aprovação publica (vigente, aprovador, ficha apontando); a revisão nova
// devolvida com parecer volta a rascunho e a vigente segue. Dados SINTÉTICOS no cliente de teste.
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroOperacao } from '@sgh/nucleo';
import { montarEtapasAprovacao } from '@sgh/dominio-qualidade';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { gravacaoDireta } from '../enfermagem/gravacao-direta.js';
import type { GravadorGestao, SubmissaoDocumentoNova } from './porta-gestao.js';
import {
  CLIENTE_QUA,
  ctxBanco,
  encerrarMassaQualidade,
  type MassaQualidade,
  prepararMassaQualidade,
  SEM_BANCO_QUA,
} from './massa.spec-util.js';
import {
  gravacoesAprovacaoDocumento,
  lerAprovacoesPendentes,
  lerSubmissaoDocumento,
  TABELAS_APROVACAO_DOCUMENTO,
} from './porta-propria-aprovacao-documento.js';
import { TABELAS_DOCUMENTOS } from './porta-propria-documentos.js';

const T: TrilhaDaGravacao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'documento_qualidade_versao',
  entidadeId: null,
  correlacao: 'teste-qualidade-aprovacao',
};
const NUM = randomInt(100_000_000, 999_999_999);

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof ErroOperacao) return `${e.problema.status}:${e.problema.codigo}`;
    throw e;
  }
}

describe.skipIf(SEM_BANCO_QUA)(`fluxo de aprovação do documento no banco próprio (${CLIENTE_QUA})`, () => {
  let m: MassaQualidade;
  let c: ReturnType<typeof ctxBanco>;
  const tipo = `tap${NUM}`;
  const codigo = `POP-AP-${NUM}`;
  const aprovador = `l0403qap${NUM}.aprov`;
  const ids = { tipo: 0, aprovador: 0, r1: 0, r2: 0 };

  const gravar = <R>(fn: (g: GravadorGestao) => Promise<R>) =>
    gravacaoDireta(m.nucleo.criarExecutor(), c, {
      nome: 'qualidade.gestao',
      tabelas: [...TABELAS_DOCUMENTOS, ...TABELAS_APROVACAO_DOCUMENTO],
      trilha: T,
      gravador: (tx, est) => gravacoesAprovacaoDocumento(tx, est) as unknown as GravadorGestao,
      fn,
    });
  const ler = <R>(fn: (l: Parameters<typeof lerSubmissaoDocumento>[0]) => Promise<R>) =>
    m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'conferencia-aprovacao' }, (e) => fn(e));
  const uma = (sql: string, p: unknown[]) =>
    m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'conferencia-aprovacao' }, (e) =>
      e.uma<Record<string, unknown>>(sql, p),
    );
  const submissao = (
    substitui: { id: number; versao: number } | null,
    agora: string,
  ): SubmissaoDocumentoNova => {
    const et = montarEtapasAprovacao(m.login, m.loginGestor, aprovador);
    if ('recusa' in et) throw new Error(et.recusa);
    return {
      codigo,
      tipo,
      titulo: 'Higiene das mãos no fluxo (sintético)',
      area: '',
      setorId: m.setor,
      conteudo: 'Passo 1: friccionar as mãos por 30 segundos (texto sintético).',
      resumoAlteracao: null,
      vigenciaAte: '2027-11-10',
      exigeCiencia: true,
      substitui,
      etapas: et.etapas,
      resumo: (r) => String(r).padStart(64, 'a'),
      agora,
      usuario: m.login,
    };
  };
  const decidir = (
    submissaoId: number,
    sequencia: number,
    usuario: string,
    decisao: 'aprovada' | 'devolvida' = 'aprovada',
    parecer: string | null = null,
  ) =>
    gravar((g) =>
      g.decidirEtapaDocumento!({
        submissao: submissaoId,
        sequencia,
        decisao,
        parecer,
        agora: '2026-11-20T09:00:00',
        usuario,
      }),
    );

  beforeAll(async () => {
    m = await prepararMassaQualidade('AP');
    c = ctxBanco(m.est, m.codigoEst, m.usuario);
    await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'preparo-aprovacao' }, async (e) => {
      ids.tipo = await e.inserir(
        "INSERT INTO tipo_documento_qualidade (codigo, descricao, categoria, criado_em) VALUES (?, 'TIPO SINT', 'procedimento_operacional', ?)",
        [tipo, new Date()],
      );
      ids.aprovador = await e.inserir(
        "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, 'USUARIO SINTETICO APROVADOR', 'pessoa', TRUE, ?)",
        [aprovador, new Date()],
      );
    });
  });

  afterAll(async () => {
    if (!m) return;
    await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'limpeza-aprovacao' }, async (e) => {
      const sub = `SELECT v.id FROM documento_qualidade_versao v JOIN documento_qualidade d ON d.id = v.documento_qualidade_id WHERE d.codigo = ?`;
      await e.executar(
        `DELETE FROM documento_qualidade_aprovacao WHERE documento_qualidade_versao_id IN (SELECT id FROM (${sub}) x)`,
        [codigo],
      );
      await e.executar(
        'UPDATE documento_qualidade SET documento_qualidade_versao_id = NULL WHERE codigo = ?',
        [codigo],
      );
      await e.executar(
        'DELETE v FROM documento_qualidade_versao v JOIN documento_qualidade d ON d.id = v.documento_qualidade_id WHERE d.codigo = ?',
        [codigo],
      );
      await e.executar('DELETE FROM documento_qualidade WHERE codigo = ?', [codigo]);
      await e.executar('DELETE FROM tipo_documento_qualidade WHERE id = ?', [ids.tipo]);
      await e.executar('DELETE FROM usuario WHERE id = ?', [ids.aprovador]);
    });
    await encerrarMassaQualidade(m);
  });

  it('submete: revisão em revisão, três etapas com responsável, nada vigente; a pendência é só do revisor', async () => {
    const r = await gravar((g) => g.submeterDocumento!(submissao(null, '2026-11-19T08:00:00')));
    ids.r1 = r.id;
    expect(r.revisao).toBe(1);
    const v = await uma(
      'SELECT situacao, aprovador_usuario_id, publicado_em FROM documento_qualidade_versao WHERE id = ?',
      [r.id],
    );
    expect(v).toMatchObject({ situacao: 'em_revisao', aprovador_usuario_id: null, publicado_em: null });
    const lida = await ler((l) => lerSubmissaoDocumento(l, m.est, r.id));
    expect(lida?.etapas.map((e) => [e.etapa, e.situacao, e.responsavel])).toEqual([
      ['elaboracao', 'aprovada', m.login.toUpperCase()],
      ['revisao', 'pendente', m.loginGestor.toUpperCase()],
      ['aprovacao', 'pendente', aprovador.toUpperCase()],
    ]);
    expect(
      (await ler((l) => lerAprovacoesPendentes(l, m.est, m.loginGestor))).map((x) => x.submissao),
    ).toEqual([r.id]);
    expect(await ler((l) => lerAprovacoesPendentes(l, m.est, aprovador))).toEqual([]);
    expect(
      await codigoDe(gravar((g) => g.submeterDocumento!(submissao(null, '2026-11-19T08:05:00')))),
    ).toMatch(/submissao-pendente/);
  });

  it('recusa fora de ordem e quem não é o designado, sem gravar; revisão aprovada passa à aprovação; a aprovação publica', async () => {
    expect(await codigoDe(decidir(ids.r1, 3, aprovador))).toMatch(/etapa-fora-de-ordem/);
    expect(await codigoDe(decidir(ids.r1, 2, aprovador))).toMatch(/decisor-nao-designado/);
    expect(await decidir(ids.r1, 2, m.loginGestor)).toEqual({ situacao: 'em_aprovacao', publicar: false });
    expect(await uma('SELECT situacao FROM documento_qualidade_versao WHERE id = ?', [ids.r1])).toMatchObject(
      {
        situacao: 'em_aprovacao',
      },
    );
    expect(await decidir(ids.r1, 3, aprovador)).toEqual({ situacao: 'vigente', publicar: true });
    const v = await uma(
      'SELECT situacao, aprovador_usuario_id FROM documento_qualidade_versao WHERE id = ?',
      [ids.r1],
    );
    expect(v).toMatchObject({ situacao: 'vigente' });
    expect(Number(v?.['aprovador_usuario_id'])).toBe(ids.aprovador);
    const f = await uma(
      'SELECT situacao, documento_qualidade_versao_id FROM documento_qualidade WHERE codigo = ?',
      [codigo],
    );
    expect(f?.['situacao']).toBe('vigente');
    expect(Number(f?.['documento_qualidade_versao_id'])).toBe(ids.r1);
    const a = await uma(
      'SELECT situacao, decidido_em IS NOT NULL AS decidida FROM documento_qualidade_aprovacao WHERE documento_qualidade_versao_id = ? AND sequencia = 3',
      [ids.r1],
    );
    expect(a).toMatchObject({ situacao: 'aprovada' });
  });

  it('a revisão nova devolvida com parecer volta a rascunho e a vigente segue; sem parecer recusa', async () => {
    const r = await gravar((g) =>
      g.submeterDocumento!(submissao({ id: ids.r1, versao: 1 + 0 }, '2026-11-21T08:00:00')),
    ).catch(async () => {
      const v = await uma('SELECT versao FROM documento_qualidade_versao WHERE id = ?', [ids.r1]);
      return gravar((g) =>
        g.submeterDocumento!(submissao({ id: ids.r1, versao: Number(v?.['versao']) }, '2026-11-21T08:00:00')),
      );
    });
    ids.r2 = r.id;
    expect(r.revisao).toBe(2);
    expect(await codigoDe(decidir(ids.r2, 2, m.loginGestor, 'devolvida', 'curto'))).toMatch(
      /parecer-obrigatorio/,
    );
    expect(
      await decidir(ids.r2, 2, m.loginGestor, 'devolvida', 'Falta o passo da secagem das mãos.'),
    ).toEqual({
      situacao: 'devolvida',
      publicar: false,
    });
    expect(await uma('SELECT situacao FROM documento_qualidade_versao WHERE id = ?', [ids.r2])).toMatchObject(
      {
        situacao: 'rascunho',
      },
    );
    expect(await uma('SELECT situacao FROM documento_qualidade_versao WHERE id = ?', [ids.r1])).toMatchObject(
      {
        situacao: 'vigente',
      },
    );
    const lida = await ler((l) => lerSubmissaoDocumento(l, m.est, ids.r2));
    expect(lida?.situacao).toBe('devolvida');
    expect(lida?.etapas[1]?.parecer).toBe('Falta o passo da secagem das mãos.');
  });
});
