// Ficha de antimicrobiano (ficha_antimicrobiano) do item prescrito, dentro da transação de quem chama. É a mesma regra
// na ficha avulsa (pep.registrarFicha, prescricao-propria-regras-2.ts) e na ficha que vai junto da gravação da
// prescrição (pep.prescrever, copiar e renovar, prescricao-propria-gravacao.ts): o item informado (ou, sem ele, o último
// item do produto na prescrição ou no atendimento), o antimicrobiano pelo princípio ativo do produto, a finalidade pelo
// tipo (empírico, dirigido, profilático), o sítio de infecção do catálogo e a duração (a informada ou a sugerida). A
// ficha nasce pendente de avaliação pela comissão de controle de infecção (a auditoria a avalia depois).
import { ErroOperacao, type TxOperacao } from '@sgh/nucleo';
import type { FichaAvulsa } from './tipos-pep.js';

/** Tipo da ficha (tela) → código da finalidade terapêutica do catálogo. */
export const FINALIDADE_DO_TIPO: Readonly<Record<FichaAvulsa['tipo'], string>> = {
  empirico: 'empirica',
  dirigido: 'terapeutica',
  profilatico: 'profilatica',
};

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const recusar = (status: number, codigo: string, detalhe: string): ErroOperacao =>
  new ErroOperacao(status, codigo, 'Operação recusada', detalhe);

/** Data civil (AAAA-MM-DD) somada de dias, sem fuso. */
export function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Hoje no fuso do estabelecimento (AAAA-MM-DD). */
export function hojeLocal(fuso: string, agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

/** Início e fim previstos da ficha: o dia de tratamento informado conta a partir de hoje (dia 1 = hoje). */
export function periodoDaFicha(
  hoje: string,
  diaTratamento: number,
  dias: number,
): { inicio: string; fim: string } {
  const inicio = somarDias(hoje, -(diaTratamento - 1));
  return { inicio, fim: somarDias(inicio, dias - 1) };
}

/** Grava a ficha do item na transação; devolve o id. Recusa sem gravar nada se o item, o produto ou o cadastro faltar. */
export async function inserirFichaAntimicrobiano(
  tx: TxOperacao,
  est: { readonly id: number; readonly fuso: string },
  profissional: number,
  f: FichaAvulsa,
): Promise<number> {
  const at = await tx.uma(
    'SELECT paciente_id, fonte_pagadora_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [f.atendimento, est.id],
  );
  if (!at || num(at['paciente_id']) !== f.paciente)
    throw recusar(404, 'registro-inexistente', 'O atendimento do paciente não foi encontrado.');
  const item = await tx.uma(
    `SELECT i.id, i.item_prescritivel_id FROM prescricao_item i
       JOIN prescricao p ON p.id = i.prescricao_id AND p.estabelecimento_id = ? AND p.excluido_em IS NULL
      WHERE i.excluido_em IS NULL AND p.atendimento_id = ? AND p.paciente_id = ?
        AND ${f.item !== null ? 'i.id = ?' : 'i.item_prescritivel_id = ?'}
        ${f.prescricao !== null ? 'AND p.id = ?' : ''}
      ORDER BY p.prescrito_em DESC, i.id DESC LIMIT 1`,
    [
      est.id,
      f.atendimento,
      f.paciente,
      f.item ?? f.produto,
      ...(f.prescricao !== null ? [f.prescricao] : []),
    ],
  );
  if (!item) {
    if (f.item !== null)
      throw recusar(404, 'registro-inexistente', 'O item não é de uma prescrição deste atendimento.');
    throw recusar(
      422,
      'ficha-sem-item',
      'A ficha justifica um item prescrito: o produto não está prescrito.',
    );
  }
  if (num(item['item_prescritivel_id']) !== f.produto)
    throw recusar(422, 'produto-diferente-do-item', 'O produto da ficha não é o do item prescrito.');
  const am = await tx.uma(
    `SELECT a.id, a.dias_liberados FROM antimicrobiano a
       JOIN item_prescritivel ip ON ip.principio_ativo_id = a.principio_ativo_id
      WHERE ip.id = ? AND a.ativo = TRUE ORDER BY a.id LIMIT 1`,
    [f.produto],
  );
  if (!am) throw recusar(422, 'produto-nao-antimicrobiano', 'O produto não é um antimicrobiano do cadastro.');
  const fin = await tx.uma(
    'SELECT id, dias_maximo_sugerido FROM finalidade_terapeutica WHERE codigo = ? AND ativo = TRUE',
    [FINALIDADE_DO_TIPO[f.tipo]],
  );
  if (!fin)
    throw recusar(
      409,
      'finalidade-sem-cadastro',
      `O cliente não tem a finalidade terapêutica do tipo "${f.tipo}".`,
    );
  const sitio = await tx.uma(
    `SELECT id FROM sitio_infeccao WHERE ativo = TRUE
        AND (LOWER(codigo) = LOWER(?) OR LOWER(sigla) = LOWER(?) OR LOWER(descricao) = LOWER(?))
      ORDER BY id LIMIT 1`,
    [f.sitio, f.sitio, f.sitio],
  );
  if (!sitio)
    throw recusar(422, 'sitio-sem-cadastro', 'O sítio de infecção não está no catálogo do cliente.');
  const dias = f.duracaoDias ?? numOuNull(fin['dias_maximo_sugerido']) ?? numOuNull(am['dias_liberados']);
  if (dias === null || dias < 1)
    throw recusar(422, 'duracao-obrigatoria', 'Informe a duração prevista do tratamento (dias).');
  const { inicio, fim } = periodoDaFicha(hojeLocal(est.fuso), f.diaTratamento, Math.min(dias, 365));
  return tx.incluir('ficha_antimicrobiano', {
    estabelecimento_id: est.id,
    paciente_id: f.paciente,
    atendimento_id: f.atendimento,
    prescricao_item_id: num(item['id']),
    antimicrobiano_id: num(am['id']),
    prescritor_profissional_id: profissional,
    fonte_pagadora_id: numOuNull(at['fonte_pagadora_id']),
    finalidade_terapeutica_id: num(fin['id']),
    origem_infeccao: f.tipo === 'profilatico' ? 'profilaxia_clinica' : 'indeterminada',
    sitio_infeccao_id: num(sitio['id']),
    cultura_coletada: f.culturaColhida,
    justificativa: f.indicacao,
    data_inicio: inicio,
    dias_previstos: Math.min(dias, 365),
    data_fim_prevista: fim,
    avaliacao_situacao: 'pendente',
    origem: 'sistema',
  });
}
