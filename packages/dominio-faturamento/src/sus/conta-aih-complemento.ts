// Complemento da conta da AIH (F7, 06-SUS linha 58): a equipe que fez cada procedimento (CNS, CBO, atividade e o
// credor do valor), os vários diagnósticos secundários (com a classificação preexistente ou adquirido, a causa
// associada e a causa da morte) e os incrementos da habilitação do hospital (percentual sobre o procedimento ou sobre a
// AIH toda). Regras puras: o que pode ser gravado, a conferência na hora (a mesma da tela e da porta) e o valor do
// incremento. A conta só aceita o complemento enquanto está fechada e não foi apresentada ao gestor.
import { cnsValido } from '@sgh/contratos';

/** O SISAIH01 leva até nove diagnósticos secundários por AIH. */
export const MAXIMO_DIAGNOSTICOS_SECUNDARIOS_AIH = 9;
/** A equipe toda da conta (o arquivo tem sequência de dois dígitos). */
export const MAXIMO_EQUIPE_AIH = 99;
/** Incrementos por conta (as habilitações do hospital que dão acréscimo). */
export const MAXIMO_INCREMENTOS_AIH = 20;
/** O teto do percentual de um incremento (os incentivos do Ministério ficam abaixo disto). */
export const PERCENTUAL_MAXIMO_INCREMENTO_AIH = 300;

export const TIPOS_DIAGNOSTICO_AIH = ['secundario', 'causa_associada', 'causa_morte'] as const;
export type TipoDiagnosticoAih = (typeof TIPOS_DIAGNOSTICO_AIH)[number];
export const CLASSIFICACOES_DIAGNOSTICO_AIH = ['preexistente', 'adquirido'] as const;
export type ClassificacaoDiagnosticoAih = (typeof CLASSIFICACOES_DIAGNOSTICO_AIH)[number];

export interface DiagnosticoAihEntrada {
  readonly cid: string;
  readonly tipo: TipoDiagnosticoAih;
  readonly classificacao: ClassificacaoDiagnosticoAih | null;
}

export interface ProfissionalEquipeAihEntrada {
  /** A sequência do procedimento da conta que o profissional fez. */
  readonly procedimento: number;
  readonly cns: string;
  readonly cbo: string;
  /** O código da atividade no ato (domínio do SUS: cirurgião, auxiliar, anestesista...). */
  readonly atividade: string;
  /** O código de quem recebe o valor (domínio do SUS); null = o hospital. */
  readonly credor: string | null;
  /** CPF ou CNPJ do credor, quando não é o hospital. */
  readonly documentoCredor: string | null;
}

export interface IncrementoAihEntrada {
  /** O código de quatro dígitos da habilitação do hospital. */
  readonly habilitacao: string;
  /** A sequência do procedimento a que o incremento se aplica; null = a AIH toda. */
  readonly procedimento: number | null;
  readonly percentual: number;
}

export interface ComplementoAihEntrada {
  readonly diagnosticos: readonly DiagnosticoAihEntrada[];
  readonly equipe: readonly ProfissionalEquipeAihEntrada[];
  readonly incrementos: readonly IncrementoAihEntrada[];
}

export interface ContextoComplementoAih {
  /** A situação da última conta da AIH. */
  readonly situacaoConta: string;
  readonly cidPrincipal: string;
  /** Os procedimentos da conta pela sequência (OPM não recebe equipe nem incremento). */
  readonly procedimentos: readonly { readonly sequencia: number; readonly tipo: string }[];
  /** As habilitações vigentes do hospital (código de quatro dígitos); sem o conjunto, só a forma é conferida. */
  readonly habilitacoes?: ReadonlySet<string>;
}

export interface ProblemaComplementoAih {
  readonly campo: string;
  readonly mensagem: string;
}

const FORMA_CID = /^[A-Z]\d{2}[0-9A-Z]{0,3}$/;
const cidLimpo = (c: string) => c.trim().replace('.', '').toUpperCase();
const digitos = (v: string) => v.replace(/\D/g, '');

/** A conta aceita o complemento só fechada (depois de apresentada, a correção é pela reapresentação). */
export function complementoEditavel(situacaoConta: string): boolean {
  return situacaoConta === 'fechada';
}

/** O tipo do documento do credor pelos dígitos (CPF 11, CNPJ 14); null quando não é nenhum dos dois. */
export function tipoDocumentoCredor(documento: string | null): 'cpf' | 'cnpj' | null {
  const d = digitos(documento ?? '');
  if (d.length === 11) return 'cpf';
  if (d.length === 14) return 'cnpj';
  return null;
}

/** A conferência do complemento inteiro, na tela e na gravação: devolve os problemas (vazio = pode gravar). */
export function conferirComplementoAih(
  e: ComplementoAihEntrada,
  ctx: ContextoComplementoAih,
): ProblemaComplementoAih[] {
  const p: ProblemaComplementoAih[] = [];
  if (!complementoEditavel(ctx.situacaoConta)) {
    p.push({
      campo: 'conta',
      mensagem:
        'A conta da AIH só recebe equipe, diagnósticos e incrementos fechada e antes da apresentação ao gestor.',
    });
    return p;
  }
  const principal = cidLimpo(ctx.cidPrincipal);
  const vistos = new Set<string>();
  let secundarios = 0;
  let causaMorte = 0;
  e.diagnosticos.forEach((d, i) => {
    const campo = `diagnosticos.${i}`;
    const cid = cidLimpo(d.cid);
    if (!FORMA_CID.test(cid)) p.push({ campo, mensagem: `O CID-10 ${i + 1} não tem a forma do catálogo.` });
    else if (cid === principal)
      p.push({ campo, mensagem: `O CID-10 ${cid} já é o diagnóstico principal da AIH.` });
    if (vistos.has(`${cid}|${d.tipo}`))
      p.push({ campo, mensagem: `O CID-10 ${cid} aparece duas vezes com o mesmo papel.` });
    vistos.add(`${cid}|${d.tipo}`);
    if (d.tipo === 'secundario') {
      secundarios += 1;
      if (d.classificacao === null)
        p.push({
          campo,
          mensagem: `Diga se o diagnóstico ${cid} é preexistente ou adquirido na internação.`,
        });
    }
    if (d.tipo === 'causa_morte') causaMorte += 1;
  });
  if (secundarios > MAXIMO_DIAGNOSTICOS_SECUNDARIOS_AIH)
    p.push({
      campo: 'diagnosticos',
      mensagem: `A AIH leva no máximo ${MAXIMO_DIAGNOSTICOS_SECUNDARIOS_AIH} diagnósticos secundários.`,
    });
  if (causaMorte > 1) p.push({ campo: 'diagnosticos', mensagem: 'A AIH tem uma só causa da morte.' });

  const procs = new Map(ctx.procedimentos.map((x) => [x.sequencia, x.tipo]));
  const comAto = (seq: number) => {
    const t = procs.get(seq);
    return t !== undefined && t !== 'opm';
  };
  if (e.equipe.length > MAXIMO_EQUIPE_AIH)
    p.push({ campo: 'equipe', mensagem: `A equipe da conta tem no máximo ${MAXIMO_EQUIPE_AIH} linhas.` });
  const atos = new Set<string>();
  e.equipe.forEach((x, i) => {
    const campo = `equipe.${i}`;
    if (!comAto(x.procedimento))
      p.push({ campo, mensagem: `A linha ${i + 1} da equipe não aponta um procedimento da conta.` });
    if (!cnsValido(digitos(x.cns)))
      p.push({ campo, mensagem: `O CNS do profissional da linha ${i + 1} não é válido.` });
    if (!/^[0-9A-Z]{6}$/.test(x.cbo.trim().toUpperCase()))
      p.push({ campo, mensagem: `A ocupação (CBO) da linha ${i + 1} tem de ter seis caracteres.` });
    if (!x.atividade.trim())
      p.push({ campo, mensagem: `Diga a atividade do profissional na linha ${i + 1}.` });
    if (x.documentoCredor !== null && tipoDocumentoCredor(x.documentoCredor) === null)
      p.push({ campo, mensagem: `O documento do credor da linha ${i + 1} não é CPF nem CNPJ.` });
    if (x.documentoCredor !== null && x.credor === null)
      p.push({ campo, mensagem: `Diga quem é o credor da linha ${i + 1} (o documento veio sem ele).` });
    const chave = `${x.procedimento}|${digitos(x.cns)}|${x.atividade.trim()}`;
    if (atos.has(chave))
      p.push({ campo, mensagem: `O mesmo profissional está duas vezes no mesmo ato (linha ${i + 1}).` });
    atos.add(chave);
  });

  if (e.incrementos.length > MAXIMO_INCREMENTOS_AIH)
    p.push({
      campo: 'incrementos',
      mensagem: `A conta leva no máximo ${MAXIMO_INCREMENTOS_AIH} incrementos.`,
    });
  const incs = new Set<string>();
  e.incrementos.forEach((x, i) => {
    const campo = `incrementos.${i}`;
    const h = x.habilitacao.trim();
    if (!/^\d{4}$/.test(h))
      p.push({ campo, mensagem: `A habilitação do incremento ${i + 1} tem quatro dígitos.` });
    else if (ctx.habilitacoes && !ctx.habilitacoes.has(h))
      p.push({ campo, mensagem: `O hospital não tem a habilitação ${h} vigente na data da internação.` });
    if (!(x.percentual > 0) || x.percentual > PERCENTUAL_MAXIMO_INCREMENTO_AIH)
      p.push({
        campo,
        mensagem: `O percentual do incremento ${i + 1} fica acima de 0 e até ${PERCENTUAL_MAXIMO_INCREMENTO_AIH}%.`,
      });
    if (x.procedimento !== null && !comAto(x.procedimento))
      p.push({ campo, mensagem: `O incremento ${i + 1} não aponta um procedimento da conta.` });
    const chave = `${h}|${x.procedimento ?? 'aih'}`;
    if (incs.has(chave))
      p.push({ campo, mensagem: `A habilitação ${h} está duas vezes no mesmo alvo (incremento ${i + 1}).` });
    incs.add(chave);
  });
  return p;
}

const centavos = (v: number) => Math.round(v * 100) / 100;

/** O valor do incremento: o percentual sobre os serviços hospitalar e profissional da base (procedimento ou AIH). */
export function valorDoIncrementoAih(
  base: { readonly servicoHospitalar: number; readonly servicoProfissional: number },
  percentual: number,
): { servicoHospitalar: number; servicoProfissional: number; total: number } {
  const sh = centavos((base.servicoHospitalar * percentual) / 100);
  const sp = centavos((base.servicoProfissional * percentual) / 100);
  return { servicoHospitalar: sh, servicoProfissional: sp, total: centavos(sh + sp) };
}
