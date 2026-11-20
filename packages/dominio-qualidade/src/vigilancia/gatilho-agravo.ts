// Gatilhos da notificação compulsória (ficha do M48, regra 8; cap-05b §5.11, "Notificação compulsória"): CID
// notificável registrado no atendimento, resultado reagente de exame configurado e óbito de atendimento com CID
// notificável. A fila mostra os gatilhos sem caso; quem abre o caso é a vigilância. A lista nacional é o cadastro de CID
// do estabelecimento (a periodicidade por CID), que o importador atualiza sem nova versão do sistema.
import {
  type GatilhoAgravo,
  type GatilhoAgravoLido,
  type GatilhoExameLido,
  type OrigemCasoAgravo,
  type PacienteAgravo,
  type PeriodicidadeAgravo,
  type SituacaoCasoAgravo,
} from '@sgh/contratos';
import { msLocal } from '../nsp/prazos.js';
import { estadoPrazoAgravo, prazoDoAgravo } from './prazos-agravo.js';

const DIA_MS = 86_400_000;

/** Janela em que o mesmo agravo do mesmo paciente é o mesmo caso (D-DEDUP-48.4). */
export const JANELA_MESMO_CASO_DIAS = 30;

/** Texto sem acento, em maiúsculas e com um espaço entre as palavras (nomes de exame e resultados). */
export function normalizarTexto(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/**
 * O resultado em texto é reagente (ou positivo, ou detectável)? "NÃO REAGENTE", "NEGATIVO", "NÃO DETECTÁVEL" e
 * "INDETERMINADO" não são. Aceita o índice depois da palavra ("REAGENTE (0,09)"), como o laboratório digita.
 */
export function ehResultadoReagente(resultado: string | null | undefined): boolean {
  if (!resultado) return false;
  const t = normalizarTexto(resultado);
  if (/^(NAO|NEGATIVO|INDETERMINADO|INCONCLUSIVO)\b/.test(t)) return false;
  return /^(REAGENTE|POSITIVO|DETECTAVEL|DETECTADO)\b/.test(t);
}

/** Termos que a consulta usa para trazer os candidatos (o filtro fino é `ehResultadoReagente`). */
export const TERMOS_RESULTADO_REAGENTE = ['REAGENTE', 'POSITIVO', 'DETECT'] as const;

/**
 * Exames cujo resultado reagente sugere agravo de notificação compulsória, pelo nome do exame no cadastro, quando o
 * estabelecimento não configurou os seus (D-EXAME-48.4; perfil da cópia pc: dengue, Zika, chikungunya, sífilis, HIV e
 * hepatites aparecem com resultado reagente em 2026). A IgG fica de fora (infecção antiga); a FTA-ABS IgG também.
 */
export const GATILHOS_EXAME_PADRAO: readonly GatilhoExameLido[] = [
  { padrao: 'DENGUE', exceto: 'IGG', cid: 'A90' },
  { padrao: 'NS1', exceto: null, cid: 'A90' },
  { padrao: 'ZIKA', exceto: 'IGG', cid: 'A928' },
  { padrao: 'CHIKUNGUNYA', exceto: 'IGG', cid: 'A920' },
  { padrao: 'VDRL', exceto: null, cid: 'A539' },
  { padrao: 'SIFILIS', exceto: 'IGG', cid: 'A539' },
  { padrao: 'HIV', exceto: null, cid: 'B24' },
  { padrao: 'HBSAG', exceto: null, cid: 'B169' },
  { padrao: 'HBC IGM', exceto: null, cid: 'B169' },
  { padrao: 'HCV', exceto: null, cid: 'B171' },
  { padrao: 'HEPATITE A', exceto: 'IGG', cid: 'B159' },
].map((g) => ({ ...g, id: null, versao: null, ativo: true, fonte: 'padrao' as const }));

/** Os gatilhos que valem: os configurados pelo estabelecimento, ou a lista padrão se não houver nenhum. */
export function gatilhosExameVigentes(
  configurados: readonly GatilhoExameLido[],
): readonly GatilhoExameLido[] {
  return configurados.length > 0 ? configurados : GATILHOS_EXAME_PADRAO;
}

/** O CID sugerido pelo nome do exame (o primeiro gatilho ativo que casa), ou nulo. */
export function cidDoExame(nomeExame: string, gatilhos: readonly GatilhoExameLido[]): string | null {
  const nome = normalizarTexto(nomeExame);
  for (const g of gatilhos) {
    if (!g.ativo) continue;
    if (!nome.includes(normalizarTexto(g.padrao))) continue;
    if (g.exceto && nome.includes(normalizarTexto(g.exceto))) continue;
    return g.cid;
  }
  return null;
}

/** Um CID notificável do cadastro (código como o cadastro guarda, sem ponto). */
export interface CidCadastro {
  readonly cid: string;
  readonly nome: string;
  readonly periodicidade: PeriodicidadeAgravo;
}

/**
 * O CID no cadastro de notificáveis: o próprio código ou, para a categoria (A90), a mais restritiva das
 * subcategorias notificáveis dela. Nulo se o CID não é notificável.
 */
export function cidNotificavel(cid: string, cadastro: ReadonlyMap<string, CidCadastro>): CidCadastro | null {
  const exato = cadastro.get(cid);
  if (exato) return exato;
  if (cid.length !== 3) return cadastro.get(cid.slice(0, 3)) ?? null;
  let achado: CidCadastro | null = null;
  for (const c of cadastro.values()) {
    if (!c.cid.startsWith(cid)) continue;
    if (!achado || (c.periodicidade === 'imediata' && achado.periodicidade !== 'imediata'))
      achado = { ...c, cid };
  }
  return achado;
}

// ── Eventos lidos e montagem da fila ────────────────────────────────────────────────────────────────────

interface EventoBase {
  readonly atendimento: number;
  readonly paciente: PacienteAgravo;
  readonly unidade: string | null;
}
/** CID registrado no atendimento (principal ou secundário). */
export interface EventoCid extends EventoBase {
  readonly cid: string;
  readonly registradoEm: string;
}
/** Resultado de exame liberado com texto candidato (o filtro fino é aqui). */
export interface EventoExame extends EventoBase {
  readonly exame: number;
  readonly nomeExame: string;
  readonly resultado: string;
  readonly liberadoEm: string;
}
/** Óbito (alta por óbito ou declaração de óbito) de atendimento com CID registrado. */
export interface EventoObito extends EventoBase {
  readonly cid: string;
  readonly obitoEm: string;
}

/** O que a fila precisa saber dos casos já abertos (para não sugerir de novo). */
export interface CasoExistente {
  readonly origem: OrigemCasoAgravo;
  readonly atendimento: number | null;
  readonly exame: number | null;
  readonly paciente: number;
  readonly cid: string;
  readonly situacao: SituacaoCasoAgravo;
  readonly gatilhoEm: string;
}

/** Chave estável do gatilho: origem, referência (atendimento ou exame) e CID. */
export function chaveGatilho(origem: GatilhoAgravo, referencia: number, cid: string): string {
  return `${origem}:${String(referencia)}:${cid}`;
}

function chaveDoCaso(c: CasoExistente): string | null {
  if (c.origem === 'manual') return null;
  const ref = c.origem === 'exame' ? c.exame : c.atendimento;
  return ref === null ? null : chaveGatilho(c.origem, ref, c.cid);
}

/** O mesmo agravo (categoria do CID) do mesmo paciente em até 30 dias já tem caso aberto ou notificado. */
function jaTemCaso(paciente: number, cid: string, quando: string, casos: readonly CasoExistente[]): boolean {
  const t = msLocal(quando);
  return casos.some(
    (c) =>
      c.paciente === paciente &&
      c.situacao !== 'descartado' &&
      c.cid.slice(0, 3) === cid.slice(0, 3) &&
      Math.abs(msLocal(c.gatilhoEm) - t) <= JANELA_MESMO_CASO_DIAS * DIA_MS,
  );
}

/** A mesma tolerância da abertura (relógios de estações diferentes). */
const TOLERANCIA_FUTURO_MS = 5 * 60_000;
const instanteMs = (t: string) => new Date(`${t.length === 16 ? `${t}:00` : t.slice(0, 19)}Z`).getTime();

export interface EntradaFilaAgravos {
  readonly cids: readonly EventoCid[];
  readonly exames: readonly EventoExame[];
  readonly obitos: readonly EventoObito[];
  readonly cadastro: ReadonlyMap<string, CidCadastro>;
  readonly gatilhosExame: readonly GatilhoExameLido[];
  readonly casos: readonly CasoExistente[];
  readonly agora: string;
}

/**
 * A fila de gatilhos sem caso: cada evento vira no máximo um gatilho; o mesmo agravo do mesmo paciente aparece uma vez
 * (o gatilho mais antigo, que define o prazo); o que já virou caso (inclusive descartado, pela chave) não volta. O
 * óbito vence o CID do mesmo atendimento (prazo imediato: óbito por agravo notificável). Ordem: prazo mais curto.
 */
export function montarFilaAgravos(e: EntradaFilaAgravos): GatilhoAgravoLido[] {
  const chavesDosCasos = new Set(e.casos.map(chaveDoCaso).filter((c): c is string => c !== null));
  const limiteFuturo = instanteMs(e.agora) + TOLERANCIA_FUTURO_MS;
  const candidatos: GatilhoAgravoLido[] = [];
  const incluir = (
    origem: GatilhoAgravo,
    ev: EventoBase,
    referencia: number,
    cidBruto: string,
    gatilhoEm: string,
    extra: { exame: number | null; exameNome: string | null; resultado: string | null },
    forcarImediata = false,
  ) => {
    const c = cidNotificavel(cidBruto, e.cadastro);
    const periodicidade: PeriodicidadeAgravo | null = forcarImediata
      ? 'imediata'
      : (c?.periodicidade ?? (origem === 'exame' ? 'semanal' : null));
    if (periodicidade === null) return;
    // O registro com data depois de agora (digitação errada ou atendimento agendado) não vira sugestão: a abertura o
    // recusaria (gatilho no futuro); se for caso, a vigilância abre sem sugestão (D-FUTURO-48.4).
    if (instanteMs(gatilhoEm) > limiteFuturo) return;
    const chave = chaveGatilho(origem, referencia, cidBruto);
    if (chavesDosCasos.has(chave)) return;
    if (jaTemCaso(ev.paciente.id, cidBruto, gatilhoEm, e.casos)) return;
    const prazoEm = prazoDoAgravo(periodicidade, gatilhoEm);
    candidatos.push({
      chave,
      origem,
      atendimento: ev.atendimento,
      exame: extra.exame,
      paciente: ev.paciente,
      cid: cidBruto,
      nomeCid: c?.nome ?? cidBruto,
      periodicidade,
      gatilhoEm,
      prazoEm,
      estadoPrazo: estadoPrazoAgravo(periodicidade, prazoEm, e.agora, 'aberto').estado,
      exameNome: extra.exameNome,
      resultado: extra.resultado,
      unidade: ev.unidade,
    });
  };
  const semExame = { exame: null, exameNome: null, resultado: null };
  for (const o of e.obitos) {
    if (!cidNotificavel(o.cid, e.cadastro)) continue;
    incluir('obito', o, o.atendimento, o.cid, o.obitoEm, semExame, true);
  }
  const atendimentosComObito = new Set(
    candidatos.filter((c) => c.origem === 'obito').map((c) => `${String(c.atendimento)}:${c.cid}`),
  );
  for (const c of e.cids) {
    if (atendimentosComObito.has(`${String(c.atendimento)}:${c.cid}`)) continue;
    incluir('cid', c, c.atendimento, c.cid, c.registradoEm, semExame);
  }
  for (const x of e.exames) {
    if (!ehResultadoReagente(x.resultado)) continue;
    const cid = cidDoExame(x.nomeExame, e.gatilhosExame);
    if (cid === null) continue;
    incluir('exame', x, x.exame, cid, x.liberadoEm, {
      exame: x.exame,
      exameNome: x.nomeExame,
      resultado: x.resultado.trim().slice(0, 60),
    });
  }
  // Um gatilho por paciente e agravo (categoria do CID): o mais antigo define o prazo.
  candidatos.sort((a, b) => msLocal(a.gatilhoEm) - msLocal(b.gatilhoEm));
  const vistos = new Set<string>();
  const unicos = candidatos.filter((c) => {
    const k = `${String(c.paciente.id)}:${c.cid.slice(0, 3)}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  return unicos.sort((a, b) => msLocal(a.prazoEm) - msLocal(b.prazoEm) || a.chave.localeCompare(b.chave));
}
