// AIH (ficha do M51, seção 5: `faturamento.registrarFaixaAih` e `faturamento.registrarAih`; regras 1, 2, 5 e 6; Manual
// do SIH/SUS): a autorização de internação hospitalar a partir da mesma conta (o financiador é o SUS: a conta é uma só,
// regra 1).
//   - Número: 13 dígitos (UF 2, ano 2, tipo 1, sequência 7 e o dígito verificador), da faixa liberada pelo gestor. O
//     dígito é o resto da divisão dos 12 primeiros por 11 (resto 10 vira 0: D-DV-AIH-51).
//   - Regra 6: a AIH só com laudo autorizado (número da faixa); não fecha sem autorização, com CID compatível e com
//     permanência coerente; as diárias de UTI vêm da trajetória (RICTRLOC nas acomodações de UTI), pelo tipo de UTI do
//     SIH e com leito habilitado (FHLEITOUTI).
//   - O procedimento principal é o realizado (ou o solicitado) e tem de ter o registro "AIH principal" na SIGTAP da
//     competência; os itens da conta com vínculo SIGTAP de registro "AIH secundário" ou "AIH especial" vão como
//     secundários e especiais; os do grupo 07 (órteses, próteses e materiais especiais) como OPM.
// Puro: as leituras ficam no adaptador e o arquivo em `sisaih-leiaute.ts`.
import type { CompetenciaSus, GravidadeCriticaSus, RegraCriticaSus, SituacaoAih } from '@sgh/contratos';
import { GRAVIDADE_DA_REGRA_SUS } from '@sgh/contratos';
import type { CriticaCiha, ProcedimentoNaCiha } from './ciha.js';
import { MOTIVOS_ALTA_SIH, normalizarCid } from './ciha.js';
import { type CompatibilidadesDaCompetencia, validarCompatibilidade } from './compatibilidade.js';
import { competenciaDaData, intervaloDaCompetencia } from './competencia.js';
import { cboValido, identificarPessoa, type ValidadorCns } from './identificacao-sus.js';
import { idadeEmMeses } from './sigtap-competencia.js';

// ── Número e faixa ────────────────────────────────────────────────────────────────────────────────────

/** O dígito verificador da AIH (D-DV-AIH-51: resto da divisão dos 12 dígitos por 11; o resto 10 vira 0). */
export function digitoAih(base12: string): string {
  if (!/^\d{12}$/.test(base12)) throw new Error('base da AIH: 12 dígitos');
  const r = Number(BigInt(base12) % 11n);
  return r === 10 ? '0' : String(r);
}

/** Número completo (13 dígitos) a partir da base de 12. */
export function numeroAih(base12: string | number | bigint): string {
  const b = String(base12).padStart(12, '0');
  return `${b}${digitoAih(b)}`;
}

/** O número tem 13 dígitos e o dígito confere. */
export function numeroAihValido(n: string | null | undefined): boolean {
  const v = (n ?? '').trim();
  return /^\d{13}$/.test(v) && digitoAih(v.slice(0, 12)) === v.slice(12);
}

/** A base (12 dígitos) de um número com o dígito. */
export function baseAih(n: string): bigint {
  return BigInt(n.slice(0, 12));
}

/** Teto da faixa registrada de uma vez (a sequência do número tem 7 dígitos). */
export const TAMANHO_MAXIMO_FAIXA_AIH = 9_999_999;

export type RecusaFaixaAih =
  'numero-invalido' | 'faixa-invertida' | 'faixa-prefixo-diferente' | 'faixa-grande' | 'faixa-sobreposta';

export interface FaixaExistente {
  readonly inicio: bigint;
  readonly fim: bigint;
  readonly situacao: 'ativa' | 'esgotada' | 'cancelada';
}

/**
 * A faixa nova: os dois extremos com o dígito certo, em ordem, com o mesmo prefixo (UF, ano e tipo: os 5 primeiros
 * dígitos), no máximo 9.999.999 números e sem sobrepor faixa já registrada (nem a cancelada: o número dela pode ter
 * sido usado).
 */
export function recusaFaixaAih(
  inicial: string,
  final: string,
  existentes: readonly FaixaExistente[],
): RecusaFaixaAih | null {
  if (!numeroAihValido(inicial) || !numeroAihValido(final)) return 'numero-invalido';
  const a = baseAih(inicial);
  const b = baseAih(final);
  if (b < a) return 'faixa-invertida';
  if (inicial.slice(0, 5) !== final.slice(0, 5)) return 'faixa-prefixo-diferente';
  if (b - a + 1n > BigInt(TAMANHO_MAXIMO_FAIXA_AIH)) return 'faixa-grande';
  if (existentes.some((f) => a <= f.fim && f.inicio <= b)) return 'faixa-sobreposta';
  return null;
}

/**
 * O próximo número da faixa (com o dígito): o seguinte ao maior já usado nela (D-FAIXA-51: a numeração é crescente; o
 * número saltado por uma escolha manual não é reaproveitado); null: esgotada.
 */
export function proximoNumeroDaFaixa(
  faixa: { readonly inicio: bigint; readonly fim: bigint },
  maiorUsado: string | null,
): string | null {
  const b = maiorUsado && numeroAihValido(maiorUsado) ? baseAih(maiorUsado) + 1n : faixa.inicio;
  const proximo = b < faixa.inicio ? faixa.inicio : b;
  return proximo > faixa.fim ? null : numeroAih(proximo);
}

/** O número pertence à faixa (pela base). */
export function numeroNaFaixa(n: string, faixa: { readonly inicio: bigint; readonly fim: bigint }): boolean {
  if (!numeroAihValido(n)) return false;
  const b = baseAih(n);
  return b >= faixa.inicio && b <= faixa.fim;
}

// ── Transições ────────────────────────────────────────────────────────────────────────────────────────

export type RecusaAih =
  | 'aih-ja-registrada'
  | 'internacao-nao-sus'
  | 'internacao-inexistente'
  | 'situacao-nao-permite'
  | 'faixa-inativa'
  | 'numero-fora-da-faixa'
  | 'numero-em-uso'
  | 'faixa-esgotada'
  | 'autorizacao-antes-do-laudo'
  | 'aih-com-bloqueante'
  | 'solicitante-inexistente'
  | 'procedimento-inexistente';

/** De que situação cada ação parte (a máquina de estados da AIH). */
export const ORIGEM_DA_ACAO_AIH: Readonly<
  Record<'autorizar' | 'negar' | 'fechar' | 'reabrir' | 'cancelar', readonly SituacaoAih[]>
> = {
  autorizar: ['solicitada'],
  negar: ['solicitada'],
  fechar: ['autorizada'],
  // A AIH fechada volta a autorizada (para corrigir); a apresentada não (o gestor já tem o arquivo: o retorno decide).
  reabrir: ['fechada'],
  cancelar: ['solicitada', 'autorizada', 'fechada'],
};

export function acaoPermitida(acao: keyof typeof ORIGEM_DA_ACAO_AIH, situacao: SituacaoAih): boolean {
  return ORIGEM_DA_ACAO_AIH[acao].includes(situacao);
}

// ── Diárias de UTI e permanência ─────────────────────────────────────────────────────────────────────

/** Acomodações de UTI do outro sistema (TBTIPOACOMOD): UTI, CTI, unidade coronária, CTI cardiovascular, UTI neonatal. */
export const ACOMODACOES_UTI: ReadonlySet<number> = new Set([3, 7, 8, 9, 17]);

/** Uma passagem da trajetória (RICTRLOC): datas AAAA-MM-DD e o tipo de acomodação. */
export interface PassagemLeito {
  readonly entrada: string;
  readonly saida: string | null;
  readonly acomodacao: number;
}

/** O tipo de UTI do SIH e o procedimento da diária por acomodação (parâmetro `faturamento.sus.aih.utiPorAcomodacao`). */
export interface UtiDaAcomodacao {
  readonly tipo: number;
  readonly procedimento: string;
}

export function utiPorAcomodacaoDoParametro(texto: string): ReadonlyMap<number, UtiDaAcomodacao> {
  const m = new Map<number, UtiDaAcomodacao>();
  for (const parte of texto.split(';')) {
    const [a, t, p] = parte.trim().split(':');
    if (!a || !t || !p || !/^\d{10}$/.test(p)) continue;
    m.set(Number(a), { tipo: Number(t), procedimento: p });
  }
  return m;
}

const DIA_MS = 86_400_000;
const dias = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_MS);

/**
 * Dias de permanência (D-PERMANENCIA-AIH-51): da internação à alta, o dia da alta não conta; a internação e a alta no
 * mesmo dia contam 1. Sem alta, ou alta antes da entrada: null.
 */
export function diasDePermanencia(entrada: string | null, alta: string | null): number | null {
  if (!entrada || !alta) return null;
  const d = dias(entrada, alta);
  return d < 0 ? null : Math.max(1, d);
}

export interface DiariasUti {
  readonly tipo: number;
  readonly procedimento: string;
  readonly diarias: number;
  /** Diárias antes do mês da alta (o SISAIH01 separa "mês anterior" e "mês da alta"). */
  readonly mesAnterior: number;
}

export interface ResultadoDiariasUti {
  readonly porTipo: readonly DiariasUti[];
  /** Acomodações de UTI da trajetória sem tipo do SIH no parâmetro. */
  readonly semTipo: readonly number[];
  readonly total: number;
}

/**
 * Diárias de UTI pela trajetória (regra 6; D-DIARIA-UTI-51): cada passagem numa acomodação de UTI conta as noites
 * (saída − entrada; a entrada e a saída no mesmo dia contam 1); a passagem sem saída vai até a alta. Somadas por tipo
 * de UTI do SIH.
 */
export function diariasUtiDaTrajetoria(
  passagens: readonly PassagemLeito[],
  mapa: ReadonlyMap<number, UtiDaAcomodacao>,
  alta: string | null,
): ResultadoDiariasUti {
  const porTipo = new Map<
    string,
    { tipo: number; procedimento: string; diarias: number; mesAnterior: number }
  >();
  const semTipo = new Set<number>();
  const inicioMesAlta = alta ? `${alta.slice(0, 7)}-01` : null;
  for (const p of passagens) {
    if (!ACOMODACOES_UTI.has(p.acomodacao)) continue;
    const u = mapa.get(p.acomodacao);
    if (!u) {
      semTipo.add(p.acomodacao);
      continue;
    }
    const fim = p.saida ?? alta;
    if (!fim) continue;
    const n = Math.max(1, dias(p.entrada, fim));
    const antes =
      inicioMesAlta && p.entrada < inicioMesAlta
        ? Math.min(n, Math.max(0, dias(p.entrada, fim < inicioMesAlta ? fim : inicioMesAlta)))
        : 0;
    const k = `${u.tipo}|${u.procedimento}`;
    const atual = porTipo.get(k);
    porTipo.set(k, {
      tipo: u.tipo,
      procedimento: u.procedimento,
      diarias: (atual?.diarias ?? 0) + n,
      mesAnterior: (atual?.mesAnterior ?? 0) + antes,
    });
  }
  const lista = [...porTipo.values()].sort((a, b) => a.tipo - b.tipo);
  return {
    porTipo: lista,
    semTipo: [...semTipo].sort((a, b) => a - b),
    total: lista.reduce((s, x) => s + x.diarias, 0),
  };
}

// ── Montagem (fechamento e crítica) ──────────────────────────────────────────────────────────────────

/** Um item da conta da internação (FCLANEXT) com o vínculo SIGTAP e o executante. */
export interface ItemContaAih {
  readonly item: number;
  readonly sigtap: number | null;
  readonly quantidade: number;
  readonly procedimento: number | null;
  readonly cbo: string | null;
}

/** O paciente (só o necessário ao leiaute; nunca vai à tela, ao banco do Sante nem à auditoria). */
export interface PacienteAih {
  readonly cns: string | null;
  readonly cpf: string | null;
  readonly sexo: string | null;
  readonly nascimento: string | null;
  readonly municipio: number | null;
  readonly nome: string | null;
}

/** A AIH registrada (o laudo, a autorização e o fechamento, sem documento). */
export interface AihRegistrada {
  readonly id: number;
  readonly situacao: SituacaoAih;
  readonly numero: string | null;
  readonly procedimentoSolicitado: string;
  readonly procedimentoRealizado: string | null;
  readonly cidPrincipal: string;
  readonly cidSecundario: string | null;
  readonly dataLaudo: string;
  readonly dataAutorizacao: string | null;
}

/** A internação (RICADINT) com a conta, o paciente e a especialidade do leito. */
export interface InternacaoAih {
  readonly registro: number;
  readonly conta: number | null;
  readonly atendimento: number | null;
  readonly convenio: number;
  readonly entrada: string | null;
  readonly alta: string | null;
  readonly motivoSaida: number | null;
  /** Especialidade do leito (TBESPLEI.COD), para o validador. */
  readonly especialidadeLeito: number | null;
  readonly paciente: PacienteAih;
  readonly itens: readonly ItemContaAih[];
  readonly passagens: readonly PassagemLeito[];
}

export interface ContextoAih {
  /** O procedimento SIGTAP pelo ID (TBPROSUS), com os atributos na competência da alta. */
  readonly procedimento: (id: number) => ProcedimentoNaCiha | null;
  /** O procedimento SIGTAP pelo código de 10 dígitos (o principal digitado e as diárias de UTI). */
  readonly porCodigo: (codigo: string) => ProcedimentoNaCiha | null;
  readonly compatibilidades: CompatibilidadesDaCompetencia;
  readonly habilitacoes: ReadonlySet<string>;
  /** Leitos de UTI habilitados por tipo do SIH (FHLEITOUTI: soma de QTDE_LEITO). */
  readonly leitosUti: ReadonlyMap<number, number>;
  readonly utiPorAcomodacao: ReadonlyMap<number, UtiDaAcomodacao>;
  readonly cnsValido: ValidadorCns;
  readonly cidExiste?: (cid: string) => boolean;
  readonly equivalencia?: (procedimento: number) => number | null;
}

export interface LinhaAihMontada {
  readonly tipo: 'principal' | 'secundario' | 'especial' | 'opm' | 'diaria-uti';
  readonly procedimento: string;
  /** TBPROSUS.ID (para os valores da competência); null quando o código não está no catálogo. */
  readonly sigtap: number | null;
  readonly quantidade: number;
  readonly cbo: string | null;
  readonly item: number | null;
  readonly tipoUti: number | null;
}

export interface ResultadoAih {
  readonly competencia: CompetenciaSus | null;
  readonly linhas: readonly LinhaAihMontada[];
  readonly permanencia: { readonly dias: number | null; readonly media: number | null };
  readonly diariasUti: { readonly total: number; readonly mesAnterior: number };
  readonly itensForaDaAih: number;
  readonly itensSemSigtap: number;
  readonly criticas: readonly CriticaCiha[];
}

function critica(
  regra: RegraCriticaSus,
  i: Pick<InternacaoAih, 'conta' | 'atendimento'>,
  item: number | null = null,
  detalhe: Record<string, string | number | null> = {},
): CriticaCiha {
  const gravidade: GravidadeCriticaSus = GRAVIDADE_DA_REGRA_SUS[regra];
  return { regra, gravidade, conta: i.conta, atendimento: i.atendimento, item, detalhe };
}

const FORMA_CID = /^[A-Z]\d{2}[0-9X]?$/;
const limpo = (v: string | null | undefined) => ((v ?? '').trim() ? (v ?? '').trim() : null);

/** Os campos do paciente que o SISAIH01 exige e faltam no cadastro. */
export function camposAusentesPacienteAih(p: PacienteAih): string[] {
  const f: string[] = [];
  const sexo = (p.sexo ?? '').trim().toUpperCase();
  if (sexo !== 'M' && sexo !== 'F') f.push('sexo');
  if (!p.nascimento || p.nascimento < '1900') f.push('nascimento');
  if (!limpo(p.nome)) f.push('nome');
  if (!p.municipio || p.municipio <= 0) f.push('municipio');
  return f;
}

/** O grupo 07 da SIGTAP: órteses, próteses e materiais especiais (OPM). */
export const ehOpm = (codigo: string) => codigo.startsWith('07');

/**
 * A montagem da AIH (o fechamento e a crítica da competência): a autorização e o número, o CID, a permanência, o
 * procedimento principal pelo validador de compatibilidade da SIGTAP da competência da alta (regra 2), os secundários,
 * especiais e OPM da conta e as diárias de UTI da trajetória (regra 6). A crítica bloqueante impede o fechamento.
 */
export function montarAih(aih: AihRegistrada, i: InternacaoAih, ctx: ContextoAih): ResultadoAih {
  const criticas: CriticaCiha[] = [];
  const competencia = competenciaDaData(i.alta);
  // Regra 6: só com o laudo autorizado e o número com o dígito certo.
  if (
    !aih.numero ||
    !['autorizada', 'fechada', 'apresentada', 'rejeitada', 'aprovada'].includes(aih.situacao)
  )
    criticas.push(critica('aih-sem-autorizacao', i));
  else if (!numeroAihValido(aih.numero)) criticas.push(critica('aih-numero-invalido', i));
  // Identificação (regra 5) e os dados mínimos do arquivo.
  for (const p of identificarPessoa({ cns: i.paciente.cns, cpf: i.paciente.cpf }, ctx.cnsValido).problemas)
    criticas.push(critica(p, i));
  for (const campo of camposAusentesPacienteAih(i.paciente))
    criticas.push(critica('dado-minimo-ausente', i, null, { campo }));
  // Permanência coerente.
  const permanencia = diasDePermanencia(i.entrada, i.alta);
  if (permanencia === null)
    criticas.push(
      critica('permanencia-incoerente', i, null, { motivo: i.alta ? 'alta-antes-da-entrada' : 'sem-alta' }),
    );
  if (i.alta && aih.dataLaudo > i.alta)
    criticas.push(critica('permanencia-incoerente', i, null, { motivo: 'laudo-depois-da-alta' }));
  if (aih.dataAutorizacao && aih.dataAutorizacao < aih.dataLaudo)
    criticas.push(critica('permanencia-incoerente', i, null, { motivo: 'autorizacao-antes-do-laudo' }));
  if (i.motivoSaida === null || !MOTIVOS_ALTA_SIH.has(i.motivoSaida))
    criticas.push(critica('dado-minimo-ausente', i, null, { campo: 'motivoSaida' }));
  // CID.
  const cid = normalizarCid(aih.cidPrincipal);
  if (!cid) criticas.push(critica('sem-cid-principal', i));
  else if (!FORMA_CID.test(cid) || (ctx.cidExiste && !ctx.cidExiste(cid)))
    criticas.push(critica('cid-invalido', i, null, { cid }));
  const sexo = (i.paciente.sexo ?? '').trim().toUpperCase() || null;
  const idadeMeses =
    i.paciente.nascimento && i.entrada ? idadeEmMeses(i.paciente.nascimento, i.entrada) : null;
  const linhas: LinhaAihMontada[] = [];
  // O principal: o realizado ou o solicitado, com o registro "AIH principal" e o validador.
  const codigoPrincipal = aih.procedimentoRealizado ?? aih.procedimentoSolicitado;
  const principal = ctx.porCodigo(codigoPrincipal);
  let media: number | null = null;
  if (!principal) criticas.push(critica('sem-sigtap', i, null, { sigtap: codigoPrincipal }));
  else {
    const problemas = validarCompatibilidade(
      {
        procedimento: principal,
        instrumento: 'aih',
        quantidade: 1,
        paciente: { sexo, idadeMeses },
        cid,
        cbo: null,
        conferirCbo: false,
        leito: i.especialidadeLeito,
      },
      ctx.compatibilidades,
      ctx.habilitacoes,
    );
    for (const x of problemas) criticas.push(critica(x.regra, i, null, x.detalhe));
    if (
      principal.naCompetencia &&
      !problemas.some((x) => x.regra === 'instrumento-incompativel') &&
      !(principal.registros ?? []).includes('aih-principal')
    )
      criticas.push(
        critica('instrumento-incompativel', i, null, {
          sigtap: codigoPrincipal,
          instrumento: 'aih-principal',
          registros: (principal.registros ?? []).join(',') || null,
        }),
      );
    media = principal.naCompetencia?.atributos.permanencia ?? null;
    linhas.push({
      tipo: 'principal',
      procedimento: codigoPrincipal,
      sigtap: principal.procedimento.id,
      quantidade: 1,
      cbo: null,
      item: null,
      tipoUti: null,
    });
  }
  if (permanencia !== null && media !== null && media > 1 && permanencia < Math.floor(media / 2))
    criticas.push(critica('permanencia-abaixo-da-media', i, null, { dias: permanencia, media }));
  // Os itens da conta.
  let fora = 0;
  let semSigtap = 0;
  const porChave = new Map<string, LinhaAihMontada>();
  for (const it of i.itens) {
    const vinculo = it.sigtap === null ? null : ctx.procedimento(it.sigtap);
    let p = vinculo?.naCompetencia ? vinculo : null;
    if (!p && it.procedimento && ctx.equivalencia) {
      const eq = ctx.equivalencia(it.procedimento);
      const pe = eq === null ? null : ctx.procedimento(eq);
      if (pe?.naCompetencia) p = pe;
    }
    if (!p) {
      if (it.sigtap === null) semSigtap += 1;
      else
        criticas.push(
          critica('sigtap-fora-da-competencia', i, it.item, {
            sigtap: vinculo?.procedimento.codigo ?? it.sigtap,
            competencia: competencia ?? null,
          }),
        );
      continue;
    }
    const codigo = p.procedimento.codigo;
    if (codigo === codigoPrincipal) continue;
    const registros = p.registros ?? [];
    const tipo: LinhaAihMontada['tipo'] | null = ehOpm(codigo)
      ? 'opm'
      : registros.includes('aih-especial')
        ? 'especial'
        : registros.includes('aih-secundario')
          ? 'secundario'
          : null;
    if (!tipo) {
      fora += 1;
      continue;
    }
    const cbo = it.cbo && cboValido(it.cbo) ? it.cbo.trim().toUpperCase() : null;
    const quantidade = Math.max(1, Math.round(it.quantidade));
    // O OPM fica por item (cada um com a nota e o lote); os demais somam por procedimento e CBO.
    const k = tipo === 'opm' ? `opm|${it.item}` : `${tipo}|${codigo}|${cbo ?? ''}`;
    const atual = porChave.get(k);
    porChave.set(
      k,
      atual
        ? { ...atual, quantidade: atual.quantidade + quantidade }
        : {
            tipo,
            procedimento: codigo,
            sigtap: p.procedimento.id,
            quantidade,
            cbo,
            item: tipo === 'opm' ? it.item : null,
            tipoUti: null,
          },
    );
  }
  if (semSigtap > 0) criticas.push(critica('item-sem-sigtap', i, null, { itens: semSigtap }));
  linhas.push(
    ...[...porChave.values()].sort(
      (a, b) => a.tipo.localeCompare(b.tipo) || a.procedimento.localeCompare(b.procedimento),
    ),
  );
  // As diárias de UTI (regra 6).
  const uti = diariasUtiDaTrajetoria(i.passagens, ctx.utiPorAcomodacao, i.alta);
  for (const a of uti.semTipo) criticas.push(critica('uti-sem-tipo-sih', i, null, { acomodacao: a }));
  for (const d of uti.porTipo) {
    if ((ctx.leitosUti.get(d.tipo) ?? 0) <= 0)
      criticas.push(critica('uti-nao-habilitada', i, null, { tipoUti: d.tipo }));
    const p = ctx.porCodigo(d.procedimento);
    if (!p?.naCompetencia)
      criticas.push(critica('sigtap-fora-da-competencia', i, null, { sigtap: d.procedimento }));
    linhas.push({
      tipo: 'diaria-uti',
      procedimento: d.procedimento,
      sigtap: p?.procedimento.id ?? null,
      quantidade: d.diarias,
      cbo: null,
      item: null,
      tipoUti: d.tipo,
    });
  }
  if (permanencia !== null && uti.total > permanencia + 1)
    criticas.push(
      critica('permanencia-incoerente', i, null, {
        motivo: 'diarias-uti-acima-da-permanencia',
        dias: permanencia,
        diariasUti: uti.total,
      }),
    );
  // A mesma crítica (regra, item e detalhe) conta uma vez.
  const vistas = new Set<string>();
  const unicas = criticas.filter((c) => {
    const k = `${c.regra}|${c.item ?? ''}|${JSON.stringify(c.detalhe)}`;
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
  return {
    competencia,
    linhas,
    permanencia: { dias: permanencia, media },
    diariasUti: { total: uti.total, mesAnterior: uti.porTipo.reduce((s, x) => s + x.mesAnterior, 0) },
    itensForaDaAih: fora,
    itensSemSigtap: semSigtap,
    criticas: unicas,
  };
}

/** A AIH entra no SISAIH01 da competência: fechada (ou rejeitada para reapresentar), com a alta até o fim dela. */
export function aihApresentavel(
  a: { readonly situacao: SituacaoAih; readonly alta: string | null },
  competencia: CompetenciaSus,
): boolean {
  return a.situacao === 'fechada' && a.alta !== null && a.alta <= intervaloDaCompetencia(competencia).fim;
}
