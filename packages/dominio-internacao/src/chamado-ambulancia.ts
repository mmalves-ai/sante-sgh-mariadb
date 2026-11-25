// Chamado de ambulância (remoção) e maqueiro do transporte interno (C2-068, 04-INT linha 83). Regras puras, sem banco:
//   - o chamado nasce com a categoria pedida e um destino (estabelecimento cadastrado, trajeto padrão ou endereço);
//   - ciclo: solicitado → aprovado (veículo ativo da categoria pedida e a equipe mínima da categoria) ou reprovado
//     (com o motivo); aprovado → em trânsito (saída com o hodômetro, nunca abaixo do registrado no veículo);
//     em trânsito → concluído (fim do trajeto com o hodômetro final); cancelado com motivo só antes da saída;
//   - equipe mínima pela classificação nacional da ambulância (Portaria GM/MS 2.048/2002): tipo A, condutor; tipo B,
//     condutor e técnico de enfermagem ou enfermeiro; tipo D (suporte avançado), condutor, enfermeiro e médico;
//   - a distância cobrada é a rodada pelo hodômetro (final menos inicial); a escolha entre trajeto e quilômetro fica com
//     a regra de cobrança do faturamento (cobrancaRemocao);
//   - maqueiro: profissional habilitado como maqueiro para o transporte interno, ativo, num pedido interno ou de retorno
//     ainda não iniciado, e livre (sem outro transporte em andamento).
import type { ProblemaTransporte } from './transporte-paciente.js';

export const TIPOS_CHAMADO_AMBULANCIA = [
  'remocao_inter_hospitalar',
  'alta_domicilio',
  'exame_externo',
  'resgate',
  'outro',
] as const;
export type TipoChamadoAmbulancia = (typeof TIPOS_CHAMADO_AMBULANCIA)[number];
export const SITUACOES_CHAMADO_AMBULANCIA = [
  'solicitado',
  'aprovado',
  'reprovado',
  'em_transito',
  'concluido',
  'cancelado',
] as const;
export type SituacaoChamadoAmbulancia = (typeof SITUACOES_CHAMADO_AMBULANCIA)[number];
export const FUNCOES_EQUIPE_AMBULANCIA = [
  'condutor',
  'tecnico_enfermagem',
  'enfermeiro',
  'medico',
  'outro',
] as const;
export type FuncaoEquipeAmbulancia = (typeof FUNCOES_EQUIPE_AMBULANCIA)[number];
export const POSICOES_CHAMADO_AMBULANCIA = ['sentado', 'deitado', 'cadeira_rodas', 'maca'] as const;
export type AcaoChamadoAmbulancia = 'aprovar' | 'reprovar' | 'sair' | 'concluir' | 'cancelar';

/** Situações em que o chamado ainda ocupa a fila. */
export const SITUACOES_ABERTAS_CHAMADO: readonly SituacaoChamadoAmbulancia[] = [
  'solicitado',
  'aprovado',
  'em_transito',
];

const FOLGA_MS = 5 * 60_000;

export interface PedidoChamadoAmbulancia {
  readonly tipo: string;
  readonly categoria: number | null;
  readonly destinoExterno: number | null;
  readonly rota: number | null;
  readonly destinoLogradouro: string | null;
  readonly destinoCep: string | null;
  readonly previsto: Date | null;
  readonly agora: Date;
  /** Já há chamado aberto para o mesmo atendimento. */
  readonly abertoNoAtendimento: boolean;
}

/** Confere o pedido do chamado antes de gravar (validação na hora, igual na tela e na API). */
export function conferirChamadoAmbulancia(p: PedidoChamadoAmbulancia): ProblemaTransporte[] {
  const r: ProblemaTransporte[] = [];
  if (!(TIPOS_CHAMADO_AMBULANCIA as readonly string[]).includes(p.tipo))
    r.push({ campo: 'tipo', mensagem: 'Tipo de remoção desconhecido.' });
  if (p.categoria === null) r.push({ campo: 'categoria', mensagem: 'Informe a categoria de ambulância.' });
  if (p.destinoExterno === null && p.rota === null && !p.destinoLogradouro)
    r.push({
      campo: 'destino',
      mensagem: 'Informe o destino: estabelecimento cadastrado, trajeto padrão ou endereço.',
    });
  if (p.destinoCep !== null && !/^\d{8}$/.test(p.destinoCep))
    r.push({ campo: 'destinoCep', mensagem: 'CEP com 8 números.' });
  if (p.previsto && p.previsto.getTime() < p.agora.getTime() - FOLGA_MS)
    r.push({ campo: 'previsto', mensagem: 'A previsão não pode estar no passado.' });
  if (p.abertoNoAtendimento)
    r.push({
      campo: 'atendimento',
      mensagem: 'Já há um chamado de ambulância em aberto para este atendimento.',
    });
  return r;
}

/** Habilitação de transporte do profissional no estabelecimento (função do cadastro, tipo e se está ativa). */
export interface HabilitacaoTransporte {
  readonly funcao: string;
  readonly tipo: string;
  readonly ativo: boolean;
}

export interface MembroEquipeAmbulancia {
  readonly profissional: number;
  readonly funcao: string;
  /** As habilitações de transporte do profissional no estabelecimento do chamado (vazio: nenhuma). */
  readonly habilitacoes: readonly HabilitacaoTransporte[];
}

/** Habilitações do cadastro de transporte que permitem cada função na equipe da ambulância. */
export const HABILITACAO_DA_FUNCAO: Record<FuncaoEquipeAmbulancia, readonly string[]> = {
  condutor: ['motorista'],
  tecnico_enfermagem: ['tecnico_enfermagem'],
  enfermeiro: ['enfermeiro'],
  medico: ['medico'],
  outro: ['socorrista', 'motorista', 'tecnico_enfermagem', 'enfermeiro', 'medico'],
};

/** O profissional tem habilitação ativa, válida para a ambulância, que permite a função declarada. */
export function habilitadoParaFuncao(m: MembroEquipeAmbulancia): boolean {
  const aceitas = HABILITACAO_DA_FUNCAO[m.funcao as FuncaoEquipeAmbulancia] ?? [];
  return m.habilitacoes.some((h) => h.ativo && h.tipo !== 'interno' && aceitas.includes(h.funcao));
}

/** Funções exigidas pela classificação nacional da ambulância; o condutor é sempre exigido. */
export function equipeMinimaAmbulancia(classificacao: string | null): readonly FuncaoEquipeAmbulancia[] {
  if (classificacao === 'B') return ['condutor', 'tecnico_enfermagem'];
  if (classificacao === 'D') return ['condutor', 'enfermeiro', 'medico'];
  return ['condutor'];
}

/**
 * Confere a equipe da remoção: funções válidas, cada membro habilitado (ativo, para a ambulância, no estabelecimento)
 * para a função declarada, sem profissional repetido e com a equipe mínima da categoria.
 */
export function conferirEquipeAmbulancia(
  equipe: readonly MembroEquipeAmbulancia[],
  classificacao: string | null,
): ProblemaTransporte[] {
  const r: ProblemaTransporte[] = [];
  if (equipe.some((m) => !(FUNCOES_EQUIPE_AMBULANCIA as readonly string[]).includes(m.funcao)))
    r.push({ campo: 'equipe', mensagem: 'Função da equipe desconhecida.' });
  for (const m of equipe)
    if ((FUNCOES_EQUIPE_AMBULANCIA as readonly string[]).includes(m.funcao) && !habilitadoParaFuncao(m))
      r.push({
        campo: 'equipe',
        mensagem: `Um profissional da equipe não está habilitado neste estabelecimento para atuar como ${ROTULO_HABILITACAO[m.funcao as FuncaoEquipeAmbulancia]} na ambulância.`,
      });
  if (new Set(equipe.map((m) => m.profissional)).size !== equipe.length)
    r.push({ campo: 'equipe', mensagem: 'O mesmo profissional aparece duas vezes na equipe.' });
  const tem = new Set(equipe.map((m) => m.funcao));
  for (const f of equipeMinimaAmbulancia(classificacao)) {
    // No tipo B, o enfermeiro supre o técnico de enfermagem.
    const ok = tem.has(f) || (f === 'tecnico_enfermagem' && tem.has('enfermeiro'));
    if (!ok)
      r.push({
        campo: 'equipe',
        mensagem: `A ambulância ${classificacao ? `tipo ${classificacao} ` : ''}exige ${ROTULO_FUNCAO[f]} na equipe.`,
      });
  }
  return r;
}

const ROTULO_HABILITACAO: Record<FuncaoEquipeAmbulancia, string> = {
  condutor: 'condutor (motorista)',
  tecnico_enfermagem: 'técnico de enfermagem',
  enfermeiro: 'enfermeiro',
  medico: 'médico',
  outro: 'outro profissional',
};

const ROTULO_FUNCAO: Record<FuncaoEquipeAmbulancia, string> = {
  condutor: 'o condutor',
  tecnico_enfermagem: 'técnico de enfermagem ou enfermeiro',
  enfermeiro: 'o enfermeiro',
  medico: 'o médico',
  outro: 'outro profissional',
};

export interface VeiculoChamado {
  readonly categoria: number;
  readonly ativo: boolean;
  readonly quilometragemAtual: number | null;
}

export interface AcaoNoChamado {
  readonly acao: AcaoChamadoAmbulancia;
  readonly situacao: string;
  readonly categoriaPedida: number;
  readonly classificacao: string | null;
  readonly veiculo: VeiculoChamado | null;
  readonly equipe?: readonly MembroEquipeAmbulancia[];
  readonly motivoReprovacao?: string | null;
  readonly motivoCancelamento?: number | null;
  readonly saida?: Date | null;
  readonly kmInicial?: number | null;
  readonly fim?: Date | null;
  readonly kmFinal?: number | null;
  readonly agora: Date;
}

const DE: Record<AcaoChamadoAmbulancia, readonly string[]> = {
  aprovar: ['solicitado'],
  reprovar: ['solicitado'],
  sair: ['aprovado'],
  concluir: ['em_transito'],
  cancelar: ['solicitado', 'aprovado'],
};
const PARA: Record<AcaoChamadoAmbulancia, SituacaoChamadoAmbulancia> = {
  aprovar: 'aprovado',
  reprovar: 'reprovado',
  sair: 'em_transito',
  concluir: 'concluido',
  cancelar: 'cancelado',
};
const PROIBIDO: Record<AcaoChamadoAmbulancia, string> = {
  aprovar: 'Só o chamado solicitado pode ser aprovado.',
  reprovar: 'Só o chamado solicitado pode ser reprovado.',
  sair: 'A saída só vale para o chamado aprovado.',
  concluir: 'Só o chamado em trânsito pode ser concluído.',
  cancelar: 'O chamado só pode ser cancelado antes da saída da ambulância.',
};

/** Confere uma ação do ciclo do chamado; devolve a situação nova ou os problemas. */
export function conferirAcaoChamado(e: AcaoNoChamado): {
  situacao: SituacaoChamadoAmbulancia | null;
  problemas: ProblemaTransporte[];
} {
  const r: ProblemaTransporte[] = [];
  if (!DE[e.acao].includes(e.situacao)) r.push({ campo: 'situacao', mensagem: PROIBIDO[e.acao] });
  const futuro = (d: Date | null | undefined) => !!d && d.getTime() > e.agora.getTime() + FOLGA_MS;
  if (e.acao === 'aprovar') {
    if (!e.veiculo) r.push({ campo: 'ambulancia', mensagem: 'Escolha a ambulância que vai atender.' });
    else if (!e.veiculo.ativo) r.push({ campo: 'ambulancia', mensagem: 'A ambulância está inativa.' });
    else if (e.veiculo.categoria !== e.categoriaPedida)
      r.push({ campo: 'ambulancia', mensagem: 'A ambulância não é da categoria pedida.' });
    r.push(...conferirEquipeAmbulancia(e.equipe ?? [], e.classificacao));
  }
  if (e.acao === 'reprovar' && !e.motivoReprovacao)
    r.push({ campo: 'motivo', mensagem: 'Informe o motivo da reprovação.' });
  if (e.acao === 'cancelar' && !e.motivoCancelamento)
    r.push({ campo: 'motivo', mensagem: 'Informe o motivo do cancelamento.' });
  if (e.acao === 'sair') {
    if (e.kmInicial === null || e.kmInicial === undefined || e.kmInicial < 0)
      r.push({ campo: 'kmInicial', mensagem: 'Informe o hodômetro na saída.' });
    else if (e.veiculo?.quilometragemAtual != null && e.kmInicial < e.veiculo.quilometragemAtual)
      r.push({
        campo: 'kmInicial',
        mensagem: `O hodômetro da saída não pode ser menor que o último registrado no veículo (${e.veiculo.quilometragemAtual} km).`,
      });
    if (futuro(e.saida)) r.push({ campo: 'saida', mensagem: 'A saída não pode estar no futuro.' });
  }
  if (e.acao === 'concluir') {
    if (e.kmFinal === null || e.kmFinal === undefined)
      r.push({ campo: 'kmFinal', mensagem: 'Informe o hodômetro no fim do trajeto.' });
    else if (e.kmInicial !== null && e.kmInicial !== undefined && e.kmFinal < e.kmInicial)
      r.push({ campo: 'kmFinal', mensagem: 'O hodômetro final não pode ser menor que o da saída.' });
    if (e.fim && e.saida && e.fim.getTime() < e.saida.getTime())
      r.push({ campo: 'fim', mensagem: 'O fim do trajeto não pode ser antes da saída.' });
    if (futuro(e.fim)) r.push({ campo: 'fim', mensagem: 'O fim do trajeto não pode estar no futuro.' });
  }
  return r.length ? { situacao: null, problemas: r } : { situacao: PARA[e.acao], problemas: [] };
}

/** Quilômetros rodados pelo hodômetro (null sem as duas leituras). */
export function quilometrosRodados(kmInicial: number | null, kmFinal: number | null): number | null {
  if (kmInicial === null || kmFinal === null || kmFinal < kmInicial) return null;
  return kmFinal - kmInicial;
}

const ORDEM_FILA: Record<string, number> = { em_transito: 0, aprovado: 1, solicitado: 2 };

/** Fila do chamado: em trânsito, aprovados e solicitados; dentro de cada um, a previsão mais próxima. */
export function ordenarFilaChamados<
  T extends { situacao: string; previsto: string | null; solicitado: string; id: number },
>(itens: readonly T[]): T[] {
  const t = (s: string | null) => (s ? Date.parse(s) : Number.MAX_SAFE_INTEGER);
  return [...itens].sort(
    (a, b) =>
      (ORDEM_FILA[a.situacao] ?? 9) - (ORDEM_FILA[b.situacao] ?? 9) ||
      t(a.previsto ?? a.solicitado) - t(b.previsto ?? b.solicitado) ||
      a.id - b.id,
  );
}

export interface DesignacaoMaqueiro {
  readonly tipoPedido: string;
  readonly situacaoPedido: string;
  /** O cadastro de transporte do profissional (null: não habilitado). */
  readonly habilitacao: { funcao: string; tipo: string; ativo: boolean } | null;
  /** Transportes em andamento com o mesmo maqueiro, fora este pedido. */
  readonly emAndamento: number;
}

/** Confere a designação do maqueiro num pedido de transporte interno. */
export function conferirMaqueiro(d: DesignacaoMaqueiro): ProblemaTransporte[] {
  const r: ProblemaTransporte[] = [];
  if (d.tipoPedido !== 'interno' && d.tipoPedido !== 'retorno')
    r.push({
      campo: 'transporte',
      mensagem: 'O maqueiro é designado só no transporte interno ou no retorno.',
    });
  if (d.situacaoPedido !== 'solicitado' && d.situacaoPedido !== 'agendado')
    r.push({ campo: 'transporte', mensagem: 'O maqueiro é designado antes da saída do paciente.' });
  if (!d.habilitacao || d.habilitacao.funcao !== 'maqueiro')
    r.push({ campo: 'maqueiro', mensagem: 'O profissional não está habilitado como maqueiro.' });
  else if (!d.habilitacao.ativo)
    r.push({ campo: 'maqueiro', mensagem: 'A habilitação do maqueiro está inativa.' });
  else if (d.habilitacao.tipo === 'ambulancia')
    r.push({ campo: 'maqueiro', mensagem: 'O maqueiro está habilitado só para a ambulância.' });
  if (d.emAndamento > 0)
    r.push({ campo: 'maqueiro', mensagem: 'O maqueiro está em outro transporte em andamento.' });
  return r;
}
