// W0-04 (programa CRUD completo): as regras puras da correção e do cancelamento da gestão da qualidade.
//   - Auditoria interna: altera-se com versão; cancela-se com motivo (a não conformidade aberta dela fica órfã: recusa).
//   - Reunião e ata: a ata se retifica por nova versão (a anterior fica acessível); a reunião lançada errado se cancela,
//     mas a de ata assinada não (pede a retificação).
//   - Não conformidade: cancela-se só a duplicada ou a aberta por engano, ainda sem tratamento.
//   - Ouvidoria: tipo, área e relato se corrigem antes do encaminhamento; a manifestação protocolada não se apaga, o
//     cancelamento é lógico com motivo (LGPD arts. 37 e 46).
export type RecusaCorrecaoGestao =
  | 'registro-cancelado'
  | 'ata-assinada'
  | 'ata-ja-assinada'
  | 'nc-em-tratamento'
  | 'duplicada-de-si'
  | 'duplicada-inexistente'
  | 'manifestacao-encaminhada'
  | 'com-dependentes'
  | 'sem-mudanca';

export const MENSAGENS_CORRECAO_GESTAO: Readonly<Record<RecusaCorrecaoGestao, string>> = {
  'registro-cancelado': 'Este registro foi cancelado: ele fica visível como inativo e não se altera mais.',
  'ata-assinada':
    'A ata desta reunião já foi assinada: a reunião não se cancela. Retifique a ata (nova versão, com a anterior guardada).',
  'ata-ja-assinada': 'A ata desta reunião já está assinada.',
  'nc-em-tratamento':
    'Só a não conformidade ainda aberta, sem tratamento, se cancela (duplicada ou aberta por engano). Em tratamento, conclua pela verificação de eficácia.',
  'duplicada-de-si': 'A não conformidade não pode ser duplicada dela mesma.',
  'duplicada-inexistente': 'A não conformidade original informada não existe ou está cancelada.',
  'manifestacao-encaminhada':
    'A manifestação já foi encaminhada ou respondida: tipo, área e relato não se corrigem mais (registre na observação do encaminhamento).',
  'com-dependentes': 'Há registros ativos que dependem deste: trate-os antes de cancelar.',
  'sem-mudanca': 'Nada foi alterado: confira os campos antes de salvar.',
};

export function conferirCancelamentoReuniao(r: {
  readonly canceladaEm?: string | null;
  readonly ataAssinadaEm?: string | null;
  /** Revisão do W0-04: a ata assinada e retificada depois (aguardando nova assinatura) também não se cancela. */
  readonly assinaturaAnteriorEm?: string | null;
}): RecusaCorrecaoGestao | null {
  if (r.canceladaEm) return 'registro-cancelado';
  return r.ataAssinadaEm || r.assinaturaAnteriorEm ? 'ata-assinada' : null;
}

export function conferirCancelamentoNaoConformidade(
  n: { readonly id: number; readonly situacao: string; readonly canceladaEm?: string | null },
  duplicadaDe: { readonly id: number; readonly canceladaEm?: string | null } | null | undefined,
  pedidaDuplicada: number | null,
): RecusaCorrecaoGestao | null {
  if (n.canceladaEm) return 'registro-cancelado';
  if (n.situacao !== 'aberta') return 'nc-em-tratamento';
  if (pedidaDuplicada === null) return null;
  if (pedidaDuplicada === n.id) return 'duplicada-de-si';
  return !duplicadaDe || duplicadaDe.canceladaEm ? 'duplicada-inexistente' : null;
}

export function conferirCorrecaoManifestacao(
  m: {
    readonly situacao: string;
    readonly canceladaEm?: string | null;
    readonly tipo: string;
    readonly area: string;
    readonly relato: string;
  },
  novo: { readonly tipo: string; readonly area: string; readonly relato: string },
): RecusaCorrecaoGestao | null {
  if (m.canceladaEm) return 'registro-cancelado';
  if (m.situacao !== 'aberta') return 'manifestacao-encaminhada';
  const igual = m.tipo === novo.tipo && m.area === novo.area.trim() && m.relato === novo.relato.trim();
  return igual ? 'sem-mudanca' : null;
}
