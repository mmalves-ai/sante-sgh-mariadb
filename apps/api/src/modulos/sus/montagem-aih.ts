// Montagem da AIH (M51, etapa 4) a partir do que a porta leu: o catálogo SIGTAP da competência da alta de cada AIH
// (regra 2), as compatibilidades, as equivalências do hospital, os leitos de UTI habilitados, o parâmetro das diárias de UTI
// e a montagem do domínio (regra 6). Puro: nenhuma leitura nem gravação aqui.
import { type CompetenciaSus, cnsValido, GRAVIDADE_DA_REGRA_SUS, type RegraCriticaSus } from '@sgh/contratos';
import {
  type AihParaArquivo,
  type ComplementoSisaih,
  type AihRegistrada,
  catalogoSigtapDaCompetencia,
  chaveDaCritica,
  compatibilidadesDaCompetencia,
  competenciaDaData,
  type ContextoAih,
  type CriticaCiha,
  type DiariaUtiCompetencia,
  diariasUtiPorCompetencia,
  diasDePermanencia,
  habilitacaoUtiDaCompetencia,
  type InternacaoAih,
  type LinhaSisaih,
  montarAih,
  normalizarCid,
  racaSia,
  type ResultadoAih,
  utiPorAcomodacaoDoParametro,
  habilitacoesDaCompetencia,
} from '@sgh/dominio-faturamento';
import { conferirTetosDiarias, type LinhaCapacidadeSus } from '@sgh/dominio-internacao';
import { cnesDaCompetencia, type ParametrosSus } from './montagem.js';
import type { DadosAihLidos, DiariasUtiGravadas } from './porta-aih.js';
import { type AihRegistro, type EquivalenciaSus, type ItemAih, type NovaCriticaSus } from './tipos.js';

/** Os parâmetros da AIH (`faturamento.sus.aih.*`). */
export interface ParametrosAih {
  readonly utiPorAcomodacao: string;
  readonly diretorClinicoCns: string;
}

export const PARAMETROS_AIH_VAZIOS: ParametrosAih = { utiPorAcomodacao: '', diretorClinicoCns: '' };

export interface AihMontada {
  readonly aih: AihRegistro;
  readonly internacao: DadosAihLidos['internacoes'][number] | null;
  readonly resultado: ResultadoAih;
  /** A especialidade do leito do arquivo: a da internação ou, sem ela, a única que a SIGTAP aceita para o principal. */
  readonly especialidade: number | null;
  /** As diárias de UTI da trajetória por competência (guardadas no fechamento; F7, 06-SUS linha 59). */
  readonly diariasCompetencia: readonly DiariaUtiCompetencia[];
}

export function aihRegistrada(a: AihRegistro): AihRegistrada {
  return {
    id: a.id,
    situacao: a.situacao,
    numero: a.numero,
    procedimentoSolicitado: a.procedimentoSolicitado,
    procedimentoRealizado: a.procedimentoRealizado,
    cidPrincipal: a.cidPrincipal,
    cidSecundario: a.cidSecundario,
    dataLaudo: a.dataLaudo,
    dataAutorizacao: a.dataAutorizacao,
  };
}

const criticaDe = (
  regra: RegraCriticaSus,
  conta: number | null,
  detalhe: Record<string, string | number | null>,
): CriticaCiha => ({
  regra,
  gravidade: GRAVIDADE_DA_REGRA_SUS[regra],
  conta,
  atendimento: null,
  item: null,
  detalhe,
});

/**
 * A montagem de cada AIH pela competência da alta (o procedimento realizado ou o solicitado; com `realizado`, o que a
 * tela pede no fechamento). As críticas levam a AIH e o registro da internação no detalhe (a tela leva à AIH).
 */
export function montarAihs(
  dados: DadosAihLidos,
  aihs: readonly AihRegistro[],
  p: ParametrosSus,
  pAih: ParametrosAih,
  equivalencias: readonly EquivalenciaSus[],
  realizado: ReadonlyMap<number, string> = new Map(),
): AihMontada[] {
  const catalogos = new Map<string, ReturnType<typeof catalogoSigtapDaCompetencia>>();
  const catalogo = (c: CompetenciaSus) => {
    let x = catalogos.get(c);
    if (!x) {
      x = catalogoSigtapDaCompetencia(c, dados.procedimentos, dados.historico, dados.registros);
      catalogos.set(c, x);
    }
    return x;
  };
  const idDoCodigo = new Map(dados.porCodigo.map((x) => [x.codigo, x.id]));
  for (const x of dados.procedimentos) if (!idDoCodigo.has(x.codigo)) idDoCodigo.set(x.codigo, x.id);
  const eq = new Map(equivalencias.map((x) => [x.procedimento, x.sigtap]));
  const leitosUti = new Map<number, number>();
  for (const l of dados.leitosUti) leitosUti.set(l.tipo, (leitosUti.get(l.tipo) ?? 0) + l.leitos);
  const uti = utiPorAcomodacaoDoParametro(pAih.utiPorAcomodacao);
  // A crítica de UTI não habilitada pela competência de cada diária e pela unidade (F7, 06-SUS linha 59).
  const habilitacoesUti = dados.habilitacoesUti;
  const porRegistro = new Map(dados.internacoes.map((x) => [x.registro, x]));
  return aihs.map((a) => {
    const i = porRegistro.get(a.registro) ?? null;
    const comp = competenciaDaData(i?.alta) ?? competenciaDaData(a.dataLaudo) ?? '200801';
    const cat = catalogo(comp);
    const compat = compatibilidadesDaCompetencia(comp, dados.compatibilidades);
    const ctx: ContextoAih = {
      procedimento: cat,
      porCodigo: (codigo) => {
        const id = idDoCodigo.get(codigo);
        return id === undefined ? null : cat(id);
      },
      compatibilidades: compat,
      habilitacoes: habilitacoesDaCompetencia(p.habilitacoesCadastradas, comp, p.habilitacoes),
      leitosUti,
      ...(habilitacoesUti
        ? {
            utiHabilitada: (tipo: number, competencia: string, unidade: number | null) =>
              habilitacaoUtiDaCompetencia(habilitacoesUti, tipo, competencia, unidade) !== null,
          }
        : {}),
      utiPorAcomodacao: uti,
      cnsValido,
      cidExiste: (cid) => dados.cids.has(cid),
      equivalencia: (procto) => eq.get(procto) ?? null,
    };
    const registrada = aihRegistrada(a);
    const comRealizado = realizado.has(a.id)
      ? { ...registrada, procedimentoRealizado: realizado.get(a.id) ?? null }
      : registrada;
    if (!i) {
      const resultado: ResultadoAih = {
        competencia: null,
        linhas: [],
        permanencia: { dias: null, media: null },
        diariasUti: { total: 0, mesAnterior: 0 },
        itensForaDaAih: 0,
        itensSemSigtap: 0,
        criticas: [criticaDe('permanencia-incoerente', a.conta, { motivo: 'internacao-inexistente' })],
      };
      return { aih: a, internacao: null, resultado, especialidade: null, diariasCompetencia: [] };
    }
    // Os itens de todas as contas SUS da internação (as parciais) e da conta gravada na AIH.
    const contasDaAih = new Set<number>([
      ...i.contasSus,
      ...(a.conta !== null ? [a.conta] : i.conta !== null ? [i.conta] : []),
    ]);
    const internacao: InternacaoAih = {
      registro: i.registro,
      conta: a.conta ?? i.conta,
      atendimento: i.atendimento,
      convenio: i.convenio,
      entrada: i.entrada,
      alta: i.alta,
      motivoSaida: i.motivoSaida,
      especialidadeLeito: i.especialidadeLeito && i.especialidadeLeito > 0 ? i.especialidadeLeito : null,
      paciente: i.paciente,
      itens: dados.itens
        .filter((x) => contasDaAih.has(x.conta))
        .map((x) => ({
          item: x.item,
          sigtap: x.sigtap,
          quantidade: x.quantidade,
          procedimento: x.procedimento,
          cbo: x.cbo,
        })),
      passagens: dados.passagens
        .filter((x) => x.registro === i.registro)
        .map((x) => ({
          entrada: x.entrada,
          saida: x.saida,
          acomodacao: x.acomodacao,
          unidade: x.unidade ?? null,
        })),
    };
    const r = montarAih(comRealizado, internacao, ctx);
    // A especialidade (D-ESPEC-AIH-51): a da internação; sem ela, a única da lista de leitos da SIGTAP do principal.
    const principal = ctx.porCodigo(
      comRealizado.procedimentoRealizado ?? comRealizado.procedimentoSolicitado,
    );
    const leitos = principal ? compat.leitos(principal.procedimento.id) : null;
    const especialidade =
      internacao.especialidadeLeito ?? (leitos && leitos.size === 1 ? Number([...leitos][0]) || null : null);
    const extras: CriticaCiha[] =
      especialidade === null
        ? [criticaDe('dado-minimo-ausente', i.conta, { campo: 'especialidadeLeito' })]
        : [];
    const criticas = [...r.criticas, ...extras].map((c) => ({
      ...c,
      detalhe: { ...c.detalhe, aih: a.id, registro: a.registro },
    }));
    return {
      aih: a,
      internacao: i,
      resultado: { ...r, criticas },
      especialidade,
      diariasCompetencia: diariasUtiPorCompetencia(internacao.passagens, uti, internacao.alta),
    };
  });
}

export interface MontagemAihCompetencia {
  readonly criticas: readonly NovaCriticaSus[];
  readonly todas: readonly CriticaCiha[];
  readonly cnes: string | null;
  /** Internações SUS da competência e AIHs a apresentar (o "registros" da competência). */
  readonly registros: number;
  readonly apresentaveis: readonly AihMontada[];
}

/** As regras do teto de diárias de UTI e os campos do detalhe que mudam de uma crítica para outra (fora da chave). */
const REGRAS_TETO_UTI: ReadonlySet<string> = new Set([
  'diarias-uti-acima-do-teto',
  'diarias-uti-sem-capacidade',
]);
const CAMPOS_VARIAVEIS_TETO = ['diarias', 'diariasOutrasAihs', 'teto', 'excedente'] as const;

/**
 * A chave estável da crítica da competência AIH (`chaveDaCritica`). No teto das diárias de UTI a chave é só o tipo de UTI
 * e a competência das diárias: as quantidades (diárias, teto, excedente) ficam no detalhe, fora da chave, e a crítica
 * que reaparece com outra quantidade mantém a linha, a situação e a justificativa.
 */
export function chaveDaCriticaAih(c: CriticaCiha): string {
  if (!REGRAS_TETO_UTI.has(c.regra)) return chaveDaCritica(c);
  const detalhe: Record<string, string | number | null> = { ...c.detalhe };
  for (const k of CAMPOS_VARIAVEIS_TETO) delete detalhe[k];
  return chaveDaCritica({ ...c, detalhe });
}

/**
 * O teto das diárias de UTI (Leitos do sistema público, 04-INT linha 79), conferido pelo total do mês das diárias:
 * as diárias das AIHs a apresentar neste arquivo somadas, por tipo de UTI e competência da diária, às diárias já
 * gravadas das outras AIHs fechadas ou apresentadas (em outra competência de apresentação: a AIH vai pela competência
 * da alta, e as diárias de um mês podem ficar repartidas entre arquivos), e conferidas pelo domínio contra a
 * capacidade contratada vigente da competência das diárias (leitos × dias do mês). Acima do teto sem liberação é
 * bloqueante; o tipo sem capacidade, quando o cadastro é usado, é aviso. O detalhe leva o total e a parte das outras
 * AIHs (`diariasOutrasAihs`).
 */
export function criticasTetoDiariasUti(
  apresentaveis: readonly AihMontada[],
  capacidadesUti: readonly LinhaCapacidadeSus[],
  outrasAihs: readonly DiariasUtiGravadas[] = [],
): CriticaCiha[] {
  const doArquivo = apresentaveis.flatMap((m) =>
    m.diariasCompetencia.map((d) => ({ tipo: d.tipo, competencia: d.competencia, diarias: d.diarias })),
  );
  // Só as competências e os tipos que este arquivo traz: o que não tem diária aqui não é deste arquivo criticar.
  const doArquivoChaves = new Set(doArquivo.map((d) => `${d.tipo}|${d.competencia.trim()}`));
  const outras = outrasAihs.filter((d) => doArquivoChaves.has(`${d.tipo}|${d.competencia.trim()}`));
  const outrasPor = new Map<string, number>();
  for (const d of outras) {
    const k = `${d.tipo}|${d.competencia.trim()}`;
    outrasPor.set(k, (outrasPor.get(k) ?? 0) + Math.max(0, d.diarias));
  }
  return conferirTetosDiarias([...doArquivo, ...outras], capacidadesUti).map((r) => {
    const competenciaDiarias = r.competencia.slice(0, 7).replace('-', '');
    return criticaDe(
      r.situacao === 'critica' ? 'diarias-uti-acima-do-teto' : 'diarias-uti-sem-capacidade',
      null,
      {
        tipoUti: r.tipo,
        competenciaDiarias,
        diarias: r.diarias,
        diariasOutrasAihs: outrasPor.get(`${r.tipo}|${competenciaDiarias}`) ?? 0,
        teto: r.teto,
        excedente: r.excedente,
      },
    );
  });
}

/**
 * A crítica da competência AIH: a internação SUS com alta nela sem AIH (aviso), o laudo sem autorização (bloqueante), a
 * AIH autorizada ainda não fechada (aviso: vai numa competência seguinte), a montagem de cada AIH a apresentar (regra 6)
 * e o teto das diárias de UTI pela capacidade contratada (`criticasTetoDiariasUti`).
 */
export function criticaAihDaCompetencia(
  competencia: CompetenciaSus,
  internacoesSus: readonly { registro: number; conta: number }[],
  vivas: readonly AihRegistro[],
  apresentaveis: readonly AihMontada[],
  p: ParametrosSus,
  pAih: ParametrosAih,
  cnesCadastrados: readonly number[],
  capacidadesUti: readonly LinhaCapacidadeSus[] = [],
  diariasOutrasAihs: readonly DiariasUtiGravadas[] = [],
): MontagemAihCompetencia {
  const todas: CriticaCiha[] = [];
  const cnes = cnesDaCompetencia(p, cnesCadastrados);
  if (!cnes) todas.push(criticaDe('sem-cnes', null, {}));
  if (!cnsValido(pAih.diretorClinicoCns))
    todas.push(criticaDe('dado-minimo-ausente', null, { campo: 'diretorClinicoCns' }));
  const porRegistro = new Map<number, AihRegistro[]>();
  for (const a of vivas) porRegistro.set(a.registro, [...(porRegistro.get(a.registro) ?? []), a]);
  for (const x of internacoesSus) {
    const lista = porRegistro.get(x.registro) ?? [];
    if (lista.length === 0) {
      todas.push(criticaDe('aih-sem-laudo', x.conta, { registro: x.registro, competencia }));
      continue;
    }
    for (const a of lista) {
      if (a.situacao === 'solicitada')
        todas.push(criticaDe('aih-sem-autorizacao', x.conta, { aih: a.id, registro: a.registro }));
      else if (a.situacao === 'autorizada')
        todas.push(criticaDe('aih-nao-fechada', x.conta, { aih: a.id, registro: a.registro }));
    }
  }
  for (const m of apresentaveis) todas.push(...m.resultado.criticas);
  todas.push(...criticasTetoDiariasUti(apresentaveis, capacidadesUti, diariasOutrasAihs));
  const criticas: NovaCriticaSus[] = todas.map((c) => ({
    chave: chaveDaCriticaAih(c),
    regra: c.regra,
    gravidade: c.gravidade,
    conta: c.conta,
    convenio: null,
    atendimento: c.atendimento,
    item: c.item,
    detalhe: JSON.stringify(c.detalhe),
  }));
  const registros = new Set([
    ...internacoesSus.map((x) => x.registro),
    ...apresentaveis.map((m) => m.aih.registro),
  ]);
  return { criticas, todas, cnes, registros: registros.size, apresentaveis };
}

const CARATER_DA_INTERNACAO: Readonly<Record<string, '01' | '02'>> = { '1': '01', '2': '02' };

/** O caráter do laudo sugerido pela internação (1 eletivo, 2 urgência). */
export function caraterDaInternacao(carint: string | null): '01' | '02' | null {
  return carint ? (CARATER_DA_INTERNACAO[carint.trim()] ?? null) : null;
}

/** A AIH fechada pronta para o arquivo (as linhas do fechamento gravado; o paciente da internação lida agora). */
export function aihParaArquivo(
  m: AihMontada,
  linhas: readonly ItemAih[],
  documentoSolicitante: string,
  /** Equipe, diagnósticos secundários e incrementos da conta (06-SUS linha 58). */
  complemento: ComplementoSisaih | null = null,
): AihParaArquivo | null {
  const a = m.aih;
  const i = m.internacao;
  if (!i || !a.numero || !a.dataAutorizacao || !i.entrada || !i.alta || !a.cnsAutorizador) return null;
  const sexo = (i.paciente.sexo ?? '').trim().toUpperCase();
  const cns = i.paciente.cns && cnsValido(i.paciente.cns) ? i.paciente.cns : null;
  const linhasArquivo: LinhaSisaih[] = linhas
    .filter((x) => x.tipo !== 'principal')
    .map((x) => ({
      tipo: x.tipo as LinhaSisaih['tipo'],
      procedimento: x.procedimento,
      quantidade: x.quantidade,
      cbo: x.cbo,
      opm: x.opm,
    }));
  const uti = linhas.find((x) => x.tipo === 'diaria-uti');
  return {
    numero: a.numero,
    especialidade: m.especialidade ?? 0,
    carater: (a.carater as AihParaArquivo['carater']) || '01',
    dataAutorizacao: a.dataAutorizacao,
    entrada: i.entrada,
    alta: i.alta,
    procedimentoSolicitado: a.procedimentoSolicitado,
    procedimentoRealizado: a.procedimentoRealizado ?? a.procedimentoSolicitado,
    motivoSaida: i.motivoSaida ?? 0,
    cidPrincipal: normalizarCid(a.cidPrincipal) ?? a.cidPrincipal,
    cidSecundario: a.cidSecundario,
    cidObito: null,
    documentoSolicitante,
    cnsAutorizador: a.cnsAutorizador,
    paciente: {
      cns,
      cpf: cns ? null : i.paciente.cpf,
      nome: i.paciente.nome ?? '',
      nascimento: i.paciente.nascimento ?? '1900-01-01',
      sexo: sexo === 'F' ? 'F' : 'M',
      raca: racaSia(i.paciente.raca),
      municipio: i.paciente.municipio ?? 0,
      cep: i.paciente.cep,
      logradouro: i.paciente.logradouro,
      numero: i.paciente.numero,
      complemento: i.paciente.complemento,
      prontuario: a.prontuario,
    },
    diariasUti: a.diariasUti ?? 0,
    diariasUtiMesAnterior: a.diariasUtiAnterior ?? 0,
    tipoUti: uti?.tipoUti ?? null,
    permanencia: a.permanencia ?? diasDePermanencia(i.entrada, i.alta) ?? 0,
    linhas: linhasArquivo,
    ...(complemento ? { complemento } : {}),
  };
}
