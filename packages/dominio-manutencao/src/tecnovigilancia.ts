// W0-08, parte 8 (mercado M2: tecnovigilância e recall ligados ao parque instalado; RDC 67/2009, RDC 551/2021 e RDC
// 509/2021, rastreabilidade do equipamento até o descarte). Regras puras:
//   - o enquadramento de cada equipamento no alerta: o fabricante e o modelo comparam sem acento, caixa nem espaço
//     sobrando; a faixa de série compara pelo NÚMERO final quando as pontas e a série têm o mesmo prefixo ("SN-0950" está
//     entre "SN-900" e "SN-1200"), senão pelo texto; o equipamento desativado fica de fora (só o parque instalado);
//     o sem série cadastrada fica "a conferir" (a pessoa confere a etiqueta e escolhe gerar a OS);
//   - a alteração do alerta pela versão: o critério (fabricante, modelo, faixa) não muda depois da primeira OS de ação
//     de campo (a OS gerada ficaria sem a razão de ser); o encerrado não muda;
//   - a ação de campo: uma OS por equipamento afetado ainda sem OS deste alerta, com a descrição tirada do alerta.
import type { AfetadoAlerta, RecusaAlertaEquipamento } from '@sgh/contratos';

/** Sem acento, maiúsculas, espaços simples nas pontas e no meio. */
export function normalizarTextoAlerta(v: string | null | undefined): string {
  return (v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

const PARTES = /^(.*?)(\d+)$/;
function partes(serie: string): { prefixo: string; numero: bigint } | null {
  const m = PARTES.exec(normalizarTextoAlerta(serie).replace(/\s/g, ''));
  return m ? { prefixo: m[1] ?? '', numero: BigInt(m[2] ?? '0') } : null;
}

/** A ordem de duas séries: pelo número final quando o prefixo é o mesmo; senão pelo texto normalizado. */
export function compararSeries(a: string, b: string): number {
  const pa = partes(a);
  const pb = partes(b);
  if (pa && pb && pa.prefixo === pb.prefixo)
    return pa.numero < pb.numero ? -1 : pa.numero > pb.numero ? 1 : 0;
  const ta = normalizarTextoAlerta(a).replace(/\s/g, '');
  const tb = normalizarTextoAlerta(b).replace(/\s/g, '');
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}

/** A série está na faixa (as duas pontas inclusive). */
export function serieNaFaixa(serie: string, inicio: string, fim: string): boolean {
  return compararSeries(inicio, serie) <= 0 && compararSeries(serie, fim) <= 0;
}

/** A faixa vem com o início depois do fim (só quando dá para comparar). */
export function faixaInvertida(inicio: string | null, fim: string | null): boolean {
  return inicio !== null && fim !== null && compararSeries(inicio, fim) > 0;
}

export interface CriterioAlerta {
  readonly fabricante: string;
  readonly modelo: string | null;
  readonly serieInicio: string | null;
  readonly serieFim: string | null;
}

export interface EquipamentoDoParque {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly fabricante: string | null;
  readonly modelo: string | null;
  readonly numeroSerie: string | null;
  readonly centroCusto: number;
  readonly situacao: string;
}

/** O enquadramento de um equipamento: afetado, a conferir (sem série, quando o alerta tem faixa) ou fora. */
export function enquadrarEquipamento(
  eq: EquipamentoDoParque,
  c: CriterioAlerta,
): 'afetado' | 'conferir' | null {
  if (eq.situacao === 'desativado') return null;
  if (normalizarTextoAlerta(eq.fabricante) !== normalizarTextoAlerta(c.fabricante)) return null;
  if (c.modelo !== null && normalizarTextoAlerta(eq.modelo) !== normalizarTextoAlerta(c.modelo)) return null;
  if (c.serieInicio === null || c.serieFim === null) return 'afetado';
  const s = (eq.numeroSerie ?? '').trim();
  if (s === '') return 'conferir';
  return serieNaFaixa(s, c.serieInicio, c.serieFim) ? 'afetado' : null;
}

/** A OS de ação de campo já gerada (por equipamento) e a queixa aberta dela. */
export interface AcaoGerada {
  readonly equipamento: number;
  readonly os: { readonly id: number; readonly numero: string; readonly situacao: string };
  readonly queixa: number | null;
}

/**
 * Os equipamentos do parque diante do alerta: os afetados e os a conferir, com a OS já gerada. O que já tem OS deste
 * alerta segue na lista mesmo se o cadastro mudou depois (a ação de campo não some).
 */
export function afetadosDoAlerta(
  parque: readonly EquipamentoDoParque[],
  c: CriterioAlerta,
  acoes: readonly AcaoGerada[],
): AfetadoAlerta[] {
  const porEquip = new Map(acoes.map((a) => [a.equipamento, a]));
  const r: AfetadoAlerta[] = [];
  for (const eq of parque) {
    const a = porEquip.get(eq.id);
    const enq = enquadrarEquipamento(eq, c) ?? (a ? 'afetado' : null);
    if (enq === null) continue;
    r.push({
      equipamento: eq.id,
      codigo: eq.codigo,
      nome: eq.nome,
      modelo: eq.modelo,
      numeroSerie: eq.numeroSerie,
      centroCusto: eq.centroCusto,
      enquadramento: enq,
      os: a?.os ?? null,
      queixa: a?.queixa ?? null,
    });
  }
  return r.sort((x, y) =>
    x.enquadramento === y.enquadramento
      ? x.codigo.localeCompare(y.codigo)
      : x.enquadramento === 'afetado'
        ? -1
        : 1,
  );
}

export interface AlertaParaConferir extends CriterioAlerta {
  readonly situacao: 'aberto' | 'encerrado';
  readonly versao: number;
  readonly acoes: number;
}

type Conferencia = { readonly ok: true } | { readonly ok: false; readonly motivo: RecusaAlertaEquipamento };
const recusa = (motivo: RecusaAlertaEquipamento): Conferencia => ({ ok: false, motivo });

/**
 * Alterar pela versão lida: o encerrado não muda; o critério não muda depois da primeira OS de ação de campo. O NÚMERO
 * do alerta é a chave que a OS de ação de campo e a queixa técnica da qualidade citam (SGH_QUA_TECNOVIG.ALERTA, sem FK):
 * com OS gerada, trocá-lo (qualquer diferença além dos espaços das pontas) é recusado com `numero-com-vinculo`
 * (revisão W0-08; a gravação confere de novo as referências pelo número atual).
 */
export function conferirAlteracaoAlerta(
  atual: AlertaParaConferir & { readonly numero?: string },
  versao: number,
  novo: CriterioAlerta & { readonly numero?: string },
): Conferencia {
  if (atual.versao !== versao) return recusa('desatualizado');
  if (atual.situacao === 'encerrado') return recusa('alerta-encerrado');
  if (faixaInvertida(novo.serieInicio, novo.serieFim)) return recusa('faixa-invertida');
  const mesmo = (a: string | null, b: string | null) => normalizarTextoAlerta(a) === normalizarTextoAlerta(b);
  const criterioMudou =
    !mesmo(atual.fabricante, novo.fabricante) ||
    !mesmo(atual.modelo, novo.modelo) ||
    !mesmo(atual.serieInicio, novo.serieInicio) ||
    !mesmo(atual.serieFim, novo.serieFim);
  if (criterioMudou && atual.acoes > 0) return recusa('alerta-com-acao');
  if (numeroMudou(atual.numero, novo.numero) && atual.acoes > 0) return recusa('numero-com-vinculo');
  return { ok: true };
}

/** O número muda quando difere além dos espaços das pontas (a referência por número compara o texto gravado). */
export function numeroMudou(antes: string | undefined, depois: string | undefined): boolean {
  return antes !== undefined && depois !== undefined && antes.trim() !== depois.trim();
}

/** Encerrar (pela versão) e excluir (pela versão, só sem OS gerada; o vínculo é conferido de novo na gravação). */
export function conferirEncerramentoAlerta(atual: AlertaParaConferir, versao: number): Conferencia {
  if (atual.versao !== versao) return recusa('desatualizado');
  if (atual.situacao === 'encerrado') return recusa('alerta-encerrado');
  return { ok: true };
}

export interface AlertaParaAcao {
  readonly numero: string;
  readonly tipo: 'alerta' | 'recall';
  readonly titulo: string;
  readonly acao: string;
}

/** O texto da OS de ação de campo (cabe nos 2000 da descrição da OS). */
export function descricaoDaAcaoDeCampo(
  a: AlertaParaAcao,
  eq: { readonly numeroSerie: string | null },
): string {
  const tipo = a.tipo === 'recall' ? 'Recall' : 'Alerta de tecnovigilância';
  const serie = eq.numeroSerie ? ` Série ${eq.numeroSerie}.` : ' Série a conferir na etiqueta.';
  return `Ação de campo — ${tipo} ${a.numero}: ${a.titulo}.${serie} ${a.acao}`.slice(0, 2000);
}

/**
 * Os equipamentos que recebem a OS agora: os pedidos (ou, sem pedido, todos os afetados), tirados os que já têm OS
 * deste alerta. Pedido de equipamento fora da lista (nem afetado nem a conferir) é ignorado. Nenhum: `sem-afetados`.
 */
export function planejarAcaoDeCampo(
  atual: AlertaParaConferir,
  versao: number,
  afetados: readonly AfetadoAlerta[],
  pedidos: readonly number[],
):
  | { readonly ok: true; readonly equipamentos: AfetadoAlerta[] }
  | { readonly ok: false; readonly motivo: RecusaAlertaEquipamento } {
  const c = conferirEncerramentoAlerta(atual, versao);
  if (!c.ok) return c;
  const pedido = new Set(pedidos);
  const alvo = afetados.filter(
    (x) => x.os === null && (pedido.size === 0 ? x.enquadramento === 'afetado' : pedido.has(x.equipamento)),
  );
  return alvo.length === 0 ? { ok: false, motivo: 'sem-afetados' } : { ok: true, equipamentos: alvo };
}
