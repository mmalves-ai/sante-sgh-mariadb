// Permissões do M29 (ficha, seção 7; convencoes.md §12): farmácia hospitalar, dispensação e farmácia clínica. Quem tem
// a opção no legado tem a permissão no novo (regra 1 do M06). Opções da árvore do menu de origem (retrato
// tools/verificadores/dados/acesso-legado.pc.json, levantado na primeira hora do marco):
//   - Gestão de estoque (1): Dispensação por horário 1951; Lista de trabalho para dispensação 6548; Horários de
//     medicação 1737; Tipo de dispensa 1776; Etiquetas 1757 e 1867; Entrega de documentos 6545 (Entrega 6546, Estorno
//     6547); Devoluções 1873 (paciente interno 5735); Medicamentos controlados 2018 (Sintético 2019, Analítico 2021, por
//     paciente 2028); Gerenciamento de livro 5566;
//   - P.E.P. (23): Avaliação da prescrição 6747 (Consultar 6748; Avaliar prescrição 6752, inativa na cópia).
// A marca do usuário do estoque "lançar controlado" concede a conferência e a perda do
// controlado. A devolução de dose usa as permissões da devolução do M28 (`suprimentos.devolucao.ler` e
// `.registrar`). A avaliação farmacêutica e a farmácia ambulatorial são recursos novos (SGH_ACESSO_MAPA_OPCAO): a decisão
// e a intervenção vão também ao perfil complementar de quem tem conselho (o farmacêutico clínico).
import type { DeclaracaoPermissao, FlagLegado } from './tipos.js';

export const OPCOES_FARMACIA = {
  dispensacaoHorario: 1951,
  listaTrabalhoDispensacao: 6548,
  horariosMedicacao: 1737,
  tipoDispensa: 1776,
  etiquetasKit: 1757,
  etiquetasSaida: 1867,
  entregaDocumentos: 6545,
  entrega: 6546,
  entregaEstorno: 6547,
  devolucoes: 1873,
  devolucaoInterno: 5735,
  controlados: 2018,
  controladosSintetico: 2019,
  controladosAnalitico: 2021,
  controladosPaciente: 2028,
  gerenciamentoLivro: 5566,
  parametros: 1642,
  avaliacaoPrescricao: 6747,
  avaliacaoConsultar: 6748,
  avaliarPrescricao: 6752,
} as const;

const O = OPCOES_FARMACIA;
const flag = (coluna: string): FlagLegado => ({ tabela: 'GEUSERS', coluna });
const CONTROLADO = flag('PERM_LAN_MAT_MED_CONT');

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
  categoria: 'clinica',
  criticidade: 'normal',
  ...extra,
});

const FARMACEUTICO = { concessaoPorPerfil: 'por-perfil' as const, perfis: ['assistencial-com-conselho'] };

export const PERMISSOES_FARMACIA_M29: readonly DeclaracaoPermissao[] = [
  p(
    'suprimentos.dispensacao.ler',
    'Consultar a fila de dispensação por unidade, paciente e horário e as dispensações feitas',
    [O.dispensacaoHorario, O.listaTrabalhoDispensacao],
  ),
  p(
    'suprimentos.dispensacao.dispensar',
    'Dispensar doses da fila com a etiqueta de dose (a saída de estoque e o item na conta pelos gatilhos)',
    [O.dispensacaoHorario],
    { criticidade: 'sensivel' },
  ),
  p(
    'suprimentos.dispensacao.cancelar',
    'Cancelar a dose dispensada ainda não entregue (item suspenso ou corrigido)',
    [O.dispensacaoHorario, O.entregaEstorno],
    { criticidade: 'sensivel' },
  ),
  p(
    'suprimentos.entrega.ler',
    'Consultar a situação de entrega das doses ao setor (a farmácia pela dispensação por horário)',
    [O.entregaDocumentos, O.entrega, O.dispensacaoHorario],
  ),
  p(
    'suprimentos.entrega.aceitar',
    'Registrar o aceite da entrega da dose (leitura da etiqueta ou confirmação no tablet)',
    [O.entrega],
  ),
  p(
    'suprimentos.controlado.ler',
    'Consultar o saldo por substância e os movimentos de medicamentos controlados (Portaria 344)',
    [O.controlados, O.controladosSintetico, O.controladosAnalitico, O.controladosPaciente],
  ),
  p(
    'suprimentos.controlado.conferir',
    'Registrar a dupla conferência do controlado (reautenticação)',
    [O.controlados],
    { flagsLegado: [CONTROLADO], criticidade: 'critica' },
  ),
  p(
    'suprimentos.controlado.registrarPerda',
    'Registrar perda ou descarte de controlado com testemunha (reautenticação)',
    [O.controlados],
    { flagsLegado: [CONTROLADO], criticidade: 'critica' },
  ),
  p('suprimentos.livro.ler', 'Consultar o livro de controlados (modo conferência)', [
    O.gerenciamentoLivro,
    O.controlados,
  ]),
  p(
    'suprimentos.livro.fechar',
    'Fechar o período do livro de controlados (farmacêutico responsável)',
    [O.gerenciamentoLivro],
    { flagsLegado: [CONTROLADO], criticidade: 'critica' },
  ),
  p(
    'suprimentos.avaliacao.ler',
    'Consultar a fila de avaliação farmacêutica da prescrição (prontuário ao lado, auditado)',
    [O.avaliacaoPrescricao, O.avaliacaoConsultar],
    FARMACEUTICO,
  ),
  p(
    'suprimentos.avaliacao.decidir',
    'Registrar a avaliação farmacêutica do item (válido, não aprovado, pendência de revisão médica)',
    [O.avaliarPrescricao],
    { ...FARMACEUTICO, exigeConselho: true },
  ),
  p(
    'suprimentos.avaliacao.intervir',
    'Registrar intervenção farmacêutica ao prescritor',
    [O.avaliarPrescricao],
    { ...FARMACEUTICO, exigeConselho: true },
  ),
  p(
    'suprimentos.intervencao.responder',
    'Responder à intervenção farmacêutica (o prescritor aceita ou recusa)',
    [O.avaliacaoPrescricao],
    FARMACEUTICO,
  ),
  p(
    'suprimentos.ambulatorial.ler',
    'Consultar a farmácia ambulatorial e a escrituração do SNGPC (desligada por padrão)',
    [O.controladosPaciente],
    FARMACEUTICO,
  ),
  p(
    'suprimentos.ambulatorial.dispensar',
    'Dispensar na farmácia ambulatorial (sem baixa no estoque do hospital; SNGPC)',
    [O.controladosPaciente],
    { ...FARMACEUTICO, criticidade: 'sensivel' },
  ),
  p(
    'suprimentos.ambulatorial.escriturar',
    'Gerar a escrituração e o lote de envio do SNGPC',
    [O.controladosPaciente],
    { ...FARMACEUTICO, criticidade: 'sensivel' },
  ),
];
