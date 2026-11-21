// CIHA (ficha do M51, regra 3; cap-06b §6.6, "Atenção sobre a CIHA"; Portaria GM/MS 1.171/2011; Orientações Técnicas
// CIHA v4 e leiaute de importação do CIHA01 1.0.4.0): toda internação e todo procedimento ambulatorial pago por
// convênio ou particular, com o procedimento SIGTAP equivalente (o vínculo que o gatilho do outro sistema grava em
// cada item lançado, ou a equivalência registrada no Sante), o CID principal e os dados que o leiaute
// exige. O que não tem equivalente vai para a crítica. Aqui a montagem é pura: as leituras do banco e o arquivo ficam
// no adaptador e em `ciha-leiaute.ts`.
//   - Internação: só o procedimento que caracteriza a internação (o de registro "AIH principal"; sem o registro
//     conhecido, o de maior quantidade), com quantidade 1 (Orientações Técnicas, item 4).
//   - Ambulatorial: todos os procedimentos; o de registro só "BPA consolidado" vai consolidado (sem identificação do
//     paciente); os demais, individualizados.
import type {
  CompetenciaSus,
  FonteRemuneracaoCiha,
  GravidadeCriticaSus,
  ModalidadeCiha,
  RegraCriticaSus,
} from '@sgh/contratos';
import { GRAVIDADE_DA_REGRA_SUS } from '@sgh/contratos';
import { competenciaDaData } from './competencia.js';
import {
  cnesValido,
  type DocumentosPessoa,
  identificarPessoa,
  type ValidadorCns,
} from './identificacao-sus.js';
import {
  type ConveniosEspeciais,
  CONVENIOS_ESPECIAIS_PADRAO,
  financiadorDoConvenio,
  type RegistroSigtap,
} from './instrumento.js';
import {
  type AtributosNaCompetencia,
  idadeEmMeses,
  incompatibilidades,
  type ProcedimentoSigtap,
} from './sigtap-competencia.js';

/** Um item da conta com o vínculo SIGTAP. */
export interface ItemCiha {
  readonly item: number;
  /** Id do procedimento SIGTAP do vínculo; null quando o gatilho não achou equivalente. */
  readonly sigtap: number | null;
  readonly quantidade: number;
  /** O procedimento do item na tabela do hospital: a chave da equivalência registrada no Sante. */
  readonly procedimento?: number | null;
}

/** Dados do paciente que só vão ao arquivo (nunca à tela, ao banco do Sante nem à auditoria). */
export interface PacienteCiha extends DocumentosPessoa {
  readonly sexo: string | null;
  /** AAAA-MM-DD. */
  readonly nascimento: string | null;
  /** Código IBGE do município de residência (6 ou 7 dígitos). */
  readonly municipio: number | null;
  readonly nome?: string | null;
  readonly logradouro?: string | null;
  readonly numero?: string | null;
  readonly complemento?: string | null;
  readonly uf?: string | null;
  readonly cep?: string | null;
  /** Número do prontuário. */
  readonly prontuario?: number | null;
  /** Declaração de óbito (só vai ao arquivo quando o motivo da alta é óbito). */
  readonly declaracaoObito?: string | null;
}

/** O atendimento (conta) como o adaptador lê: chaves, financiador, paciente (só o necessário ao leiaute) e itens. */
export interface AtendimentoCiha {
  readonly conta: number;
  readonly atendimento: number | null;
  readonly modalidade: ModalidadeCiha;
  readonly convenio: number;
  readonly paciente: PacienteCiha;
  /** AAAA-MM-DD: entrada e saída (na ambulatorial, as duas são a data do atendimento). */
  readonly entrada: string | null;
  readonly saida: string | null;
  /** CID-10 sem ponto (A000 a Z999, com ou sem o quarto caractere). */
  readonly cidPrincipal: string | null;
  readonly cidSecundario: string | null;
  readonly itens: readonly ItemCiha[];
  /** Motivo da alta na tabela do SIH (a internação exige). */
  readonly motivoAlta?: number | null;
  /** Código do beneficiário na operadora (a fonte "plano privado" exige). */
  readonly beneficiario?: string | null;
  /** Número da guia TISS (só vai na fonte "plano privado"). */
  readonly guiaTiss?: string | null;
  /** Registro ANS e CNPJ da operadora do convênio. */
  readonly operadora?: { readonly regAns: number | null; readonly cnpj: string | null } | null;
}

export interface ProcedimentoRegistro {
  readonly codigo: string;
  readonly quantidade: number;
  /** BPA consolidado: sai no registro consolidado (procedimento, quantidade, fonte e competência). */
  readonly consolidado: boolean;
}

/** O registro pronto para o leiaute (os documentos só vão ao arquivo; a tela lista as chaves). */
export interface RegistroCiha {
  readonly conta: number;
  readonly atendimento: number | null;
  readonly modalidade: ModalidadeCiha;
  readonly fonte: FonteRemuneracaoCiha;
  readonly cns: string | null;
  readonly cpf: string | null;
  readonly sexo: 'M' | 'F';
  readonly nascimento: string;
  readonly municipio: number | null;
  readonly entrada: string;
  readonly saida: string;
  readonly cidPrincipal: string;
  readonly cidSecundario: string | null;
  /** Na internação, um só (o que caracteriza a internação); na ambulatorial, todos, com a quantidade. */
  readonly procedimentos: readonly ProcedimentoRegistro[];
  readonly nome: string;
  readonly logradouro: string;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly uf: string;
  readonly cep: string;
  readonly prontuario: number;
  readonly motivoAlta: number | null;
  readonly declaracaoObito: string | null;
  readonly regAns: number | null;
  readonly cnpjOperadora: string | null;
  readonly beneficiario: string | null;
  readonly guiaTiss: string | null;
}

export interface CriticaCiha {
  readonly regra: RegraCriticaSus;
  readonly gravidade: GravidadeCriticaSus;
  readonly conta: number | null;
  readonly atendimento: number | null;
  readonly item: number | null;
  readonly detalhe: Readonly<Record<string, string | number | null>>;
}

export interface ProcedimentoNaCiha {
  readonly procedimento: ProcedimentoSigtap;
  readonly naCompetencia: AtributosNaCompetencia | null;
  /** Instrumentos de registro do procedimento na competência; vazio = não conhecido. */
  readonly registros?: readonly RegistroSigtap[];
}

export interface ContextoCiha {
  readonly competencia: CompetenciaSus;
  readonly cnes: string | number | null;
  readonly convenios?: ConveniosEspeciais;
  /** Fonte de remuneração por convênio (parâmetros `faturamento.sus.ciha.*`). */
  readonly fontePorConvenio: (convenio: number) => FonteRemuneracaoCiha | null;
  /** O procedimento SIGTAP pelo ID e os atributos na competência (regra 2); null se não existe. */
  readonly procedimento: (id: number) => ProcedimentoNaCiha | null;
  readonly cnsValido: ValidadorCns;
  /** CID-10 existente (catálogo CID-10); a forma é conferida aqui. */
  readonly cidExiste?: (cid: string) => boolean;
  /**
   * A equivalência SIGTAP registrada no Sante para o procedimento do item. Vale
   * quando o item não tem vínculo ou o vínculo não está vigente na competência; o vínculo vigente do gatilho prevalece.
   */
  readonly equivalencia?: (procedimento: number) => number | null;
}

export interface ResultadoCiha {
  readonly registros: readonly RegistroCiha[];
  readonly criticas: readonly CriticaCiha[];
  /** Contas lidas que ficaram fora por serem do SUS (vão para BPA, APAC ou AIH, desligados pela DP-35). */
  readonly foraPorSerSus: number;
}

const FORMA_CID = /^[A-Z]\d{2}[0-9X]?$/;

/** Motivos de alta e permanência da tabela do SIH (o outro sistema já grava o motivo da alta nessa tabela). */
export const MOTIVOS_ALTA_SIH: ReadonlySet<number> = new Set([
  11, 12, 14, 15, 16, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31, 32, 41, 42, 43, 51, 61, 62, 63, 64, 65,
  66, 67,
]);
/** Motivos de óbito (o arquivo leva a declaração de óbito). */
export const MOTIVOS_OBITO_SIH: ReadonlySet<number> = new Set([41, 42, 43, 65, 66, 67]);

/** As fontes que exigem o CNPJ da entidade (leiaute 1.0.4.0: fontes 6 e 9). */
const FONTES_COM_CNPJ: ReadonlySet<FonteRemuneracaoCiha> = new Set([
  'recurso-proprio-gestor',
  'consorcio-publico',
]);

export function normalizarCid(cid: string | null | undefined): string | null {
  const c = (cid ?? '')
    .trim()
    .toUpperCase()
    .replace(/[.\s-]/g, '');
  return c.length ? c : null;
}

const limpo = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t.length ? t : null;
};
const digitos = (v: string | null | undefined): string | null => {
  const d = (v ?? '').replace(/\D/g, '');
  return d.length && !/^0+$/.test(d) ? d : null;
};

function critica(
  regra: RegraCriticaSus,
  a: Pick<AtendimentoCiha, 'conta' | 'atendimento'> | null,
  item: number | null = null,
  detalhe: Record<string, string | number | null> = {},
): CriticaCiha {
  return {
    regra,
    gravidade: GRAVIDADE_DA_REGRA_SUS[regra],
    conta: a?.conta ?? null,
    atendimento: a?.atendimento ?? null,
    item,
    detalhe,
  };
}

interface ProcedimentoMontado {
  readonly codigo: string;
  readonly quantidade: number;
  readonly registros: readonly RegistroSigtap[];
}

/** Soma as quantidades por código SIGTAP (ordem estável: a primeira aparição). */
function agruparProcedimentos(p: readonly ProcedimentoMontado[]): ProcedimentoMontado[] {
  const m = new Map<string, ProcedimentoMontado>();
  for (const x of p) {
    const atual = m.get(x.codigo);
    m.set(x.codigo, atual ? { ...atual, quantidade: atual.quantidade + x.quantidade } : x);
  }
  return [...m.values()];
}

/** O de registro só "BPA consolidado" (sem BPA individualizado nem APAC principal) vai consolidado. */
function consolidado(registros: readonly RegistroSigtap[]): boolean {
  return registros.includes('bpa-c') && !registros.includes('bpa-i') && !registros.includes('apac-principal');
}

/** Na internação, o procedimento que caracteriza a internação, com quantidade 1. */
function principalDaInternacao(p: readonly ProcedimentoMontado[]): ProcedimentoRegistro[] {
  const aih = p.filter((x) => x.registros.includes('aih-principal'));
  const base = aih.length ? aih : p;
  // sort estável: no empate, a ordem de lançamento.
  const [primeiro] = [...base].sort((x, y) => y.quantidade - x.quantidade);
  return primeiro ? [{ codigo: primeiro.codigo, quantidade: 1, consolidado: false }] : [];
}

/** Os campos obrigatórios do registro individualizado que faltam (leiaute 1.0.4.0). */
function camposAusentes(a: AtendimentoCiha, fonte: FonteRemuneracaoCiha | null): string[] {
  const p = a.paciente;
  const faltam: string[] = [];
  const sexo = (p.sexo ?? '').trim().toUpperCase();
  if (sexo !== 'M' && sexo !== 'F') faltam.push('sexo');
  if (!p.nascimento || p.nascimento < '1900') faltam.push('nascimento');
  if (!limpo(p.nome)) faltam.push('nome');
  if (!limpo(p.logradouro)) faltam.push('logradouro');
  if (!p.municipio || p.municipio <= 0) faltam.push('municipio');
  if (!/^[A-Z]{2}$/.test((p.uf ?? '').trim().toUpperCase())) faltam.push('uf');
  const cep = digitos(p.cep);
  if (!cep || cep.length > 8) faltam.push('cep');
  if (!p.prontuario || p.prontuario <= 0) faltam.push('prontuario');
  if (a.modalidade === 'internacao' && !(a.motivoAlta && MOTIVOS_ALTA_SIH.has(a.motivoAlta)))
    faltam.push('motivoAlta');
  if (fonte === 'plano-privado') {
    const ans = a.operadora?.regAns ?? null;
    if (!ans || ans <= 0 || ans > 999_999) faltam.push('regAns');
    if (!limpo(a.beneficiario)) faltam.push('beneficiario');
  }
  if (fonte && FONTES_COM_CNPJ.has(fonte) && (digitos(a.operadora?.cnpj)?.length ?? 0) !== 14)
    faltam.push('cnpjOperadora');
  return faltam;
}

const listaCurta = (xs: readonly number[]): string =>
  [...new Set(xs)]
    .sort((x, y) => x - y)
    .slice(0, 10)
    .join(',');

/**
 * Regra 3 e a crítica prévia da CIHA. Cada atendimento vira um registro ou fica fora com ao menos uma crítica
 * bloqueante; o aviso (item sem equivalente quando outros itens têm, quantidade acima do máximo) não tira o registro.
 */
export function montarCiha(atendimentos: readonly AtendimentoCiha[], ctx: ContextoCiha): ResultadoCiha {
  const registros: RegistroCiha[] = [];
  const criticas: CriticaCiha[] = [];
  let foraPorSerSus = 0;
  if (!cnesValido(ctx.cnes)) criticas.push(critica('sem-cnes', null));
  for (const a of atendimentos) {
    if (financiadorDoConvenio(a.convenio, ctx.convenios ?? CONVENIOS_ESPECIAIS_PADRAO) === 'sus') {
      foraPorSerSus += 1;
      continue;
    }
    const proprias: CriticaCiha[] = [];
    const fonte = ctx.fontePorConvenio(a.convenio);
    if (!fonte) proprias.push(critica('fonte-remuneracao-indefinida', a, null, { convenio: a.convenio }));
    const id = identificarPessoa(a.paciente, ctx.cnsValido);
    for (const p of id.problemas) proprias.push(critica(p, a));
    const cid = normalizarCid(a.cidPrincipal);
    if (!cid) proprias.push(critica('sem-cid-principal', a));
    else if (!FORMA_CID.test(cid) || (ctx.cidExiste && !ctx.cidExiste(cid)))
      proprias.push(critica('cid-invalido', a, null, { cid }));
    const saida = a.saida ?? a.entrada;
    if (competenciaDaData(saida) !== ctx.competencia)
      proprias.push(critica('data-fora-da-competencia', a, null, { competencia: ctx.competencia }));
    for (const campo of camposAusentes(a, fonte))
      proprias.push(critica('dado-minimo-ausente', a, null, { campo }));
    const sexo = (a.paciente.sexo ?? '').trim().toUpperCase();
    const idade =
      a.paciente.nascimento && (a.entrada ?? saida)
        ? idadeEmMeses(a.paciente.nascimento, (a.entrada ?? saida) as string)
        : null;
    const procs: ProcedimentoMontado[] = [];
    const semEquivalente: number[] = [];
    let itensSemEquivalente = 0;
    let foraDaCompetencia = 0;
    for (const it of a.itens) {
      const vinculo = it.sigtap === null ? null : ctx.procedimento(it.sigtap);
      let p = vinculo?.naCompetencia ? vinculo : null;
      if (!p && it.procedimento && ctx.equivalencia) {
        const eq = ctx.equivalencia(it.procedimento);
        const pe = eq === null ? null : ctx.procedimento(eq);
        if (pe?.naCompetencia) p = pe;
      }
      if (!p) {
        if (it.sigtap === null) {
          itensSemEquivalente += 1;
          if (it.procedimento) semEquivalente.push(it.procedimento);
          continue;
        }
        foraDaCompetencia += 1;
        proprias.push(
          critica('sigtap-fora-da-competencia', a, it.item, {
            sigtap: vinculo?.procedimento.codigo ?? it.sigtap,
            competencia: ctx.competencia,
            procedimento: it.procedimento ?? null,
          }),
        );
        continue;
      }
      for (const r of incompatibilidades(
        (p.naCompetencia as AtributosNaCompetencia).atributos,
        { sexo: sexo || null, idadeMeses: idade },
        it.quantidade,
      ))
        proprias.push(critica(r, a, it.item, { sigtap: p.procedimento.codigo }));
      procs.push({ codigo: p.procedimento.codigo, quantidade: it.quantidade, registros: p.registros ?? [] });
    }
    const procedimentosSem = listaCurta(semEquivalente) || null;
    if (procs.length === 0 && foraDaCompetencia === 0)
      proprias.push(
        critica('sem-sigtap', a, null, { itens: a.itens.length, procedimentos: procedimentosSem }),
      );
    else if (itensSemEquivalente > 0)
      proprias.push(
        critica('item-sem-sigtap', a, null, { itens: itensSemEquivalente, procedimentos: procedimentosSem }),
      );
    criticas.push(...proprias);
    if (proprias.some((c) => c.gravidade === 'bloqueante')) continue;
    const agrupados = agruparProcedimentos(procs);
    const procedimentos: ProcedimentoRegistro[] =
      a.modalidade === 'internacao'
        ? principalDaInternacao(agrupados)
        : agrupados.map((x) => ({
            codigo: x.codigo,
            quantidade: x.quantidade,
            consolidado: consolidado(x.registros),
          }));
    const p = a.paciente;
    const obito = a.motivoAlta !== null && a.motivoAlta !== undefined && MOTIVOS_OBITO_SIH.has(a.motivoAlta);
    const declaracao = obito ? digitos(p.declaracaoObito) : null;
    const plano = fonte === 'plano-privado';
    registros.push({
      conta: a.conta,
      atendimento: a.atendimento,
      modalidade: a.modalidade,
      fonte: fonte as FonteRemuneracaoCiha,
      cns: id.cns,
      cpf: id.cpf,
      sexo: sexo as 'M' | 'F',
      nascimento: p.nascimento as string,
      municipio: p.municipio,
      entrada: (a.entrada ?? saida) as string,
      saida: saida as string,
      cidPrincipal: cid as string,
      cidSecundario: normalizarCid(a.cidSecundario),
      procedimentos,
      nome: limpo(p.nome) as string,
      logradouro: limpo(p.logradouro) as string,
      numero: limpo(p.numero),
      complemento: limpo(p.complemento),
      uf: (p.uf as string).trim().toUpperCase(),
      cep: digitos(p.cep) as string,
      prontuario: p.prontuario as number,
      motivoAlta: a.modalidade === 'internacao' ? (a.motivoAlta ?? null) : null,
      declaracaoObito: declaracao && declaracao.length <= 11 ? declaracao : null,
      regAns: plano ? (a.operadora?.regAns ?? null) : null,
      cnpjOperadora: fonte && FONTES_COM_CNPJ.has(fonte) ? digitos(a.operadora?.cnpj) : null,
      beneficiario: plano ? limpo(a.beneficiario) : null,
      guiaTiss: plano ? limpo(a.guiaTiss) : null,
    });
  }
  return { registros, criticas, foraPorSerSus };
}

/** Contagem por regra e gravidade (o payload da auditoria e o cabeçalho da tela; sem dado pessoal). */
export function resumoCriticas(criticas: readonly Pick<CriticaCiha, 'regra' | 'gravidade'>[]): {
  readonly bloqueantes: number;
  readonly avisos: number;
  readonly porRegra: Readonly<Record<string, number>>;
} {
  const porRegra: Record<string, number> = {};
  let bloqueantes = 0;
  for (const c of criticas) {
    porRegra[c.regra] = (porRegra[c.regra] ?? 0) + 1;
    if (c.gravidade === 'bloqueante') bloqueantes += 1;
  }
  return { bloqueantes, avisos: criticas.length - bloqueantes, porRegra };
}

/**
 * A chave estável de uma crítica entre execuções (regra, conta, atendimento, item e o detalhe): a crítica que
 * reaparece mantém a linha (e a justificativa); a que some vira "corrigida".
 */
export function chaveDaCritica(
  c: Pick<CriticaCiha, 'regra' | 'conta' | 'atendimento' | 'item' | 'detalhe'>,
): string {
  const d = Object.keys(c.detalhe)
    .sort()
    .map((k) => `${k}=${String(c.detalhe[k] ?? '')}`)
    .join(';');
  return `${c.regra}|${c.conta ?? ''}|${c.atendimento ?? ''}|${c.item ?? ''}|${d}`.slice(0, 200);
}
