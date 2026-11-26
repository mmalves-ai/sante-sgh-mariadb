// Ciclo de esterilização pelos testes de cada indicador e rejeição no reprocessamento (CME; F7, 04-CME linha 116;
// RDC 15/2012 da ANVISA, arts. 96 a 99 e 104). Regras puras:
//   - o teste de um indicador (físico, químico por classe, biológico, Bowie-Dick) com lote e validade do indicador,
//     incubação, leitura, responsável e controle positivo do biológico;
//   - os indicadores do ciclo saem dos testes registrados: a liberação só acontece com indicador APROVADO em cada
//     categoria exigida (físico e químico sempre; biológico na carga com implante); um teste reprovado de indicador de
//     que a liberação depende reprova a carga; o inconclusivo não libera (repete-se o teste);
//   - a rejeição de pacote ou de ciclo: motivo, fase, retorno ao reprocessamento e o recolhimento dos pacotes já
//     distribuídos do mesmo ciclo (recall).
// A porta reconfere tudo no banco e nunca apaga.
import type { Indicadores, ProblemaCme, ResultadoIndicador } from './cme.js';

export const CATEGORIAS_INDICADOR = ['fisico', 'quimico', 'biologico', 'bowie_dick'] as const;
export type CategoriaIndicador = (typeof CATEGORIAS_INDICADOR)[number];
export const RESULTADOS_TESTE = ['pendente', 'aprovado', 'reprovado', 'inconclusivo'] as const;
export type ResultadoTeste = (typeof RESULTADOS_TESTE)[number];

export interface TesteEntrada {
  readonly categoria: CategoriaIndicador;
  readonly exigeLote: boolean;
  readonly exigeControle: boolean;
  readonly resultado: ResultadoTeste;
  readonly lote: string | null;
  /** AAAA-MM-DD. */
  readonly validade: string | null;
  /** Dia do início do ciclo (AAAA-MM-DD), para a validade do indicador. */
  readonly diaDoCiclo: string;
  readonly incubacaoInicio: string | null;
  readonly leitura: string | null;
  readonly controlePositivoOk: boolean | null;
  readonly valorMedido: string | null;
  /** Situação atual do ciclo. */
  readonly situacaoCiclo: string;
}

/** Confere o registro do teste de um indicador. */
export function conferirTeste(t: TesteEntrada): ProblemaCme[] {
  const p: ProblemaCme[] = [];
  if (t.situacaoCiclo !== 'em_andamento' && t.situacaoCiclo !== 'concluido')
    p.push({ campo: 'ciclo', mensagem: 'Só o ciclo em andamento ou aguardando liberação recebe teste.' });
  if (t.exigeLote && !t.lote?.trim())
    p.push({ campo: 'lote', mensagem: 'Informe o lote do indicador.' });
  if (t.validade && t.validade < t.diaDoCiclo)
    p.push({ campo: 'validade', mensagem: 'O indicador estava vencido no dia do ciclo.' });
  if (t.resultado !== 'pendente' && !t.leitura)
    p.push({ campo: 'leitura', mensagem: 'Informe a hora da leitura do resultado.' });
  if (t.leitura && t.incubacaoInicio && t.leitura < t.incubacaoInicio)
    p.push({ campo: 'leitura', mensagem: 'A leitura não pode ser antes do início da incubação.' });
  if (t.categoria === 'biologico' && t.resultado !== 'pendente' && !t.incubacaoInicio)
    p.push({ campo: 'incubacaoInicio', mensagem: 'Informe o início da incubação do indicador biológico.' });
  if (t.exigeControle && t.resultado === 'aprovado' && t.controlePositivoOk !== true)
    p.push({
      campo: 'controlePositivoOk',
      mensagem: 'O indicador de controle (não processado) precisa ter crescido para valer a leitura.',
    });
  if (t.categoria === 'fisico' && t.resultado !== 'pendente' && !t.valorMedido?.trim())
    p.push({ campo: 'valorMedido', mensagem: 'Informe a leitura física (temperatura, pressão ou tempo).' });
  return p;
}

export interface TesteRegistrado {
  readonly categoria: CategoriaIndicador;
  readonly resultado: ResultadoTeste;
  /** A carga só é liberada com este indicador aprovado. */
  readonly liberacaoDepende: boolean;
  /**
   * Tipo do indicador. Os testes chegam na ordem do registro: em cada tipo vale o último (o teste repetido depois do
   * inconclusivo, a leitura registrada depois do biológico posto a incubar). Sem tipo, a categoria agrupa.
   */
  readonly tipo?: number;
}

function situacaoDaCategoria(testes: readonly TesteRegistrado[]): ResultadoIndicador {
  const valem = testes.filter((t) => t.liberacaoDepende);
  // Reprovado não se desfaz com repetição: a carga do indicador reprovado está reprovada.
  if (valem.some((t) => t.resultado === 'reprovado')) return 'nao_conforme';
  const ultimoPorTipo = new Map<number | string, ResultadoTeste>();
  for (const t of valem) ultimoPorTipo.set(t.tipo ?? t.categoria, t.resultado);
  const ultimos = [...ultimoPorTipo.values()];
  if (ultimos.length && ultimos.every((r) => r === 'aprovado')) return 'conforme';
  return 'pendente';
}

/**
 * Os indicadores do ciclo pelos testes registrados. O Bowie-Dick (teste de remoção do ar da autoclave) conta junto do
 * físico: reprovado, reprova; aprovado não substitui a leitura física do ciclo.
 */
export function indicadoresDosTestes(testes: readonly TesteRegistrado[]): Indicadores {
  const de = (c: CategoriaIndicador) => testes.filter((t) => t.categoria === c);
  const bowie = situacaoDaCategoria(de('bowie_dick'));
  const fisico = situacaoDaCategoria(de('fisico'));
  return {
    fisico: bowie === 'nao_conforme' ? 'nao_conforme' : fisico,
    quimico: situacaoDaCategoria(de('quimico')),
    biologico: situacaoDaCategoria(de('biologico')),
  };
}

// ── Rejeição no reprocessamento ──────────────────────────────────────────────────────────────────────────────────

export interface RejeicaoEntrada {
  readonly objeto: 'pacote' | 'ciclo';
  /** Situação atual do pacote ou do ciclo. */
  readonly situacao: string;
  readonly motivoAtivo: boolean;
  /** Fase a que o motivo se restringe (nulo: qualquer fase). */
  readonly faseDoMotivo: number | null;
  readonly fase: number;
  readonly retorna: boolean;
  readonly faseRetorno: number | null;
  /** Ordem da fase da rejeição e da de retorno, para o retorno não pular para frente. */
  readonly ordemFase: number;
  readonly ordemRetorno: number | null;
  readonly descricao: string | null;
}

const PACOTE_REJEITAVEL = ['em_preparo', 'aguardando_esterilizacao', 'esteril', 'distribuido', 'vencido'];
const CICLO_REJEITAVEL = ['concluido', 'liberado'];

export function conferirRejeicao(r: RejeicaoEntrada): ProblemaCme[] {
  const p: ProblemaCme[] = [];
  if (r.objeto === 'pacote' && !PACOTE_REJEITAVEL.includes(r.situacao))
    p.push({ campo: 'pacote', mensagem: 'O pacote usado, rejeitado ou descartado não é rejeitado de novo.' });
  if (r.objeto === 'ciclo' && !CICLO_REJEITAVEL.includes(r.situacao))
    p.push({ campo: 'ciclo', mensagem: 'Só o ciclo concluído ou liberado é rejeitado (o em andamento se conclui).' });
  if (!r.motivoAtivo) p.push({ campo: 'motivo', mensagem: 'Escolha um motivo de rejeição ativo.' });
  if (r.faseDoMotivo !== null && r.faseDoMotivo !== r.fase)
    p.push({ campo: 'fase', mensagem: 'Este motivo não se aplica à fase escolhida.' });
  if (r.retorna && r.faseRetorno === null)
    p.push({ campo: 'faseRetorno', mensagem: 'Informe a fase para onde o material volta.' });
  if (r.retorna && r.ordemRetorno !== null && r.ordemRetorno > r.ordemFase)
    p.push({ campo: 'faseRetorno', mensagem: 'O material rejeitado volta a uma fase anterior ou à mesma.' });
  if (r.objeto === 'ciclo' && !r.descricao?.trim())
    p.push({ campo: 'descricao', mensagem: 'Descreva a causa da rejeição do ciclo.' });
  return p;
}

/**
 * Exige recolhimento quando o motivo o obriga ou quando a rejeição é do ciclo e já há pacote distribuído dele: os
 * pacotes que saíram da CME voltam (recall) antes de a rejeição se concluir.
 */
export function exigeRecolhimento(objeto: 'pacote' | 'ciclo', motivoExige: boolean, distribuidos: number): boolean {
  return distribuidos > 0 && (motivoExige || objeto === 'ciclo');
}

/** Situação inicial da rejeição. */
export function situacaoDaRejeicao(recolher: boolean): 'aberta' | 'em_recolhimento' | 'concluida' {
  return recolher ? 'em_recolhimento' : 'concluida';
}

/** O recolhimento de um pacote distribuído do ciclo rejeitado: volta à CME e fica rejeitado. */
export function conferirRecolhimento(situacaoRejeicao: string, situacaoPacote: string): ProblemaCme[] {
  if (situacaoRejeicao !== 'em_recolhimento')
    return [{ campo: 'rejeicao', mensagem: 'Só a rejeição em recolhimento recebe pacote de volta.' }];
  if (situacaoPacote !== 'distribuido')
    return [{ campo: 'pacote', mensagem: 'Só o pacote distribuído (fora da CME) é recolhido.' }];
  return [];
}
