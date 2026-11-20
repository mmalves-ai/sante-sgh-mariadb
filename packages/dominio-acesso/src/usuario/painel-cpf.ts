// W1-01 (parte 3c): monta o painel de identidade única (contas pessoais ativas sem CPF e logins que repartem o
// mesmo CPF) a partir do que o adaptador leu. Puro e só de consulta: corrigir é pela ficha (troca de CPF com
// justificativa) ou pelo bloqueio. As contas de dispositivo e integração (grupos dispensados; hoje o grupo dos
// painéis) não têm pessoa por trás: ficam fora do "sem CPF" e só entram na contagem.
import { chaveGrupo } from '../mapa-grupos.js';

export interface ContaCpfLida {
  readonly login: string;
  readonly nome: string | null;
  readonly grupo: string | null;
  readonly ativo: boolean;
  readonly bloqueado: boolean;
}

/** Grupos de contas sem pessoa (aparelho, integração): CPF dispensado (D-W101-14). */
export const GRUPOS_SEM_CPF: readonly string[] = ['PAINEIS'];

export interface PainelCpfMontado {
  readonly semCpf: ContaCpfLida[];
  readonly dispensadasSemCpf: number;
  readonly gruposDispensados: string[];
  readonly duplicados: { chave: string; contas: ContaCpfLida[] }[];
}

const porLogin = (a: ContaCpfLida, b: ContaCpfLida) => a.login.localeCompare(b.login);

export function montarPainelCpf(
  semCpf: readonly ContaCpfLida[],
  duplicadas: readonly (ContaCpfLida & { readonly chave: string })[],
  dispensados: readonly string[] = GRUPOS_SEM_CPF,
): PainelCpfMontado {
  const dispensada = (c: ContaCpfLida) =>
    dispensados.some((g) => chaveGrupo(g) === chaveGrupo(c.grupo ?? ''));
  const ativas = semCpf.filter((c) => c.ativo);
  const grupos = new Map<string, ContaCpfLida[]>();
  for (const { chave, ...c } of duplicadas) grupos.set(chave, [...(grupos.get(chave) ?? []), c]);
  return {
    semCpf: ativas.filter((c) => !dispensada(c)).sort(porLogin),
    dispensadasSemCpf: ativas.filter(dispensada).length,
    gruposDispensados: [...dispensados],
    // Só grupos com 2+ logins; a chave vira um número de ordem (nada do CPF nem do ID sai).
    duplicados: [...grupos.values()]
      .filter((g) => g.length > 1)
      .map((g) => g.sort(porLogin))
      .sort((a, b) => porLogin(a[0]!, b[0]!))
      .map((contas, i) => ({ chave: String(i + 1), contas })),
  };
}
