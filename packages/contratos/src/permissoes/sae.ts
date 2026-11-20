// Permissões do M45, etapa 4 (ficha, seção 7; convencoes.md §12): o processo de enfermagem (SAE), a prescrição de
// enfermagem aprazada e checada, a prescrição de medicamento pelo enfermeiro e a vacina aplicada. Quem tem a opção no
// legado tem a permissão no novo (regra 1 do M06). O legado não tem opção de SAE (as tabelas de lançamento da SAE têm 0
// linhas e nenhuma opção do módulo do PEP no retrato tools/verificadores/dados/acesso-legado.pc.json fala dela): as
// permissões vão nas opções do mesmo ato no legado (D-PERM-SAE-45):
//   - ler a SAE, os cuidados, as receitas e as vacinas: as de leitura da checagem da enfermagem (M25) e da evolução do
//     PEP (M22);
//   - registrar a SAE e prescrever os cuidados (privativos do enfermeiro, COFEN 736/2024): as do aprazamento (ato do
//     enfermeiro no legado: Aprazar 4590, Aprazar/avaliar 5678, Reaprazar 6744) e as de gravação da evolução; o servidor
//     confere a categoria pelo vínculo (CBO 2235 com o conselho ativo);
//   - checar o cuidado: as da checagem (M25: enfermeiro e técnico); estornar: as do cancelamento da checagem (crítica);
//   - carregar a terminologia (DP-19): as de administração do PEP (M22), crítica;
//   - prescrever medicamento (COFEN 801/2026): as do aprazamento e da evolução, como a SAE, crítica (assinatura com a
//     senha), e o servidor confere a consulta de enfermagem e a categoria;
//   - registrar a vacina: as da checagem da administração (a vacina é administrada e checada como o medicamento).
import { OPCOES_ENFERMAGEM } from './enfermagem.js';
import { OPCOES_PEP_ADMIN_EDITAR, OPCOES_PEP_EVOLUCAO_CRIAR, OPCOES_PEP_EVOLUCAO_LER } from './pep.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_SAE = {
  saeLer: 'enfermagem.sae.ler',
  saeRegistrar: 'enfermagem.sae.registrar',
  terminologiaCarregar: 'enfermagem.sae.terminologia',
  cuidadoPrescrever: 'enfermagem.cuidado.prescrever',
  cuidadoChecar: 'enfermagem.cuidado.checar',
  cuidadoEstornar: 'enfermagem.cuidado.estornar',
  medicamentoLer: 'enfermagem.prescricaoMedicamento.ler',
  medicamentoPrescrever: 'enfermagem.prescricaoMedicamento.prescrever',
  vacinaLer: 'enfermagem.vacina.ler',
  vacinaRegistrar: 'enfermagem.vacina.registrar',
} as const;

const P = PERMISSOES_SAE;
const O = OPCOES_ENFERMAGEM;

const LER = [
  O.checagem,
  O.checagemConsultar,
  O.checagemGeral,
  O.checagemAntiga,
  O.checagemNaoChecado,
  ...OPCOES_PEP_EVOLUCAO_LER,
];
const ATO_DO_ENFERMEIRO = [O.aprazar, O.aprazarAvaliar, O.reaprazar, ...OPCOES_PEP_EVOLUCAO_CRIAR];
const CHECAR = [
  O.checar,
  O.checarCodigoBarras,
  O.checarCodigoBarras2,
  O.gravar,
  O.checarTodos,
  O.assinar,
  O.checarAntiga,
];

const clinica = (
  codigo: string,
  descricao: string,
  opcoesLegado: readonly number[],
  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado: [...new Set(opcoesLegado)],
  concessaoPorPerfil: null,
  categoria: 'clinica',
  criticidade: 'sensivel',
  ...extra,
});

export const PERMISSOES_SAE_M45: readonly DeclaracaoPermissao[] = [
  clinica(
    P.saeLer,
    'Ver o processo de enfermagem do paciente (avaliação, diagnósticos, resultados e metas, intervenções, atividades e evolução) e a prescrição de enfermagem do turno',
    LER,
  ),
  clinica(
    P.saeRegistrar,
    'Registrar o processo de enfermagem e a evolução que reavalia as metas (privativo do enfermeiro; a categoria é conferida pelo vínculo)',
    ATO_DO_ENFERMEIRO,
    { exigeConselho: true },
  ),
  clinica(
    P.terminologiaCarregar,
    'Carregar a versão da terminologia do processo de enfermagem escolhida pela diretoria de enfermagem, com a licença (a versão carregada é imutável)',
    [...OPCOES_PEP_ADMIN_EDITAR],
    { criticidade: 'critica' },
  ),
  clinica(
    P.cuidadoPrescrever,
    'Prescrever e suspender os cuidados de enfermagem (atividades com a frequência e os horários aprazados pela grade da unidade; privativo do enfermeiro)',
    ATO_DO_ENFERMEIRO,
    { exigeConselho: true },
  ),
  clinica(
    P.cuidadoChecar,
    'Checar o cuidado de enfermagem prescrito (feito, ou não feito com o motivo), enfermeiro e técnico',
    CHECAR,
  ),
  clinica(
    P.cuidadoEstornar,
    'Estornar a checagem do cuidado com a justificativa (a checagem original fica guardada)',
    [O.cancelar, O.cancelarPendencia],
    { criticidade: 'critica' },
  ),
  clinica(
    P.medicamentoLer,
    'Ver as receitas de medicamento emitidas pelo enfermeiro na consulta de enfermagem',
    LER,
  ),
  clinica(
    P.medicamentoPrescrever,
    'Prescrever medicamento na consulta de enfermagem pelo protocolo publicado, com a receita assinada (enfermeiro; reautenticação)',
    ATO_DO_ENFERMEIRO,
    { exigeConselho: true, criticidade: 'critica' },
  ),
  clinica(P.vacinaLer, 'Ver as vacinas aplicadas no paciente e a situação do envio', LER),
  clinica(
    P.vacinaRegistrar,
    'Registrar a vacina aplicada (imunobiológico, lote, dose, via, local e o vacinador)',
    CHECAR,
    { exigeConselho: true },
  ),
];
