// Permissões do M45, etapa 6 (ficha, seção 7; convencoes.md §12): as especialidades sob demanda (DP-32) e o lactário.
// Quem tem a opção no sistema anterior tem a permissão no novo (regra 1 do M06). Opções da árvore do menu de origem (retrato
// tools/verificadores/dados/acesso-legado.pc.json, módulo do prontuário):
//   - oftalmologia: Planejamento oftalmológico (2600; Consultar 5496; Nova 5280; Salvar 6558), Exames oftalmológicos
//     complementares (4714; Consultar 5967; Incluir 4715) e Resultados de exames oftalmológicos padrão (4718; Consultar
//     5968; Confirmar 5401);
//   - oncologia: Planejamento oncológico/hematológico (4271; Consultar 5483; Nova 5254; Alterar 4272; Prescrever 4273;
//     Validar 4274), Protocolos oncológicos/hematológicos › Incluir (4686) e Tipos de protocolos › Incluir (2660). A
//     validação do ciclo é do farmacêutico (CBO 2234, conferido na hora pelo vínculo) com a opção de validar ou de
//     prescrever (a farmácia do estabelecimento recebe a de validar quando o recurso for ligado; DP-3);
//   - obstetrícia: Partograma (6473; Consultar 6474; Confirmar assinatura 6476) e o registro no prontuário (as opções da
//     evolução), com a categoria (médico ou enfermagem obstétrica) conferida na hora;
//   - lactário: o gerenciamento de dietas (6355 a 6360) e o Salvar da evolução da nutrição (4581); a conferência da
//     ordem é de outra pessoa com a mesma permissão (a tela e o servidor conferem).
// Sem escopo próprio. Conferir com a diretoria clínica e a nutrição na ativação (DP-32, DP-3).
import { OPCOES_PEP_DIETA_LER, OPCOES_PEP_EVOLUCAO_CRIAR, OPCOES_PEP_EVOLUCAO_LER } from './pep.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_ESPECIALIDADES_CODIGOS = {
  oftalmologiaLer: 'pep.especialidadeOftalmologia.ler',
  oftalmologiaRegistrar: 'pep.especialidadeOftalmologia.registrar',
  oncologiaLer: 'pep.especialidadeOncologia.ler',
  oncologiaPublicarProtocolo: 'pep.especialidadeOncologia.publicarProtocolo',
  oncologiaRegistrar: 'pep.especialidadeOncologia.registrar',
  oncologiaValidar: 'pep.especialidadeOncologia.validar',
  obstetriciaLer: 'pep.especialidadeObstetricia.ler',
  obstetriciaRegistrar: 'pep.especialidadeObstetricia.registrar',
  lactarioLer: 'hotelaria.lactario.ler',
  lactarioProduzir: 'hotelaria.lactario.produzir',
} as const;

const C = PERMISSOES_ESPECIALIDADES_CODIGOS;

export const OPCOES_OFTALMOLOGIA = {
  planejamento: 2600,
  planejamentoConsultar: 5496,
  planejamentoNova: 5280,
  planejamentoSalvar: 6558,
  complementares: 4714,
  complementaresConsultar: 5967,
  complementaresIncluir: 4715,
  resultadosPadrao: 4718,
  resultadosConsultar: 5968,
  resultadosConfirmar: 5401,
} as const;
export const OPCOES_ONCOLOGIA = {
  planejamento: 4271,
  consultar: 5483,
  nova: 5254,
  alterar: 4272,
  prescrever: 4273,
  validar: 4274,
  protocolosIncluir: 4686,
  tiposProtocoloIncluir: 2660,
} as const;
export const OPCOES_PARTOGRAMA = { raiz: 6473, consultar: 6474, confirmarAssinatura: 6476 } as const;
/** Gerenciamento de dietas (raiz 6355, incluir 6357, consultar 6359, imprimir 6360) e o Salvar da nutrição (4581). */
export const OPCOES_LACTARIO = {
  raiz: 6355,
  incluir: 6357,
  consultar: 6359,
  imprimir: 6360,
  salvar: 4581,
} as const;

const p = (
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

const OF = OPCOES_OFTALMOLOGIA;
const ON = OPCOES_ONCOLOGIA;
const PA = OPCOES_PARTOGRAMA;
const LA = OPCOES_LACTARIO;

export const PERMISSOES_ESPECIALIDADES_M45: readonly DeclaracaoPermissao[] = [
  p(
    C.oftalmologiaLer,
    'Ver os exames oftalmológicos do paciente (acuidade visual, pressão intraocular, gonioscopia e exames complementares)',
    [OF.planejamento, OF.planejamentoConsultar, OF.complementaresConsultar, OF.resultadosConsultar],
  ),
  p(
    C.oftalmologiaRegistrar,
    'Registrar o exame oftalmológico (acuidade pelo cadastro, pressão intraocular e exames complementares): médico com o conselho ativo',
    [OF.planejamentoNova, OF.planejamentoSalvar, OF.complementaresIncluir, OF.resultadosConfirmar],
    { exigeConselho: true },
  ),
  p(
    C.oncologiaLer,
    'Ver os protocolos de quimioterapia e os ciclos do paciente (doses calculadas com as parcelas e a validação farmacêutica)',
    [ON.planejamento, ON.consultar],
  ),
  p(
    C.oncologiaPublicarProtocolo,
    'Publicar a versão de um protocolo de quimioterapia (imutável; corrigir é publicar nova versão): médico com o conselho ativo',
    [ON.protocolosIncluir, ON.tiposProtocoloIncluir, ON.alterar],
    { exigeConselho: true },
  ),
  p(
    C.oncologiaRegistrar,
    'Registrar o ciclo de quimioterapia do paciente (dose por superfície corporal, peso ou AUC calculada pelo sistema): médico com o conselho ativo',
    [ON.nova, ON.prescrever],
    { exigeConselho: true },
  ),
  p(
    C.oncologiaValidar,
    'Validar o ciclo de quimioterapia com a dupla checagem independente das doses: farmacêutico com o conselho ativo',
    [ON.validar, ON.prescrever],
    { exigeConselho: true },
  ),
  p(
    C.obstetriciaLer,
    'Ver o partograma (dilatação, apresentação, batimentos cardíacos fetais e contrações com as linhas de alerta e de ação) e os recém-nascidos',
    [PA.raiz, PA.consultar, ...OPCOES_PEP_EVOLUCAO_LER],
  ),
  p(
    C.obstetriciaRegistrar,
    'Registrar a observação do partograma e o recém-nascido (Apgar, peso, idade gestacional): médico ou enfermagem obstétrica com o conselho ativo',
    [PA.confirmarAssinatura, ...OPCOES_PEP_EVOLUCAO_CRIAR],
    { exigeConselho: true },
  ),
  p(
    C.lactarioLer,
    'Ver a produção do lactário (ordens de fórmula por paciente e horário, validade e conferência; lista com nomes)',
    [LA.raiz, LA.consultar, ...OPCOES_PEP_DIETA_LER],
    { categoria: 'administrativa' },
  ),
  p(
    C.lactarioProduzir,
    'Registrar a ordem de produção do lactário, conferir a de outra pessoa e imprimir as etiquetas (dois identificadores, fórmula, volume, horário e validade)',
    [LA.raiz, LA.incluir, LA.imprimir, LA.salvar],
    { categoria: 'administrativa', criticidade: 'normal' },
  ),
];
