// Onda 4 (ficha do M42): a liberação por setor do faturamento, da auditoria de contas, do TISS, da glosa e do recurso,
// do financeiro e do repasse sobre as regras 1 a 8 do M40 (o mesmo critério por setor, o mesmo registro na lista para
// ligar, o mesmo lote), mais as condições próprias da onda: a ordem dos setores (campo 12), o início na abertura de uma
// competência (regra 1), a reprodução sem diferença (regra 3), as respostas do faturamento e do fiscal (regra 8) e o
// roteiro de recolhimento com os recursos que só existem no novo. Regras puras, sem banco e sem tela.
import {
  ITENS_CRITERIO_POR_SETOR_ONDA_4,
  ORDEM_SETORES_ONDA_4,
  PARTES_POR_RESPOSTA,
  SETORES_ONDA_4,
  SETORES_ONDA_4_PRONTIDAO,
  SETORES_PRONTIDAO,
  SITUACOES_RESPOSTA,
  situacaoDaParte,
  type DefinicaoSetor,
  type ItemCriterioLiberacao,
  type ItemCriterioRegistrado,
  type SituacaoResposta,
} from '@sgh/contratos';
import { conferirAberturaDaCompetencia, diaValido } from '@sgh/contratos/regras-faturamento';
import { setoresDaOndaDaChave, type AvaliacaoLiberacaoSetor } from '../onda2/onda2.js';

export function ehSetorOnda4(setor: string): boolean {
  return SETORES_ONDA_4_PRONTIDAO.includes(setor);
}

/** O passo do setor na ordem recomendada (1 = primeiro), ou 0 fora da onda. */
export function passoDoSetorOnda4(setor: string): number {
  return ORDEM_SETORES_ONDA_4.findIndex((p) => p.includes(setor)) + 1;
}

/** Setores da onda 4 a que a chave pertence (vazio: a chave é de outra onda ou de nenhuma). */
export function setoresOnda4DaChave(
  tipo: 'recurso' | 'operacao',
  chave: string,
  nomesCatalogo: readonly string[],
  setores: readonly Pick<DefinicaoSetor, 'id' | 'onda' | 'operacoes' | 'recursos'>[] = SETORES_PRONTIDAO,
): string[] {
  return setoresDaOndaDaChave(4, SETORES_ONDA_4_PRONTIDAO, tipo, chave, nomesCatalogo, setores);
}

/** Itens a mais do critério do setor da onda 4 (vazio fora da onda). */
export function itensOnda4DoSetor(setor: string): readonly ItemCriterioLiberacao[] {
  return (
    (ITENS_CRITERIO_POR_SETOR_ONDA_4 as Readonly<Record<string, readonly ItemCriterioLiberacao[]>>)[setor] ??
    []
  );
}

/** O setor entra na abertura de uma competência (regra 1)? */
export function setorExigeAbertura(setor: string): boolean {
  return itensOnda4DoSetor(setor).includes('abertura-da-competencia');
}

/** O momento do setor dentro da competência (campo 12). */
export function momentoDoSetorOnda4(setor: string) {
  return SETORES_ONDA_4.find((s) => s.id === setor)?.momento ?? null;
}

// ── Regra 1: começa na abertura de uma competência ───────────────────────────────────────────────────────────

/** Feriados do estabelecimento a partir do parâmetro (datas AAAA-MM-DD separadas por vírgula; as inválidas saem). */
export function feriadosDoParametro(texto: string | null | undefined): ReadonlySet<string> {
  return new Set(
    (texto ?? '')
      .split(',')
      .map((d) => d.trim())
      .filter((d) => diaValido(d)),
  );
}

/**
 * Recusa do registro do início fora da abertura (regra 1): o item `abertura-da-competencia` cumprido precisa da data
 * igual ao primeiro dia útil de uma competência. Devolve a mensagem (texto de produto) ou null.
 */
export function motivoForaDaAbertura(
  itens: readonly Pick<ItemCriterioRegistrado, 'item' | 'situacao' | 'em'>[],
  feriados: ReadonlySet<string>,
): string | null {
  const i = itens.find((x) => x.item === 'abertura-da-competencia' && x.situacao === 'cumprido');
  if (!i) return null;
  if (!i.em || !diaValido(i.em)) return 'Informe a data do início do setor (AAAA-MM-DD).';
  const a = conferirAberturaDaCompetencia(i.em, feriados);
  if (a.ok) return null;
  return `O setor entra na abertura de uma competência: ${formatar(i.em)} não é o primeiro dia útil de ${a.competencia.slice(5)}/${a.competencia.slice(0, 4)} (${formatar(a.abertura)}). A próxima abertura é ${formatar(a.proximaAbertura!)}.`;
}

const formatar = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/**
 * Confere de novo, na avaliação, o item `abertura-da-competencia` registrado (um registro antigo ou um feriado novo no
 * parâmetro): com a data fora da abertura, o item fica pendente com o motivo. Os demais itens não mudam.
 */
export function ajustarAberturaOnda4(
  avaliacao: AvaliacaoLiberacaoSetor,
  registrados: readonly Pick<ItemCriterioRegistrado, 'item' | 'situacao' | 'em'>[],
  feriados: ReadonlySet<string>,
): AvaliacaoLiberacaoSetor {
  const motivo = motivoForaDaAbertura(registrados, feriados);
  if (!motivo) return avaliacao;
  const itens = avaliacao.itens.map((i) =>
    i.item === 'abertura-da-competencia' ? { ...i, ok: false, falta: motivo } : i,
  );
  return { ...avaliacao, itens, podeLiberar: itens.every((i) => i.ok) };
}

// ── Regra 8: respostas do faturamento e do fiscal ──────────────────────────────────────────────────────────────

export interface SituacaoRespostaLida {
  readonly pergunta: string;
  readonly pc: SituacaoResposta;
  readonly hs: SituacaoResposta;
}

/**
 * Lê as situações das tabelas de acompanhamento (respostas/faturamento.md e respostas/fiscal.md): a primeira coluna
 * começa pelo código da pergunta (FAT-nn ou FIS-nn) e as colunas 3 e 4 são a situação no pc e no hs. Linha com
 * situação desconhecida vale `sem-resposta` (o padrão de mercado; a parte não para, POL-1).
 */
export function lerSituacoesRespostas(markdown: string): SituacaoRespostaLida[] {
  const ok = (v: string | undefined): SituacaoResposta =>
    (SITUACOES_RESPOSTA as readonly string[]).includes((v ?? '').trim())
      ? ((v ?? '').trim() as SituacaoResposta)
      : 'sem-resposta';
  const r: SituacaoRespostaLida[] = [];
  for (const linha of markdown.split('\n')) {
    const cols = linha.split('|').map((c) => c.trim());
    const m = /^(FAT|FIS)-\d{2}\b/.exec(cols[1] ?? '');
    if (!m) continue;
    r.push({ pergunta: m[0], pc: ok(cols[3]), hs: ok(cols[4]) });
  }
  return r;
}

/** As respostas do setor, com a parte afetada e como ela entra na liberação (regra 8). */
export function respostasDoSetorOnda4(
  setor: string,
  lidas: readonly SituacaoRespostaLida[],
  hospital: string,
): {
  pergunta: string;
  parte: string;
  situacao: SituacaoResposta;
  comoEntra: ReturnType<typeof situacaoDaParte>;
}[] {
  const def = SETORES_ONDA_4.find((s) => s.id === setor);
  if (!def) return [];
  const porPergunta = new Map(lidas.map((l) => [l.pergunta, l]));
  return def.respostas.map((pergunta) => {
    const l = porPergunta.get(pergunta);
    const situacao: SituacaoResposta = l ? (hospital === 'hs' ? l.hs : l.pc) : 'sem-resposta';
    return {
      pergunta,
      parte: PARTES_POR_RESPOSTA[pergunta] ?? pergunta,
      situacao,
      comoEntra: situacaoDaParte(situacao),
    };
  });
}
