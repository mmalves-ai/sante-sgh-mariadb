// Permissões do M48, etapa 4 (notificação compulsória; ficha, seção 7; convencoes.md §12; cap-05b §5.11, Perfis). O
// outro sistema tem a notificação compulsória no prontuário ("P.E.P. › Movimentações › Notificação compulsória" e o
// histórico); quem tem essas opções lá tem a permissão aqui (regra do M06):
//   - consultar: 5273 (acessar), 5487 (consultar), 5490 e 5491 (histórico e visualizar), 5495 (pré-impressão);
//   - notificar: 5275 (notificar), 5826 (sem CID), 6856 (sem ficha), 5494 (enviar), 5827, 5831 e 5832 (confirmar),
//     5833 (cancelar), 6442 (suspender), 6443 (concluir), 6556 (corrigir).
// Além delas, o perfil complementar `vigilancia-epidemiologica` (núcleo hospitalar; concedido pelo gestor de acessos,
// ADR 0022) e o `controle-infeccao` (a CCIH costuma notificar as IRAS e os agravos dos internados). Conteúdo clínico:
// categoria clínica, criticidade sensível.
import type { DeclaracaoPermissao } from './tipos.js';
import { PERFIL_CCIH } from './qualidade-ccih.js';

/** Perfil complementar do núcleo de vigilância epidemiológica hospitalar. */
export const PERFIL_VIGILANCIA_EPIDEMIOLOGICA = 'vigilancia-epidemiologica';

export const PERMISSOES_AGRAVO = {
  ler: 'qualidade.agravo.ler',
  notificar: 'qualidade.agravo.notificar',
} as const;

const agravo = (codigo: string, descricao: string): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: 'por-perfil',
  perfis: [PERFIL_VIGILANCIA_EPIDEMIOLOGICA, PERFIL_CCIH],
  categoria: 'clinica',
  criticidade: 'sensivel',
});

export const PERMISSOES_QUALIDADE_AGRAVO_M48: readonly DeclaracaoPermissao[] = [
  agravo(
    PERMISSOES_AGRAVO.ler,
    'Consultar a fila de agravos de notificação compulsória (gatilhos por CID, resultado reagente e óbito), os casos, os prazos e a ficha SINAN pré-preenchida',
  ),
  agravo(
    PERMISSOES_AGRAVO.notificar,
    'Abrir o caso de agravo, registrar a notificação à autoridade sanitária ou descartar o caso, e configurar os exames cujo resultado reagente sugere o agravo',
  ),
];
