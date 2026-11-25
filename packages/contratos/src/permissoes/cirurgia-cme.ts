// Permissões da central de material esterilizado (CME; F7, 05-SUP linha 29; RDC 15/2012). Recurso só do novo (o
// processamento na CME não tem opção de menu de origem que o cubra por inteiro): concessão por perfil.
//   - a equipe da CME (perfil complementar `central-material-esteril`) consulta, opera (caixas, equipamentos, pacotes,
//     ciclos, indicadores, liberação e entrega), recebe as solicitações e registra o uso;
//   - a equipe assistencial com conselho (enfermagem do bloco e dos setores) consulta o rastreio, pede material
//     estéril e registra a abertura do pacote no paciente.
import type { DeclaracaoPermissao } from './tipos.js';

/** Perfil complementar da equipe da central de material esterilizado. */
export const PERFIL_CME = 'central-material-esteril';

export const PERMISSOES_CME = {
  ler: 'cirurgia.cme.ler',
  operar: 'cirurgia.cme.operar',
  solicitar: 'cirurgia.cme.solicitar',
  usar: 'cirurgia.cme.usar',
} as const;

const cme = (codigo: string, descricao: string, perfis: readonly string[]): DeclaracaoPermissao => ({
  codigo,
  descricao,
  concessaoPorPerfil: 'por-perfil',
  perfis,
  categoria: 'clinica',
});

export const PERMISSOES_CIRURGIA_CME: readonly DeclaracaoPermissao[] = [
  cme(
    PERMISSOES_CME.ler,
    'Consultar a CME: caixas, pacotes, ciclos de esterilização com indicadores e o rastreio do pacote até o paciente',
    [PERFIL_CME, 'assistencial-com-conselho'],
  ),
  cme(
    PERMISSOES_CME.operar,
    'Operar a CME: cadastrar caixas e equipamentos, preparar pacotes, abrir e concluir ciclos, liberar o lote e entregar',
    [PERFIL_CME],
  ),
  cme(PERMISSOES_CME.solicitar, 'Pedir material estéril à CME para o setor ou para a cirurgia', [
    PERFIL_CME,
    'assistencial-com-conselho',
  ]),
  cme(PERMISSOES_CME.usar, 'Registrar a abertura do pacote estéril na cirurgia do paciente', [
    PERFIL_CME,
    'assistencial-com-conselho',
  ]),
];
