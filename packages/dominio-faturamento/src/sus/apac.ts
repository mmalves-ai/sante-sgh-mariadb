// APAC (ficha do M51, seção 5: `faturamento.registrarApac`; regras 1, 2, 5 e 6; Portaria SAS 768/2006 e Manual do SIA):
// a autorização de procedimento ambulatorial de alta complexidade, da solicitação ao encerramento, e a produção dela em
// cada competência a partir da mesma conta (regra 1: a conta é uma só; o procedimento cujo registro na SIGTAP da
// competência é APAC principal ou secundário vai à APAC do paciente, nunca ao BPA).
//   - Laudo (solicitada) → autorização do gestor (número de 13 dígitos com o dígito verificador; validade de até três
//     competências; a única vale uma) ou negativa → continuidade (a competência seguinte, dentro da validade, uma a uma)
//     → encerramento (motivo de saída do SIA) ou cancelamento (com justificativa; nada é apagado).
//   - Em cada competência, a APAC apresentável sai como inicial (1, na primeira competência), continuidade (2) ou única
//     (3); o procedimento principal é o do laudo e os secundários são os de registro APAC secundário do mesmo paciente.
//   - O validador de compatibilidade (CID do laudo, CBO e CNS do executante, sexo, idade, habilitação e quantidade) e a
//     identificação (CNS do paciente, do solicitante e do autorizador) vêm da etapa 2; o laudo de nefrologia é exigido
//     nos procedimentos do grupo 03.05 (tratamento em nefrologia, D-NEFRO-51).
// Puro: as leituras ficam no adaptador e o arquivo em `apac-leiaute.ts`.
import {
  type CompetenciaSus,
  GRAVIDADE_DA_REGRA_SUS,
  type LaudoNefrologia,
  MOTIVO_PERMANENCIA_PADRAO_APAC,
  MOTIVOS_ENCERRAMENTO_APAC,
  type RegraCriticaSus,
  type SituacaoApac,
  type TipoApac,
  type TipoApacNoArquivo,
} from '@sgh/contratos';
import type { AtendimentoBpa, ContextoBpa, PacienteBpa } from './bpa.js';
import { idadeEmAnos, racaSia } from './bpa.js';
import type { CriticaCiha } from './ciha.js';
import { normalizarCid } from './ciha.js';
import { validarCompatibilidade } from './compatibilidade.js';
import { competenciaDaData, competenciaSeguinte } from './competencia.js';
import { cboValido, cnesValido, documentoInformado } from './identificacao-sus.js';
import { CONVENIOS_ESPECIAIS_PADRAO, financiadorDoConvenio } from './instrumento.js';
import { idadeEmMeses } from './sigtap-competencia.js';

/** Validade máxima da APAC inicial, em competências (a de início incluída). */
export const VALIDADE_MAXIMA_APAC = 3;

/** O dígito verificador do número da APAC: o resto da divisão dos 12 primeiros dígitos por 11 (10 vira 0). */
export function digitoApac(base12: string): number {
  if (!/^\d{12}$/.test(base12)) throw new RangeError('numero-apac-base-invalida');
  const r = Number(BigInt(base12) % 11n);
  return r === 10 ? 0 : r;
}

/** Número da APAC: 13 dígitos, não zerado, com o dígito verificador conferido (D-NUMERO-APAC-51). */
export function numeroApacValido(n: string | null | undefined): boolean {
  const v = (n ?? '').trim();
  if (!/^\d{13}$/.test(v) || /^0+$/.test(v)) return false;
  return digitoApac(v.slice(0, 12)) === Number(v[12]);
}

/** Quantas competências há de `a` a `b`, as duas incluídas (0 quando `b` vem antes de `a`). */
export function competenciasNoIntervalo(a: string, b: string): number {
  const n = (c: string) => Number(c.slice(0, 4)) * 12 + Number(c.slice(4, 6)) - 1;
  return Math.max(0, n(b) - n(a) + 1);
}

export type RecusaApac =
  | 'apac-situacao-invalida'
  | 'apac-numero-invalido'
  | 'apac-validade-invalida'
  | 'apac-data-invalida'
  | 'apac-continuidade-fora-da-validade'
  | 'apac-encerramento-invalido';

/** O que as recusas leem da APAC gravada. */
export interface EstadoApac {
  readonly situacao: SituacaoApac;
  readonly tipo: TipoApac | null;
  readonly dataSolicitacao: string;
  readonly dataAutorizacao: string | null;
  readonly competenciaInicial: string | null;
  readonly competenciaFinal: string | null;
  readonly ultimaCompetencia: string | null;
}

/** A data do laudo: não futura e de 2008 em diante (início da SIGTAP). */
export function recusaLaudoApac(dataSolicitacao: string, hoje: string): RecusaApac | null {
  return dataSolicitacao > hoje || dataSolicitacao < '2008-01-01' ? 'apac-data-invalida' : null;
}

/**
 * Corrigir o laudo (D-CORRIGIR-513): só a APAC ainda solicitada (depois da autorização, o gestor já decidiu sobre o laudo
 * que recebeu); a data do laudo obedece à mesma regra do registro.
 */
export function recusaCorrigirApac(
  a: Pick<EstadoApac, 'situacao'>,
  dataSolicitacao: string,
  hoje: string,
): RecusaApac | null {
  if (a.situacao !== 'solicitada') return 'apac-situacao-invalida';
  return recusaLaudoApac(dataSolicitacao, hoje);
}

/**
 * Autorizar: só a solicitada; número válido; data da autorização entre a do laudo e hoje; validade a partir da
 * competência do laudo, até a de hoje, com até três competências na inicial e uma na única.
 */
export function recusaAutorizarApac(
  a: EstadoApac,
  e: {
    numero: string;
    tipo: TipoApac;
    dataAutorizacao: string;
    competenciaInicial: string;
    competenciaFinal: string;
  },
  hoje: string,
): RecusaApac | null {
  if (a.situacao !== 'solicitada') return 'apac-situacao-invalida';
  if (!numeroApacValido(e.numero)) return 'apac-numero-invalido';
  if (e.dataAutorizacao < a.dataSolicitacao || e.dataAutorizacao > hoje) return 'apac-data-invalida';
  const doLaudo = competenciaDaData(a.dataSolicitacao);
  const deHoje = competenciaDaData(hoje);
  const n = competenciasNoIntervalo(e.competenciaInicial, e.competenciaFinal);
  if (
    !doLaudo ||
    !deHoje ||
    e.competenciaInicial < doLaudo ||
    e.competenciaInicial > deHoje ||
    n < 1 ||
    n > (e.tipo === 'unica' ? 1 : VALIDADE_MAXIMA_APAC)
  )
    return 'apac-validade-invalida';
  return null;
}

/** Continuar: a APAC inicial autorizada passa à competência seguinte, dentro da validade e já começada. */
export function recusaContinuarApac(a: EstadoApac, hoje: string): RecusaApac | null {
  if (a.situacao !== 'autorizada' || a.tipo !== 'inicial' || !a.ultimaCompetencia || !a.competenciaFinal)
    return 'apac-situacao-invalida';
  const proxima = competenciaSeguinte(a.ultimaCompetencia);
  const deHoje = competenciaDaData(hoje);
  if (proxima > a.competenciaFinal || !deHoje || proxima > deHoje)
    return 'apac-continuidade-fora-da-validade';
  return null;
}

/** Encerrar: a autorizada, com motivo de saída (não de permanência) e data numa competência já apresentada. */
export function recusaEncerrarApac(
  a: EstadoApac,
  e: { motivo: string; dataEncerramento: string },
  hoje: string,
): RecusaApac | null {
  if (a.situacao !== 'autorizada' || !a.competenciaInicial || !a.ultimaCompetencia || !a.dataAutorizacao)
    return 'apac-situacao-invalida';
  if (!(MOTIVOS_ENCERRAMENTO_APAC as readonly string[]).includes(e.motivo))
    return 'apac-encerramento-invalido';
  const c = competenciaDaData(e.dataEncerramento);
  if (
    !c ||
    e.dataEncerramento > hoje ||
    e.dataEncerramento < a.dataSolicitacao ||
    c < a.competenciaInicial ||
    c > a.ultimaCompetencia
  )
    return 'apac-encerramento-invalido';
  return null;
}

/** Negar: só a solicitada. Cancelar: a solicitada ou a autorizada (a encerrada e a negada ficam como estão). */
export function recusaNegarOuCancelarApac(a: EstadoApac, acao: 'negar' | 'cancelar'): RecusaApac | null {
  if (acao === 'negar') return a.situacao === 'solicitada' ? null : 'apac-situacao-invalida';
  return a.situacao === 'solicitada' || a.situacao === 'autorizada' ? null : 'apac-situacao-invalida';
}

/** A APAC autorizada (ou encerrada) é apresentada na competência? Com que tipo no arquivo? */
export function tipoNaCompetencia(
  a: Pick<EstadoApac, 'situacao' | 'tipo' | 'competenciaInicial' | 'ultimaCompetencia'>,
  c: CompetenciaSus,
): TipoApacNoArquivo | null {
  if (a.situacao !== 'autorizada' && a.situacao !== 'encerrada') return null;
  if (!a.competenciaInicial || !a.ultimaCompetencia) return null;
  if (c < a.competenciaInicial || c > a.ultimaCompetencia) return null;
  if (a.tipo === 'unica') return '3';
  return c === a.competenciaInicial ? '1' : '2';
}

/** O procedimento que exige o laudo de nefrologia (grupo 03, subgrupo 05: tratamento em nefrologia; D-NEFRO-51). */
export function exigeLaudoNefrologia(codigoSigtap: string): boolean {
  return codigoSigtap.startsWith('0305');
}

/** A APAC gravada no Sante como a montagem a lê (o solicitante com o CNS e o nome do cadastro de solicitantes SUS). */
export interface ApacParaMontar extends EstadoApac {
  readonly id: number;
  readonly numero: string | null;
  readonly paciente: number | null;
  readonly procedimento: string;
  readonly cidPrincipal: string;
  readonly cidSecundario: string | null;
  readonly cidAssociado: string | null;
  readonly autorizador: string | null;
  readonly solicitante: { readonly cns: string | null; readonly nome: string | null } | null;
  readonly laudoEspecifico: 'nenhum' | 'nefrologia';
  readonly nefrologia: LaudoNefrologia | null;
  readonly motivoSaida: string | null;
  readonly dataEncerramento: string | null;
}

/** O atendimento SUS da competência com o paciente (ID do cadastro e o nome da mãe, que a APAC exige). */
export interface AtendimentoApac extends AtendimentoBpa {
  readonly pacienteId: number | null;
  readonly paciente: PacienteBpa & { readonly mae: string | null };
}

export interface ProcedimentoNaApac {
  readonly codigo: string;
  readonly principal: boolean;
  readonly cbo: string;
  readonly cnsExecutante: string;
  readonly quantidade: number;
  readonly conta: number;
  readonly item: number;
}

/** A APAC montada para o arquivo da competência (o dado pessoal só vai ao arquivo guardado). */
export interface ApacNoArquivo {
  readonly apac: number;
  readonly numero: string;
  readonly tipoNoArquivo: TipoApacNoArquivo;
  readonly competenciaInicial: string;
  readonly competenciaFinal: string;
  readonly cidPrincipal: string;
  readonly cidSecundario: string | null;
  readonly cidAssociado: string | null;
  readonly motivoSaida: string;
  /** AAAA-MM-DD da saída (só na competência do encerramento). */
  readonly dataSaida: string | null;
  readonly autorizador: string;
  readonly solicitante: { readonly cns: string; readonly nome: string };
  readonly paciente: {
    readonly cns: string;
    readonly cpf: string | null;
    readonly nome: string;
    readonly mae: string;
    readonly sexo: 'M' | 'F';
    readonly nascimento: string;
    readonly municipio: number;
    readonly raca: string;
    readonly idade: number;
    readonly cep: string | null;
    readonly logradouro: string | null;
    readonly numero: string | null;
    readonly complemento: string | null;
    readonly bairro: string | null;
  };
  readonly nefrologia: LaudoNefrologia | null;
  readonly procedimentos: readonly ProcedimentoNaApac[];
}

export interface ResultadoApac {
  readonly apacs: readonly ApacNoArquivo[];
  readonly criticas: readonly CriticaCiha[];
  /** APACs apresentáveis na competência (autorizadas e na validade). */
  readonly apresentaveis: number;
  /** Atendimentos SUS com procedimento de APAC. */
  readonly atendimentos: number;
  readonly foraPorNaoSerSus: number;
}

function critica(
  regra: RegraCriticaSus,
  conta: number | null,
  atendimento: number | null,
  item: number | null,
  detalhe: Record<string, string | number | null> = {},
): CriticaCiha {
  return { regra, gravidade: GRAVIDADE_DA_REGRA_SUS[regra], conta, atendimento, item, detalhe };
}

const limpo = (v: string | null | undefined) => {
  const t = (v ?? '').trim();
  return t.length ? t : null;
};

/**
 * O item vai à APAC quando o registro dele na SIGTAP da competência é só de APAC (principal ou secundário); o que também
 * cabe no BPA fica no BPA (D-SECUNDARIO-51: a mesma partição que o BPA faz, sem contar o item duas vezes).
 */
const ehApac = (registros: readonly string[]) =>
  (registros.includes('apac-principal') || registros.includes('apac-secundario')) &&
  !registros.includes('bpa-i') &&
  !registros.includes('bpa-c');

interface ItemResolvido {
  readonly a: AtendimentoApac;
  readonly item: number;
  readonly codigo: string;
  readonly registros: readonly string[];
  readonly quantidade: number;
  readonly cbo: string | null;
  readonly cnsExecutante: string | null;
  readonly p: NonNullable<ReturnType<ContextoBpa['procedimento']>>;
}

/**
 * A crítica e a montagem da APAC da competência. A APAC com bloqueante fica fora do arquivo (o faturista corrige na origem
 * ou no laudo e roda de novo); o aviso não a tira. O procedimento de APAC sem autorização vigente do paciente e a APAC
 * sem a produção do principal na competência são avisos (justificáveis: nem toda produção vira cobrança).
 */
export function montarApac(
  apacs: readonly ApacParaMontar[],
  atendimentos: readonly AtendimentoApac[],
  ctx: ContextoBpa,
): ResultadoApac {
  const criticas: CriticaCiha[] = [];
  if (!cnesValido(ctx.cnes)) criticas.push(critica('sem-cnes', null, null, null));
  const presentes = apacs
    .map((x) => ({ x, tipo: tipoNaCompetencia(x, ctx.competencia) }))
    .filter(
      (y): y is { x: ApacParaMontar; tipo: TipoApacNoArquivo } => y.tipo !== null && y.x.paciente !== null,
    )
    .sort((p, q) => (p.x.numero ?? '').localeCompare(q.x.numero ?? '') || p.x.id - q.x.id);
  const porPaciente = new Map<number, { x: ApacParaMontar; tipo: TipoApacNoArquivo }[]>();
  for (const y of presentes)
    porPaciente.set(y.x.paciente as number, [...(porPaciente.get(y.x.paciente as number) ?? []), y]);

  // Os itens de APAC de cada paciente (pela SIGTAP da competência, com a equivalência do Sante quando não há vínculo).
  let foraPorNaoSerSus = 0;
  let comApac = 0;
  const itensPorApac = new Map<number, ItemResolvido[]>();
  for (const a of atendimentos) {
    if (financiadorDoConvenio(a.convenio, ctx.convenios ?? CONVENIOS_ESPECIAIS_PADRAO) !== 'sus') {
      foraPorNaoSerSus += 1;
      continue;
    }
    let teve = false;
    for (const it of a.itens) {
      const vinculo = it.sigtap === null ? null : ctx.procedimento(it.sigtap);
      let p = vinculo?.naCompetencia ? vinculo : null;
      if (!p && it.procedimento && ctx.equivalencia) {
        const eq = ctx.equivalencia(it.procedimento);
        const pe = eq === null ? null : ctx.procedimento(eq);
        if (pe?.naCompetencia) p = pe;
      }
      const registros = p?.registros ?? [];
      if (!p || !ehApac(registros)) continue;
      teve = true;
      const codigo = p.procedimento.codigo;
      const doPaciente = a.pacienteId === null ? [] : (porPaciente.get(a.pacienteId) ?? []);
      const dona =
        doPaciente.find((y) => y.x.procedimento === codigo) ??
        (registros.includes('apac-secundario') ? doPaciente[0] : undefined);
      if (!dona) {
        criticas.push(critica('apac-sem-autorizacao', a.conta, a.atendimento, it.item, { sigtap: codigo }));
        continue;
      }
      const ex = it.executante;
      const cnsEx = documentoInformado(ex?.cns);
      itensPorApac.set(dona.x.id, [
        ...(itensPorApac.get(dona.x.id) ?? []),
        {
          a,
          item: it.item,
          codigo,
          registros,
          quantidade: Math.max(1, Math.round(it.quantidade)),
          cbo: ex?.cbo && cboValido(ex.cbo) ? ex.cbo.trim().toUpperCase() : null,
          cnsExecutante: cnsEx && ctx.cnsValido(cnsEx) ? cnsEx : null,
          p,
        },
      ]);
    }
    if (teve) comApac += 1;
  }

  const montadas: ApacNoArquivo[] = [];
  for (const { x, tipo } of presentes) {
    const itens = itensPorApac.get(x.id) ?? [];
    const principal = itens.filter((i) => i.codigo === x.procedimento);
    if (principal.length === 0) {
      criticas.push(
        critica('apac-sem-producao', null, null, null, {
          apac: x.id,
          numero: x.numero,
          sigtap: x.procedimento,
          competencia: ctx.competencia,
        }),
      );
      continue;
    }
    const base = principal[0] as ItemResolvido;
    const a = base.a;
    const proprias: CriticaCiha[] = [];
    const daApac = (r: RegraCriticaSus, d: Record<string, string | number | null> = {}) =>
      proprias.push(critica(r, a.conta, a.atendimento, null, { apac: x.id, ...d }));
    if (!numeroApacValido(x.numero)) daApac('apac-numero-invalido');
    const cnsAut = documentoInformado(x.autorizador);
    if (!cnsAut || !ctx.cnsValido(cnsAut)) daApac('autorizador-sem-identificacao');
    const cnsSol = documentoInformado(x.solicitante?.cns);
    const nomeSol = limpo(x.solicitante?.nome);
    if (!cnsSol || !ctx.cnsValido(cnsSol) || !nomeSol)
      daApac('profissional-sem-identificacao', { papel: 'solicitante' });
    const pac = a.paciente;
    const cnsPac = documentoInformado(pac.cns);
    if (!cnsPac || !ctx.cnsValido(cnsPac)) daApac('sem-cns-paciente');
    const sexo = (pac.sexo ?? '').trim().toUpperCase();
    const faltam: string[] = [];
    if (sexo !== 'M' && sexo !== 'F') faltam.push('sexo');
    if (!pac.nascimento || pac.nascimento < '1900') faltam.push('nascimento');
    if (!limpo(pac.nome)) faltam.push('nome');
    if (!limpo(pac.mae)) faltam.push('mae');
    if (!pac.municipio || pac.municipio <= 0) faltam.push('municipio');
    for (const campo of faltam) daApac('dado-minimo-ausente', { campo });
    if (exigeLaudoNefrologia(x.procedimento) && (x.laudoEspecifico !== 'nefrologia' || !x.nefrologia))
      daApac('laudo-especifico-ausente', { sigtap: x.procedimento, laudo: 'nefrologia' });
    const cid = normalizarCid(x.cidPrincipal);
    const dataRef = a.data ?? `${ctx.competencia.slice(0, 4)}-${ctx.competencia.slice(4, 6)}-01`;
    const idadeMeses = pac.nascimento ? idadeEmMeses(pac.nascimento, dataRef) : null;
    // Os procedimentos: o principal primeiro (somado), depois os secundários (somados por código, CBO e executante).
    const somados = new Map<string, ProcedimentoNaApac>();
    const ordem = [...principal, ...itens.filter((i) => i.codigo !== x.procedimento)];
    for (const i of ordem) {
      for (const inc of validarCompatibilidade(
        {
          procedimento: i.p,
          instrumento: 'apac',
          quantidade: i.quantidade,
          paciente: { sexo: sexo || null, idadeMeses },
          cid,
          cbo: i.cbo,
        },
        ctx.compatibilidades,
        ctx.habilitacoes,
      ))
        proprias.push(critica(inc.regra, i.a.conta, i.a.atendimento, i.item, { apac: x.id, ...inc.detalhe }));
      if (!i.cnsExecutante)
        proprias.push(
          critica('profissional-sem-identificacao', i.a.conta, i.a.atendimento, i.item, {
            apac: x.id,
            sigtap: i.codigo,
          }),
        );
      if (!i.cbo || !i.cnsExecutante) continue;
      const k = `${i.codigo}|${i.cbo}|${i.cnsExecutante}`;
      const atual = somados.get(k);
      somados.set(
        k,
        atual
          ? { ...atual, quantidade: atual.quantidade + i.quantidade }
          : {
              codigo: i.codigo,
              principal: i.codigo === x.procedimento,
              cbo: i.cbo,
              cnsExecutante: i.cnsExecutante,
              quantidade: i.quantidade,
              conta: i.a.conta,
              item: i.item,
            },
      );
    }
    const vistas = new Set<string>();
    for (const c of proprias) {
      const k = `${c.regra}|${c.item ?? ''}|${JSON.stringify(c.detalhe)}`;
      if (vistas.has(k)) continue;
      vistas.add(k);
      criticas.push(c);
    }
    const procedimentos = [...somados.values()];
    if (proprias.some((c) => c.gravidade === 'bloqueante') || !procedimentos.some((p) => p.principal))
      continue;
    const encerraAqui = x.situacao === 'encerrada' && x.ultimaCompetencia === ctx.competencia;
    montadas.push({
      apac: x.id,
      numero: x.numero as string,
      tipoNoArquivo: tipo,
      competenciaInicial: x.competenciaInicial as string,
      competenciaFinal: x.competenciaFinal as string,
      cidPrincipal: cid as string,
      cidSecundario: normalizarCid(x.cidSecundario),
      cidAssociado: normalizarCid(x.cidAssociado),
      motivoSaida: encerraAqui && x.motivoSaida ? x.motivoSaida : MOTIVO_PERMANENCIA_PADRAO_APAC,
      dataSaida: encerraAqui ? x.dataEncerramento : null,
      autorizador: cnsAut as string,
      solicitante: { cns: cnsSol as string, nome: nomeSol as string },
      paciente: {
        cns: cnsPac as string,
        cpf: documentoInformado(pac.cpf)?.padStart(11, '0') ?? null,
        nome: limpo(pac.nome) as string,
        mae: limpo(pac.mae) as string,
        sexo: sexo as 'M' | 'F',
        nascimento: pac.nascimento as string,
        municipio: pac.municipio as number,
        raca: racaSia(pac.raca),
        idade: idadeEmAnos(pac.nascimento, dataRef) ?? 0,
        cep: limpo(pac.cep),
        logradouro: limpo(pac.logradouro),
        numero: limpo(pac.numero),
        complemento: limpo(pac.complemento),
        bairro: limpo(pac.bairro),
      },
      nefrologia: x.laudoEspecifico === 'nefrologia' ? x.nefrologia : null,
      procedimentos,
    });
  }
  return {
    apacs: montadas,
    criticas,
    apresentaveis: presentes.length,
    atendimentos: comApac,
    foraPorNaoSerSus,
  };
}
