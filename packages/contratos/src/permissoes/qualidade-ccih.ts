// Permissões do M48, etapa 3 (CCIH; ficha, seção 7; convencoes.md §12; cap-05b §5.11, Perfis). O outro sistema não tem
// módulo de controle de infecção; as opções vizinhas que tratam do mesmo trabalho entram como concessão (quem tem a opção
// no outro sistema tem a permissão no novo, regra do M06):
//   - 2299 "Bloco Cirúrgico › Relatórios › Controle de infecção": consulta da vigilância (o relatório de infecção
//     cirúrgica de hoje);
//   - 1933 "Gestão de estoque › Movimentos › Antimicrobianos" e 5459 "Pedido de antimicrobiano › Consultar": a
//     consulta do uso de antimicrobianos (fila, DDD e DOT); 5228 "Pedido de antimicrobiano › Liberar pedido" e 1935
//     "Antimicrobianos › Paciente interno › Manutenção": a liberação (a ficha: "opções de antimicrobiano do módulo
//     Gestão de estoque mapeadas"). A validação de antimicrobiano do outro sistema está desligada: a liberação fica no
//     novo e não liga nada lá.
// O resto é recurso só do novo pelo perfil complementar `controle-infeccao` (médico e enfermeiro da CCIH, Portaria
// 2.616/1998; concedido pelo gestor de acessos, ADR 0022). Conteúdo clínico: categoria clínica, criticidade sensível.
import type { DeclaracaoPermissao } from './tipos.js';

/** Perfil complementar da Comissão de Controle de Infecção Hospitalar (Portaria 2.616/1998). */
export const PERFIL_CCIH = 'controle-infeccao';

export const PERMISSOES_CCIH = {
  ccihLer: 'qualidade.ccih.ler',
  ccihRegistrar: 'qualidade.ccih.registrar',
  irasLer: 'qualidade.iras.ler',
  irasRegistrar: 'qualidade.iras.registrar',
  antimicrobianoLer: 'qualidade.antimicrobiano.ler',
  antimicrobianoLiberar: 'qualidade.antimicrobiano.liberar',
  precaucaoLer: 'qualidade.precaucao.ler',
  precaucaoDefinir: 'qualidade.precaucao.definir',
} as const;

const C = PERMISSOES_CCIH;

const ccih = (codigo: string, descricao: string): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: 'por-perfil',
  perfis: [PERFIL_CCIH],
  categoria: 'clinica',
  criticidade: 'sensivel',
});

export const PERMISSOES_QUALIDADE_CCIH_M48: readonly DeclaracaoPermissao[] = [
  ccih(
    C.ccihLer,
    'Consultar a vigilância ativa dos internados (dispositivos, antimicrobianos, culturas, febre), a higiene das mãos e os surtos',
  ),
  ccih(
    C.ccihRegistrar,
    'Registrar a inserção e a retirada de dispositivo invasivo, as observações de higiene das mãos, o consumo de preparação alcoólica e os surtos',
  ),
  ccih(C.irasLer, 'Consultar as fichas de IRAS e os denominadores (pacientes-dia e dispositivos-dia)'),
  ccih(C.irasRegistrar, 'Registrar e descartar a ficha de IRAS pelos critérios da Anvisa'),
  ccih(
    C.antimicrobianoLer,
    'Consultar a fila de antimicrobianos restritos, as liberações e o consumo (DDD e DOT)',
  ),
  ccih(
    C.antimicrobianoLiberar,
    'Liberar ou não o antimicrobiano restrito, registrar as revisões do 3º e do 7º dia e configurar a política e a DDD dos itens',
  ),
  ccih(C.precaucaoLer, 'Consultar as precauções e os isolamentos dos internados'),
  ccih(
    C.precaucaoDefinir,
    'Definir e encerrar a precaução do internado (reflete no mapa de leitos, no cabeçalho e na higienização)',
  ),
];
