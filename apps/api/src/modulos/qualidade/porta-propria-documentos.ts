// Gravações dos documentos controlados da gestão da qualidade no banco próprio (fatia F3.9-Q1): publicar a revisão,
// retirar a revisão vigente e registrar a ciência de quem leu. Mesmo contrato da porta de memória (porta-gestao-memoria.ts)
// sobre o modelo próprio, com as leituras do complemento Q2 (o "documento" do contrato é a REVISÃO publicada,
// documento_qualidade_versao; o documento_qualidade é a ficha do código).
//
// - Publicar: a primeira revisão de um código cria a ficha (código, título, tipo, setor da área, dono = quem aprovou e
//   publicou, exigência de ciência, próxima revisão) e a revisão vigente com o texto, o resumo SHA-256 fixado na
//   publicação (coluna resumo_sha256, nunca recalculado), elaborador, revisor e aprovador. A revisão nova de um código
//   vigente exige `substitui` = a revisão vigente com a versão lida: ela vira obsoleta na mesma transação (a linha fica,
//   com o texto e o resumo dela; o histórico nunca é apagado) e a ficha passa a apontar a revisão nova. Publicar sem
//   `substitui` com revisão vigente no código, ou repetir o número da revisão, recusa `conflito-versao`.
// - Retirar: a revisão vigente sai de uso com o motivo, o instante e a conta (retirada_em, motivo_retirada,
//   retirada_por_usuario_id; CHECK do DDL 23 exige os três juntos), situação `cancelada`, e a ficha fica `cancelado` sem
//   revisão vigente. Conferida pela versão lida.
// - Ciência: uma por pessoa e revisão vigente, pela conta da sessão (e o colaborador da conta, quando houver); a revisão
//   travada na transação serializa a conferência do "já registrou" (a chave única do DDL só cobre o colaborador).
// Nenhum gatilho: a regra está aqui e no domínio (conferirPublicacao, recusaRetirada, recusaCiencia, na API).
import { recusa, type TxOperacao } from '@sgh/nucleo';
import { exigirUsuario, type Linha, n, paraBanco, texto } from './apoio-propria.js';
import type { GravadorGestao } from './porta-gestao.js';
import { recusaVersaoGestao } from './tipos.js';

/** As tabelas que as gravações dos documentos tocam (somadas às da porta completa). */
export const TABELAS_DOCUMENTOS = [
  'documento_qualidade',
  'documento_qualidade_versao',
  'documento_qualidade_ciencia',
] as const;

export type GravacoesDocumentos = Pick<
  GravadorGestao,
  'publicarDocumento' | 'retirarDocumento' | 'registrarCiencia'
>;

/** A revisão travada para a publicação de uma revisão nova (regra pura, testada à parte). */
export interface RevisaoTravada {
  readonly id: number;
  readonly versao: number;
  readonly documento: number;
  readonly codigo: string;
  readonly situacao: string;
}

/**
 * Confere a substituição contra o banco travado: a revisão substituída tem de ser a vigente do mesmo código, na versão
 * lida; sem substituição, o código não pode ter revisão vigente; o número da revisão não se repete no código.
 * Devolve o motivo da recusa (null: pode publicar).
 */
export function conferirSubstituicao(e: {
  readonly codigo: string;
  readonly revisao: number;
  readonly substitui: { readonly id: number; readonly versao: number } | null;
  readonly substituida: RevisaoTravada | null;
  readonly vigenteDoCodigo: number | null;
  readonly revisoesDoCodigo: readonly string[];
}): 'substituida-invalida' | 'ja-vigente' | 'revisao-repetida' | null {
  if (e.substitui) {
    const s = e.substituida;
    if (!s || s.versao !== e.substitui.versao || s.situacao !== 'vigente' || s.codigo !== e.codigo)
      return 'substituida-invalida';
  } else if (e.vigenteDoCodigo !== null) return 'ja-vigente';
  if (e.revisoesDoCodigo.some((r) => Number(/^\s*(\d+)/.exec(r)?.[1] ?? -1) === e.revisao))
    return 'revisao-repetida';
  return null;
}

/**
 * Escolhe o setor da área entre os que casam pelo código ou pelo nome: um só pelo código vence; sem código, o nome
 * tem de ser único no estabelecimento. Devolve o id, 'inexistente' ou 'ambigua'.
 */
export function escolherSetor(
  c: readonly { readonly id: number; readonly peloCodigo: boolean }[],
): number | 'inexistente' | 'ambigua' {
  const codigo = c.filter((x) => x.peloCodigo);
  if (codigo.length === 1) return codigo[0]!.id;
  if (codigo.length > 1) return 'ambigua';
  if (c.length === 0) return 'inexistente';
  return c.length === 1 ? c[0]!.id : 'ambigua';
}

const SQL_REVISAO = `
  SELECT v.id, v.versao, v.situacao, v.documento_qualidade_id AS documento, d.codigo, d.versao AS versao_documento
    FROM documento_qualidade_versao v
    JOIN documento_qualidade d ON d.id = v.documento_qualidade_id
   WHERE v.id = ? AND d.estabelecimento_id = ? AND d.excluido_em IS NULL`;

const dia = (agora: string): string => agora.slice(0, 10);

export function gravacoesDocumentos(tx: TxOperacao, est: number): GravacoesDocumentos {
  /** Os ids do tipo e do setor da área, ou recusa (nada é gravado com referência solta). */
  async function referencias(
    tipo: string,
    area: string,
    setorId?: number | null,
  ): Promise<{ tipo: number; setor: number }> {
    const t = await tx.uma<Linha>(
      'SELECT id FROM tipo_documento_qualidade WHERE codigo = ? AND ativo = TRUE',
      [tipo],
    );
    if (!t)
      throw recusa('tipo-documento-inexistente', 'O tipo de documento informado não existe ou está inativo.');
    if (setorId != null) {
      // O setor escolhido na lista: tem de ser deste estabelecimento e estar ativo (nunca o de outra unidade).
      const s = await tx.uma<Linha>(
        'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [setorId, est],
      );
      if (!s) throw recusa('area-inexistente', 'A área informada não é um setor deste estabelecimento.');
      return { tipo: n(t['id']), setor: n(s['id']) };
    }
    // O código do setor vence o nome; nome repetido no estabelecimento recusa (nunca escolhe um setor por acaso).
    const candidatos = await tx.consultar<Linha>(
      `SELECT id, UPPER(codigo) = UPPER(?) AS pelo_codigo FROM setor_funcional
        WHERE estabelecimento_id = ? AND excluido_em IS NULL
          AND (UPPER(nome) = UPPER(?) OR UPPER(codigo) = UPPER(?))`,
      [area.trim(), est, area.trim(), area.trim()],
    );
    const setor = escolherSetor(
      candidatos.map((c) => ({ id: n(c['id']), peloCodigo: n(c['pelo_codigo']) === 1 })),
    );
    if (setor === 'inexistente')
      throw recusa('area-inexistente', 'A área informada não é um setor deste estabelecimento.');
    if (setor === 'ambigua')
      throw recusa('area-ambigua', 'Há mais de um setor com esse nome: informe o código do setor.');
    return { tipo: n(t['id']), setor };
  }

  return {
    publicarDocumento: async (d) => {
      const ref = await referencias(d.tipo, d.area, d.setorId);
      const elaborador = await exigirUsuario(tx, d.elaboradoPor);
      const revisor = d.revisadoPor ? await exigirUsuario(tx, d.revisadoPor) : null;
      const aprovador = await exigirUsuario(tx, d.usuario);
      const [ficha] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, versao FROM documento_qualidade WHERE estabelecimento_id = ? AND codigo = ? AND excluido_em IS NULL',
        [est, d.codigo],
        { teto: 1 },
      );
      let substituida: RevisaoTravada | null = null;
      if (d.substitui) {
        const [s] = await tx.consultarParaAtualizar<Linha>(SQL_REVISAO, [d.substitui.id, est], { teto: 1 });
        substituida = s
          ? {
              id: n(s['id']),
              versao: n(s['versao']),
              documento: n(s['documento']),
              codigo: texto(s['codigo']),
              situacao: texto(s['situacao']),
            }
          : null;
      }
      const revisoes = ficha
        ? await tx.consultar<Linha>(
            'SELECT numero_versao, situacao, id FROM documento_qualidade_versao WHERE documento_qualidade_id = ?',
            [n(ficha['id'])],
          )
        : [];
      const vigente = revisoes.find((r) => texto(r['situacao']) === 'vigente');
      const motivo = conferirSubstituicao({
        codigo: d.codigo,
        revisao: d.revisao,
        substitui: d.substitui,
        substituida,
        vigenteDoCodigo: vigente ? n(vigente['id']) : null,
        revisoesDoCodigo: revisoes.map((r) => texto(r['numero_versao'])),
      });
      if (motivo) throw recusaVersaoGestao('O documento');

      const agora = paraBanco(d.agora);
      if (substituida)
        await tx.alterar('documento_qualidade_versao', substituida.id, substituida.versao, {
          situacao: 'obsoleta',
          vigencia_fim: dia(d.agora),
        });
      const dadosFicha = {
        titulo: d.titulo,
        tipo_documento_qualidade_id: ref.tipo,
        setor_funcional_id: ref.setor,
        exige_ciencia: d.exigeCiencia,
        situacao: 'vigente',
        ultima_revisao: dia(d.agora),
        proxima_revisao: d.vigenciaAte,
      };
      const documento = ficha
        ? n(ficha['id'])
        : await tx.incluir('documento_qualidade', {
            estabelecimento_id: est,
            codigo: d.codigo,
            dono_usuario_id: aprovador,
            ...dadosFicha,
          });
      const id = await tx.incluir('documento_qualidade_versao', {
        documento_qualidade_id: documento,
        operacao: 'inclusao',
        dados: JSON.stringify({ resumoSha256: d.hash, substitui: d.substitui?.id ?? null }),
        ocorrido_em: agora,
        usuario_id: aprovador,
        numero_versao: String(d.revisao),
        situacao: 'vigente',
        formato: 'texto',
        conteudo: d.conteudo,
        resumo_sha256: d.hash.toLowerCase(),
        motivo_alteracao: d.resumoAlteracao,
        elaborador_usuario_id: elaborador,
        revisor_usuario_id: revisor,
        aprovador_usuario_id: aprovador,
        aprovado_em: agora,
        publicado_em: agora,
        vigencia_inicio: dia(d.agora),
        proxima_revisao: d.vigenciaAte,
      });
      if (ficha)
        await tx.alterar('documento_qualidade', documento, n(ficha['versao']), {
          ...dadosFicha,
          documento_qualidade_versao_id: id,
        });
      else await tx.alterar('documento_qualidade', documento, 1, { documento_qualidade_versao_id: id });
      return { id };
    },

    retirarDocumento: async (r) => {
      const [v] = await tx.consultarParaAtualizar<Linha>(SQL_REVISAO, [r.id, est], { teto: 1 });
      if (!v || n(v['versao']) !== r.versao || texto(v['situacao']) !== 'vigente')
        throw recusaVersaoGestao('O documento');
      const usuario = await exigirUsuario(tx, r.usuario);
      const versao = await tx.alterar('documento_qualidade_versao', r.id, r.versao, {
        situacao: 'cancelada',
        retirada_em: paraBanco(r.agora),
        retirada_por_usuario_id: usuario,
        motivo_retirada: r.motivo,
        vigencia_fim: dia(r.agora),
      });
      const [ficha] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, versao FROM documento_qualidade WHERE id = ?',
        [n(v['documento'])],
        { teto: 1 },
      );
      if (ficha)
        await tx.alterar('documento_qualidade', n(ficha['id']), n(ficha['versao']), {
          situacao: 'cancelado',
          documento_qualidade_versao_id: null,
        });
      return { versao };
    },

    registrarCiencia: async (c) => {
      const [v] = await tx.consultarParaAtualizar<Linha>(SQL_REVISAO, [c.documento, est], { teto: 1 });
      if (!v || texto(v['situacao']) !== 'vigente')
        throw recusa('documento-nao-vigente', 'O documento não está mais vigente: abra a revisão nova.');
      const usuario = await exigirUsuario(tx, c.usuario);
      const colab = await tx.uma<Linha>(
        'SELECT MIN(id) AS id FROM colaborador WHERE usuario_id = ? AND excluido_em IS NULL',
        [usuario],
      );
      const colaborador = colab?.['id'] == null ? null : n(colab['id']);
      const ja = await tx.uma<Linha>(
        `SELECT c.id FROM documento_qualidade_ciencia c
           LEFT JOIN colaborador co ON co.id = c.colaborador_id
          WHERE c.documento_qualidade_versao_id = ? AND c.excluido_em IS NULL
            AND (c.usuario_id = ? OR co.usuario_id = ? OR (? IS NOT NULL AND c.colaborador_id = ?))
          LIMIT 1`,
        [c.documento, usuario, usuario, colaborador, colaborador],
      );
      if (ja) throw recusa('ciencia-ja-registrada', 'Você já registrou a ciência desta revisão.');
      const agora = paraBanco(c.agora);
      const id = await tx.incluir('documento_qualidade_ciencia', {
        documento_qualidade_versao_id: c.documento,
        colaborador_id: colaborador,
        usuario_id: usuario,
        lido_em: agora,
        ciencia_em: agora,
        meio: 'sistema',
      });
      return { id };
    },
  };
}
