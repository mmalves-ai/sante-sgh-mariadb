// BPA (ficha do M51, seção 5: `faturamento.gerarBpa`; regras 1, 2, 4 e 5; Portaria SAS 709/2007; Manual do SIA): a
// produção ambulatorial do SUS da competência, a partir da mesma conta (o financiador é o SUS: a conta é uma só, regra
// 1). Cada procedimento vai ao instrumento de registro que a SIGTAP da competência permite:
//   - BPA individualizado (BPA-I, registro 02 da SIGTAP): identifica o paciente pelo CNS e o executante pelo CNS e pelo
//     CBO; é o preferido quando os dois são permitidos (regra 1) e o paciente tem CNS válido;
//   - BPA consolidado (BPA-C, registro 01): só CBO, procedimento, idade e quantidade, somados; vai consolidado também
//     quando o procedimento permite os dois e o paciente não tem CNS (D-BPAI-51: o leiaute do BPA-I exige o CNS);
//   - o que só cabe em APAC vai à APAC (etapa 3, `apac.ts`); o que só cabe em AIH, ou não tem registro conhecido, vai
//     para a crítica (`instrumento-incompativel`).
// O validador de compatibilidade (compatibilidade.ts) confere CID, CBO, sexo, idade, habilitação e quantidade. A
// requisição de laboratório não é atendimento (regra 4; a consulta já filtra ESPEC > 0). Puro: as leituras ficam no
// adaptador e o arquivo em `bpa-leiaute.ts`.
import type { CompetenciaSus, GravidadeCriticaSus, RegraCriticaSus } from '@sgh/contratos';
import { GRAVIDADE_DA_REGRA_SUS } from '@sgh/contratos';
import type { CriticaCiha, ProcedimentoNaCiha } from './ciha.js';
import { normalizarCid } from './ciha.js';
import { type CompatibilidadesDaCompetencia, validarCompatibilidade } from './compatibilidade.js';
import { competenciaDaData } from './competencia.js';
import {
  cboValido,
  cnesValido,
  documentoInformado,
  identificarPessoa,
  type ValidadorCns,
} from './identificacao-sus.js';
import { type ConveniosEspeciais, CONVENIOS_ESPECIAIS_PADRAO, financiadorDoConvenio } from './instrumento.js';
import { idadeEmMeses } from './sigtap-competencia.js';

/** O profissional executante do item (o titular do item, com o CBO e o profissional). */
export interface ExecutanteBpa {
  readonly cbo: string | null;
  readonly cns: string | null;
  readonly cpf: string | null;
}

export interface ItemBpa {
  readonly item: number;
  /** Id do procedimento SIGTAP do vínculo do item; null sem equivalente. */
  readonly sigtap: number | null;
  readonly quantidade: number;
  /** O procedimento unificado do item: a chave da equivalência do Sante. */
  readonly procedimento: number | null;
  readonly executante: ExecutanteBpa | null;
}

/** Dados do paciente que só vão ao arquivo (nunca à tela, ao banco do Sante nem à auditoria). */
export interface PacienteBpa {
  readonly cns: string | null;
  readonly cpf: string | null;
  readonly sexo: string | null;
  readonly nascimento: string | null;
  readonly municipio: number | null;
  readonly nome: string | null;
  readonly raca: number | null;
  readonly cep: string | null;
  readonly logradouro: string | null;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
}

export interface AtendimentoBpa {
  readonly conta: number;
  readonly atendimento: number | null;
  readonly convenio: number;
  /** AAAA-MM-DD do atendimento ambulatorial. */
  readonly data: string | null;
  readonly cidPrincipal: string | null;
  readonly paciente: PacienteBpa;
  readonly itens: readonly ItemBpa[];
}

/** Uma linha do BPA-C (somada por CBO, procedimento e idade). */
export interface LinhaBpaC {
  readonly cbo: string;
  readonly procedimento: string;
  readonly idade: number;
  readonly quantidade: number;
}

/** Uma linha do BPA-I (por atendimento, procedimento e executante). */
export interface LinhaBpaI {
  readonly conta: number;
  readonly atendimento: number | null;
  readonly data: string;
  readonly cnsProfissional: string;
  readonly cbo: string;
  readonly procedimento: string;
  readonly cnsPaciente: string;
  readonly sexo: 'M' | 'F';
  readonly municipio: number;
  readonly cid: string | null;
  readonly idade: number;
  readonly quantidade: number;
  readonly nome: string;
  readonly nascimento: string;
  /** Raça/cor (01 a 05; 99 sem informação). */
  readonly raca: string;
  readonly cep: string | null;
  readonly logradouro: string | null;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
}

export interface ContextoBpa {
  readonly competencia: CompetenciaSus;
  readonly cnes: string | number | null;
  readonly convenios?: ConveniosEspeciais;
  readonly procedimento: (id: number) => ProcedimentoNaCiha | null;
  readonly compatibilidades: CompatibilidadesDaCompetencia;
  readonly habilitacoes: ReadonlySet<string>;
  readonly cnsValido: ValidadorCns;
  readonly cidExiste?: (cid: string) => boolean;
  /** A equivalência SIGTAP do Sante (vale quando o item não tem vínculo vigente; D-EQUIV-BPA-51). */
  readonly equivalencia?: (procedimento: number) => number | null;
  /**
   * A APAC está liberada no estabelecimento? Ligada (o padrão), o procedimento que só cabe em APAC sai do BPA e a crítica
   * da APAC acusa a falta da autorização; desligada, nada o acusaria, e ele fica no BPA com a crítica
   * `instrumento-incompativel` (D-BPA-APAC-513).
   */
  readonly apacLiberada?: boolean;
}

export interface ResultadoBpa {
  readonly consolidado: readonly LinhaBpaC[];
  readonly individualizado: readonly LinhaBpaI[];
  readonly criticas: readonly CriticaCiha[];
  /** Atendimentos lidos que ficaram fora por não serem do SUS (vão na CIHA). */
  readonly foraPorNaoSerSus: number;
  /** Atendimentos com ao menos uma linha. */
  readonly atendimentos: number;
}

function critica(
  regra: RegraCriticaSus,
  a: Pick<AtendimentoBpa, 'conta' | 'atendimento'> | null,
  item: number | null = null,
  detalhe: Record<string, string | number | null> = {},
): CriticaCiha {
  const gravidade: GravidadeCriticaSus = GRAVIDADE_DA_REGRA_SUS[regra];
  return { regra, gravidade, conta: a?.conta ?? null, atendimento: a?.atendimento ?? null, item, detalhe };
}

const FORMA_CID = /^[A-Z]\d{2}[0-9X]?$/;
const limpo = (v: string | null | undefined) => {
  const t = (v ?? '').trim();
  return t.length ? t : null;
};

/** Raça/cor do cadastro (1 a 5) no código do SIA (01 a 05); o resto é 99 (sem informação). */
export function racaSia(v: number | null | undefined): string {
  return v !== null && v !== undefined && v >= 1 && v <= 5 ? `0${v}` : '99';
}

/** Idade em anos completos na data do atendimento (0 a 130; o leiaute tem 3 dígitos). */
export function idadeEmAnos(nascimento: string | null, data: string): number | null {
  if (!nascimento) return null;
  const m = idadeEmMeses(nascimento, data);
  return m === null ? null : Math.min(130, Math.floor(m / 12));
}

/** Os campos do BPA-I que o leiaute exige e faltam no cadastro do paciente. */
function camposAusentesBpaI(p: PacienteBpa): string[] {
  const f: string[] = [];
  const sexo = (p.sexo ?? '').trim().toUpperCase();
  if (sexo !== 'M' && sexo !== 'F') f.push('sexo');
  if (!p.nascimento || p.nascimento < '1900') f.push('nascimento');
  if (!limpo(p.nome)) f.push('nome');
  if (!p.municipio || p.municipio <= 0) f.push('municipio');
  return f;
}

interface Montado {
  readonly item: number;
  readonly instrumento: 'bpa-c' | 'bpa-i';
  readonly codigo: string;
  readonly quantidade: number;
  readonly cbo: string;
  readonly cnsProfissional: string | null;
}

/**
 * A crítica e a montagem do BPA. O atendimento com bloqueante fica todo fora (como na CIHA: o faturista corrige na
 * origem e roda de novo); o aviso não tira a linha.
 */
export function montarBpa(atendimentos: readonly AtendimentoBpa[], ctx: ContextoBpa): ResultadoBpa {
  const criticas: CriticaCiha[] = [];
  const consolidado = new Map<string, LinhaBpaC>();
  const individualizado: LinhaBpaI[] = [];
  let foraPorNaoSerSus = 0;
  let comLinha = 0;
  if (!cnesValido(ctx.cnes)) criticas.push(critica('sem-cnes', null));
  for (const a of atendimentos) {
    if (financiadorDoConvenio(a.convenio, ctx.convenios ?? CONVENIOS_ESPECIAIS_PADRAO) !== 'sus') {
      foraPorNaoSerSus += 1;
      continue;
    }
    const proprias: CriticaCiha[] = [];
    const data = a.data;
    if (!data || competenciaDaData(data) !== ctx.competencia)
      proprias.push(critica('data-fora-da-competencia', a, null, { competencia: ctx.competencia }));
    const id = identificarPessoa({ cns: a.paciente.cns, cpf: a.paciente.cpf }, ctx.cnsValido);
    for (const p of id.problemas) proprias.push(critica(p, a));
    const cid = normalizarCid(a.cidPrincipal);
    if (cid && (!FORMA_CID.test(cid) || (ctx.cidExiste && !ctx.cidExiste(cid))))
      proprias.push(critica('cid-invalido', a, null, { cid }));
    const sexo = (a.paciente.sexo ?? '').trim().toUpperCase() || null;
    const idadeMeses = a.paciente.nascimento && data ? idadeEmMeses(a.paciente.nascimento, data) : null;
    const faltamI = camposAusentesBpaI(a.paciente);
    const montados: Montado[] = [];
    let semEquivalente = 0;
    let apac = 0;
    const procedimentosSem: number[] = [];
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
          semEquivalente += 1;
          if (it.procedimento) procedimentosSem.push(it.procedimento);
          continue;
        }
        proprias.push(
          critica('sigtap-fora-da-competencia', a, it.item, {
            sigtap: vinculo?.procedimento.codigo ?? it.sigtap,
            competencia: ctx.competencia,
            procedimento: it.procedimento ?? null,
          }),
        );
        continue;
      }
      const registros = p.registros ?? [];
      const podeI = registros.includes('bpa-i');
      const podeC = registros.includes('bpa-c');
      // Etapa 3 (regra 1): com a APAC liberada, o procedimento que só cabe em APAC vai à APAC do paciente (a crítica dela
      // acusa a falta da autorização); não é produção do BPA. Com ela desligada, segue para a crítica do instrumento.
      if (
        ctx.apacLiberada !== false &&
        !podeI &&
        !podeC &&
        (registros.includes('apac-principal') || registros.includes('apac-secundario'))
      ) {
        apac += 1;
        continue;
      }
      // Regra 1: o BPA-I quando permitido e o paciente tem CNS; senão o BPA-C, se permitido.
      const instrumento: 'bpa-c' | 'bpa-i' | null =
        podeI && id.cns ? 'bpa-i' : podeC ? 'bpa-c' : podeI ? 'bpa-i' : null;
      const ex = it.executante;
      const cbo = ex?.cbo && cboValido(ex.cbo) ? ex.cbo.trim().toUpperCase() : null;
      const problemas = validarCompatibilidade(
        {
          procedimento: p,
          instrumento: instrumento ?? 'bpa-i',
          quantidade: it.quantidade,
          paciente: { sexo, idadeMeses },
          cid,
          conferirCid: instrumento === 'bpa-i',
          cbo,
        },
        ctx.compatibilidades,
        ctx.habilitacoes,
      );
      for (const x of problemas) proprias.push(critica(x.regra, a, it.item, x.detalhe));
      if (instrumento === null) continue;
      let cnsProfissional: string | null = null;
      if (instrumento === 'bpa-i') {
        if (!id.cns) {
          proprias.push(critica('sem-cns-paciente', a, it.item, { sigtap: p.procedimento.codigo }));
          continue;
        }
        const cnsEx = documentoInformado(ex?.cns);
        cnsProfissional = cnsEx && ctx.cnsValido(cnsEx) ? cnsEx : null;
        if (!cnsProfissional)
          proprias.push(
            critica('profissional-sem-identificacao', a, it.item, { sigtap: p.procedimento.codigo }),
          );
        for (const campo of faltamI) proprias.push(critica('dado-minimo-ausente', a, it.item, { campo }));
      }
      if (!cbo) continue;
      montados.push({
        item: it.item,
        instrumento,
        codigo: p.procedimento.codigo,
        quantidade: Math.max(1, Math.round(it.quantidade)),
        cbo,
        cnsProfissional,
      });
    }
    // Os procedimentos do hospital sem equivalente (até 10, em ordem): a tela mostra o código e o nome e oferece a
    // equivalência do Sante, como na CIHA.
    const lista =
      [...new Set(procedimentosSem)]
        .sort((x, y) => x - y)
        .slice(0, 10)
        .join(',') || null;
    if (montados.length === 0 && apac > 0 && !proprias.some((c) => c.gravidade === 'bloqueante')) continue;
    if (montados.length === 0 && !proprias.some((c) => c.gravidade === 'bloqueante'))
      proprias.push(critica('sem-sigtap', a, null, { itens: a.itens.length, procedimentos: lista }));
    else if (semEquivalente > 0)
      proprias.push(critica('item-sem-sigtap', a, null, { itens: semEquivalente, procedimentos: lista }));
    // Críticas repetidas no mesmo atendimento (o mesmo campo ausente em dois itens) contam uma vez.
    const vistas = new Set<string>();
    for (const c of proprias) {
      const k = `${c.regra}|${c.item ?? ''}|${JSON.stringify(c.detalhe)}`;
      if (vistas.has(k)) continue;
      vistas.add(k);
      criticas.push(c);
    }
    if (proprias.some((c) => c.gravidade === 'bloqueante') || montados.length === 0) continue;
    comLinha += 1;
    const idade = idadeEmAnos(a.paciente.nascimento, data as string) ?? 0;
    const porChaveI = new Map<string, LinhaBpaI>();
    for (const m of montados) {
      if (m.instrumento === 'bpa-c') {
        const k = `${m.codigo}|${m.cbo}|${idade}`;
        const atual = consolidado.get(k);
        consolidado.set(
          k,
          atual
            ? { ...atual, quantidade: atual.quantidade + m.quantidade }
            : { cbo: m.cbo, procedimento: m.codigo, idade, quantidade: m.quantidade },
        );
        continue;
      }
      const k = `${m.codigo}|${m.cbo}|${m.cnsProfissional}`;
      const atual = porChaveI.get(k);
      if (atual) {
        porChaveI.set(k, { ...atual, quantidade: atual.quantidade + m.quantidade });
        continue;
      }
      const p = a.paciente;
      porChaveI.set(k, {
        conta: a.conta,
        atendimento: a.atendimento,
        data: data as string,
        cnsProfissional: m.cnsProfissional as string,
        cbo: m.cbo,
        procedimento: m.codigo,
        cnsPaciente: id.cns as string,
        sexo: sexo as 'M' | 'F',
        municipio: p.municipio as number,
        cid,
        idade,
        quantidade: m.quantidade,
        nome: limpo(p.nome) as string,
        nascimento: p.nascimento as string,
        raca: racaSia(p.raca),
        cep: limpo(p.cep),
        logradouro: limpo(p.logradouro),
        numero: limpo(p.numero),
        complemento: limpo(p.complemento),
        bairro: limpo(p.bairro),
      });
    }
    individualizado.push(...porChaveI.values());
  }
  const c = [...consolidado.values()].sort(
    (x, y) => x.procedimento.localeCompare(y.procedimento) || x.cbo.localeCompare(y.cbo) || x.idade - y.idade,
  );
  const i = individualizado.sort((x, y) => x.conta - y.conta || x.procedimento.localeCompare(y.procedimento));
  return { consolidado: c, individualizado: i, criticas, foraPorNaoSerSus, atendimentos: comLinha };
}
