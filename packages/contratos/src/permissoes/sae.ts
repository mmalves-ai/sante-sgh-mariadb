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

const clinica = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'clinica',
  criticidade: 'sensivel',
  ...extra,
});

export const PERMISSOES_SAE_M45: readonly DeclaracaoPermissao[] = [
  clinica(
    P.saeLer,
    'Ver o processo de enfermagem do paciente (avaliação, diagnósticos, resultados e metas, intervenções, atividades e evolução) e a prescrição de enfermagem do turno',
  ),
  clinica(
    P.saeRegistrar,
    'Registrar o processo de enfermagem e a evolução que reavalia as metas (privativo do enfermeiro; a categoria é conferida pelo vínculo)',

    { exigeConselho: true },
  ),
  clinica(
    P.terminologiaCarregar,
    'Carregar a versão da terminologia do processo de enfermagem escolhida pela diretoria de enfermagem, com a licença (a versão carregada é imutável)',

    { criticidade: 'critica' },
  ),
  clinica(
    P.cuidadoPrescrever,
    'Prescrever e suspender os cuidados de enfermagem (atividades com a frequência e os horários aprazados pela grade da unidade; privativo do enfermeiro)',

    { exigeConselho: true },
  ),
  clinica(
    P.cuidadoChecar,
    'Checar o cuidado de enfermagem prescrito (feito, ou não feito com o motivo), enfermeiro e técnico',
  ),
  clinica(
    P.cuidadoEstornar,
    'Estornar a checagem do cuidado com a justificativa (a checagem original fica guardada)',

    { criticidade: 'critica' },
  ),
  clinica(
    P.medicamentoLer,
    'Ver as receitas de medicamento emitidas pelo enfermeiro na consulta de enfermagem',
  ),
  clinica(
    P.medicamentoPrescrever,
    'Prescrever medicamento na consulta de enfermagem pelo protocolo publicado, com a receita assinada (enfermeiro; reautenticação)',

    { exigeConselho: true, criticidade: 'critica' },
  ),
  clinica(P.vacinaLer, 'Ver as vacinas aplicadas no paciente e a situação do envio'),
  clinica(
    P.vacinaRegistrar,
    'Registrar a vacina aplicada (imunobiológico, lote, dose, via, local e o vacinador)',

    { exigeConselho: true },
  ),
];
