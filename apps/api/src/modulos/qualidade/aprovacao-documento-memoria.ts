// Fluxo de aprovação por etapas do documento da qualidade na porta em MEMÓRIA (fonte sintética e E2E padrão): as
// mesmas regras do domínio (conferirDecisaoEtapa) e o mesmo efeito da porta própria (porta-propria-aprovacao-documento):
// nada vigente até a última etapa aprovada; a publicação obsoleta a revisão substituída.
import type { AprovacaoPendenteDocumento, SubmissaoDocumentoLida } from '@sgh/contratos';
import {
  conferirDecisaoEtapa,
  MENSAGENS_RECUSA_APROVACAO_DOCUMENTO,
  type RecusaAprovacaoDocumento,
} from '@sgh/dominio-qualidade';
import { recusa } from '@sgh/nucleo';
import type { GravadorGestao, SubmissaoDocumentoNova } from './porta-gestao.js';
import { type DocumentoQualidadeRegistrado, recusaVersaoGestao } from './tipos.js';

export interface SubmissaoMemoria {
  dados: Omit<SubmissaoDocumentoNova, 'resumo' | 'etapas' | 'agora' | 'usuario'>;
  lida: SubmissaoDocumentoLida;
  hash: string;
}

export interface EstadoAprovacaoMemoria {
  documentos: (DocumentoQualidadeRegistrado & { conteudo: string })[];
  submissoes?: SubmissaoMemoria[];
}

const recusar = (r: RecusaAprovacaoDocumento) => recusa(r, MENSAGENS_RECUSA_APROVACAO_DOCUMENTO[r]);
const seg = (t: string) => (t.length === 16 ? `${t}:00` : t.slice(0, 19));

export function gravacoesAprovacaoMemoria(
  s: EstadoAprovacaoMemoria,
  novoId: () => number,
): Required<Pick<GravadorGestao, 'submeterDocumento' | 'decidirEtapaDocumento'>> {
  const subs = (): SubmissaoMemoria[] => (s.submissoes ??= []);
  return {
    submeterDocumento: async (d) => {
      if (
        subs().some(
          (x) => x.lida.codigo === d.codigo && ['em_revisao', 'em_aprovacao'].includes(x.lida.situacao),
        )
      )
        throw recusar('submissao-pendente');
      const vigente = s.documentos.find((x) => x.codigo === d.codigo && x.situacao === 'vigente');
      if (d.substitui) {
        if (!vigente || vigente.id !== d.substitui.id || vigente.versao !== d.substitui.versao)
          throw recusaVersaoGestao('O documento');
      } else if (vigente)
        throw recusa('codigo-ja-vigente', 'O código já tem revisão vigente: revise a vigente.');
      const revisao =
        Math.max(
          0,
          ...s.documentos.filter((x) => x.codigo === d.codigo).map((x) => x.revisao),
          ...subs()
            .filter((x) => x.lida.codigo === d.codigo)
            .map((x) => x.lida.revisao),
        ) + 1;
      const id = novoId();
      const agora = seg(d.agora);
      const { resumo, etapas, usuario } = d;
      const dados = {
        codigo: d.codigo,
        tipo: d.tipo,
        titulo: d.titulo,
        area: d.area,
        setorId: d.setorId,
        conteudo: d.conteudo,
        resumoAlteracao: d.resumoAlteracao,
        vigenciaAte: d.vigenciaAte,
        exigeCiencia: d.exigeCiencia,
        substitui: d.substitui,
      };
      subs().push({
        dados,
        hash: resumo(revisao).toLowerCase(),
        lida: {
          id,
          codigo: d.codigo,
          revisao,
          titulo: d.titulo,
          tipo: d.tipo,
          conteudo: d.conteudo,
          elaboradoPor: usuario.toUpperCase(),
          submetidoEm: agora,
          situacao: 'em_revisao',
          etapas: etapas.map((e) => ({
            ...e,
            situacao: e.situacao === 'dispensada' ? 'aprovada' : e.situacao,
            parecer: null,
            decididoEm: e.situacao === 'pendente' ? null : agora,
            decisor: e.situacao === 'pendente' ? null : usuario.toUpperCase(),
          })),
        },
      });
      return { id, revisao };
    },
    decidirEtapaDocumento: async (d) => {
      const x = subs().find((y) => y.lida.id === d.submissao);
      if (!x || !['em_revisao', 'em_aprovacao'].includes(x.lida.situacao))
        throw recusaVersaoGestao('A revisão submetida');
      const efeito = conferirDecisaoEtapa({
        etapas: x.lida.etapas,
        sequencia: d.sequencia,
        decisor: d.usuario,
        decisao: d.decisao,
        parecer: d.parecer,
      });
      if ('recusa' in efeito) throw recusar(efeito.recusa);
      const agora = seg(d.agora);
      if (efeito.publicar) {
        const vig = s.documentos.find((y) => y.codigo === x.lida.codigo && y.situacao === 'vigente');
        const sub = x.dados.substitui;
        if (sub ? !vig || vig.id !== sub.id || vig.versao !== sub.versao : vig)
          throw recusaVersaoGestao('O documento');
        if (vig)
          s.documentos = s.documentos.map((y) =>
            y.id === vig.id ? { ...y, situacao: 'obsoleto', encerradoEm: agora, versao: y.versao + 1 } : y,
          );
        const revisor = x.lida.etapas.find((e) => e.etapa === 'revisao');
        s.documentos.push({
          id: x.lida.id,
          versao: 1,
          codigo: x.lida.codigo,
          revisao: x.lida.revisao,
          tipo: x.dados.tipo,
          titulo: x.dados.titulo,
          area: x.dados.area,
          resumoAlteracao: x.dados.resumoAlteracao,
          elaboradoPor: x.lida.elaboradoPor,
          revisadoPor: revisor?.responsavel ?? null,
          aprovadoPor: d.usuario.toUpperCase(),
          publicadoEm: agora,
          vigenciaAte: x.dados.vigenciaAte,
          exigeCiencia: x.dados.exigeCiencia,
          hash: x.hash,
          situacao: 'vigente',
          motivoRetirada: null,
          encerradoEm: null,
          conteudo: x.dados.conteudo,
        } as DocumentoQualidadeRegistrado & { conteudo: string });
      }
      s.submissoes = subs().map((y) =>
        y !== x
          ? y
          : {
              ...y,
              lida: {
                ...y.lida,
                situacao: efeito.situacao,
                etapas: y.lida.etapas.map((e) =>
                  e.sequencia === d.sequencia
                    ? {
                        ...e,
                        situacao: d.decisao,
                        parecer: d.parecer,
                        decididoEm: agora,
                        decisor: d.usuario.toUpperCase(),
                      }
                    : e,
                ),
              },
            },
      );
      return efeito;
    },
  };
}

export function submissaoMemoria(s: EstadoAprovacaoMemoria, id: number): SubmissaoDocumentoLida | null {
  const x = (s.submissoes ?? []).find((y) => y.lida.id === id);
  return x ? structuredClone(x.lida) : null;
}

export function aprovacoesPendentesMemoria(
  s: EstadoAprovacaoMemoria,
  login: string,
): AprovacaoPendenteDocumento[] {
  const u = login.trim().toUpperCase();
  return (s.submissoes ?? [])
    .filter((x) => ['em_revisao', 'em_aprovacao'].includes(x.lida.situacao))
    .flatMap((x) => {
      const e = [...x.lida.etapas]
        .sort((a, b) => a.sequencia - b.sequencia)
        .find((y) => y.situacao === 'pendente');
      return e && e.responsavel === u
        ? [
            {
              submissao: x.lida.id,
              codigo: x.lida.codigo,
              revisao: x.lida.revisao,
              titulo: x.lida.titulo,
              etapa: e.etapa,
              sequencia: e.sequencia,
              elaboradoPor: x.lida.elaboradoPor,
              submetidoEm: x.lida.submetidoEm,
            },
          ]
        : [];
    });
}
