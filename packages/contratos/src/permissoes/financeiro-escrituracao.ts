// Permissões da escrituração fiscal das entradas e da EFD-Contribuições (F3.8, 07-FIN linha 108). A consulta segue a
// permissão que já existe (`financeiro.escrituracao.ler`, do menu de origem). Classificar o item pela tela e gerar o
// arquivo da competência são recursos novos, sem opção correspondente no menu de origem: concedidos ao administrador
// do sistema e dados pelo cargo.
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_ESCRITURACAO_CODIGOS = {
  classificar: 'financeiro.escrituracao.classificar',
  gerarEfd: 'financeiro.efdContribuicoes.gerar',
} as const;

const p = (
  codigo: string,
  descricao: string,
  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,
  concessaoPorPerfil: 'por-perfil',
  perfis: ['administrador-sistema'],
  categoria: 'financeira',
  criticidade: 'normal',
  ...extra,
});

export const PERMISSOES_ESCRITURACAO_F38: readonly DeclaracaoPermissao[] = [
  p(
    PERMISSOES_ESCRITURACAO_CODIGOS.classificar,
    'Gravar e corrigir os dados fiscais do item da entrada (CFOP, CST, base e crédito do PIS e da COFINS, natureza do crédito)',
  ),
  p(
    PERMISSOES_ESCRITURACAO_CODIGOS.gerarEfd,
    'Gerar o arquivo da EFD-Contribuições da competência (conferido) e registrar o recibo da entrega',
    { criticidade: 'sensivel' },
  ),
];
