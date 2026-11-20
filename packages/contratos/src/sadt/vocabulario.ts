// Vocabulário do SADT: laboratório, imagem, métodos gráficos, endoscopia, laudos e portal de resultados (M26; ficha,
// seções 5, 6 e 8; Anexo A §A.1 e §A.7). Os códigos são os do legado; o novo grava só valores já vistos no perfil
// passivo da cópia (só agregados). Perfil da cópia pc (2026, exames lançados e pedidos):
//   - ATO 15 patologia clínica (laboratório) 253.847, 90 métodos gráficos 9.522, 24 ultrassonografia 5.776, 25
//     tomografia 3.699, 16 radiologia 2.649, 21 endoscopia 645 (26 ressonância, 27 eco Doppler e 42 outros: Anexo A,
//     sem lançamento no período);
//   - PEND_SADT F (recebido ou executado pelo setor), T (pendente), S (suspenso no prontuário);
//   - SOLICITACAOPEP 2 (pedido do prontuário), 1 (lançado direto no setor), 3 (46 linhas, só lida);
//   - RESLIB, DIGRES, EMIRES T/F; URG T/F; ATEND I (internado) ou E (externo);
//   - TIPO_RESULTADO P (parametrizado), V (variável), T (texto) e a situação 2 da liberação: baixa confiança (DP-46.6),
//     a legenda diz "a confirmar".
// Nenhum nome de tabela do legado sai daqui para a tela: os rótulos são de produto (ADR 0023).

/** Setores do diagnóstico (a chave de liberação é por setor; ficha, seção 12). */
export const SETORES_SADT = [
  { codigo: 'laboratorio', rotulo: 'Laboratório', atos: [15] },
  { codigo: 'imagem', rotulo: 'Imagem', atos: [16, 24, 25, 26, 27, 42] },
  { codigo: 'metodosGraficos', rotulo: 'Métodos gráficos', atos: [90] },
  { codigo: 'endoscopia', rotulo: 'Endoscopia', atos: [21] },
] as const;
export type SetorSadt = (typeof SETORES_SADT)[number]['codigo'];
export const CODIGOS_SETOR_SADT = SETORES_SADT.map((s) => s.codigo) as [SetorSadt, ...SetorSadt[]];

/** Atos do legado (SILANEXA.ATO; Anexo A §A.1) com o rótulo de produto e o setor. */
export const ATOS_SADT: Readonly<Record<number, { readonly rotulo: string; readonly setor: SetorSadt }>> =
  Object.freeze({
    15: { rotulo: 'Patologia clínica', setor: 'laboratorio' },
    16: { rotulo: 'Radiologia', setor: 'imagem' },
    21: { rotulo: 'Endoscopia', setor: 'endoscopia' },
    24: { rotulo: 'Ultrassonografia', setor: 'imagem' },
    25: { rotulo: 'Tomografia', setor: 'imagem' },
    26: { rotulo: 'Ressonância magnética', setor: 'imagem' },
    27: { rotulo: 'Ecocardiograma com Doppler', setor: 'imagem' },
    42: { rotulo: 'Outros exames de imagem', setor: 'imagem' },
    90: { rotulo: 'Métodos gráficos', setor: 'metodosGraficos' },
  });
export const ATOS_LANCAVEIS = [15, 16, 21, 24, 25, 90] as const;

export function setorDoAto(ato: number): SetorSadt | null {
  return ATOS_SADT[ato]?.setor ?? null;
}
export function rotuloAto(ato: number): string {
  return ATOS_SADT[ato]?.rotulo ?? 'Outro';
}
/** Laudo privativo de médico (Lei 12.842/2013, art. 4º, VII): imagem, endoscopia e métodos gráficos. */
export function laudoPrivativoDeMedico(ato: number): boolean {
  const s = setorDoAto(ato);
  return s === 'imagem' || s === 'endoscopia' || s === 'metodosGraficos';
}

/**
 * Estados do exame (regra 1): solicitado → coletado → recebido → em análise → digitado → liberado → emitido ou
 * visualizado. Solicitado, digitado, liberado e emitido são as marcas do legado (PEND_SADT, DIGRES, RESLIB, EMIRES);
 * coletado, recebido e em análise vêm do rastreio de amostra (só no novo); visualizado, da liberação no portal.
 */
export const ESTADOS_EXAME = [
  { codigo: 'solicitado', rotulo: 'Solicitado', origem: 'legado' },
  { codigo: 'suspenso', rotulo: 'Suspenso no prontuário', origem: 'legado' },
  { codigo: 'coletado', rotulo: 'Coletado', origem: 'novo' },
  { codigo: 'recebido', rotulo: 'Recebido no setor', origem: 'legado' },
  { codigo: 'emAnalise', rotulo: 'Em análise', origem: 'novo' },
  { codigo: 'digitado', rotulo: 'Resultado digitado', origem: 'legado' },
  { codigo: 'liberado', rotulo: 'Liberado', origem: 'legado' },
  { codigo: 'emitido', rotulo: 'Laudo emitido', origem: 'legado' },
  { codigo: 'visualizado', rotulo: 'Visto no portal', origem: 'legado' },
] as const;
export type EstadoExame = (typeof ESTADOS_EXAME)[number]['codigo'];
export const CODIGOS_ESTADO_EXAME = ESTADOS_EXAME.map((e) => e.codigo) as [EstadoExame, ...EstadoExame[]];
export function rotuloEstadoExame(e: EstadoExame): string {
  return ESTADOS_EXAME.find((x) => x.codigo === e)?.rotulo ?? e;
}

/**
 * Rastreio de amostra (só no novo; cap-05b §5.10): o domínio de situação de amostra do outro sistema só tem o estado
 * inicial "Aguardando coleta" (uma linha por ato, 8 linhas), que o novo lê como o primeiro estado.
 */
export const ESTADOS_AMOSTRA = [
  { codigo: 'aguardandoColeta', rotulo: 'Aguardando coleta' },
  { codigo: 'coletada', rotulo: 'Coletada' },
  { codigo: 'emTransporte', rotulo: 'Em transporte' },
  { codigo: 'recebida', rotulo: 'Recebida no laboratório' },
  { codigo: 'emAnalise', rotulo: 'Em análise' },
  { codigo: 'rejeitada', rotulo: 'Rejeitada' },
  { codigo: 'recoleta', rotulo: 'Recoleta pedida' },
] as const;
export type EstadoAmostra = (typeof ESTADOS_AMOSTRA)[number]['codigo'];
export const CODIGOS_ESTADO_AMOSTRA = ESTADOS_AMOSTRA.map((e) => e.codigo) as [
  EstadoAmostra,
  ...EstadoAmostra[],
];
export function rotuloEstadoAmostra(e: EstadoAmostra): string {
  return ESTADOS_AMOSTRA.find((x) => x.codigo === e)?.rotulo ?? e;
}

/** Motivos de rejeição de amostra (padrão de mercado; lista do laboratório configurável por parâmetro). */
export const MOTIVOS_REJEICAO = [
  { codigo: 'hemolisada', rotulo: 'Amostra hemolisada' },
  { codigo: 'coagulada', rotulo: 'Amostra coagulada' },
  { codigo: 'insuficiente', rotulo: 'Volume insuficiente' },
  { codigo: 'identificacao', rotulo: 'Identificação divergente ou ausente' },
  { codigo: 'recipiente', rotulo: 'Recipiente inadequado' },
  { codigo: 'transporte', rotulo: 'Tempo ou temperatura de transporte fora do padrão' },
  { codigo: 'lipemica', rotulo: 'Amostra lipêmica' },
  { codigo: 'outro', rotulo: 'Outro (descrever)' },
] as const;
export type MotivoRejeicao = (typeof MOTIVOS_REJEICAO)[number]['codigo'];
export const CODIGOS_MOTIVO_REJEICAO = MOTIVOS_REJEICAO.map((m) => m.codigo) as [
  MotivoRejeicao,
  ...MotivoRejeicao[],
];

/** Tipos de resultado do exame (baixa confiança, DP-46.6: "a confirmar" na legenda). */
export const TIPOS_RESULTADO: Readonly<Record<string, string>> = Object.freeze({
  P: 'Parametrizado (a confirmar)',
  V: 'Variável (a confirmar)',
  T: 'Texto (a confirmar)',
  '': 'Sem tipo',
});

/** Situação da liberação para visualização (1 liberado; 2 substituído, a confirmar: DP-46.6). */
export const SITUACOES_LIBERACAO: Readonly<Record<number, string>> = Object.freeze({
  1: 'Liberado para visualização',
  2: 'Substituído por nova versão (a confirmar)',
});

/** Prioridade (URG T/F). */
export const PRIORIDADES = ['rotina', 'urgente'] as const;
export type Prioridade = (typeof PRIORIDADES)[number];

/** Origem do exame no setor (SOLICITACAOPEP 2 pedido do prontuário, 1 lançado direto). */
export const ORIGENS_EXAME = [
  { codigo: 'pedidoProntuario', rotulo: 'Pedido do prontuário', solicitacaoPep: 2 },
  { codigo: 'lancadoNoSetor', rotulo: 'Lançado no setor', solicitacaoPep: 1 },
] as const;

/** Escalonamento do aviso de valor crítico (regra 7): responsável → plantonista → supervisor. */
export const NIVEIS_ESCALONAMENTO = [
  { nivel: 0, codigo: 'responsavel', rotulo: 'Médico ou enfermeiro responsável' },
  { nivel: 1, codigo: 'plantonista', rotulo: 'Plantonista' },
  { nivel: 2, codigo: 'supervisor', rotulo: 'Supervisor' },
] as const;
export type NivelEscalonamento = 0 | 1 | 2;

/** Quem emite o aviso: liberação feita aqui ou detectada na liberação feita no outro sistema (vigia). */
export const ORIGENS_LIBERACAO = ['novo', 'outroSistema'] as const;
export type OrigemLiberacao = (typeof ORIGENS_LIBERACAO)[number];

/** Perfis do portal (domínio de identidade separado dos usuários internos; cap-08 §8.3). */
export const PERFIS_PORTAL = ['paciente', 'medicoExterno'] as const;
export type PerfilPortal = (typeof PERFIS_PORTAL)[number];

/** Situação do autocadastro de médico solicitante (só no novo). */
export const SITUACOES_AUTOCADASTRO = ['pendente', 'aprovado', 'recusado'] as const;
export type SituacaoAutocadastro = (typeof SITUACOES_AUTOCADASTRO)[number];

/** Situação do orçamento particular (a validade e a conversão ficam no novo; o legado guarda cabeçalho e itens). */
export const SITUACOES_ORCAMENTO = ['aberto', 'vencido', 'convertido'] as const;
export type SituacaoOrcamento = (typeof SITUACOES_ORCAMENTO)[number];

/** Chaves de liberação por setor (ficha, seção 12; SGH_CFG_LIBERACAO) e as só do novo. */
export const CHAVES_SADT = {
  laboratorio: 'sadt.laboratorio',
  imagem: 'sadt.imagem',
  metodosGraficos: 'sadt.metodosGraficos',
  endoscopia: 'sadt.endoscopia',
  rastreio: 'sadt.rastreio',
  critico: 'sadt.critico',
  portal: 'sadt.portal',
  orcamento: 'sadt.orcamento',
  requisicao: 'sadt.requisicao',
} as const;

export function chaveDoSetor(setor: SetorSadt): string {
  return CHAVES_SADT[setor];
}
