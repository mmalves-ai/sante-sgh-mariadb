// Permissões da portaria e dos visitantes (M50, etapa 5; ficha, seção 7). Quem tem a opção no legado tem a permissão no
// novo (regra 1 do M06). Opções do módulo "Controle de acesso" (35) do outro sistema (menu de origem, retrato
// tools/verificadores/dados/acesso-legado.pc.json; todas ativas, concedidas a 2 grupos no `pc`): Tabelas 4528 (Parâmetros
// do módulo 4529, Crachás 4530, Portarias 4532, Locais 4533, Configuração de locais 4534, Motivos de bloqueio/limitar
// visitantes 4538, Terminais 4540 › Tecnibra 5611 e TopData 5612 › Manutenção 5613 e Biometria 5614); Movimentações 4541
// (Visitantes 4542 › Manutenção 4543, Bloqueio/Limitar visitantes 5615 › Bloqueio 4544 e Limitar 5616, Período de
// acesso 5617; Registrar entradas/saídas 4545); Relatórios 4546 (Relatório de visitas 4547). A ficha diz "módulo 31";
// no retrato, o 31 é o Agendamento e o controle de acesso é o 35 (D-PERM-50-5). O bloqueio clínico é da enfermagem: as
// opções de quem fecha o balanço hídrico (5317, 5318, 5319) com o conselho; o acompanhante, também pela recepção interna
// (Pacientes/acompanhantes 2457).
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_PORTARIA = {
  controleAcesso: 4527,
  tabelas: 4528,
  parametros: 4529,
  crachas: 4530,
  portarias: 4532,
  locais: 4533,
  configuracaoLocais: 4534,
  motivosBloqueio: 4538,
  terminais: 4540,
  terminaisTecnibra: 5611,
  terminaisTopdata: 5612,
  terminaisManutencao: 5613,
  terminaisBiometria: 5614,
  movimentacoes: 4541,
  visitantes: 4542,
  visitantesManutencao: 4543,
  bloqueioLimitar: 5615,
  bloqueio: 4544,
  limitar: 5616,
  periodoAcesso: 5617,
  registrarEntradas: 4545,
  relatorios: 4546,
  relatorioVisitas: 4547,
  acompanhantesRecepcao: 2457,
  enfermagemFechar: 5317,
  enfermagemFecharParcial: 5318,
  enfermagemFecharTotal: 5319,
} as const;
const O = OPCOES_PORTARIA;

export const PERMISSOES_PORTARIA = {
  ler: 'hotelaria.visita.ler',
  registrar: 'hotelaria.visita.registrar',
  regrar: 'hotelaria.visita.regrar',
  bloquearClinico: 'hotelaria.visita.bloquearClinico',
  contatos: 'hotelaria.visita.contatos',
  acompanhante: 'hotelaria.acompanhante.registrar',
  terminalLer: 'hotelaria.terminal.ler',
  terminalEditar: 'hotelaria.terminal.editar',
  catraca: 'hotelaria.catraca.registrar',
} as const;
const P = PERMISSOES_PORTARIA;

const p = (
  codigo: string,
  descricao: string,
  opcoesLegado: readonly number[],
  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado,
  concessaoPorPerfil: null,
  categoria: 'administrativa',
  criticidade: 'sensivel',
  ...extra,
});

export const PERMISSOES_PORTARIA_M50: readonly DeclaracaoPermissao[] = [
  p(P.ler, 'Ver a portaria: a busca do paciente para a visita, as visitas em curso e os crachás', [
    O.controleAcesso,
    O.movimentacoes,
    O.visitantes,
    O.visitantesManutencao,
    O.registrarEntradas,
  ]),
  p(
    P.registrar,
    'Cadastrar o visitante (cadastro mínimo com foto), registrar a visita com o crachá e a saída',
    [O.visitantesManutencao, O.registrarEntradas, O.crachas, O.periodoAcesso],
  ),
  p(
    P.regrar,
    'Definir as regras de visita por unidade, bloquear e revogar a visita a um paciente e autorizar exceção na portaria',
    [
      O.parametros,
      O.locais,
      O.configuracaoLocais,
      O.motivosBloqueio,
      O.bloqueioLimitar,
      O.bloqueio,
      O.limitar,
    ],
  ),
  p(
    P.bloquearClinico,
    'Bloquear a visita a um paciente por decisão clínica (enfermagem ou médico) e revogar o bloqueio clínico',
    [O.enfermagemFechar, O.enfermagemFecharParcial, O.enfermagemFecharTotal],
    { categoria: 'clinica', exigeConselho: true },
  ),
  p(
    P.contatos,
    'Emitir o relatório de contatos de visita de um paciente ou de uma unidade (investigação de surto)',
    [O.relatorios, O.relatorioVisitas],
  ),
  p(P.acompanhante, 'Registrar o acompanhante com direito legal, a troca e o fim do acompanhamento', [
    O.visitantesManutencao,
    O.registrarEntradas,
    O.acompanhantesRecepcao,
  ]),
  p(P.terminalLer, 'Ver os terminais e as catracas da portaria e os eventos de passagem', [
    O.tabelas,
    O.terminais,
  ]),
  p(P.terminalEditar, 'Cadastrar e alterar os terminais e as catracas da portaria', [
    O.terminaisTecnibra,
    O.terminaisTopdata,
    O.terminaisManutencao,
  ]),
  p(
    P.catraca,
    'Registrar a passagem do crachá na catraca (integrador local do terminal; só com a catraca liberada)',
    [O.terminaisManutencao],
    { categoria: 'tecnica' },
  ),
];
