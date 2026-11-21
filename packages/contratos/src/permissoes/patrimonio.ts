// Permissões do patrimônio, etapa 6 (M54-F6; ficha, seção 7: "Bens patrimoniais", "Depreciação" e "Transferência,
// baixa e inventário"; convencoes.md §12). Quem tem a opção no outro sistema tem a permissão no novo (regra 1 do M06).
// Opções da árvore do menu de origem "Gestão patrimonial" (4266; conector/mapa/permissoes.tsv): Tabelas › Bens 266; Movimentação 268
// (Cálculo de Depreciação 269, Transferência 270, Baixa 271, Manutenção de Bens 272 com Saída 273 e Retorno 274);
// Relatórios 276 (Razão Analítico dos Bens 277, Mapa de depreciações 278, Demonstrativo de Saldos 279, Demonstrativo de
// Depreciação Acumulada 280, Inventário de Bens 281 a 284, Ficha de Bens 287, Listagem de Locais 288, Termo de
// Responsabilidade 289). No pc só o grupo MASTER tem as opções de Gestão patrimonial (preparo do M54, §2.6): a concessão
// vai também pelo perfil complementar `patrimonio` (SGH_ACESSO_MAPA_OPCAO).
// D-PERM-ACEITE-546: o aceite da transferência é de quem RECEBE (o gestor do setor de destino), que em geral não
// cadastra nem movimenta bens: permissão própria, pela Movimentação (268) e pela Transferência (270), mais o perfil
// complementar `gestor-setor` (Fase 6, regra 7). D-PERM-BAIXA-546: a baixa é irreversível e tem opção própria (271):
// permissão à parte do registro dos demais movimentos.
import type { DeclaracaoPermissao } from './tipos.js';

/** Perfis complementares (Fase 6, regra 7: patrimônio e gestor de setor). */
export const PERFIL_PATRIMONIO = 'patrimonio';
export const PERFIL_GESTOR_SETOR = 'gestor-setor';

export const PERMISSOES_PATRIMONIO_CODIGOS = {
  bemLer: 'patrimonio.bem.ler',
  bemCadastrar: 'patrimonio.bem.cadastrar',
  bemBaixar: 'patrimonio.bem.baixar',
  depreciacaoLer: 'patrimonio.depreciacao.ler',
  depreciacaoCalcular: 'patrimonio.depreciacao.calcular',
  movimentoLer: 'patrimonio.movimento.ler',
  movimentoRegistrar: 'patrimonio.movimento.registrar',
  movimentoAceitar: 'patrimonio.movimento.aceitar',
  inventarioContar: 'patrimonio.inventario.contar',
} as const;

const p = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: 'por-perfil',
  perfis: [PERFIL_PATRIMONIO],
  categoria: 'financeira',
  criticidade: 'normal',
  escopos: [],
  ...extra,
});

const C = PERMISSOES_PATRIMONIO_CODIGOS;

export const PERMISSOES_PATRIMONIO_M54_F6: readonly DeclaracaoPermissao[] = [
  p(
    C.bemLer,
    'Consultar os bens patrimoniais (plaqueta, origem, localização, responsável, valor e depreciação acumulada) e emitir a etiqueta',
  ),
  p(
    C.bemCadastrar,
    'Cadastrar bens a partir da nota fiscal de entrada (ou da doação com termo) e alterar os dados do bem',

    { criticidade: 'sensivel' },
  ),
  p(
    C.bemBaixar,
    'Dar baixa em um bem patrimonial (venda, perda, sinistro, obsolescência), com o termo',

    {
      criticidade: 'critica',
    },
  ),
  p(
    C.depreciacaoLer,
    'Consultar a depreciação mensal (prévia e cotas gravadas, por grupo e por centro de custo)',
  ),
  p(
    C.depreciacaoCalcular,
    'Calcular e gravar a depreciação do mês de uma empresa (vira fato contábil do patrimônio)',

    { criticidade: 'sensivel' },
  ),
  p(C.movimentoLer, 'Consultar as transferências, empréstimos, comodatos e baixas de bens'),
  p(
    C.movimentoRegistrar,
    'Registrar transferência, empréstimo, comodato e devolução de bens e cancelar o pedido de transferência',
  ),
  p(
    C.movimentoAceitar,
    'Aceitar ou recusar a transferência de um bem para o setor (quem recebe)',

    { perfis: [PERFIL_PATRIMONIO, PERFIL_GESTOR_SETOR] },
  ),
  p(C.inventarioContar, 'Abrir o inventário, registrar a leitura do QR dos bens no celular e encerrar'),
];
