// Respostas das telas do SADT (M26; ficha, seções 4 e 7). Nenhum nome de tabela do legado; o nome do paciente
// aparece só nas telas de trabalho com a permissão (recepção do setor, coleta, digitação, liberação, laudos), nunca em
// área comum; o portal mostra só os laudos liberados de setores publicados (regra 9).
import { z } from 'zod';
import {
  CODIGOS_ESTADO_AMOSTRA,
  CODIGOS_ESTADO_EXAME,
  CODIGOS_SETOR_SADT,
  PERFIS_PORTAL,
  SITUACOES_AUTOCADASTRO,
  SITUACOES_ORCAMENTO,
} from './vocabulario.js';
import { esquemaChaveExame } from './entradas.js';

const txt = z.string();
const n = z.number();
const nul = <T extends z.ZodType>(t: T) => t.nullable();

export const esquemaAcaoSadt = z.object({ ligada: z.boolean(), motivo: nul(txt) });
export type AcaoSadt = z.infer<typeof esquemaAcaoSadt>;

/** As funcionalidades por setor e cada ação (gravam agora? o motivo quando não). */
export const esquemaGravacaoSadt = z.object({
  setores: z.record(z.enum(CODIGOS_SETOR_SADT), esquemaAcaoSadt),
  rastreio: esquemaAcaoSadt,
  critico: esquemaAcaoSadt,
  portal: esquemaAcaoSadt,
  orcamento: esquemaAcaoSadt,
  requisicao: esquemaAcaoSadt,
  /** Operação → liberada (com o motivo); a tela mostra o botão só com a permissão de agir. */
  operacoes: z.record(z.string(), esquemaAcaoSadt),
  /** Quem pode liberar resultado de laboratório e laudar (decidido no servidor pelo vínculo da sessão). */
  habilitacao: z.object({
    liberarLaboratorio: z.boolean(),
    laudarImagem: z.boolean(),
    motivo: nul(txt),
    vinculo: nul(n),
  }),
});
export type GravacaoSadt = z.infer<typeof esquemaGravacaoSadt>;

export const esquemaPacienteSadt = z.object({
  id: nul(n),
  prontuario: n,
  nome: txt,
  /** Sexo e idade (a referência e as restrições dependem deles). */
  sexo: nul(z.enum(['M', 'F'])),
  idadeAnos: nul(n),
  /** Data de nascimento (o segundo identificador da coleta e da etiqueta; só nas telas de trabalho). */
  nascimento: nul(txt),
});
export type PacienteSadt = z.infer<typeof esquemaPacienteSadt>;

export const esquemaAmostraResumo = z.object({
  id: n,
  codigo: txt,
  estado: z.enum(CODIGOS_ESTADO_AMOSTRA),
  rotulo: txt,
  em: txt,
});
export type AmostraResumo = z.infer<typeof esquemaAmostraResumo>;

/** Um exame lançado ou pedido (as listas do setor). */
export const esquemaExameSadt = z.object({
  id: n,
  chave: esquemaChaveExame,
  versao: nul(txt),
  paciente: esquemaPacienteSadt,
  atendimento: z.object({
    cabecalho: txt,
    reg: n,
    tipo: z.enum(['I', 'E']),
    unidade: nul(n),
    leito: nul(txt),
  }),
  setor: z.enum(CODIGOS_SETOR_SADT),
  ato: n,
  atoRotulo: txt,
  exame: z.object({ id: nul(n), codigo: txt, nome: txt }),
  estado: z.enum(CODIGOS_ESTADO_EXAME),
  estadoRotulo: txt,
  urgente: z.boolean(),
  origem: z.enum(['pedidoProntuario', 'lancadoNoSetor', 'outro']),
  solicitante: txt,
  pedidoEm: nul(txt),
  previsaoColeta: nul(txt),
  material: nul(txt),
  recipiente: nul(z.object({ codigo: n, nome: txt })),
  especialidade: nul(z.object({ codigo: n, nome: txt })),
  amostra: nul(esquemaAmostraResumo),
  critico: z.boolean(),
});
export type ExameSadt = z.infer<typeof esquemaExameSadt>;

export const esquemaListaExamesSadt = z.object({
  data: txt,
  itens: z.array(esquemaExameSadt),
  cortada: z.boolean(),
  /** Contagens por situação no recorte (para as abas). */
  contagens: z.record(z.string(), n),
});
export type ListaExamesSadt = z.infer<typeof esquemaListaExamesSadt>;

/** Lista de coleta: paciente × recipiente (a coleta agrupada pelo tubo). */
export const esquemaColetaGrupo = z.object({
  paciente: esquemaPacienteSadt,
  atendimento: z.object({ cabecalho: txt, tipo: z.enum(['I', 'E']), leito: nul(txt), unidade: nul(n) }),
  recipiente: nul(z.object({ codigo: n, nome: txt })),
  material: nul(txt),
  previsao: nul(txt),
  urgente: z.boolean(),
  exames: z.array(z.object({ id: n, codigo: txt, nome: txt, coletado: z.boolean() })),
  /** A pulseira é obrigatória na coleta do internado (meta 1 de segurança). */
  exigePulseira: z.boolean(),
});
export type ColetaGrupo = z.infer<typeof esquemaColetaGrupo>;

export const esquemaListaColeta = z.object({
  unidade: nul(n),
  inicio: txt,
  fim: txt,
  /** Janela de coleta (HH:MM, pela previsão da coleta), quando filtrada. */
  deHora: nul(txt),
  ateHora: nul(txt),
  /** As unidades com pedido a coletar no dia (o seletor da tela), com quantos exames cada uma tem. */
  unidades: z.array(z.object({ codigo: n, exames: n })),
  grupos: z.array(esquemaColetaGrupo),
  cortada: z.boolean(),
});
export type ListaColeta = z.infer<typeof esquemaListaColeta>;

/** Mapa de trabalho: exames por bancada (especialidade laboratorial) e prioridade. */
export const esquemaMapaTrabalho = z.object({
  setor: z.enum(CODIGOS_SETOR_SADT),
  bancadas: z.array(
    z.object({
      codigo: nul(n),
      nome: txt,
      urgentes: n,
      /** Exames por lote no modelo de mapa (nulo: lote único) e os lotes que os não retidos ocupam. */
      limite: nul(n).optional(),
      lotes: n.optional(),
      /** Os exames a processar, urgentes primeiro (os retidos não entram). */
      exames: z.array(esquemaExameSadt),
      /** Exames retidos na bancada (fora da fila, do lote e dos urgentes), com o motivo. */
      retidos: z.array(esquemaExameSadt.extend({ motivo: txt })).optional(),
    }),
  ),
  cortada: z.boolean(),
});
export type MapaTrabalho = z.infer<typeof esquemaMapaTrabalho>;

/** A referência vigente no dia do exame (regra 5), por sexo e idade, como a versão do legado guarda. */
export const esquemaReferenciaElemento = z.object({
  texto: nul(txt),
  minimo: nul(n),
  maximo: nul(n),
  /** Versão usada (data da versão; "atual" quando não há histórico anterior ao exame). */
  versao: nul(txt),
  fonte: z.enum(['historicoElemento', 'historicoExame', 'cadastro', 'nenhuma']),
});
export type ReferenciaElemento = z.infer<typeof esquemaReferenciaElemento>;

export const esquemaElementoDigitacao = z.object({
  codigo: n,
  nome: txt,
  titulo: z.boolean(),
  unidade: nul(txt),
  casas: nul(n),
  numerico: z.boolean(),
  /** Limites de digitação aberta (o valor fora deles pede confirmação). */
  minimoAberto: nul(n),
  maximoAberto: nul(n),
  referencia: esquemaReferenciaElemento,
  respostasPadrao: z.array(z.object({ codigo: n, texto: txt })),
  critico: nul(z.object({ abaixoDe: nul(n), acimaDe: nul(n), prazoMinutos: n })),
  valor: nul(z.object({ numerico: nul(n), alfa: nul(txt), absoluta: nul(n) })),
  /** Analito calculado: a fórmula vigente na data do exame, as variáveis e o valor (ou o motivo de não calcular). */
  calculo: z
    .object({
      expressao: txt,
      casas: nul(n),
      variaveis: z.array(
        z.object({
          codigo: n,
          identificador: txt,
          fonte: z.enum(['analito', 'grandeza', 'dado_paciente', 'digitado']),
          analito: nul(n),
          dadoPaciente: nul(txt),
        }),
      ),
      valor: nul(n),
      motivo: nul(txt),
    })
    .nullable()
    .optional(),
});
export type ElementoDigitacao = z.infer<typeof esquemaElementoDigitacao>;

export const esquemaResultadoDigitacao = z.object({
  exame: esquemaExameSadt,
  elementos: z.array(esquemaElementoDigitacao),
  variaveis: z.array(z.object({ codigo: n, identificacao: txt, descricao: txt, valor: nul(n) })),
  observacoes: z.array(txt),
  /** Modelos de laudo do exame (resultado padrão) para o editor de imagem e métodos gráficos. */
  modelos: z.array(z.object({ codigo: n, nome: txt, texto: txt })),
  laudo: nul(z.object({ texto: txt, html: txt, emissor: txt })),
  /** Data inválida antiga (até o ano 5202) no resultado: aparece com alerta, nunca é criada. */
  alertaDataInvalida: z.boolean(),
  /** Resultado liberado: só a retificação muda (regra 4). */
  bloqueado: z.boolean(),
  /** Grandezas do laudo estruturado do eco (as do exame). */
  grandezas: z.array(z.object({ codigo: n, nome: txt, sigla: txt })),
  /** Textos padrão oferecidos na digitação do exame (os do exame, os do setor e os gerais). */
  textosPadrao: z.array(z.object({ codigo: n, descricao: txt, texto: txt, mnemonico: nul(txt) })).optional(),
  /** Idade do paciente em anos completos na data do exame (para refazer a conta da fórmula na tela). */
  idadePaciente: nul(n).optional(),
});
export type ResultadoDigitacao = z.infer<typeof esquemaResultadoDigitacao>;

export const esquemaValorConferencia = z.object({
  elemento: txt,
  valor: txt,
  numero: nul(n),
  unidade: nul(txt),
  referencia: nul(txt),
  foraDaFaixa: nul(z.enum(['abaixo', 'acima'])),
  critico: z.boolean(),
});
export type ValorConferencia = z.infer<typeof esquemaValorConferencia>;

export const esquemaItemLiberacao = z.object({
  exame: esquemaExameSadt,
  valores: z.array(esquemaValorConferencia),
  digitadoEm: nul(txt),
  digitadoPor: nul(txt),
  critico: z.boolean(),
  /** Versões liberadas antes (retificações), com o motivo. */
  versoes: z.array(z.object({ versao: n, em: txt, motivo: nul(txt), viramAntes: n })),
});
export type ItemLiberacao = z.infer<typeof esquemaItemLiberacao>;

export const esquemaListaLiberacao = z.object({ itens: z.array(esquemaItemLiberacao), cortada: z.boolean() });
export type ListaLiberacao = z.infer<typeof esquemaListaLiberacao>;

export const esquemaAvisoCritico = z.object({
  id: n,
  exame: n,
  chave: txt,
  paciente: esquemaPacienteSadt,
  atendimento: txt,
  elemento: txt,
  valor: txt,
  origem: z.enum(['novo', 'outroSistema']),
  liberadoEm: txt,
  emitidoEm: txt,
  /** Segundos da liberação ao aviso (meta < 60 s; cap-14 §14.5). */
  segundosAteAviso: n,
  prazoEm: txt,
  nivel: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  nivelRotulo: txt,
  comunicado: nul(z.object({ canal: txt, destinatario: txt, por: txt, em: txt })),
  ciencia: nul(z.object({ usuario: txt, em: txt })),
  situacao: z.enum(['aguardandoCiencia', 'escalonado', 'comCiencia']),
});
export type AvisoCritico = z.infer<typeof esquemaAvisoCritico>;

export const esquemaPainelCriticos = z.object({
  avisos: z.array(esquemaAvisoCritico),
  /** Indicadores do período: comunicados no prazo e tempo médio até a ciência (parcelas impressas). */
  noPrazo: n,
  total: n,
  mediaMinutosCiencia: nul(n),
});
export type PainelCriticos = z.infer<typeof esquemaPainelCriticos>;

export const esquemaValorCriticoLido = z.object({
  id: n,
  ato: n,
  exame: txt,
  exameNome: txt,
  elemento: n,
  elementoNome: txt,
  abaixoDe: nul(n),
  acimaDe: nul(n),
  prazoMinutos: n,
  aprovacao: txt,
  ativo: z.boolean(),
  atualizadoEm: txt,
});
export type ValorCriticoLido = z.infer<typeof esquemaValorCriticoLido>;

export const esquemaAmostraDetalhe = z.object({
  id: n,
  codigo: txt,
  estado: z.enum(CODIGOS_ESTADO_AMOSTRA),
  rotulo: txt,
  paciente: esquemaPacienteSadt,
  recipiente: nul(txt),
  exames: z.array(z.object({ id: n, codigo: txt, nome: txt })),
  pulseiraConferida: z.boolean(),
  eventos: z.array(
    z.object({
      estado: z.enum(CODIGOS_ESTADO_AMOSTRA),
      rotulo: txt,
      em: txt,
      por: txt,
      motivo: nul(txt),
    }),
  ),
});
export type AmostraDetalhe = z.infer<typeof esquemaAmostraDetalhe>;

export const esquemaListaAmostras = z.object({
  itens: z.array(esquemaAmostraDetalhe),
  cortada: z.boolean(),
  /** Indicadores do dia: rejeitadas e recoletas por motivo. */
  rejeicoes: z.array(z.object({ motivo: txt, quantidade: n })),
});
export type ListaAmostras = z.infer<typeof esquemaListaAmostras>;

export const esquemaColetaRegistrada = z.object({
  amostra: n,
  codigo: txt,
  /** A etiqueta ZPL foi para a fila de impressão da estação. */
  etiquetaNaFila: z.boolean(),
  mensagem: txt,
});
export type ColetaRegistrada = z.infer<typeof esquemaColetaRegistrada>;

export const esquemaLaudoEmitido = z.object({
  impressao: n,
  /** O número do laudo: sequencial e único por estabelecimento na 1ª via; a 2ª via repete o da 1ª (F3.5). */
  numero: txt,
  codigo: txt,
  exames: n,
  segundaVia: z.boolean(),
  /** O PDF/A (base64) com o código e o QR da validação pública. */
  pdf: nul(txt),
  hash: nul(txt),
  mensagem: txt,
});
export type LaudoEmitido = z.infer<typeof esquemaLaudoEmitido>;

export const esquemaLaudoLido = z.object({
  /** O número do laudo (o mesmo em todas as vias). */
  numero: txt,
  codigo: txt,
  emitidoEm: txt,
  emitidoPor: txt,
  exames: z.array(z.object({ id: n, nome: txt, setor: txt })),
  segundasVias: n,
});
export type LaudoLido = z.infer<typeof esquemaLaudoLido>;

/** Validação pública do laudo (sem conteúdo clínico; regra 11). */
export const esquemaValidacaoLaudo = z.object({
  valido: z.boolean(),
  /** O número do laudo, impresso no PDF ao lado do código. */
  numero: nul(txt),
  emitidoEm: nul(txt),
  estabelecimento: nul(txt),
  exames: n,
});
export type ValidacaoLaudo = z.infer<typeof esquemaValidacaoLaudo>;

export const esquemaOrcamentoLido = z.object({
  id: n,
  nome: txt,
  paciente: nul(n),
  convenio: z.object({ codigo: n, nome: txt }),
  ato: n,
  atoRotulo: txt,
  data: txt,
  validade: txt,
  situacao: z.enum(SITUACOES_ORCAMENTO),
  itens: z.array(z.object({ exame: txt, nome: txt, valor: n })),
  total: n,
  convertidoEm: nul(z.object({ atendimento: n, em: txt })),
});
export type OrcamentoLido = z.infer<typeof esquemaOrcamentoLido>;

export const esquemaListaOrcamentos = z.object({
  itens: z.array(esquemaOrcamentoLido),
  cortada: z.boolean(),
});
export type ListaOrcamentos = z.infer<typeof esquemaListaOrcamentos>;

export const esquemaRequisicaoLida = z.object({
  atendimento: txt,
  reg: n,
  paciente: esquemaPacienteSadt,
  convenio: z.object({ codigo: n, nome: txt }),
  data: txt,
  /** A conta do setor já aberta (requisição) ou ainda não. */
  conta: nul(z.object({ id: n, numero: n, solicitante: txt, guia: txt })),
  exames: n,
});
export type RequisicaoLida = z.infer<typeof esquemaRequisicaoLida>;

export const esquemaListaRequisicoes = z.object({
  data: txt,
  itens: z.array(esquemaRequisicaoLida),
  cortada: z.boolean(),
});
export type ListaRequisicoes = z.infer<typeof esquemaListaRequisicoes>;

export const esquemaApoioSadt = z.object({
  prestadores: z.array(z.object({ id: n, ato: n, codigo: n, nome: txt })),
  executantes: z.array(z.object({ id: n, nome: txt, conselho: txt })),
  locais: z.record(z.string(), n),
  exames: z.array(
    z.object({ id: n, ato: n, codigo: txt, nome: txt, material: nul(txt), recipiente: nul(txt) }),
  ),
  kits: z.array(z.object({ codigo: n, nome: txt })),
  recipientes: z.array(z.object({ codigo: n, nome: txt })),
  convenios: z.array(z.object({ codigo: n, nome: txt })),
  motivosRejeicao: z.array(z.object({ codigo: txt, rotulo: txt })),
});
export type ApoioSadt = z.infer<typeof esquemaApoioSadt>;

/** Parâmetros do setor (uma linha por usuário no legado): só os campos sem segredo (regra 10). */
export const esquemaParametrosSadt = z.object({
  setor: z.enum(CODIGOS_SETOR_SADT),
  usuario: txt,
  campos: z.array(z.object({ campo: txt, rotulo: txt, valor: txt })),
  /** Campos guardados que o novo nunca mostra: só a natureza (senha, credencial, caminho, porta), nunca o nome. */
  ocultos: z.array(txt),
});
export type ParametrosSadt = z.infer<typeof esquemaParametrosSadt>;

/** TAT do pedido à coleta e da coleta à liberação (regra 12), agregado no banco, sem sentinela. */
export const esquemaIndicadoresSadt = z.object({
  inicio: txt,
  fim: txt,
  linhas: z.array(
    z.object({
      setor: z.enum(CODIGOS_SETOR_SADT),
      prioridade: z.enum(['rotina', 'urgente']),
      exames: n,
      liberados: n,
      /** Minutos médios do pedido à liberação (só com as duas marcas; as parcelas impressas). */
      mediaMinutosPedidoLiberacao: nul(n),
      comMarcas: n,
      semMarcas: n,
      /** Do pedido à coleta (a coleta do rastreio, em SGH_): média e quantos exames entram nela. */
      mediaMinutosPedidoColeta: nul(n),
      comColeta: n,
      /** Da coleta à liberação: média e quantos exames entram nela (coletados e liberados, marcas válidas). */
      mediaMinutosColetaLiberacao: nul(n),
      comColetaLiberacao: n,
    }),
  ),
  porDia: z.array(z.object({ dia: txt, exames: n })),
  pendentesMais24h: n,
  visualizadosPortal: z.object({ liberados: n, visualizados: n }),
});
export type IndicadoresSadt = z.infer<typeof esquemaIndicadoresSadt>;

export const esquemaResultadoSadt = z.object({
  mensagem: txt,
  repetida: z.boolean(),
  ids: z.record(z.string(), z.union([n, txt])),
  avisos: z.array(txt),
});
export type ResultadoSadt = z.infer<typeof esquemaResultadoSadt>;

// ── Portal ─────────────────────────────────────────────────────────────────────────────────────────────

export const esquemaSessaoPortal = z.object({
  perfil: z.enum(PERFIS_PORTAL),
  nome: txt,
  /** Válida até (o portal sai sozinho). */
  expiraEm: txt,
});
export type SessaoPortal = z.infer<typeof esquemaSessaoPortal>;

export const esquemaLaudoPortal = z.object({
  liberacao: n,
  exame: n,
  nome: txt,
  setor: txt,
  data: txt,
  liberadoEm: txt,
  visualizado: z.boolean(),
  paciente: nul(txt),
});
export type LaudoPortal = z.infer<typeof esquemaLaudoPortal>;

export const esquemaListaPortal = z.object({
  laudos: z.array(esquemaLaudoPortal),
  cortada: z.boolean(),
});
export type ListaPortal = z.infer<typeof esquemaListaPortal>;

export const esquemaLaudoPortalAberto = z.object({
  laudo: esquemaLaudoPortal,
  valores: z.array(esquemaValorConferencia),
  texto: z.array(txt),
  /** M47 (etapa 3): o link das imagens do exame (laudo liberado e estudo concluído no PACS). */
  imagem: z.object({ link: txt, visualizador: txt }).nullable().optional(),
});
export type LaudoPortalAberto = z.infer<typeof esquemaLaudoPortalAberto>;

export const esquemaAutocadastroLido = z.object({
  id: n,
  nome: txt,
  conselho: txt,
  uf: txt,
  numero: txt,
  situacao: z.enum(SITUACOES_AUTOCADASTRO),
  pedidoEm: txt,
  origem: z.enum(['novo', 'outroSistema']),
  /** Médicos do cadastro com o mesmo conselho, UF e número (a aprovação liga). */
  candidatos: z.array(z.object({ id: n, nome: txt })),
});
export type AutocadastroLido = z.infer<typeof esquemaAutocadastroLido>;
