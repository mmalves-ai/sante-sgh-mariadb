// M60, etapa 1: regras puras do ensaio da primeira aplicação (ficha do M60, M60-F1 e regras 1 a 3). O ensaio cria
// uma cópia limpa do banco atual numa porta própria (a partir da matriz de ../banco-dev, sem nenhum objeto SGH_),
// abre sessões que simulam o sistema anterior em uso (leem e gravam tabelas legadas, sempre desfeitas), aplica
// todos os scripts SGH_, mede, compara e recolhe. Aqui ficam o limite de espera de trava, a comparação de
// contagens e de impressão digital e o veredito de cada critério de aceite; a orquestração (cópia, sessões,
// MON$) usa estas peças.

/**
 * POL-5 (decisão do construtor, regra 3): nenhuma operação das sessões legadas pode esperar mais de 2 s por
 * trava durante a aplicação. Fundamento: os scripts SGH_ só criam objetos novos e alteram tabelas SGH_, então
 * nenhuma espera é esperada; 2 s fica abaixo do que um usuário do balcão percebe como travamento e acima do
 * ruído de E/S de uma cópia de 48 GB. As sessões rodam com LOCK TIMEOUT igual ao limite (estourar = falha).
 */
export const LIMITE_ESPERA_TRAVA_MS = 2000;

/** Uma operação de uma sessão legada (leitura ou gravação desfeita) com o tempo de parede. */
export interface AmostraSessao {
  readonly sessao: number;
  readonly operacao: 'leitura' | 'gravacao';
  readonly ms: number;
  /** Erro da operação (ex.: lock time-out); só o código/nome, nunca dado de linha. */
  readonly erro?: string;
}

export interface AvaliacaoEsperas {
  readonly operacoes: number;
  readonly maiorMs: number;
  readonly acimaDoLimite: number;
  readonly comErro: number;
  readonly ok: boolean;
}

export function avaliarEsperas(
  amostras: readonly AmostraSessao[],
  limiteMs = LIMITE_ESPERA_TRAVA_MS,
): AvaliacaoEsperas {
  const maiorMs = amostras.reduce((m, a) => Math.max(m, a.ms), 0);
  const acimaDoLimite = amostras.filter((a) => a.ms > limiteMs).length;
  const comErro = amostras.filter((a) => a.erro !== undefined).length;
  return {
    operacoes: amostras.length,
    maiorMs,
    acimaDoLimite,
    comErro,
    // Sem operação nenhuma, o ensaio não provou nada: falha.
    ok: amostras.length > 0 && acimaDoLimite === 0 && comErro === 0,
  };
}

/**
 * Amostra do MON$STATEMENTS durante a aplicação: comandos das sessões legadas parados (MON$STATE = 2, à
 * espera de recurso) e há quanto tempo. Um comando parado acima do limite reprova o ensaio.
 */
export interface AmostraMon {
  readonly instante: number;
  readonly paradosLegados: number;
  readonly maiorParadoMs: number;
}

export function avaliarMon(amostras: readonly AmostraMon[], limiteMs = LIMITE_ESPERA_TRAVA_MS) {
  const maiorParadoMs = amostras.reduce((m, a) => Math.max(m, a.maiorParadoMs), 0);
  return { amostras: amostras.length, maiorParadoMs, ok: amostras.length > 0 && maiorParadoMs <= limiteMs };
}

export type Contagens = Readonly<Record<string, number>>;

/** Tabelas legadas cuja contagem mudou entre o antes e o depois (as sessões só gravam desfazendo). */
export function compararContagens(antes: Contagens, depois: Contagens): string[] {
  const nomes = [...new Set([...Object.keys(antes), ...Object.keys(depois)])].sort();
  return nomes.filter((n) => antes[n] !== depois[n]);
}

/** Contagem para relatório: abaixo de 5 vira "<5" (regra de privacidade da obra). */
export function contagemPublica(n: number): string {
  return n < 5 ? '<5' : String(n);
}

export interface EntradaVeredito {
  readonly copiaLimpa: { readonly objetosSghAntes: number };
  readonly aplicacao: { readonly ok: boolean; readonly scripts: number; readonly totalMs: number };
  readonly impressaoLegadaAntes: string;
  readonly impressaoLegadaDepois: string;
  readonly contagensAntes: Contagens;
  readonly contagensDepois: Contagens;
  readonly esperas: AvaliacaoEsperas;
  readonly mon: ReturnType<typeof avaliarMon>;
  readonly recolhimento: {
    readonly ok: boolean;
    readonly impressaoCompletaAntes: string;
    readonly impressaoCompletaDepois: string;
    readonly objetosSghDepois: number;
  };
  /** M60.1: o próprio `sgh:aplicar` (simulação, contas, `--relatorio` e `--recolher`) na cópia limpa. */
  readonly cli: ConferenciaCli;
}

export interface Criterio {
  readonly nome: string;
  readonly ok: boolean;
  readonly detalhe: string;
}

/** Critérios de aceite da migração (ficha do M60, seção 7) e o veredito. */
export function vereditoDoEnsaio(e: EntradaVeredito): { ok: boolean; criterios: Criterio[] } {
  const mudaram = compararContagens(e.contagensAntes, e.contagensDepois);
  const criterios: Criterio[] = [
    {
      nome: 'cópia limpa',
      ok: e.copiaLimpa.objetosSghAntes === 0,
      detalhe: `${e.copiaLimpa.objetosSghAntes} objeto(s) SGH_ antes da aplicação`,
    },
    {
      nome: 'aplicação completa',
      ok: e.aplicacao.ok && e.aplicacao.scripts > 0,
      detalhe: `${e.aplicacao.scripts} script(s) em ${Math.round(e.aplicacao.totalMs)} ms`,
    },
    {
      nome: 'impressão legada idêntica',
      ok: e.impressaoLegadaAntes !== '' && e.impressaoLegadaAntes === e.impressaoLegadaDepois,
      detalhe: e.impressaoLegadaAntes === e.impressaoLegadaDepois ? 'igual' : 'diferente',
    },
    {
      nome: 'contagens legadas iguais',
      ok: Object.keys(e.contagensAntes).length > 0 && mudaram.length === 0,
      detalhe:
        mudaram.length === 0
          ? `${Object.keys(e.contagensAntes).length} tabela(s) iguais`
          : `mudaram: ${mudaram.join(', ')}`,
    },
    {
      nome: 'nenhuma espera longa',
      ok: e.esperas.ok && e.mon.ok,
      detalhe: `${e.esperas.operacoes} operação(ões), maior ${Math.round(e.esperas.maiorMs)} ms, ${e.esperas.acimaDoLimite} acima de ${LIMITE_ESPERA_TRAVA_MS} ms, ${e.esperas.comErro} com erro; MON$ maior parado ${Math.round(e.mon.maiorParadoMs)} ms em ${e.mon.amostras} amostra(s)`,
    },
    {
      nome: 'recolhimento volta ao estado inicial',
      ok:
        e.recolhimento.ok &&
        e.recolhimento.objetosSghDepois === 0 &&
        e.recolhimento.impressaoCompletaAntes !== '' &&
        e.recolhimento.impressaoCompletaAntes === e.recolhimento.impressaoCompletaDepois,
      detalhe: `${e.recolhimento.objetosSghDepois} objeto(s) SGH_ depois; impressão ${
        e.recolhimento.impressaoCompletaAntes === e.recolhimento.impressaoCompletaDepois
          ? 'igual'
          : 'diferente'
      } à de antes`,
    },
    ...criteriosDoCli(e.cli),
  ];
  return { ok: criterios.every((c) => c.ok), criterios };
}

/** Linha e relatório do `sgh:aplicar --relatorio=<arquivo>.json` (o ensaio lê o JSON; ferramentas não se importam). */
export interface LinhaCli {
  readonly numero?: number;
  readonly item: string;
  readonly hash?: string;
  readonly ms: number | null;
  readonly resultado: string;
}

export interface RelatorioCli {
  readonly modo: string;
  readonly totalMs: number;
  readonly resultado: 'ok' | 'falhou';
  readonly erro?: string;
  readonly linhas: readonly LinhaCli[];
  readonly resumo: string;
}

export interface ConferenciaCli {
  /** `--simular` antes da aplicação, com a conta de leitura. */
  readonly simulacaoAntes: RelatorioCli;
  /** A ordem e o hash esperados (ordemDeAplicacao dos scripts do repositório). */
  readonly ordemEsperada: readonly { readonly numero: number; readonly hash: string }[];
  readonly objetosSghDepoisDaSimulacao: number;
  /** A aplicação pelo CLI, com a conta da aplicação e a de leitura. */
  readonly aplicacao: RelatorioCli;
  /** RDB$USER_PRIVILEGES: papel SGH_APLICACAO na conta da aplicação; SELECT em SGH_VERSAO_SCRIPT na de leitura. */
  readonly papelConcedido: boolean;
  readonly leituraConcedida: boolean;
  /** `--simular` depois da aplicação, com a conta de leitura (só lê os registros com o SELECT concedido). */
  readonly simulacaoDepois: RelatorioCli;
  readonly recolhimento: RelatorioCli;
}

/** Onde a lista simulada se afasta da esperada (vazio = mesma ordem, mesmo hash, tudo "a aplicar"). */
export function divergenciasDaSimulacao(
  linhas: readonly LinhaCli[],
  esperada: ConferenciaCli['ordemEsperada'],
): string[] {
  const d: string[] = [];
  if (linhas.length !== esperada.length) d.push(`${linhas.length} pendente(s), esperados ${esperada.length}`);
  for (let i = 0; i < Math.min(linhas.length, esperada.length); i++) {
    const l = linhas[i]!;
    const e = esperada[i]!;
    if (l.numero !== e.numero) d.push(`posição ${i + 1}: ${l.numero ?? '-'} em vez de ${e.numero}`);
    else if (l.hash !== e.hash) d.push(`${e.numero}: hash diferente`);
    else if (!l.resultado.startsWith('a aplicar')) d.push(`${e.numero}: ${l.resultado}`);
    if (d.length >= 5) break;
  }
  return d;
}

export function criteriosDoCli(c: ConferenciaCli): Criterio[] {
  const div = divergenciasDaSimulacao(c.simulacaoAntes.linhas, c.ordemEsperada);
  const depois = c.simulacaoDepois;
  const ap = c.aplicacao;
  const rec = c.recolhimento;
  const comTempo = ap.linhas.filter((l) => l.ms !== null).length;
  return [
    {
      nome: 'simulação na cópia limpa (conta de leitura)',
      ok:
        c.simulacaoAntes.resultado === 'ok' &&
        c.ordemEsperada.length > 0 &&
        div.length === 0 &&
        c.objetosSghDepoisDaSimulacao === 0,
      detalhe:
        c.simulacaoAntes.resultado !== 'ok'
          ? `falhou: ${c.simulacaoAntes.erro ?? 'sem erro'}`
          : div.length > 0
            ? div.join('; ')
            : `${c.simulacaoAntes.linhas.length} pendente(s) na ordem de aplicação, com o hash; ${c.objetosSghDepoisDaSimulacao} objeto(s) SGH_ depois (nada gravado)`,
    },
    {
      nome: 'contas da aplicação e de leitura',
      ok: c.papelConcedido && c.leituraConcedida && depois.resultado === 'ok' && depois.linhas.length === 0,
      detalhe: `papel SGH_APLICACAO ${c.papelConcedido ? 'concedido' : 'AUSENTE'}; SELECT em SGH_VERSAO_SCRIPT ${
        c.leituraConcedida ? 'concedido' : 'AUSENTE'
      }; simulação depois pela conta de leitura: ${
        depois.resultado === 'ok' ? `${depois.linhas.length} pendente(s)` : `falhou (${depois.erro ?? ''})`
      }`,
    },
    {
      nome: 'relatórios do sgh:aplicar (--relatorio e --recolher)',
      ok:
        ap.resultado === 'ok' &&
        ap.linhas.length === c.ordemEsperada.length &&
        comTempo === ap.linhas.length &&
        rec.resultado === 'ok' &&
        rec.linhas.length > 0,
      detalhe: `aplicação: ${ap.resultado}, ${ap.linhas.length} linha(s), ${comTempo} com tempo, total ${Math.round(
        ap.totalMs,
      )} ms; recolhimento: ${rec.resultado}, ${rec.linhas.length} comando(s) em ${Math.round(rec.totalMs)} ms`,
    },
  ];
}

/** Porta da cópia limpa do ensaio: própria, em loopback, nunca as compartilhadas nem as ocupadas. */
export const PORTA_ENSAIO_PADRAO = 3361;

export function conferirPortaDoEnsaio(porta: number, ocupadas: readonly number[]): void {
  if (!Number.isInteger(porta) || porta < 1024 || porta > 65535) throw new Error('Porta do ensaio inválida.');
  if ([3351, 3352].includes(porta)) {
    throw new Error(`A porta ${porta} é de uma cópia compartilhada: o ensaio usa uma porta própria.`);
  }
  if (ocupadas.includes(porta)) throw new Error(`A porta ${porta} está ocupada por outro projeto.`);
}
