// Catálogo das operações de gravação que a tela de liberação (M08) e o comando liberacao:ligar-tudo mostram com chave
// por estabelecimento. Regra pura (só @sgh/contratos), para a API e as ferramentas usarem o MESMO catálogo.
// No produto, a operação registrada já nasce liberada: não há mais o estado vindo da captura de assinatura do sistema
// de origem (ADR 0003). As operações são as que o produto declara: as fichas das ondas 1 a 4, as operações de usuários
// e de leitos (@sgh/contratos) e as do cadastro e do acesso (abaixo).
// Melhoria: o estado não depende de arquivo de catálogo em disco nem de reexecução de assinaturas.
// Melhoria: catálogo vazio é recusado na montagem (sem ele, nenhuma operação desligada poderia ser religada).
import {
  type EstadoOperacao,
  NOMES_OPERACOES_LEITOS,
  NOMES_OPERACOES_USUARIOS,
  OPERACOES_CATALOGO_ONDA_2,
  OPERACOES_CATALOGO_ONDA_3,
  OPERACOES_FICHA_ONDA_1,
  OPERACOES_ONDA_1,
  ROTULOS_OPERACAO_ONDA_4,
  SETORES_ONDA_4,
} from '@sgh/contratos';

/**
 * Gravações do cadastro (pacientes, profissionais, estado civil, conselhos), da organização e do acesso, que o produto
 * faz desde a implantação e que nenhuma ficha de setor declara.
 */
export const OPERACOES_CADASTRO_E_ACESSO: readonly string[] = [
  'cadastro.cadastrarPaciente',
  'cadastro.alterarPaciente',
  'cadastro.unificarPaciente',
  'cadastro.cadastrarProfissional',
  'cadastro.alterarProfissional',
  'cadastro.incluirRegistroProfissional',
  'cadastro.alterarRegistroProfissional',
  'cadastro.definirEspecialidadeProfissional',
  'cadastro.lotarProfissional',
  'cadastro.credenciarProfissional',
  'cadastro.vincularLoginProfissional',
  'cadastro.inativarProfissional',
  'cadastro.reativarProfissional',
  'cadastro.excluirProfissional',
  'cadastro.excluirRegistroProfissional',
  'cadastro.incluirEstadoCivil',
  'cadastro.alterarEstadoCivil',
  'cadastro.incluirConselho',
  'cadastro.alterarConselho',
  'organizacao.alterarUnidade',
  'acesso.registrarLogin',
  'acesso.bloquearPorTentativas',
  'acesso.trocarSenha',
];

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

/** Nome de operação do produto: `modulo.operacao`. */
const NOME_OPERACAO = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;

/** As operações de gravação que o produto declara nos contratos, sem repetição e em ordem de nome. */
export function operacoesDeclaradas(): OperacaoLiberavel[] {
  const nomes = new Set<string>([
    ...OPERACOES_CADASTRO_E_ACESSO,
    ...OPERACOES_FICHA_ONDA_1.flatMap((o) => o.catalogo),
    ...OPERACOES_ONDA_1,
    ...OPERACOES_CATALOGO_ONDA_2,
    ...OPERACOES_CATALOGO_ONDA_3,
    ...SETORES_ONDA_4.flatMap((s) => s.operacoes),
    ...NOMES_OPERACOES_USUARIOS,
    ...NOMES_OPERACOES_LEITOS,
  ]);
  return [...nomes]
    .filter((n) => NOME_OPERACAO.test(n))
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
  if (operacoes.length === 0)
    throw new Error('catálogo de operações vazio: monte-o com as operações do produto');
  const lista = Object.freeze([...operacoes]);
  const nomes = new Set(lista.map((o) => o.nome));
  return {
    operacoes: () => lista,
    estado: (nome) => (nomes.has(nome) ? 'liberada' : null),
  };
}
