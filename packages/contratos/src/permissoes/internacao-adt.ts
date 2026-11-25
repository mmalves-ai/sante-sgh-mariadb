// Permissões do M21 (ficha, seção 7; convencoes.md §12): internação (pré-internação, admissão, guias, trocas, alta em
// dois tempos, impressos), mapa de leitos operacional (admitir, transferir, bloquear), higienização (painel,
// solicitações, aplicativo do profissional, inspeção e liberação, cadastros) e SAME (movimentação física). Quem tem a
// opção no legado tem a permissão no novo (regra 1 do M06). Opções da árvore do menu de origem (retrato
// tools/verificadores/dados/acesso-legado.pc.json):
//   - Recepção interna (módulo 7) › Internações 2342: Manutenção 5740 (Alterar 6056, Incluir 6057, Excluir 6058,
//     Consultar 6059, Cancelar 6060); Pré-internação 5741 (6062 a 6065); Transferências de localização 5742 (6066 a
//     6069); Altas 5743 (Alterar 6070, Incluir 6071, Excluir 6072, Consultar 6073, Cancelar 6074); Alterações… 5744
//     (6075 a 6079); Criação de contas/guias/protocolos 2360; Emissão de fichas 2372 e de etiquetas 2373; Fichas a
//     imprimir 2315; Leitos 2322 (Manutenção 2323, Painel de leitos 3990, Controle Central de Leitos 2483); Controle de
//     prontuários 2361 (Manutenção 2362, Controle I 2363, Controle II 2364, Movimentação em lote 4569, Setor 2365,
//     Motivo 2366, Localização 2367, Composição 2368); Relatórios › Relatório do SAME 2468, Controle de prontuários 2488;
//   - Higienização (módulo 37): Parâmetros 5003, Cadastro de áreas 5004, de tipos de ocorrências 5005, de tipos de
//     limpeza 5006, Configuração de checklist 5007, Cadastro de profissionais 5008, de terceirizadas 5009, Vínculo do
//     profissional por área 5010; Painel de leitos 5012, Solicitar limpeza 5013, Gerenciar limpeza 5014,
//     Iniciar/Finalizar limpeza 5015, Checklist de liberação 5016.
// Perfil da trilha do legado (cópia pc, desde 2026-06, só contagens): a admissão na 6057 (188), a transferência na
// 6067 (172), a alta na 6071 (190), a pré-internação na 6063 (55), as alterações na 6075 (5) e o cancelamento da alta
// na 6074 (1). Ato médico (alta médica: Lei 12.842/2013): `internacao.altaMedica.registrar` exige conselho ativo.
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_M21_CODIGOS = {
  internacaoLer: 'internacao.internacao.ler',
  internacaoCriar: 'internacao.internacao.criar',
  internacaoExcluir: 'internacao.internacao.excluir',
  preLer: 'internacao.pre.ler',
  preCriar: 'internacao.pre.criar',
  guiaEditar: 'internacao.guia.editar',
  trocaCriar: 'internacao.troca.criar',
  altaMedica: 'internacao.altaMedica.registrar',
  altaRegistrar: 'internacao.alta.registrar',
  altaCancelar: 'internacao.alta.cancelar',
  impressoEmitir: 'internacao.impresso.emitir',
  mapaLer: 'leitos.mapa.ler',
  transferenciaCriar: 'leitos.transferencia.criar',
  bloqueioCriar: 'leitos.bloqueio.criar',
  limpezaLer: 'hotelaria.limpeza.ler',
  limpezaSolicitar: 'hotelaria.limpeza.solicitar',
  limpezaExecutar: 'hotelaria.limpeza.executar',
  limpezaLiberar: 'hotelaria.limpeza.liberar',
  cadastroEditar: 'hotelaria.cadastro.editar',
  sameLer: 'same.movimento.ler',
  sameCriar: 'same.movimento.criar',
  sameExcluir: 'same.movimento.excluir',
  sameAutorizarSolicitacao: 'same.solicitacao.autorizar',
} as const;

const p = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'administrativa',
  criticidade: 'normal',
  ...extra,
});

export const PERMISSOES_INTERNACAO_M21: readonly DeclaracaoPermissao[] = [
  p(
    'internacao.internacao.ler',
    'Consultar as internações, a trajetória do paciente, as guias, as trocas e os procedimentos extras',
  ),
  p(
    'internacao.internacao.criar',
    'Admitir o paciente (nova internação) no leito do mapa, com a pulseira de identificação',
  ),
  p(
    'internacao.internacao.excluir',
    'Excluir a internação aberta por engano (supervisor; apaga conta, guias e períodos: dupla confirmação)',

    { criticidade: 'critica' },
  ),
  p('internacao.pre.ler', 'Ver as pré-internações pendentes e a lista de saneamento das datas'),
  p('internacao.pre.criar', 'Agendar a pré-internação e corrigir a data prevista (saneamento)'),
  p(
    'internacao.guia.editar',
    'Registrar as guias e autorizações do convênio da internação (prorrogações)',

    { categoria: 'financeira' },
  ),
  p('internacao.troca.criar', 'Trocar o convênio, a clínica, a especialidade ou o médico da internação'),
  p(
    'internacao.altaMedica.registrar',
    'Registrar a alta médica (decisão, motivo e destino; ligada ao sumário de alta): ato médico',

    { categoria: 'clinica', exigeConselho: true },
  ),
  p(
    'internacao.alta.registrar',
    'Dar a saída do paciente (alta administrativa): libera o leito e pede a limpeza',
  ),
  p(
    'internacao.alta.cancelar',
    'Cancelar a alta dada por engano (supervisor; o leito volta à internação)',

    { criticidade: 'critica' },
  ),
  p('internacao.impresso.emitir', 'Emitir as fichas, etiquetas e a pulseira da internação'),
  p('leitos.mapa.ler', 'Ver o mapa de leitos operacional e o histórico de ocupação (períodos)'),
  p('leitos.transferencia.criar', 'Transferir o paciente internado de leito ou de setor'),
  p(
    'leitos.bloqueio.criar',
    'Bloquear e liberar leito no mapa (manutenção, reserva, isolamento) e marcar a precaução',
  ),
  p('hotelaria.limpeza.ler', 'Ver o painel de higienização em tempo real e as solicitações com o prazo'),
  p('hotelaria.limpeza.solicitar', 'Solicitar a limpeza do leito (manual ou pelo QR code)'),
  p(
    'hotelaria.limpeza.executar',
    'Executar a limpeza no aplicativo do profissional (iniciar, pausar, concluir, checklist e foto)',
  ),
  p(
    'hotelaria.limpeza.liberar',
    'Inspecionar e liberar o leito depois da limpeza (supervisor da higienização ou enfermagem)',
  ),
  p(
    'hotelaria.cadastro.editar',
    'Manter as áreas, os profissionais, os vínculos e os materiais da higienização',
  ),
  p('same.movimento.ler', 'Ver a localização e a linha do tempo de prontuários e contas em papel'),
  p(
    'same.movimento.criar',
    'Registrar a movimentação física de prontuários e contas (leitura do código de barras)',
  ),
  p(
    'same.movimento.excluir',
    'Desfazer (exclusão lógica) o último movimento lançado por engano, com o motivo',

    { criticidade: 'sensivel' },
  ),
  p(
    'same.solicitacao.autorizar',
    'Autorizar ou negar o pedido de prontuário cujo motivo exige autorização (pesquisa, processo judicial)',
    { concessaoPorPerfil: 'por-perfil', perfis: ['diretoria-clinica'], criticidade: 'sensivel' },
  ),
];
