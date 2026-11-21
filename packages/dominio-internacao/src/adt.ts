// ADT da internação (M21; ficha, seção 8): as regras puras das telas de trabalho — internado pela sentinela (regra 2),
// as duas réguas de permanência com nomes distintos (regra 5), o grupo do motivo de alta e o destino (regra 6), a
// reinternação calculada por paciente até 30 dias (regra 7) e o mapa de leitos operacional: o painel do M16 (os mesmos
// números, regra 4) sobreposto pelos estados que só o novo conhece (bloqueio, precaução, higienização) e o conflito
// quando o outro sistema ocupa um leito bloqueado no novo (regra 8: o mapa mostra e avisa; nunca impede o outro).
import {
  type ChaveLeito,
  chaveTextoLeito,
  type DestinoAlta,
  diariasFaturaveis as diariasDoLegado,
  type GrupoMotivoAlta,
  grupoMotivoAlta,
  type LeitoMapa,
  type MapaOperacional,
  type PainelLeitos,
  type SituacaoMapaLeito,
} from '@sgh/contratos';

// ── Regra 2: internado = alta sentinela ───────────────────────────────────────────────────────────

/** A alta lida (AAAA-MM-DD ou null na sentinela 1899-12-30): sem alta = internado. Nunca NULL no legado. */
export function estaInternado(alta: string | null): boolean {
  return alta === null || alta.startsWith('1899-12-30');
}

/** As internações com alta antes da entrada (incoerência antiga): vão ao relatório do SAME, fora dos cálculos. */
export function altaAntesDaEntrada(i: { entrada: string; alta: string | null }): boolean {
  return i.alta !== null && !estaInternado(i.alta) && i.alta < i.entrada;
}

// ── Regra 5: as duas réguas ───────────────────────────────────────────────────────────────────────

/** Diárias faturáveis (a coluna do faturamento), pela regra do legado: a diferença de dias, mais uma às 12h ou depois. */
export const diariasFaturaveis = diariasDoLegado;

/**
 * Permanência da Portaria SAS 312/2002 (paciente-dia do paciente): os dias entre a entrada e a saída (o dia da saída
 * não conta); a entrada e a saída no mesmo dia contam um paciente-dia. Nome distinto das diárias faturáveis.
 */
export function permanenciaPortaria312(entradaIso: string, saidaIso: string): number {
  const dias = Math.round(
    (Date.parse(`${saidaIso}T00:00:00Z`) - Date.parse(`${entradaIso}T00:00:00Z`)) / 86_400_000,
  );
  if (!Number.isFinite(dias) || dias < 0) return 0;
  return Math.max(1, dias);
}

// ── Regra 7: reinternação ─────────────────────────────────────────────────────────────────────────

/**
 * Reinternação: a nova entrada até 30 dias depois da alta anterior do mesmo paciente (o legado grava REINT30 'F' em
 * 100% e o novo calcula). A alta por óbito não tem reinternação; a alta no mesmo dia e a entrada antes não contam.
 */
export function reinternacaoEm30Dias(altaAnterior: string | null, novaEntrada: string, dias = 30): boolean {
  if (!altaAnterior || estaInternado(altaAnterior)) return false;
  const d = Math.round(
    (Date.parse(`${novaEntrada}T00:00:00Z`) - Date.parse(`${altaAnterior}T00:00:00Z`)) / 86_400_000,
  );
  return d >= 0 && d <= dias;
}

/** A internação mais recente do paciente terminou até 30 dias antes desta entrada? (lista de internações dele) */
export function ehReinternacao(
  historico: readonly { reg: number; entrada: string; alta: string | null; motivo: number | null }[],
  atual: { reg: number; entrada: string },
): boolean {
  const anteriores = historico
    .filter(
      (h) => h.reg !== atual.reg && h.entrada <= atual.entrada && h.alta !== null && !estaInternado(h.alta),
    )
    .sort((a, b) => (a.alta ?? '').localeCompare(b.alta ?? ''));
  const ultima = anteriores.at(-1);
  if (!ultima) return false;
  if (ultima.motivo !== null && grupoMotivoAlta(ultima.motivo) === 'obito') return false;
  return reinternacaoEm30Dias(ultima.alta, atual.entrada);
}

// ── Regra 6: motivo e destino da alta ─────────────────────────────────────────────────────────────

export { grupoMotivoAlta };

/** Tipos de saída do cadastro de motivos de saída hospitalar (o CHECK do banco). */
export const TIPOS_SAIDA_HOSPITALAR = [
  'alta',
  'transferencia',
  'obito',
  'evasao',
  'a_pedido',
  'administrativa',
  'permanencia',
] as const;
export type TipoSaidaHospitalar = (typeof TIPOS_SAIDA_HOSPITALAR)[number];

/**
 * Grupo do indicador pelo tipo de saída do cadastro (o modelo próprio): nada de faixa de código do sistema de origem.
 * A permanência (mudança de procedimento) não encerra a internação; se vier, conta como alta domiciliar.
 */
export function grupoDoTipoSaida(tipo: string | null): GrupoMotivoAlta | null {
  switch (tipo) {
    case 'obito':
      return 'obito';
    case 'transferencia':
      return 'transferencia-externa';
    case 'evasao':
    case 'a_pedido':
      return 'evasao-ou-a-pedido';
    case 'administrativa':
      return 'encerramento-administrativo';
    case 'alta':
    case 'permanencia':
      return 'alta-domiciliar';
    default:
      return null;
  }
}

/** O destino codificado da alta médica que corresponde ao grupo do motivo de alta. */
export function destinoDoGrupo(g: GrupoMotivoAlta): DestinoAlta {
  switch (g) {
    case 'obito':
      return 'obito';
    case 'transferencia-externa':
      return 'transferenciaExterna';
    case 'internacao-domiciliar':
      return 'internacaoDomiciliar';
    case 'evasao-ou-a-pedido':
      return 'aPedido';
    case 'encerramento-administrativo':
      return 'administrativo';
    default:
      return 'domicilio';
  }
}

/** O motivo de alta escolhido é coerente com o destino da alta médica? */
export function motivoCoerente(motivo: number, destino: DestinoAlta): boolean {
  return destinoDoGrupo(grupoMotivoAlta(motivo)) === destino;
}

// ── Mapa de leitos operacional ────────────────────────────────────────────────────────────────────

export interface EstadoNovoLeito {
  readonly chave: string;
  readonly estado: 'bloqueio' | 'precaucao' | 'extra' | 'higienizacao';
  readonly motivo: string | null;
  readonly precaucao: string | null;
  readonly previsaoFim: string | null;
  readonly desde: string;
  readonly solicitacao: number | null;
  readonly conflitoReg: number | null;
  readonly conflitoEm: string | null;
  /** W0-07 (M4): a observação do estado ("OS <número>" liga o bloqueio à OS; o diálogo de alteração a mostra). */
  readonly observacao?: string | null;
}

export interface LimpezaDoLeito {
  readonly chave: string;
  readonly solicitacao: number;
  readonly etapa: string;
  readonly prazo: string | null;
  readonly atrasada: boolean;
}

/** M44 (etapa 2): a reserva vigente do NIR no leito. */
export interface ReservaDoLeito {
  readonly chave: string;
  readonly id: number;
  readonly solicitacao: number;
  readonly validaAte: string;
  readonly confirmada: boolean;
  readonly conflitoEm: string | null;
}

export interface AtributoDoLeito {
  readonly chave: string;
  readonly sexo: string | null;
  readonly idadeMinima: number | null;
  readonly idadeMaxima: number | null;
  readonly criticidade: number | null;
}

const MOTIVO_BLOQUEIO = 'Leito bloqueado no mapa: admita em outro leito ou desbloqueie antes.';
const MOTIVO_HIGIENIZACAO = 'Leito em higienização: a admissão espera a liberação depois da inspeção.';
const MOTIVO_OCUPADO = 'Leito ocupado.';
const MOTIVO_INATIVO = 'Leito inativo no cadastro de leitos.';
const MOTIVO_RESERVADO = 'Leito reservado pelo NIR: só o paciente da solicitação é admitido nele.';

/**
 * O mapa operacional: cada leito do painel do M16 (os mesmos totais) com os estados só do novo, a limpeza em curso e o
 * conflito (regra 8): o leito bloqueado ou em higienização no novo e ocupado no legado vira "conflito" (o mapa mostra na
 * hora e a coordenação é avisada); o legado nunca é impedido.
 */
export function montarMapaOperacional(
  painel: PainelLeitos,
  estados: readonly EstadoNovoLeito[],
  limpezas: readonly LimpezaDoLeito[],
  atributos: readonly AtributoDoLeito[] = [],
  reservas: readonly ReservaDoLeito[] = [],
  /** A solicitação do NIR que a tela atende (a admissão vinda do NIR): o leito reservado para ela é admissível. */
  solicitacaoAtendida: number | null = null,
): MapaOperacional {
  const porLeito = new Map<string, EstadoNovoLeito[]>();
  for (const e of estados) porLeito.set(e.chave, [...(porLeito.get(e.chave) ?? []), e]);
  const limpezaDe = new Map(limpezas.map((l) => [l.chave, l]));
  const atributoDe = new Map(atributos.map((a) => [a.chave, a]));
  const reservaDe = new Map(reservas.map((r) => [r.chave, r]));
  let reservados = 0;
  const leitos: LeitoMapa[] = [];
  let bloqueados = 0;
  let emHigienizacao = 0;
  let conflitos = 0;
  let admissiveis = 0;
  for (const b of painel.blocos)
    for (const a of b.acomodacoes)
      for (const l of a.leitos) {
        const leito: ChaveLeito = { bloco: b.bloco, acomodacao: a.acomodacao, leito: l.leito };
        const chave = chaveTextoLeito(leito);
        const es = porLeito.get(chave) ?? [];
        const bloqueio = es.find((e) => e.estado === 'bloqueio');
        const higienizacao = es.find((e) => e.estado === 'higienizacao');
        const ocupado = l.situacao === 'ocupado';
        let situacao: SituacaoMapaLeito = l.situacao;
        let motivo: string | null = null;
        let conflito: LeitoMapa['conflito'] = null;
        const reserva = reservaDe.get(chave) ?? null;
        if (l.situacao === 'inativo') motivo = MOTIVO_INATIVO;
        else if (ocupado && reserva && !bloqueio && !higienizacao) {
          // Regra 12 do M44: o outro sistema ocupou o leito reservado aqui (mostrado e avisado; nunca desfeito).
          situacao = 'conflito';
          conflito = {
            internacao: l.cartao?.internacao ?? 0,
            desde: reserva.conflitoEm ?? reserva.validaAte,
            registrado: reserva.conflitoEm !== null,
            reserva: reserva.id,
          };
          motivo = 'Ocupado pelo outro sistema com o leito reservado pelo NIR aqui: avise o NIR.';
        } else if (ocupado && (bloqueio || higienizacao)) {
          situacao = 'conflito';
          const c = (bloqueio ?? higienizacao) as EstadoNovoLeito;
          conflito = {
            internacao: l.cartao?.internacao ?? c.conflitoReg ?? 0,
            desde: c.conflitoEm ?? c.desde,
            // Já registrado (e na trilha) quando algum estado aberto do leito tem o conflito gravado: a releitura do
            // mapa não registra de novo (regra 8: o conflito visto pela primeira vez).
            registrado: es.some(
              (e) => (e.estado === 'bloqueio' || e.estado === 'higienizacao') && e.conflitoEm !== null,
            ),
          };
          motivo =
            'Ocupado pelo outro sistema com o leito bloqueado ou em higienização aqui: avise a coordenação.';
        } else if (ocupado) motivo = MOTIVO_OCUPADO;
        else if (bloqueio) {
          situacao = 'bloqueado';
          motivo = MOTIVO_BLOQUEIO;
        } else if (higienizacao) {
          situacao = 'higienizacao';
          motivo = MOTIVO_HIGIENIZACAO;
        } else if (reserva) {
          situacao = 'reservado';
          motivo = MOTIVO_RESERVADO;
        }
        if (situacao === 'bloqueado') bloqueados++;
        if (situacao === 'higienizacao') emHigienizacao++;
        if (situacao === 'conflito') conflitos++;
        if (situacao === 'reservado') reservados++;
        const admissivel =
          situacao === 'livre' ||
          (situacao === 'reservado' && reserva !== null && reserva.solicitacao === solicitacaoAtendida);
        if (admissivel) admissiveis++;
        const lp = limpezaDe.get(chave);
        const at = atributoDe.get(chave);
        leitos.push({
          chave,
          leito,
          situacao,
          estados: es.map((e) => ({
            estado: e.estado,
            motivo: e.motivo,
            precaucao: e.precaucao,
            previsaoFim: e.previsaoFim,
            desde: e.desde,
            observacao: e.observacao ?? null,
          })),
          admissivel,
          motivo,
          limpeza: lp
            ? { solicitacao: lp.solicitacao, etapa: lp.etapa, prazo: lp.prazo, atrasada: lp.atrasada }
            : null,
          conflito,
          atributos: at
            ? {
                sexo: at.sexo,
                idadeMinima: at.idadeMinima,
                idadeMaxima: at.idadeMaxima,
                criticidade: at.criticidade,
              }
            : null,
          reserva: reserva
            ? {
                id: reserva.id,
                solicitacao: reserva.solicitacao,
                validaAte: reserva.validaAte,
                confirmada: reserva.confirmada,
              }
            : null,
        });
      }
  return { painel, leitos, resumo: { bloqueados, emHigienizacao, conflitos, admissiveis, reservados } };
}

/** O leito aceita o paciente pelos atributos do novo (sexo e faixa de idade permitidos)? O motivo, quando não. */
export function compativelComPaciente(
  a: Pick<AtributoDoLeito, 'sexo' | 'idadeMinima' | 'idadeMaxima'> | null,
  p: { sexo: string | null; idade: number | null },
): string | null {
  if (!a) return null;
  if (a.sexo && a.sexo !== 'A' && p.sexo && a.sexo !== p.sexo)
    return a.sexo === 'F'
      ? 'Leito só para pacientes do sexo feminino.'
      : 'Leito só para pacientes do sexo masculino.';
  if (p.idade !== null && a.idadeMinima !== null && p.idade < a.idadeMinima)
    return `Leito para pacientes a partir de ${a.idadeMinima} anos.`;
  if (p.idade !== null && a.idadeMaxima !== null && p.idade > a.idadeMaxima)
    return `Leito para pacientes até ${a.idadeMaxima} anos.`;
  return null;
}

/** A idade em anos completos na data (AAAA-MM-DD); null sem o nascimento ou com data inválida. */
export function idadeEmAnos(nascimentoIso: string | null, hojeIso: string): number | null {
  if (!nascimentoIso || !/^\d{4}-\d{2}-\d{2}/.test(nascimentoIso) || !/^\d{4}-\d{2}-\d{2}/.test(hojeIso))
    return null;
  const [an, mn, dn] = nascimentoIso.slice(0, 10).split('-').map(Number) as [number, number, number];
  const [ah, mh, dh] = hojeIso.slice(0, 10).split('-').map(Number) as [number, number, number];
  const idade = ah - an - (mh < mn || (mh === mn && dh < dn) ? 1 : 0);
  return idade < 0 ? null : idade;
}

/** A guia vence hoje, já venceu ou está vigente (o alerta de vencimento da tela de guias). */
export function vencimentoDaGuia(
  fimIso: string | null,
  hojeIso: string,
): 'vigente' | 'vence-hoje' | 'vencida' {
  if (!fimIso) return 'vigente';
  if (fimIso < hojeIso) return 'vencida';
  const amanha = new Date(`${hojeIso}T00:00:00Z`);
  amanha.setUTCDate(amanha.getUTCDate() + 1);
  return fimIso <= amanha.toISOString().slice(0, 10) ? 'vence-hoje' : 'vigente';
}
