// Regra 3 do M58 (cap-15 §15.3.5; padrão aprovado da DP-5): duas semanas sem sessão de pessoa no outro sistema, fora
// das contas técnicas e de contingência combinadas e dos grupos que não são pessoa. A tabela de conexões do outro
// sistema guarda só a ÚLTIMA conexão por usuário e módulo, com data sem hora (regra 3 do M43): a série por dia conta
// as pessoas cuja última conexão caiu naquele dia, e por isso só mostra a queda (é um limite inferior do uso diário).
// Para o critério basta: nenhuma pessoa com última conexão dentro da janela. O mesmo cálculo serve aos 30 dias do
// cap-14 §14.9.4, mostrados ao lado (regra 2 do M43).
import {
  JANELA_SEM_SESSAO_DIAS,
  JANELA_SEM_SESSAO_DIAS_CAP14,
  type SessoesOutroSistema,
} from '@sgh/contratos';

export interface PessoasPorDia {
  /** AAAA-MM-DD. */
  readonly dia: string;
  readonly pessoas: number;
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const somarDias = (d: string, n: number) => new Date(ms(d) + n * 86_400_000).toISOString().slice(0, 10);

/** O primeiro dia da janela que termina em `hoje` (inclusive): 14 dias = hoje e os 13 anteriores. */
export function inicioDaJanela(hoje: string, janelaDias: number): string {
  if (!DIA.test(hoje) || !Number.isInteger(janelaDias) || janelaDias < 1) {
    throw new Error('Janela de sessões inválida.');
  }
  return somarDias(hoje, -(janelaDias - 1));
}

/**
 * Avalia o critério sobre a série agregada (logins distintos por dia da última conexão, já sem as contas excluídas).
 * Dias fora de ordem ou repetidos são somados; dias depois de `hoje` (relógio adiantado do outro lado) contam como
 * dentro da janela, para nunca declarar o critério cumprido por engano. A soma da série conta duas vezes quem usou
 * dois módulos em dias diferentes: `distintosNaJanela` (COUNT DISTINCT da leitura) dá o número exato; o critério
 * (zero ou não) é o mesmo pelas duas contas.
 */
export function avaliarSessoes(
  porDia: readonly PessoasPorDia[],
  hoje: string,
  janelaDias = JANELA_SEM_SESSAO_DIAS,
  distintosNaJanela?: number,
): SessoesOutroSistema {
  const inicio = inicioDaJanela(hoje, janelaDias);
  const inicio30 = inicioDaJanela(hoje, Math.max(janelaDias, JANELA_SEM_SESSAO_DIAS_CAP14));
  const somados = new Map<string, number>();
  for (const x of porDia) {
    if (!DIA.test(x.dia) || !Number.isInteger(x.pessoas) || x.pessoas < 0) {
      throw new Error(`Dia de sessões inválido: ${x.dia}.`);
    }
    somados.set(x.dia, (somados.get(x.dia) ?? 0) + x.pessoas);
  }
  const serie = [...somados.entries()]
    .filter(([d]) => d >= inicio30)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dia, pessoas]) => ({ dia, pessoas }));
  const comSessao = [...somados.entries()].filter(([, n]) => n > 0).map(([d]) => d);
  const ultima = comSessao.length ? comSessao.reduce((m, d) => (d > m ? d : m)) : null;
  const soma = serie.filter((x) => x.dia >= inicio).reduce((s, x) => s + x.pessoas, 0);
  if (distintosNaJanela !== undefined && distintosNaJanela > 0 !== soma > 0) {
    throw new Error('Contagem distinta da janela não casa com a série.');
  }
  const pessoasNaJanela = distintosNaJanela ?? soma;
  const pessoas30 = serie.reduce((s, x) => s + x.pessoas, 0);
  const diasSemSessao =
    ultima === null ? null : Math.max(0, Math.round((ms(hoje) - ms(ultima)) / 86_400_000));
  return {
    janelaDias,
    porDia: serie.filter((x) => x.dia >= inicio),
    pessoasNaJanela,
    diasSemSessao,
    cumprido: pessoasNaJanela === 0,
    cumpridoCap14: pessoas30 === 0,
  };
}

/**
 * Os logins que ficam fora da contagem: as contas técnicas e de contingência combinadas (lista do estabelecimento,
 * registrada pelo M43 em Autorizações e guardada fora do repositório) normalizadas como o outro sistema as grava.
 * Teto de 200 (a consulta monta um IN com elas).
 */
export function loginsExcluidos(lista: readonly string[]): string[] {
  const u = [...new Set(lista.map((x) => x.trim().toUpperCase()).filter(Boolean))];
  if (u.length > 200) throw new Error('Lista de contas excluídas acima de 200.');
  return u.sort();
}
