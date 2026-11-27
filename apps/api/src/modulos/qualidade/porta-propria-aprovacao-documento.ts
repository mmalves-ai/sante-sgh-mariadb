// Fluxo de aprovação por etapas do documento da qualidade no banco próprio (F3.9 publicarDocumento, C2-060).
// A submissão grava a revisão nova em documento_qualidade_versao (situação em_revisao, nada vigente) e as etapas em
// documento_qualidade_aprovacao (elaboração aprovada pelo autor; revisão e aprovação pendentes, com o responsável).
// Cada decisão é do responsável, na própria sessão, conferida por conferirDecisaoEtapa sobre as etapas travadas.
// A última aprovada publica: a revisão fica vigente, a anterior obsoleta e a ficha aponta a nova, na mesma transação.
// Devolver ou reprovar encerra o fluxo: a revisão volta a rascunho (fora das listas de documentos).
import type {
  AprovacaoPendenteDocumento,
  EtapaAprovacaoDocumentoCodigo,
  SituacaoEtapaDocumento,
  SituacaoSubmissaoDocumento,
  SubmissaoDocumentoLida,
} from '@sgh/contratos';
import {
  conferirDecisaoEtapa,
  MENSAGENS_RECUSA_APROVACAO_DOCUMENTO,
  type RecusaAprovacaoDocumento,
} from '@sgh/dominio-qualidade';
import { recusa, type TxOperacao } from '@sgh/nucleo';
import { exigirUsuario, type L, type Linha, n, paraBanco, texto } from './apoio-propria.js';
import type { GravadorGestao } from './porta-gestao.js';
import { recusaVersaoGestao } from './tipos.js';

export const TABELAS_APROVACAO_DOCUMENTO = ['documento_qualidade_aprovacao'] as const;

export type GravacoesAprovacaoDocumento = Required<
  Pick<GravadorGestao, 'submeterDocumento' | 'decidirEtapaDocumento'>
>;

const recusar = (r: RecusaAprovacaoDocumento) => recusa(r, MENSAGENS_RECUSA_APROVACAO_DOCUMENTO[r]);
const dia = (agora: string): string => agora.slice(0, 10);
const ABERTAS = "('em_revisao','em_aprovacao')";

/** A situação da revisão no banco vista pelo fluxo (rascunho depois de submetida = devolvida ao autor). */
export const SITUACAO_SUBMISSAO: Readonly<Record<string, SituacaoSubmissaoDocumento>> = {
  em_revisao: 'em_revisao',
  em_aprovacao: 'em_aprovacao',
  vigente: 'vigente',
  obsoleta: 'vigente',
  rascunho: 'devolvida',
};

export function gravacoesAprovacaoDocumento(tx: TxOperacao, est: number): GravacoesAprovacaoDocumento {
  async function setor(area: string, setorId: number | null): Promise<number> {
    const s = await tx.uma<Linha>(
      setorId != null
        ? 'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL'
        : `SELECT MIN(id) AS id FROM setor_funcional WHERE estabelecimento_id = ? AND excluido_em IS NULL
             AND (UPPER(nome) = UPPER(?) OR UPPER(codigo) = UPPER(?)) HAVING COUNT(*) = 1`,
      setorId != null ? [setorId, est] : [est, area.trim(), area.trim()],
    );
    if (!s?.['id'])
      throw recusa('area-inexistente', 'A área informada não é um setor deste estabelecimento.');
    return n(s['id']);
  }

  return {
    submeterDocumento: async (d) => {
      const t = await tx.uma<Linha>(
        'SELECT id FROM tipo_documento_qualidade WHERE codigo = ? AND ativo = TRUE',
        [d.tipo],
      );
      if (!t)
        throw recusa(
          'tipo-documento-inexistente',
          'O tipo de documento informado não existe ou está inativo.',
        );
      const setorId = await setor(d.area, d.setorId);
      const autor = await exigirUsuario(tx, d.usuario);
      const responsaveis = new Map<string, number>();
      for (const e of d.etapas) responsaveis.set(e.responsavel, await exigirUsuario(tx, e.responsavel));
      const [ficha] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, versao FROM documento_qualidade WHERE estabelecimento_id = ? AND codigo = ? AND excluido_em IS NULL',
        [est, d.codigo],
        { teto: 1 },
      );
      const revisoes = ficha
        ? await tx.consultar<Linha>(
            'SELECT id, versao, numero_versao, situacao FROM documento_qualidade_versao WHERE documento_qualidade_id = ?',
            [n(ficha['id'])],
          )
        : [];
      if (revisoes.some((r) => ['em_revisao', 'em_aprovacao'].includes(texto(r['situacao']))))
        throw recusar('submissao-pendente');
      const vigente = revisoes.find((r) => texto(r['situacao']) === 'vigente');
      if (d.substitui) {
        if (!vigente || n(vigente['id']) !== d.substitui.id || n(vigente['versao']) !== d.substitui.versao)
          throw recusaVersaoGestao('O documento');
      } else if (vigente)
        throw recusa('codigo-ja-vigente', 'O código já tem revisão vigente: revise a vigente.');
      const revisao =
        Math.max(0, ...revisoes.map((r) => Number(/^\s*(\d+)/.exec(texto(r['numero_versao']))?.[1] ?? 0))) +
        1;
      const agora = paraBanco(d.agora);
      const documento = ficha
        ? n(ficha['id'])
        : await tx.incluir('documento_qualidade', {
            estabelecimento_id: est,
            codigo: d.codigo,
            titulo: d.titulo,
            tipo_documento_qualidade_id: n(t['id']),
            setor_funcional_id: setorId,
            exige_ciencia: d.exigeCiencia,
            dono_usuario_id: autor,
            situacao: 'em_revisao',
            proxima_revisao: d.vigenciaAte,
          });
      const hash = d.resumo(revisao).toLowerCase();
      const revisor = d.etapas.find((e) => e.etapa === 'revisao');
      const id = await tx.incluir('documento_qualidade_versao', {
        documento_qualidade_id: documento,
        operacao: 'inclusao',
        dados: JSON.stringify({
          resumoSha256: hash,
          substitui: d.substitui,
          titulo: d.titulo,
          tipoId: n(t['id']),
          setorId,
          exigeCiencia: d.exigeCiencia,
          vigenciaAte: d.vigenciaAte,
        }),
        ocorrido_em: agora,
        usuario_id: autor,
        numero_versao: String(revisao),
        situacao: 'em_revisao',
        formato: 'texto',
        conteudo: d.conteudo,
        resumo_sha256: hash,
        motivo_alteracao: d.resumoAlteracao,
        elaborador_usuario_id: autor,
        revisor_usuario_id: revisor ? (responsaveis.get(revisor.responsavel) ?? null) : null,
        proxima_revisao: d.vigenciaAte,
      });
      for (const e of d.etapas)
        await tx.incluir('documento_qualidade_aprovacao', {
          documento_qualidade_versao_id: id,
          sequencia: e.sequencia,
          etapa: e.etapa,
          responsavel_usuario_id: responsaveis.get(e.responsavel) ?? null,
          situacao: e.situacao,
          decidido_em: e.situacao === 'pendente' ? null : agora,
          decisor_usuario_id: e.situacao === 'pendente' ? null : autor,
        });
      return { id, revisao };
    },

    decidirEtapaDocumento: async (d) => {
      const [v] = await tx.consultarParaAtualizar<Linha>(
        `SELECT v.id, v.versao, v.situacao, v.dados, v.documento_qualidade_id AS documento
           FROM documento_qualidade_versao v JOIN documento_qualidade d ON d.id = v.documento_qualidade_id
          WHERE v.id = ? AND d.estabelecimento_id = ? AND d.excluido_em IS NULL`,
        [d.submissao, est],
        { teto: 1 },
      );
      if (!v || !['em_revisao', 'em_aprovacao'].includes(texto(v['situacao'])))
        throw recusaVersaoGestao('A revisão submetida');
      const etapas = await tx.consultarParaAtualizar<Linha>(
        `SELECT a.id, a.versao, a.sequencia, a.etapa, a.situacao, UPPER(u.login) AS responsavel
           FROM documento_qualidade_aprovacao a LEFT JOIN usuario u ON u.id = a.responsavel_usuario_id
          WHERE a.documento_qualidade_versao_id = ? AND a.excluido_em IS NULL ORDER BY a.sequencia`,
        [d.submissao],
        { teto: 20 },
      );
      const efeito = conferirDecisaoEtapa({
        etapas: etapas.map((e) => ({
          sequencia: n(e['sequencia']),
          etapa: texto(e['etapa']) as EtapaAprovacaoDocumentoCodigo,
          responsavel: texto(e['responsavel']),
          situacao: texto(e['situacao']) as SituacaoEtapaDocumento,
        })),
        sequencia: d.sequencia,
        decisor: d.usuario,
        decisao: d.decisao,
        parecer: d.parecer,
      });
      if ('recusa' in efeito) throw recusar(efeito.recusa);
      const decisor = await exigirUsuario(tx, d.usuario);
      const agora = paraBanco(d.agora);
      const alvo = etapas.find((e) => n(e['sequencia']) === d.sequencia)!;
      await tx.alterar('documento_qualidade_aprovacao', n(alvo['id']), n(alvo['versao']), {
        situacao: d.decisao,
        parecer: d.parecer,
        decidido_em: agora,
        decisor_usuario_id: decisor,
      });
      const versaoV = n(v['versao']);
      if (!efeito.publicar) {
        await tx.alterar('documento_qualidade_versao', d.submissao, versaoV, {
          situacao: efeito.situacao === 'devolvida' ? 'rascunho' : efeito.situacao,
        });
        return efeito;
      }
      const bruto = v['dados'];
      const dados = (typeof bruto === 'string' ? JSON.parse(bruto || '{}') : (bruto ?? {})) as {
        substitui?: { id: number; versao: number } | null;
        titulo?: string;
        tipoId?: number;
        setorId?: number;
        exigeCiencia?: boolean;
        vigenciaAte?: string;
      };
      const documento = n(v['documento']);
      const [ficha] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, versao FROM documento_qualidade WHERE id = ?',
        [documento],
        { teto: 1 },
      );
      const [vig] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, versao FROM documento_qualidade_versao WHERE documento_qualidade_id = ? AND situacao = 'vigente'`,
        [documento],
        { teto: 1 },
      );
      const sub = dados.substitui ?? null;
      if (sub ? !vig || n(vig['id']) !== sub.id || n(vig['versao']) !== sub.versao : vig)
        throw recusaVersaoGestao('O documento');
      if (vig)
        await tx.alterar('documento_qualidade_versao', n(vig['id']), n(vig['versao']), {
          situacao: 'obsoleta',
          vigencia_fim: dia(d.agora),
        });
      await tx.alterar('documento_qualidade_versao', d.submissao, versaoV, {
        situacao: 'vigente',
        aprovador_usuario_id: decisor,
        aprovado_em: agora,
        publicado_em: agora,
        vigencia_inicio: dia(d.agora),
      });
      if (ficha)
        await tx.alterar('documento_qualidade', documento, n(ficha['versao']), {
          ...(dados.titulo ? { titulo: dados.titulo } : {}),
          ...(dados.tipoId ? { tipo_documento_qualidade_id: dados.tipoId } : {}),
          ...(dados.setorId ? { setor_funcional_id: dados.setorId } : {}),
          ...(dados.exigeCiencia === undefined ? {} : { exige_ciencia: dados.exigeCiencia }),
          situacao: 'vigente',
          ultima_revisao: dia(d.agora),
          ...(dados.vigenciaAte ? { proxima_revisao: dados.vigenciaAte } : {}),
          documento_qualidade_versao_id: d.submissao,
        });
      return efeito;
    },
  };
}

const SQL_SUBMISSAO = `
  SELECT v.id, d.codigo, v.numero_versao, COALESCE(JSON_VALUE(v.dados, '$.titulo'), d.titulo) AS titulo,
         t.codigo AS tipo, v.conteudo, UPPER(ue.login) AS elaborador, v.ocorrido_em, v.situacao
    FROM documento_qualidade_versao v
    JOIN documento_qualidade d ON d.id = v.documento_qualidade_id
    JOIN tipo_documento_qualidade t ON t.id = COALESCE(JSON_VALUE(v.dados, '$.tipoId'), d.tipo_documento_qualidade_id)
    LEFT JOIN usuario ue ON ue.id = v.elaborador_usuario_id
   WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL`;

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : texto(v).replace(' ', 'T'));
const isoN = (v: unknown): string | null => (v == null ? null : iso(v));

/** A revisão submetida com as etapas (só as que passaram pelo fluxo: com etapas gravadas). */
export async function lerSubmissaoDocumento(
  l: L,
  est: number,
  id: number,
): Promise<SubmissaoDocumentoLida | null> {
  const v = await l.uma<Linha>(`${SQL_SUBMISSAO} AND v.id = ?`, [est, id]);
  if (!v) return null;
  const etapas = await l.consultar<Linha>(
    `SELECT a.sequencia, a.etapa, UPPER(u.login) AS responsavel, a.situacao, a.parecer, a.decidido_em,
            UPPER(dc.login) AS decisor
       FROM documento_qualidade_aprovacao a
       LEFT JOIN usuario u ON u.id = a.responsavel_usuario_id
       LEFT JOIN usuario dc ON dc.id = a.decisor_usuario_id
      WHERE a.documento_qualidade_versao_id = ? AND a.excluido_em IS NULL ORDER BY a.sequencia`,
    [id],
  );
  if (!etapas.length) return null;
  return {
    id: n(v['id']),
    codigo: texto(v['codigo']),
    revisao: n(v['numero_versao']),
    titulo: texto(v['titulo']),
    tipo: texto(v['tipo']),
    conteudo: texto(v['conteudo']),
    elaboradoPor: texto(v['elaborador']),
    submetidoEm: iso(v['ocorrido_em']),
    situacao: SITUACAO_SUBMISSAO[texto(v['situacao'])] ?? 'devolvida',
    etapas: etapas.map((e) => ({
      sequencia: n(e['sequencia']),
      etapa: texto(e['etapa']) as EtapaAprovacaoDocumentoCodigo,
      responsavel: texto(e['responsavel']),
      situacao: texto(e['situacao']) as SituacaoEtapaDocumento,
      parecer: e['parecer'] == null ? null : texto(e['parecer']),
      decididoEm: isoN(e['decidido_em']),
      decisor: e['decisor'] == null ? null : texto(e['decisor']),
    })),
  };
}

/** As etapas pendentes do login cujas anteriores estão aprovadas, da submissão mais antiga para a mais nova. */
export async function lerAprovacoesPendentes(
  l: L,
  est: number,
  login: string,
): Promise<AprovacaoPendenteDocumento[]> {
  const r = await l.consultar<Linha>(
    `SELECT x.*, a.etapa, a.sequencia FROM (${SQL_SUBMISSAO} AND v.situacao IN ${ABERTAS}) x
       JOIN documento_qualidade_aprovacao a ON a.documento_qualidade_versao_id = x.id
       JOIN usuario u ON u.id = a.responsavel_usuario_id
      WHERE a.situacao = 'pendente' AND a.excluido_em IS NULL AND UPPER(u.login) = UPPER(?)
        AND NOT EXISTS (SELECT 1 FROM documento_qualidade_aprovacao p
                         WHERE p.documento_qualidade_versao_id = a.documento_qualidade_versao_id
                           AND p.sequencia < a.sequencia AND p.excluido_em IS NULL
                           AND p.situacao NOT IN ('aprovada','dispensada'))
      ORDER BY x.ocorrido_em, x.id`,
    [est, login.trim()],
  );
  return r.map((x) => ({
    submissao: n(x['id']),
    codigo: texto(x['codigo']),
    revisao: n(x['numero_versao']),
    titulo: texto(x['titulo']),
    etapa: texto(x['etapa']) as EtapaAprovacaoDocumentoCodigo,
    sequencia: n(x['sequencia']),
    elaboradoPor: texto(x['elaborador']),
    submetidoEm: iso(x['ocorrido_em']),
  }));
}
