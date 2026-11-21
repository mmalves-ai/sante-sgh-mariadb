// Catálogo das operações de gravação que a tela de liberação (M08), a onda 0 e o comando liberacao:ligar-tudo mostram
// com chave por estabelecimento. Regra pura (só @sgh/contratos), para a API e as ferramentas usarem o MESMO catálogo.
// No produto, a operação registrada já nasce liberada: não há mais o estado vindo da captura de assinatura do sistema
// de origem (ADR 0003). As operações são as que o produto declara nos contratos (@sgh/contratos): as escritas das telas
// da onda 0, as fichas das ondas 1 a 4 e as operações de usuários e de leitos. A onda 0 recusa nome fora do catálogo.
// Melhoria: o estado não depende de arquivo de catálogo em disco nem de reexecução de assinaturas.
// Melhoria: catálogo vazio é recusado na montagem (sem ele, nenhuma operação desligada poderia ser religada).
import {
  ESCRITAS_TELAS_ONDA_0,
  type EstadoOperacao,
  NOMES_OPERACOES_LEITOS,
  NOMES_OPERACOES_USUARIOS,
  OPERACOES_CATALOGO_ONDA_2,
  OPERACOES_CATALOGO_ONDA_3,
  OPERACOES_FICHA_ONDA_1,
  OPERACOES_ONDA_0,
  OPERACOES_ONDA_1,
  ROTULOS_OPERACAO_ONDA_4,
  SETORES_ONDA_4,
} from '@sgh/contratos';

export interface OperacaoLiberavel {
  readonly nome: string;
  readonly modulo: string;
  readonly descricao: string;
}

export interface CatalogoOperacoesLiberacao {
  operacoes(): readonly OperacaoLiberavel[];
  /** Estado da operação no estabelecimento; null quando a operação não está no catálogo. */
  estado(nome: string, hospital: string): EstadoOperacao | null;
}

/** Nome de operação do produto: `modulo.operacao`. Os eventos de convivência com o sistema de origem ficam fora. */
const NOME_OPERACAO = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;
const DE_CONVIVENCIA = /Legado$/;

/** As operações de gravação que o produto declara nos contratos, sem repetição e em ordem de nome. */
export function operacoesDeclaradas(): OperacaoLiberavel[] {
  const nomes = new Set<string>([
    ...Object.values(ESCRITAS_TELAS_ONDA_0).flat(),
    ...OPERACOES_ONDA_0,
    ...OPERACOES_FICHA_ONDA_1.flatMap((o) => o.catalogo),
    ...OPERACOES_ONDA_1,
    ...OPERACOES_CATALOGO_ONDA_2,
    ...OPERACOES_CATALOGO_ONDA_3,
    ...SETORES_ONDA_4.flatMap((s) => s.operacoes),
    ...NOMES_OPERACOES_USUARIOS,
    ...NOMES_OPERACOES_LEITOS,
  ]);
  return [...nomes]
    .filter((n) => NOME_OPERACAO.test(n) && !DE_CONVIVENCIA.test(n))
    .sort()
    .map((nome) => ({
      nome,
      modulo: nome.slice(0, nome.indexOf('.')),
      descricao: ROTULOS_OPERACAO_ONDA_4[nome] ?? nome,
    }));
}

/**
 * O catálogo das operações liberáveis. Sem lista, usa as operações declaradas pelo produto; a lista vazia é recusada
 * (a tela de liberação ficaria sem operações e, em produção, nenhuma operação desligada poderia ser religada).
 */
export function catalogoOperacoesProprio(
  operacoes: readonly OperacaoLiberavel[] = operacoesDeclaradas(),
): CatalogoOperacoesLiberacao {
  if (operacoes.length === 0) throw new Error('catálogo de operações vazio: monte-o com as operações do produto');
  const lista = Object.freeze([...operacoes]);
  const nomes = new Set(lista.map((o) => o.nome));
  return {
    operacoes: () => lista,
    estado: (nome) => (nomes.has(nome) ? 'liberada' : null),
  };
}
