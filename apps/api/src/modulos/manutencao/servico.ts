// Montagem das respostas da manutenção (M55, etapa 1): junta o que a porta leu de tabelas da manutenção com os nomes lidos do
// outro sistema (setor, unidade, recurso de agenda, fornecedor, usuário) e as regras puras de @sgh/dominio-manutencao
// (prazos do SLA, ações, alerta do crítico parado, situação do plano, cobertura vigente, indicadores com as parcelas).
// Sem banco e sem Nest: os testes chamam direto.
import {
  type CodigoModeloPlano,
  type CoberturaResumo,
  type EquipamentoDetalhe,
  type EquipamentoPeloCodigo,
  type EquipamentoResumo,
  type IndicadoresManutencao,
  type ItemPlanoPainel,
  type OsDetalhe,
  type OsResumo,
  type PainelPlano,
  type PrioridadeOs,
  type Rotulado,
  type SlaPrioridade,
} from '@sgh/contratos';
import {
  acoesDisponiveis,
  alertaDeParada,
  calcularIndicadores,
  custoDaOs,
  exigeLaudo,
  ordenarPainel,
  prazosDaOs,
  type QuemAge,
  resumoPainel,
  situacaoDoPlano,
  vigenteEm,
} from '@sgh/dominio-manutencao';
import type {
  CoberturaManutencao,
  EquipamentoManutencao,
  EventoOrdem,
  OcorrenciasDoPeriodo,
  OrdemServico,
  PlanoManutencao,
  RecursoDeAgenda,
  SetorManutencao,
} from './tipos.js';

export interface Nomes {
  readonly setores: ReadonlyMap<number, SetorManutencao>;
  readonly unidades: ReadonlyMap<number, string>;
  readonly usuarios: ReadonlyMap<string, string>;
  readonly fornecedores: ReadonlyMap<number, string>;
}

export const reais = (centavos: number): number => Math.round(centavos) / 100;
export const centavos = (r: number): number => Math.round(r * 100);

export function rotuloSetor(n: Nomes, codigo: number): Rotulado<string> {
  return { codigo: String(codigo), nome: n.setores.get(codigo)?.nome ?? `Setor ${codigo}` };
}

const nomeDoUsuario = (n: Nomes, login: string | null): string | null =>
  login === null ? null : (n.usuarios.get(login.trim().toUpperCase()) ?? login);

export function resumoEquipamento(e: EquipamentoManutencao, n: Nomes, planosVencidos: number): EquipamentoResumo {
  return {
    id: e.id,
    versao: e.versao,
    codigo: e.codigo,
    nome: e.nome,
    tipo: e.tipo,
    criticidade: e.criticidade,
    classeRisco: e.classeRisco,
    situacao: e.situacao,
    parado: e.parado,
    setor: rotuloSetor(n, e.centroCusto),
    unidade:
      e.unidade === null
        ? null
        : { codigo: String(e.unidade), nome: n.unidades.get(e.unidade) ?? `Unidade ${e.unidade}` },
    localizacao: e.localizacao,
    planosVencidos,
    osAbertas: e.osAbertas,
  };
}

export function resumoCobertura(c: CoberturaManutencao, n: Nomes, hoje: string): CoberturaResumo {
  return {
    id: c.id,
    numero: c.numero,
    fornecedor: {
      codigo: String(c.fornecedor),
      nome: n.fornecedores.get(c.fornecedor) ?? `Fornecedor ${c.fornecedor}`,
    },
    cobertura: c.cobertura,
    inicio: c.inicio,
    fim: c.fim,
    vigente: c.ativa && vigenteEm(c, hoje),
    slaHoras: c.slaHoras,
  };
}

export function detalheEquipamento(
  e: EquipamentoManutencao,
  n: Nomes,
  x: {
    readonly planosVencidos: number;
    readonly recurso: RecursoDeAgenda | null;
    readonly coberturas: readonly CoberturaManutencao[];
    readonly hoje: string;
  },
): EquipamentoDetalhe {
  return {
    ...resumoEquipamento(e, n, x.planosVencidos),
    fabricante: e.fabricante,
    modelo: e.modelo,
    numeroSerie: e.numeroSerie,
    registroAnvisa: e.registroAnvisa,
    recurso: e.recurso
      ? { tipo: e.recurso.tipo, id: e.recurso.id, nome: x.recurso?.nome ?? `Recurso ${e.recurso.id}` }
      : null,
    bemPatrimonial: e.bemPatrimonial,
    instalacao: e.instalacao,
    garantiaAte: e.garantiaAte,
    coberturas: x.coberturas.map((c) => resumoCobertura(c, n, x.hoje)),
  };
}

export function peloCodigo(e: EquipamentoManutencao, n: Nomes): EquipamentoPeloCodigo {
  return {
    id: e.id,
    codigo: e.codigo,
    nome: e.nome,
    criticidade: e.criticidade,
    situacao: e.situacao,
    setor: rotuloSetor(n, e.centroCusto),
    centroCusto: e.centroCusto,
    parado: e.parado,
    osAbertas: e.osAbertas,
  };
}

/** O que as regras puras do ciclo precisam da OS lida. */
export const osParaAcao = (o: OrdemServico) => ({
  situacao: o.situacao,
  solicitante: o.solicitante,
  tecnico: o.tecnico,
  concluidaEm: o.concluidaEm,
  temParadaAberta: o.paradaInicio !== null && o.paradaFim === null,
});

export function resumoOs(
  o: OrdemServico,
  n: Nomes,
  equipamentos: ReadonlyMap<number, EquipamentoManutencao>,
  sla: Readonly<Record<PrioridadeOs, SlaPrioridade>>,
  agora: string,
): OsResumo {
  const eq = o.equipamento === null ? null : (equipamentos.get(o.equipamento) ?? null);
  const prazos = prazosDaOs(o, sla, agora, o.canceladaEm);
  return {
    id: o.id,
    versao: o.versao,
    numero: o.numero,
    natureza: o.natureza,
    prioridade: o.prioridade,
    situacao: o.situacao,
    equipamento: eq ? { id: eq.id, codigo: eq.codigo, nome: eq.nome } : null,
    critico: eq?.criticidade === 'critica',
    parado: o.paradaInicio !== null && o.paradaFim === null && o.situacao !== 'cancelada',
    setor: rotuloSetor(n, o.centroCusto),
    local: o.local,
    abertaEm: o.registro,
    solicitante: nomeDoUsuario(n, o.solicitante) ?? o.solicitante,
    tecnico: nomeDoUsuario(n, o.tecnico),
    atendimento: prazos.atendimento,
    solucao: prazos.solucao,
  };
}

export function detalheOs(
  o: OrdemServico,
  n: Nomes,
  x: {
    readonly equipamento: EquipamentoManutencao | null;
    readonly recurso: RecursoDeAgenda | null;
    readonly cobertura: CoberturaManutencao | null;
    readonly eventos: readonly EventoOrdem[];
    readonly sla: Readonly<Record<PrioridadeOs, SlaPrioridade>>;
    readonly agora: string;
    readonly quem: QuemAge;
    readonly horasAceite: number;
  },
): OsDetalhe {
  const mapa = new Map(x.equipamento ? [[x.equipamento.id, x.equipamento]] : []);
  const acoes = acoesDisponiveis(osParaAcao(o), x.quem, x.agora, x.horasAceite);
  const paradaAberta = o.paradaInicio !== null && o.paradaFim === null && o.situacao !== 'cancelada';
  const alerta = paradaAberta && x.equipamento ? alertaDeParada(x.equipamento) : null;
  return {
    ...resumoOs(o, n, mapa, x.sla, x.agora),
    descricao: o.descricao,
    prioridadeSugerida: o.prioridadeSugerida,
    contato: o.contato,
    executor: o.executor,
    cobertura: x.cobertura ? resumoCobertura(x.cobertura, n, x.agora.slice(0, 10)) : null,
    paradaInicio: o.paradaInicio,
    paradaFim: o.paradaFim,
    causa: o.causa,
    solucaoTexto: o.solucao,
    inicioReparo: o.inicioReparo,
    fimReparo: o.fimReparo,
    custos: custoDaOs({
      pecas: reais(o.custoPecasCent),
      maoDeObra: reais(o.custoMaoDeObraCent),
      terceiros: reais(o.custoTerceirosCent),
    }),
    laudo: o.laudo,
    eventos: x.eventos.map((e) => ({
      em: e.em,
      ator: nomeDoUsuario(n, e.ator) ?? e.ator,
      de: e.de,
      para: e.para,
      nota: e.nota,
    })),
    souSolicitante: o.solicitante.trim().toUpperCase() === x.quem.login.trim().toUpperCase(),
    // W0-08: a abertura se corrige enquanto ninguém assumiu (quem abriu ou a manutenção).
    podeCorrigir:
      o.situacao === 'aberta' &&
      o.tecnico === null &&
      o.assumidaEm === null &&
      (o.solicitante.trim().toUpperCase() === x.quem.login.trim().toUpperCase() || x.quem.podeAtender),
    // "Reabrir" é a recusa do aceite: na tela, o mesmo botão do encerramento (aceite sim ou não).
    acoes: [...new Set(acoes.map((a) => (a === 'reabrir' ? 'encerrar' : a)))],
    alerta: alerta
      ? {
          setor: rotuloSetor(n, alerta.centroCusto),
          recurso: alerta.recurso
            ? {
                tipo: alerta.recurso.tipo,
                id: alerta.recurso.id,
                nome: x.recurso?.nome ?? `Recurso ${alerta.recurso.id}`,
              }
            : null,
          operacaoBloqueio: alerta.operacaoBloqueio,
        }
      : null,
  };
}

export function painelDoPlano(
  planos: readonly PlanoManutencao[],
  equipamentos: ReadonlyMap<number, EquipamentoManutencao>,
  hoje: string,
  antecedenciaPadrao: number,
): PainelPlano {
  const itens = planos.flatMap((p): (ItemPlanoPainel & { situacao: ItemPlanoPainel['situacao'] })[] => {
    const eq = equipamentos.get(p.equipamento);
    if (!eq || eq.situacao === 'desativado' || !p.ativo) return [];
    const s = situacaoDoPlano(p, hoje, antecedenciaPadrao);
    return [
      {
        plano: p.id,
        versao: p.versao,
        equipamento: { id: eq.id, codigo: eq.codigo, nome: eq.nome },
        criticidade: eq.criticidade,
        atividade: p.atividade,
        periodicidade: p.periodicidade,
        ultimaExecucao: p.ultimaExecucao,
        ultimoResultado: p.ultimoResultado,
        proxima: s.proxima,
        situacao: s.situacao,
        diasParaVencer: s.diasParaVencer,
        exigeLaudo: exigeLaudo(p.atividade),
        modelo: p.modelo ? (p.modelo.codigo as CodigoModeloPlano) : null,
      },
    ];
  });
  const paraOrdenar = itens.map((i) => ({
    ...i,
    situacao: { proxima: i.proxima, situacao: i.situacao, diasParaVencer: i.diasParaVencer },
  }));
  const ordenados = ordenarPainel(paraOrdenar).map((i) => ({ ...i, situacao: i.situacao.situacao }));
  return { hoje, itens: ordenados, resumo: resumoPainel(paraOrdenar) };
}

/** Planos vencidos por equipamento (a coluna da lista). */
export function vencidosPorEquipamento(
  planos: readonly PlanoManutencao[],
  hoje: string,
  antecedenciaPadrao: number,
): Map<number, number> {
  const r = new Map<number, number>();
  for (const p of planos)
    if (p.ativo && situacaoDoPlano(p, hoje, antecedenciaPadrao).situacao === 'vencida')
      r.set(p.equipamento, (r.get(p.equipamento) ?? 0) + 1);
  return r;
}

export function indicadores(
  o: OcorrenciasDoPeriodo,
  periodo: { inicio: string; fim: string },
  agora: string,
): IndicadoresManutencao {
  const r = calcularIndicadores({ ...periodo, agora, ...o });
  return {
    inicio: periodo.inicio,
    fim: periodo.fim,
    equipamentos: r.equipamentos,
    parcelas: r.parcelas,
    disponibilidade: r.disponibilidade,
    mtbf: r.mtbf,
    mttr: r.mttr,
    porEquipamento: r.porEquipamento.map((x) => ({
      equipamento: { id: x.equipamento.id, codigo: x.equipamento.codigo, nome: x.equipamento.nome },
      disponibilidade: x.disponibilidade,
      mtbf: x.mtbf,
      mttr: x.mttr,
      horasParadas: x.parcelas.horasParadas,
      falhas: x.parcelas.falhas,
      reparos: x.parcelas.reparos,
      horasReparo: x.parcelas.horasReparo,
    })),
  };
}
