// Imuno-hematologia do receptor e prova cruzada (ficha do M47, etapa 2, regras 3 e 6; cap-05b §5.11; RDC 34/2014):
//   - tipagem ABO pela prova direta (hemácias do paciente com anti-A e anti-B) e pela reversa (soro do paciente com
//     hemácias A1 e B), que precisam concordar; o controle positivo invalida; RhD pelo anti-D (0 negativo, 2 ou mais
//     positivo; 1 cruz é D fraco no receptor: repetir antes de usar);
//   - o resultado é digitado por um profissional e liberado por outro (dupla conferência); só o liberado vale;
//   - com a agência própria, a tipagem liberada do novo prevalece sobre a do cadastro do paciente (ponto de partida);
//     duas tipagens liberadas que discordam bloqueiam a transfusão até uma nova amostra;
//   - a prova cruzada é das hemácias, na amostra válida da requisição; com a pesquisa de anticorpos positiva, só vale
//     com a fase da antiglobulina; a bolsa de hemácias só é reservada (e transfundida) com a prova compatível liberada,
//     fora a extrema urgência (liberada sem prova, com o alerta; a prova é feita depois).
import type {
  ClasseHemocomponente,
  ProvaCruzadaResumo,
  ResultadoImunoResumo,
  EstadoImuno,
  FatorRh,
  GrupoAbo,
  ResultadoPai,
  TipagemDoReceptor,
  TipagemSanguinea,
  TipoExameImuno,
} from '@sgh/contratos';

export type { ProvaCruzadaResumo, ResultadoImunoResumo };

export interface ProvaDireta {
  readonly antiA: number;
  readonly antiB: number;
  readonly antiD: number;
  readonly controle: number;
}
export interface ProvaReversa {
  readonly hemaciaA1: number;
  readonly hemaciaB: number;
}

export type ProblemaTipagem = 'controle-positivo' | 'discrepancia-abo' | 'rh-fraco';

export const MENSAGENS_IMUNO: Readonly<Record<string, string>> = {
  'controle-positivo': 'O controle reagiu: o teste é inválido. Repita com nova amostra.',
  'discrepancia-abo': 'A prova direta e a reversa não concordam: resolva a discrepância antes de liberar.',
  'rh-fraco': 'Anti-D com 1 cruz (D fraco): no receptor, repita e trate como Rh negativo até concluir.',
  'tipagem-inconclusiva': 'A tipagem não é conclusiva: não pode ser liberada.',
  'mesmo-profissional': 'A liberação é de outro profissional: quem registrou não libera o próprio resultado.',
  'ja-liberado': 'O resultado já foi liberado.',
  invalidado: 'O resultado foi invalidado.',
  'prova-so-hemacias': 'A prova cruzada é feita para concentrado de hemácias.',
  'amostra-ausente': 'A requisição não tem amostra coletada.',
  'amostra-vencida': 'A amostra da requisição venceu: colete outra.',
  'antiglobulina-obrigatoria':
    'Com a pesquisa de anticorpos positiva, a prova cruzada precisa da fase da antiglobulina.',
  'bolsa-fora-do-estoque': 'A bolsa não está no estoque da agência.',
  'bolsa-de-outro-hemocomponente': 'A bolsa não é do hemocomponente requisitado.',
  'requisicao-encerrada': 'A requisição está cancelada ou já atendida.',
  'paciente-diferente': 'A requisição é de outro paciente.',
  'sem-tipagem-da-agencia': 'O paciente não tem a tipagem ABO e Rh liberada pela agência.',
  'tipagem-divergente': 'Há duas tipagens liberadas que não concordam: colete nova amostra.',
  'prova-cruzada-pendente':
    'Falta a prova cruzada compatível e liberada desta bolsa com a amostra do paciente.',
  'prova-incompativel': 'A prova cruzada desta bolsa foi incompatível: escolha outra bolsa.',
  'bolsa-sem-reserva': 'A bolsa de hemácias não está reservada para esta requisição.',
  'bolsa-reservada-outra': 'A bolsa está reservada para outra requisição.',
  'sem-prova-cruzada': 'Extrema urgência: bolsa liberada sem a prova cruzada (fazer depois, com a amostra).',
  'pai-positivo': 'Pesquisa de anticorpos irregulares positiva: use hemácias compatíveis com o anticorpo.',
  'equipamento-desligado': 'A interface de equipamento ainda não está ligada: digite o resultado.',
  'etiqueta-diferente-do-estoque':
    'A etiqueta lida não confere com a bolsa recebida no estoque (hemocomponente, tipo sanguíneo ou validade).',
};

const positivo = (g: number) => g >= 1;

/** O grupo pela prova direta. */
function grupoDireto(d: ProvaDireta): GrupoAbo {
  const a = positivo(d.antiA);
  const b = positivo(d.antiB);
  return a && b ? 'AB' : a ? 'A' : b ? 'B' : 'O';
}

/** O que a prova reversa espera de cada grupo (anticorpo natural contra o antígeno que falta). */
const REVERSA_ESPERADA: Readonly<Record<GrupoAbo, { readonly a1: boolean; readonly b: boolean }>> = {
  A: { a1: false, b: true },
  B: { a1: true, b: false },
  AB: { a1: false, b: false },
  O: { a1: true, b: true },
};

/** Interpreta a tipagem ABO e Rh; com problema, a tipagem fica nula (não pode ser liberada). */
export function interpretarAboRh(
  d: ProvaDireta,
  r: ProvaReversa,
): { readonly tipagem: TipagemSanguinea | null; readonly problemas: readonly ProblemaTipagem[] } {
  const problemas: ProblemaTipagem[] = [];
  if (positivo(d.controle)) problemas.push('controle-positivo');
  const abo = grupoDireto(d);
  const esperada = REVERSA_ESPERADA[abo];
  if (positivo(r.hemaciaA1) !== esperada.a1 || positivo(r.hemaciaB) !== esperada.b)
    problemas.push('discrepancia-abo');
  let rh: FatorRh | null = d.antiD === 0 ? 'negativo' : d.antiD >= 2 ? 'positivo' : null;
  if (rh === null) problemas.push('rh-fraco');
  if (problemas.length > 0) rh = null;
  return { tipagem: problemas.length > 0 ? null : { abo, rh }, problemas };
}

/** Regra da dupla conferência: quem registrou não libera; só o registrado (e conclusivo) é liberado. */
export function conferirLiberacaoImuno(c: {
  readonly estado: EstadoImuno;
  readonly tipo: TipoExameImuno;
  readonly registradoPor: string;
  readonly liberador: string;
  readonly tipagem: TipagemSanguinea | null;
}): readonly string[] {
  const b: string[] = [];
  if (c.estado === 'liberado') b.push('ja-liberado');
  if (c.estado === 'invalidado') b.push('invalidado');
  if (c.registradoPor.trim().toUpperCase() === c.liberador.trim().toUpperCase()) b.push('mesmo-profissional');
  if (c.tipo === 'aboRh' && (!c.tipagem?.abo || !c.tipagem.rh)) b.push('tipagem-inconclusiva');
  return b;
}

/** A tipagem que vale para a transfusão: a liberada pela agência; sem ela, a do cadastro (ponto de partida). */
export function tipagemDoReceptor(
  resultados: readonly ResultadoImunoResumo[],
  cadastro: TipagemSanguinea,
): TipagemDoReceptor {
  const liberados = resultados
    .filter((x) => x.estado === 'liberado')
    .sort((a, b) => (b.liberadoEm ?? '').localeCompare(a.liberadoEm ?? ''));
  const tipagens = liberados.filter((x) => x.tipo === 'aboRh' && x.tipagem?.abo && x.tipagem.rh);
  const pai = liberados.find((x) => x.tipo === 'pai') ?? null;
  const base = { pai: pai?.pai ?? null, anticorpos: pai?.anticorpos ?? null };
  if (tipagens.length > 0) {
    const t = tipagens[0]!.tipagem!;
    const divergente = tipagens.some((x) => x.tipagem!.abo !== t.abo || x.tipagem!.rh !== t.rh);
    return divergente
      ? { tipagem: { abo: null, rh: null }, origem: 'agencia', divergente: true, ...base }
      : { tipagem: t, origem: 'agencia', divergente: false, ...base };
  }
  const temCadastro = cadastro.abo !== null && cadastro.rh !== null;
  return {
    tipagem: temCadastro ? cadastro : { abo: null, rh: null },
    origem: temCadastro ? 'cadastro' : null,
    divergente: false,
    ...base,
  };
}

/** Conferências do registro da prova cruzada (antes de gravar; o banco relê na transação). */
export function conferirProvaCruzada(c: {
  readonly classe: ClasseHemocomponente;
  readonly amostraValidaAte: string | null;
  readonly agora: string;
  readonly bolsaNoEstoque: boolean;
  readonly hemocomponenteDaBolsa: string | null;
  readonly hemocomponenteRequisitado: string;
  readonly estadoRequisicao: string;
  readonly pai: ResultadoPai | null;
  readonly faseAntiglobulina: boolean;
}): readonly string[] {
  const b: string[] = [];
  if (c.classe !== 'hemacias') b.push('prova-so-hemacias');
  if (c.estadoRequisicao === 'cancelada' || c.estadoRequisicao === 'atendida') b.push('requisicao-encerrada');
  if (c.amostraValidaAte === null) b.push('amostra-ausente');
  else if (c.amostraValidaAte <= c.agora) b.push('amostra-vencida');
  if (!c.bolsaNoEstoque) b.push('bolsa-fora-do-estoque');
  else if (
    (c.hemocomponenteDaBolsa ?? '').trim().toUpperCase() !== c.hemocomponenteRequisitado.trim().toUpperCase()
  )
    b.push('bolsa-de-outro-hemocomponente');
  if (c.pai === 'positivo' && !c.faseAntiglobulina) b.push('antiglobulina-obrigatoria');
  return b;
}

/**
 * A bolsa escolhida para a requisição com a agência própria (a reserva e o início do ato): a tipagem do receptor pela
 * agência, sem divergência; nas hemácias, a prova cruzada compatível e liberada desta bolsa com esta requisição (fora a
 * extrema urgência, que passa com o alerta).
 */
export function conferirCompatibilidadeDaAgencia(c: {
  readonly classe: ClasseHemocomponente;
  readonly numeroBolsa: string;
  readonly requisicao: number;
  readonly extremaUrgencia: boolean;
  readonly receptor: TipagemDoReceptor;
  readonly provas: readonly ProvaCruzadaResumo[];
}): { readonly bloqueios: readonly string[]; readonly alertas: readonly string[] } {
  const bloqueios: string[] = [];
  const alertas: string[] = [];
  if (c.receptor.divergente) bloqueios.push('tipagem-divergente');
  else if (c.receptor.origem !== 'agencia' && !c.extremaUrgencia) bloqueios.push('sem-tipagem-da-agencia');
  if (c.receptor.pai === 'positivo') alertas.push('pai-positivo');
  if (c.classe === 'hemacias') {
    const daBolsa = c.provas.filter(
      (p) => p.bolsa === c.numeroBolsa && p.requisicao === c.requisicao && p.estado === 'liberado',
    );
    if (daBolsa.some((p) => p.resultado === 'incompativel')) bloqueios.push('prova-incompativel');
    else if (!daBolsa.some((p) => p.resultado === 'compativel')) {
      if (c.extremaUrgencia) alertas.push('sem-prova-cruzada');
      else bloqueios.push('prova-cruzada-pendente');
    }
  }
  return { bloqueios, alertas };
}

/**
 * Com a agência própria, o início do ato (etapa 1) confere a bolsa contra o estoque: ela está no estoque, com a
 * etiqueta lida igual à do recebimento (hemocomponente, tipagem e validade), liberada ou reservada para esta requisição
 * (as hemácias só reservadas: a reserva vem depois da prova cruzada), e a compatibilidade da agência (tipagem da
 * agência, prova cruzada). Devolve também a situação no estoque, que a regra 3 (`conferirBolsa`) usa.
 */
export function conferirBolsaDaAgenciaNoAto(c: {
  readonly bolsa: {
    readonly situacao: string;
    readonly reservadaPara: number | null;
    readonly hemocomponente: string;
    readonly abo: GrupoAbo | null;
    readonly rh: FatorRh | null;
    readonly validade: string;
  } | null;
  readonly etiqueta: {
    readonly numero: string;
    readonly hemocomponente: string;
    readonly abo: GrupoAbo;
    readonly rh: FatorRh;
    readonly validade: string;
  };
  readonly requisicao: number;
  readonly classe: ClasseHemocomponente;
  readonly extremaUrgencia: boolean;
  readonly receptor: TipagemDoReceptor;
  readonly provas: readonly ProvaCruzadaResumo[];
}): {
  readonly bloqueios: readonly string[];
  readonly alertas: readonly string[];
  readonly situacao:
    'quarentena' | 'liberada' | 'reservada' | 'transfundida' | 'descartada' | 'devolvida' | null;
} {
  if (!c.bolsa) return { bloqueios: ['bolsa-fora-do-estoque'], alertas: [], situacao: null };
  const b = c.bolsa;
  const bloqueios: string[] = [];
  if (
    b.hemocomponente.trim().toUpperCase() !== c.etiqueta.hemocomponente.trim().toUpperCase() ||
    b.abo !== c.etiqueta.abo ||
    b.rh !== c.etiqueta.rh ||
    b.validade.slice(0, 16) !== c.etiqueta.validade.slice(0, 16)
  )
    bloqueios.push('etiqueta-diferente-do-estoque');
  if (b.situacao === 'reservada' && b.reservadaPara !== c.requisicao) bloqueios.push('bolsa-reservada-outra');
  else if (b.situacao === 'liberada' && c.classe === 'hemacias' && !c.extremaUrgencia)
    bloqueios.push('bolsa-sem-reserva');
  const compat = conferirCompatibilidadeDaAgencia({
    classe: c.classe,
    numeroBolsa: c.etiqueta.numero,
    requisicao: c.requisicao,
    extremaUrgencia: c.extremaUrgencia,
    receptor: c.receptor,
    provas: c.provas,
  });
  return {
    bloqueios: [...bloqueios, ...compat.bloqueios],
    alertas: compat.alertas,
    situacao: b.situacao as 'quarentena',
  };
}
