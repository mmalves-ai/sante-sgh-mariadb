// Cadastro do antibiograma (F7, 05-SADT linha 12): regras puras do painel de antimicrobianos e do ponto de corte.
// - Ponto de corte: a norma é BrCAST, EUCAST ou CLSI; o de concentração inibitória mínima (CIM) traz ao menos um limite
//   em mg/L e nenhum halo; o de disco-difusão traz ao menos um halo em mm e nenhuma CIM. O limite de resistente fica
//   acima (ou igual) do de sensível; no halo, o mínimo de sensível fica acima (ou igual) do máximo de resistente.
// - Versão nova da norma: o ponto do mesmo par (germe, antimicrobiano, material, método e norma) que ainda vale no
//   início do novo é encerrado na véspera, sozinho; o novo nunca começa antes (ou no mesmo dia) do que já vale: isso
//   reescreveria o passado, e o antibiograma já liberado foi interpretado pelo ponto antigo.
// - Ponto já usado numa interpretação não muda: encerra-se e cria-se outro (o histórico do laudo fica explicável).
// - Painel: ao menos um antimicrobiano, sem repetir; a ordem da lista é a do laudo; o de liberação restrita (cascata)
//   precisa de ao menos um de primeira linha no mesmo painel, senão nunca apareceria.
import { RecusaMicrobiologia } from './antibiograma.js';

export const NORMAS_ANTIBIOGRAMA = ['BrCAST', 'EUCAST', 'CLSI'] as const;
export type NormaAntibiograma = (typeof NORMAS_ANTIBIOGRAMA)[number];

export interface PontoCorteInformado {
  readonly microrganismo: number;
  readonly antimicrobiano: number;
  readonly material: number | null;
  readonly metodo: 'concentracao_inibitoria' | 'disco_difusao';
  readonly norma: string;
  readonly versaoNorma: string;
  readonly sensivelAte: number | null;
  readonly resistenteAcima: number | null;
  readonly haloSensivelMinimo: number | null;
  readonly haloResistenteMaximo: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

const recusar = (codigo: string, mensagem: string): never => {
  throw new RecusaMicrobiologia(codigo, mensagem);
};

/** A norma escrita como o cadastro guarda (BrCAST, EUCAST ou CLSI), sem diferença de caixa; outra recusa. */
export function normaDoCadastro(norma: string): NormaAntibiograma {
  const achada = NORMAS_ANTIBIOGRAMA.find((x) => x.toLowerCase() === norma.trim().toLowerCase());
  return achada ?? recusar('norma-desconhecida', 'A norma do antibiograma é BrCAST, EUCAST ou CLSI.');
}

/** Confere o ponto de corte informado e devolve a norma no formato do cadastro. */
export function conferirPontoCorte(
  p: PontoCorteInformado,
): PontoCorteInformado & { norma: NormaAntibiograma } {
  const norma = normaDoCadastro(p.norma);
  if (!p.versaoNorma.trim()) recusar('versao-norma', 'Informe a versão da norma (ex.: 2026).');
  const temCim = p.sensivelAte !== null || p.resistenteAcima !== null;
  const temHalo = p.haloSensivelMinimo !== null || p.haloResistenteMaximo !== null;
  if (p.metodo === 'concentracao_inibitoria') {
    if (!temCim)
      recusar('ponto-sem-limite', 'O ponto por CIM precisa do limite de sensível ou de resistente.');
    if (temHalo)
      recusar('ponto-metodo-misturado', 'O ponto por CIM não leva halo; o halo é do disco-difusão.');
    if (p.sensivelAte !== null && p.resistenteAcima !== null && p.resistenteAcima < p.sensivelAte)
      recusar('ponto-limites-invertidos', 'O limite de resistente não pode ficar abaixo do de sensível.');
  } else {
    if (!temHalo)
      recusar(
        'ponto-sem-limite',
        'O ponto de disco-difusão precisa de um halo de sensível ou de resistente.',
      );
    if (temCim) recusar('ponto-metodo-misturado', 'O ponto de disco-difusão não leva CIM.');
    if (
      p.haloSensivelMinimo !== null &&
      p.haloResistenteMaximo !== null &&
      p.haloSensivelMinimo < p.haloResistenteMaximo
    )
      recusar(
        'ponto-limites-invertidos',
        'O halo mínimo de sensível não pode ficar abaixo do máximo de resistente.',
      );
  }
  if (p.vigenciaFim !== null && p.vigenciaFim < p.vigenciaInicio)
    recusar('vigencia-invertida', 'O fim da vigência não pode vir antes do início.');
  return { ...p, norma };
}

export interface PontoExistente {
  readonly id: number;
  readonly microrganismo: number;
  readonly antimicrobiano: number;
  readonly material: number | null;
  readonly metodo: string;
  readonly norma: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}

/** A véspera da data (AAAA-MM-DD), no calendário, sem fuso. */
export function vespera(data: string): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Os pontos do mesmo par e norma que ainda valem no início do novo e devem ser encerrados na véspera. Recusa quando
 * algum começa no mesmo dia ou depois do novo (a versão nova não reescreve o passado).
 */
export function pontosAEncerrar(
  existentes: readonly PontoExistente[],
  novo: PontoCorteInformado,
): { id: number; vigenciaFim: string }[] {
  const norma = normaDoCadastro(novo.norma).toLowerCase();
  const mesmos = existentes.filter(
    (e) =>
      e.ativo &&
      e.microrganismo === novo.microrganismo &&
      e.antimicrobiano === novo.antimicrobiano &&
      e.material === novo.material &&
      e.metodo === novo.metodo &&
      e.norma.trim().toLowerCase() === norma,
  );
  const fecha: { id: number; vigenciaFim: string }[] = [];
  for (const e of mesmos) {
    const terminaAntes = e.vigenciaFim !== null && e.vigenciaFim < novo.vigenciaInicio;
    if (terminaAntes) continue;
    if (e.vigenciaInicio >= novo.vigenciaInicio)
      recusar(
        'vigencia-sobreposta',
        'Já existe ponto desta norma para o par começando nesta data ou depois: a versão nova começa depois dele.',
      );
    fecha.push({ id: e.id, vigenciaFim: vespera(novo.vigenciaInicio) });
  }
  return fecha;
}

export interface ItemPainelInformado {
  readonly antimicrobiano: number;
  readonly exibeNoLaudo: boolean;
  readonly liberacaoRestrita: boolean;
  readonly indicaMultirresistencia: boolean;
}

/** Confere os itens do painel e devolve cada um com a sequência do laudo (a ordem da lista, de 1 em diante). */
export function conferirPainel(
  itens: readonly ItemPainelInformado[],
): (ItemPainelInformado & { sequencia: number })[] {
  if (!itens.length) recusar('painel-vazio', 'O painel precisa de ao menos um antimicrobiano.');
  const vistos = new Set<number>();
  for (const i of itens) {
    if (vistos.has(i.antimicrobiano))
      recusar('painel-repetido', 'O mesmo antimicrobiano aparece duas vezes no painel.');
    vistos.add(i.antimicrobiano);
  }
  if (itens.some((i) => i.liberacaoRestrita) && !itens.some((i) => !i.liberacaoRestrita))
    recusar(
      'painel-so-restritos',
      'O antimicrobiano de liberação restrita precisa de um de primeira linha no painel para aparecer no laudo.',
    );
  return itens.map((i, k) => ({ ...i, sequencia: k + 1 }));
}
