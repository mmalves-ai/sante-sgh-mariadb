// Montagem da CIHA (M51, etapa 1), do BPA (etapa 2) e da APAC (etapa 3) de uma competência a partir do que a porta leu: o catálogo SIGTAP da competência
// (regra 2), as equivalências do Sante, os parâmetros do estabelecimento (CNES, convênios SUS e particular, fonte de
// remuneração) e a crítica prévia do domínio. Puro: nenhuma leitura nem gravação aqui.
import {
  cnsValido,
  type CompetenciaSus,
  FONTES_REMUNERACAO_CIHA,
  type FonteRemuneracaoCiha,
} from '@sgh/contratos';
import {
  type ApacParaMontar,
  type AtendimentoApac,
  camposAusentesCabecalhoApac,
  montarApac,
  type ResultadoApac,
  type AtendimentoBpa,
  type AtendimentoCiha,
  type CabecalhoBpa,
  camposAusentesCabecalhoBpa,
  catalogoSigtapDaCompetencia,
  compatibilidadesDaCompetencia,
  montarBpa,
  type ResultadoBpa,
  chaveDaCritica,
  cnesValido,
  montarCiha,
  type ResultadoCiha,
} from '@sgh/dominio-faturamento';
import type {
  ApacSghLinha,
  EquivalenciaSusLinha,
  NovaCriticaSus,
  RegistroCihaParaGravar,
  SolicitanteApacLido,
} from '@sgh/legado';
import type { ParametrosAih } from './montagem-aih.js';
import type { DadosBpaLidos, DadosCihaLidos } from './porta.js';

export interface ParametrosSus {
  /** CNES do parâmetro (vazio: o de TBEMPHOS, quando houver um só). */
  readonly cnes: string;
  readonly conveniosSus: readonly number[];
  readonly conveniosParticular: readonly number[];
  readonly fontePadrao: FonteRemuneracaoCiha | null;
  readonly fontePorConvenio: ReadonlyMap<number, string>;
  /** Etapa 2: as habilitações do CNES (parâmetro `faturamento.sus.habilitacoes`) e o cabeçalho do BPA-Mag. */
  readonly habilitacoes: ReadonlySet<string>;
  readonly bpa: CabecalhoBpa;
  /** Etapa 3: o código IBGE da UF do gestor no registro da APAC (o cabeçalho do APAC-Mag é o do BPA). */
  readonly apac: { readonly uf: string };
  /** Etapa 4: as diárias de UTI por acomodação e o diretor clínico do SISAIH01. */
  readonly aih?: ParametrosAih;
}

export interface MontagemCiha {
  readonly resultado: ResultadoCiha;
  readonly cnes: string | null;
  readonly criticas: readonly NovaCriticaSus[];
  readonly registros: readonly RegistroCihaParaGravar[];
}

const ehFonte = (f: string | undefined): f is FonteRemuneracaoCiha =>
  (FONTES_REMUNERACAO_CIHA as readonly string[]).includes(f ?? '');

/** O CNES da competência: o parâmetro; sem ele, o do cadastro do estabelecimento quando há um só. */
export function cnesDaCompetencia(p: ParametrosSus, cadastrados: readonly number[]): string | null {
  if (cnesValido(p.cnes)) return p.cnes;
  const unicos = [...new Set(cadastrados)];
  return unicos.length === 1 && cnesValido(unicos[0]) ? String(unicos[0]).padStart(7, '0') : null;
}

export function montarCihaDaCompetencia(
  competencia: CompetenciaSus,
  dados: DadosCihaLidos,
  p: ParametrosSus,
  equivalencias: readonly EquivalenciaSusLinha[],
): MontagemCiha {
  const procedimento = catalogoSigtapDaCompetencia(
    competencia,
    dados.procedimentos,
    dados.historico,
    dados.registros,
  );
  const eq = new Map(equivalencias.map((x) => [x.procedimento, x.sigtap]));
  const cnes = cnesDaCompetencia(p, dados.cnesCadastrados);
  const convenioDaConta = new Map<number, number>();
  const registroDaConta = new Map<number, number>();
  const atendimentos: AtendimentoCiha[] = dados.atendimentos.map((a) => {
    const c = a.conta;
    convenioDaConta.set(c.conta, c.convenio);
    registroDaConta.set(c.conta, c.registro);
    return {
      conta: c.conta,
      atendimento: c.atendimento,
      modalidade: c.modalidade,
      convenio: c.convenio,
      paciente: c.paciente,
      entrada: c.entrada,
      saida: c.saida,
      cidPrincipal: c.cidPrincipal,
      cidSecundario: c.cidSecundario,
      itens: a.itens.map((i) => ({
        item: i.item,
        sigtap: i.sigtap,
        quantidade: i.quantidade,
        procedimento: i.procedimento,
      })),
      motivoAlta: c.motivoAlta,
      beneficiario: c.beneficiario,
      guiaTiss: c.guiaTiss,
      operadora: c.operadora,
    };
  });
  // Ordem estável por conta: o mesmo conjunto dá o mesmo arquivo e o mesmo hash.
  atendimentos.sort((x, y) => x.conta - y.conta);
  const resultado = montarCiha(atendimentos, {
    competencia,
    cnes,
    convenios: { sus: p.conveniosSus, particular: p.conveniosParticular },
    fontePorConvenio: (convenio) => {
      const f = p.fontePorConvenio.get(convenio);
      if (f !== undefined) return ehFonte(f) ? f : null;
      return p.fontePadrao;
    },
    procedimento,
    cnsValido,
    cidExiste: (cid) => dados.cids.has(cid),
    equivalencia: (procto) => eq.get(procto) ?? null,
  });
  const criticas: NovaCriticaSus[] = resultado.criticas.map((c) => ({
    chave: chaveDaCritica(c),
    regra: c.regra,
    gravidade: c.gravidade,
    conta: c.conta,
    convenio: c.conta === null ? null : (convenioDaConta.get(c.conta) ?? null),
    atendimento: c.atendimento,
    item: c.item,
    detalhe: JSON.stringify(c.detalhe),
  }));
  const registros: RegistroCihaParaGravar[] = resultado.registros.map((r) => ({
    modalidade: r.modalidade,
    conta: r.conta,
    atendimento: r.atendimento,
    registro: registroDaConta.get(r.conta) ?? null,
    fonte: r.fonte,
    cidPrincipal: r.cidPrincipal,
    procedimentoPrincipal: r.procedimentos[0]?.codigo ?? '',
    procedimentos: r.procedimentos.length,
  }));
  return { resultado, cnes, criticas, registros };
}

export interface MontagemBpa {
  readonly resultado: ResultadoBpa;
  readonly cnes: string | null;
  readonly criticas: readonly NovaCriticaSus[];
  /** O registro da ficha (RECADATE.REG) de cada conta (a linha do BPA-I guarda a chave natural). */
  readonly registroDaConta: ReadonlyMap<number, number>;
}

/**
 * Etapa 2: o BPA da competência pelo que a porta leu (a mesma SIGTAP da competência, as compatibilidades vigentes nela,
 * as habilitações do CNES e as equivalências do Sante). Os campos do cabeçalho que faltam viram crítica
 * `dado-minimo-ausente` do estabelecimento (sem conta), antes de gerar.
 */
export function montarBpaDaCompetencia(
  competencia: CompetenciaSus,
  dados: DadosBpaLidos,
  p: ParametrosSus,
  equivalencias: readonly EquivalenciaSusLinha[],
  /** Com a APAC desligada, o procedimento só de APAC fica no BPA com a crítica do instrumento (D-BPA-APAC-513). */
  apacLiberada = true,
): MontagemBpa {
  const procedimento = catalogoSigtapDaCompetencia(
    competencia,
    dados.procedimentos,
    dados.historico,
    dados.registros,
  );
  const eq = new Map(equivalencias.map((x) => [x.procedimento, x.sigtap]));
  const cnes = cnesDaCompetencia(p, dados.cnesCadastrados);
  const convenioDaConta = new Map<number, number>();
  const registroDaConta = new Map<number, number>();
  const atendimentos: AtendimentoBpa[] = dados.atendimentos.map((a) => {
    const c = a.conta;
    for (const k of a.contas) {
      convenioDaConta.set(k, c.convenio);
      registroDaConta.set(k, c.registro);
    }
    return {
      conta: c.conta,
      atendimento: c.atendimento,
      convenio: c.convenio,
      data: c.data,
      cidPrincipal: c.cidPrincipal,
      paciente: c.paciente,
      itens: a.itens.map((i) => ({
        item: i.item,
        sigtap: i.sigtap,
        quantidade: i.quantidade,
        procedimento: i.procedimento,
        executante: i.executante,
      })),
    };
  });
  atendimentos.sort((x, y) => x.conta - y.conta);
  const resultado = montarBpa(atendimentos, {
    competencia,
    cnes,
    convenios: { sus: p.conveniosSus, particular: p.conveniosParticular },
    procedimento,
    compatibilidades: compatibilidadesDaCompetencia(competencia, dados.compatibilidades),
    habilitacoes: p.habilitacoes,
    cnsValido,
    cidExiste: (cid) => dados.cids.has(cid),
    equivalencia: (procto) => eq.get(procto) ?? null,
    apacLiberada,
  });
  const doCabecalho = camposAusentesCabecalhoBpa(p.bpa).map((campo) => ({
    regra: 'dado-minimo-ausente' as const,
    gravidade: 'bloqueante' as const,
    conta: null,
    atendimento: null,
    item: null,
    detalhe: { campo },
  }));
  const criticas: NovaCriticaSus[] = [...resultado.criticas, ...doCabecalho].map((c) => ({
    chave: chaveDaCritica(c),
    regra: c.regra,
    gravidade: c.gravidade,
    conta: c.conta,
    convenio: c.conta === null ? null : (convenioDaConta.get(c.conta) ?? null),
    atendimento: c.atendimento,
    item: c.item,
    detalhe: JSON.stringify(c.detalhe),
  }));
  return {
    resultado: { ...resultado, criticas: [...resultado.criticas, ...doCabecalho] },
    cnes,
    criticas,
    registroDaConta,
  };
}

export interface MontagemApac {
  readonly resultado: ResultadoApac;
  readonly cnes: string | null;
  readonly criticas: readonly NovaCriticaSus[];
}

/** A APAC gravada no Sante como a montagem lê (o solicitante pelo cadastro FAMEDSOL). */
export function apacParaMontar(
  a: ApacSghLinha,
  solicitantes: ReadonlyMap<string, SolicitanteApacLido>,
): ApacParaMontar {
  const sol = solicitantes.get(a.solicitante) ?? null;
  return {
    id: a.id,
    situacao: a.situacao,
    tipo: a.tipo,
    numero: a.numero,
    paciente: a.paciente,
    procedimento: a.procedimento,
    cidPrincipal: a.cidPrincipal,
    cidSecundario: a.cidSecundario,
    cidAssociado: a.cidAssociado,
    dataSolicitacao: a.dataSolicitacao,
    dataAutorizacao: a.dataAutorizacao,
    competenciaInicial: a.competenciaInicial,
    competenciaFinal: a.competenciaFinal,
    ultimaCompetencia: a.ultimaCompetencia,
    autorizador: a.autorizador,
    solicitante: sol ? { cns: sol.cns, nome: sol.nome } : null,
    laudoEspecifico: a.laudoEspecifico,
    nefrologia: a.nefrologia,
    motivoSaida: a.motivoSaida,
    dataEncerramento: a.dataEncerramento,
  };
}

/**
 * Etapa 3: a APAC da competência pelo que a porta leu (a produção SUS do BPA, a mesma SIGTAP da competência, as
 * compatibilidades, as habilitações e as equivalências do Sante) e as APACs apresentáveis. Os campos do cabeçalho que
 * faltam viram crítica `dado-minimo-ausente` do estabelecimento (sem conta), antes de gerar.
 */
export function montarApacDaCompetencia(
  competencia: CompetenciaSus,
  dados: DadosBpaLidos,
  apacs: readonly ApacParaMontar[],
  p: ParametrosSus,
  equivalencias: readonly EquivalenciaSusLinha[],
): MontagemApac {
  const procedimento = catalogoSigtapDaCompetencia(
    competencia,
    dados.procedimentos,
    dados.historico,
    dados.registros,
  );
  const eq = new Map(equivalencias.map((x) => [x.procedimento, x.sigtap]));
  const cnes = cnesDaCompetencia(p, dados.cnesCadastrados);
  const convenioDaConta = new Map<number, number>();
  const atendimentos: AtendimentoApac[] = dados.atendimentos.map((a) => {
    const c = a.conta;
    for (const k of a.contas) convenioDaConta.set(k, c.convenio);
    return {
      conta: c.conta,
      atendimento: c.atendimento,
      pacienteId: c.pacienteId,
      convenio: c.convenio,
      data: c.data,
      cidPrincipal: c.cidPrincipal,
      paciente: c.paciente,
      itens: a.itens.map((i) => ({
        item: i.item,
        sigtap: i.sigtap,
        quantidade: i.quantidade,
        procedimento: i.procedimento,
        executante: i.executante,
      })),
    };
  });
  atendimentos.sort((x, y) => x.conta - y.conta);
  const resultado = montarApac(apacs, atendimentos, {
    competencia,
    cnes,
    convenios: { sus: p.conveniosSus, particular: p.conveniosParticular },
    procedimento,
    compatibilidades: compatibilidadesDaCompetencia(competencia, dados.compatibilidades),
    habilitacoes: p.habilitacoes,
    cnsValido,
    cidExiste: (cid) => dados.cids.has(cid),
    equivalencia: (procto) => eq.get(procto) ?? null,
  });
  const doCabecalho = camposAusentesCabecalhoApac({ ...p.bpa, uf: p.apac.uf }).map((campo) => ({
    regra: 'dado-minimo-ausente' as const,
    gravidade: 'bloqueante' as const,
    conta: null,
    atendimento: null,
    item: null,
    detalhe: { campo },
  }));
  const todas = [...resultado.criticas, ...doCabecalho];
  const criticas: NovaCriticaSus[] = todas.map((c) => ({
    chave: chaveDaCritica(c),
    regra: c.regra,
    gravidade: c.gravidade,
    conta: c.conta,
    convenio: c.conta === null ? null : (convenioDaConta.get(c.conta) ?? null),
    atendimento: c.atendimento,
    item: c.item,
    detalhe: JSON.stringify(c.detalhe),
  }));
  return { resultado: { ...resultado, criticas: todas }, cnes, criticas };
}
