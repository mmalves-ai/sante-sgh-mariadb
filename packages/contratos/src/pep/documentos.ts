// Contratos do M23 (ficha, seções 4, 5, 7 e 8): o prontuário de uso diário em volta do registro clínico do M22 —
// painel "Meus pacientes", cabeçalho fixo, linha do tempo, alergias, lista de problemas, pedidos de exame,
// resultados com ciência de valor crítico, receituário, atestados, TCLE, sumário de alta, relatório de
// transferência, óbito, anexos, registro de tempo, parecer com fila e pendências de assinatura. Nenhum nome de tabela
// nem coluna do banco sai daqui (fronteira); textos de documento restritos ao CP1252 (regra 18).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { esquemaContextoPaciente } from '../ui/paciente.js';

const id = z.number().int().positive();
const idRota = z.coerce.number().int().positive();
const data = z.iso.date();
/** Data e hora local do estabelecimento (AAAA-MM-DDTHH:MM). */
const horaLocal = z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/);
const justificativa = textoCp1252(70).pipe(
  z.string().trim().min(10, 'Justificativa com ao menos 10 letras.'),
);

// ── Categorias assistenciais (regra 2: matriz ação × categoria, pelo CBO) ───────────────────────────────

export const CATEGORIAS_ASSISTENCIAIS = [
  'medico',
  'enfermagem',
  'fisioterapia',
  'nutricao',
  'psicologia',
  'fonoaudiologia',
  'odontologia',
  'farmacia',
  'servico-social',
  'outros',
] as const;
export type CategoriaAssistencial = (typeof CATEGORIAS_ASSISTENCIAIS)[number];

export const ROTULOS_CATEGORIA_ASSISTENCIAL: Readonly<Record<CategoriaAssistencial, string>> = {
  medico: 'Medicina',
  enfermagem: 'Enfermagem',
  fisioterapia: 'Fisioterapia',
  nutricao: 'Nutrição',
  psicologia: 'Psicologia',
  fonoaudiologia: 'Fonoaudiologia',
  odontologia: 'Odontologia',
  farmacia: 'Farmácia',
  'servico-social': 'Serviço social',
  outros: 'Outras',
};

// ── Liberação (POL-3; ficha, seção 12) ─────────────────────────────────────────────────────────────────

export const RECURSOS_M23 = {
  consulta: 'pep.prontuario.consulta',
  documentos: 'pep.documentos.emissao',
  alergia: 'pep.alergia.registro',
  exame: 'pep.exame.solicitacao',
  anexo: 'pep.anexo.registro',
  parecer: 'pep.interconsulta.fila',
  problema: 'pep.problema.lista',
  ciencia: 'pep.resultado.ciencia',
  assinatura: 'documento.assinatura.lote',
} as const;
export type RecursoM23 = (typeof RECURSOS_M23)[keyof typeof RECURSOS_M23];

/** Situação de uma ação na tela: pode gravar agora? Senão, o motivo (consulta). */
export interface AcaoLiberada {
  readonly pode: boolean;
  readonly motivo: string | null;
}

// ── Painel "Meus pacientes" ────────────────────────────────────────────────────────────────────────────

export const COLUNAS_PAINEL = [
  'leito',
  'paciente',
  'idade',
  'atendimento',
  'entrada',
  'dias',
  'convenio',
  'medico',
  'alergias',
  'alertas',
] as const;
export type ColunaPainel = (typeof COLUNAS_PAINEL)[number];

/**
 * Recorte do painel por vínculo: todos da unidade; "meus" (o profissional é o responsável pelo atendimento, registrou
 * no episódio ou aceitou parecer dele); "equipe" (o responsável pelo atendimento é da mesma especialidade).
 */
export const VINCULOS_PAINEL = ['todos', 'meus', 'equipe'] as const;
export type VinculoPainel = (typeof VINCULOS_PAINEL)[number];

export const esquemaFiltrosPainel = z
  .object({
    unidade: idRota.optional(),
    busca: z.string().trim().max(60).optional(),
    favoritos: z.enum(['sim', 'nao']).optional(),
    /** IDs dos favoritos (deste navegador), com `favoritos=sim`. */
    ids: z.string().max(3000).optional(),
    vinculo: z.enum(VINCULOS_PAINEL).optional(),
    /** Recortes do filtro salvo (F3.3, L90). */
    setor: idRota.optional(),
    acomodacao: idRota.optional(),
    leito: idRota.optional(),
    especialidade: idRota.optional(),
    tipo: z.enum(['todos', 'internacao', 'ambulatorio', 'urgencia', 'externo', 'domiciliar']).optional(),
    situacao: z.enum(['em_atendimento', 'aguardando', 'alta_prevista', 'alta', 'todos']).optional(),
  })
  .strict();
export type FiltrosPainel = z.infer<typeof esquemaFiltrosPainel>;

export const esquemaPreferenciasPainel = z
  .object({
    colunas: z.array(z.enum(COLUNAS_PAINEL)).min(2).max(COLUNAS_PAINEL.length),
    unidade: id.nullable(),
    soFavoritos: z.boolean(),
  })
  .strict();
export type PreferenciasPainel = z.infer<typeof esquemaPreferenciasPainel>;

export type SituacaoAlergias = 'lista' | 'nega' | 'nao-avaliadas';

export interface LinhaPainel {
  readonly paciente: number;
  readonly nome: string;
  readonly idade: string | null;
  readonly sexo: string | null;
  readonly prontuario: string;
  readonly atendimento: number;
  readonly registro: number;
  readonly tipo: 'internacao' | 'externo' | 'urgencia';
  readonly entrada: string | null;
  readonly dias: number | null;
  readonly unidade: string | null;
  readonly leito: string | null;
  readonly convenio: string | null;
  readonly medico: string | null;
  readonly alergias: SituacaoAlergias;
  readonly alertas: readonly AlertaCompletude[];
  readonly favorito: boolean;
}

export interface PainelPacientes {
  readonly unidades: readonly { id: number; nome: string }[];
  readonly preferencias: PreferenciasPainel;
  readonly pacientes: readonly LinhaPainel[];
  readonly total: number;
  /** Teto da lista (300): acima, a tela pede um filtro. */
  readonly teto: number;
  readonly limitado: boolean;
  /** pep.painel.configurar: o usuário configura as colunas e os favoritos do painel. */
  readonly configurar: boolean;
}

// ── Alertas de completude (regra 14) ───────────────────────────────────────────────────────────────────

export const TIPOS_ALERTA_COMPLETUDE = [
  'sem-evolucao-medica-24h',
  'assinatura-pendente',
  'alta-sem-sumario',
  'critico-sem-ciencia',
  'parecer-atrasado',
] as const;
export type TipoAlertaCompletude = (typeof TIPOS_ALERTA_COMPLETUDE)[number];

export interface AlertaCompletude {
  readonly tipo: TipoAlertaCompletude;
  readonly texto: string;
}

// ── Cabeçalho fixo e contexto ─────────────────────────────────────────────────────────────────────────

export interface AtendimentoPep {
  readonly id: number;
  readonly registro: number;
  readonly tipo: 'internacao' | 'externo' | 'urgencia';
  readonly entrada: string | null;
  readonly alta: string | null;
  readonly aberto: boolean;
  readonly unidade: string | null;
}

export const esquemaCabecalhoPep = z.object({
  paciente: id,
  contexto: esquemaContextoPaciente,
});
export interface CabecalhoPep {
  readonly paciente: number;
  readonly contexto: z.infer<typeof esquemaContextoPaciente>;
  readonly atendimentos: readonly AtendimentoPep[];
  /** Atendimento em uso (o aberto mais recente; senão o último). */
  readonly atendimentoAtual: number | null;
  readonly alertas: readonly AlertaCompletude[];
  readonly categoria: CategoriaAssistencial | null;
}

// ── Linha do tempo (atendimentos, registros, exames, prescrições, documentos) ───────────────────────────

export const TIPOS_EVENTO_LINHA = [
  'atendimento',
  'registro',
  'parecer',
  'exame-pedido',
  'exame-resultado',
  'prescricao',
  'receita',
  'atestado',
  'alergia',
  'sumario-alta',
  'tcle',
  'anexo',
  'exame-externo',
  'cirurgia',
] as const;
export type TipoEventoLinha = (typeof TIPOS_EVENTO_LINHA)[number];

export const TETO_LINHA_TEMPO = 200;

export const esquemaFiltrosLinhaTempo = z
  .object({
    de: data.optional(),
    ate: data.optional(),
    tipos: z
      .string()
      .regex(/^[a-z-]+(,[a-z-]+)*$/)
      .optional(),
    pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .strict();
export type FiltrosLinhaTempo = z.infer<typeof esquemaFiltrosLinhaTempo>;

export interface EventoLinhaTempo {
  readonly chave: string;
  readonly tipo: TipoEventoLinha;
  readonly quando: string;
  readonly titulo: string;
  readonly detalhe: string | null;
  readonly profissional: string | null;
  readonly categoria: CategoriaAssistencial | null;
  readonly situacao: string | null;
  readonly suspenso: boolean;
  /** Conteúdo sob sigilo da categoria (regra 15): só "houve atendimento". */
  readonly sigilo: boolean;
  /** Abre o documento (tipo e identificador), quando há. */
  readonly documento: { tipo: TipoDocumentoAberto; id: number } | null;
}

export interface LinhaTempo {
  readonly eventos: readonly EventoLinhaTempo[];
  readonly pagina: number;
  readonly temMais: boolean;
}

export const TIPOS_DOCUMENTO_ABERTO = [
  'registro',
  'receita',
  'atestado',
  'pedido-exame',
  'exame-externo',
  'anexo',
  'tcle',
  'sumario-alta',
  'rel-transferencia',
  'declaracao-obito',
] as const;
export type TipoDocumentoAberto = (typeof TIPOS_DOCUMENTO_ABERTO)[number];

export interface DocumentoAberto {
  readonly tipo: TipoDocumentoAberto;
  readonly id: number;
  readonly titulo: string;
  readonly emitidoEm: string | null;
  readonly profissional: string | null;
  readonly situacao: 'emitido' | 'suspenso' | 'assinado' | 'solicitado' | 'pendente' | 'revogado';
  readonly suspensao: { em: string | null; justificativa: string | null } | null;
  /** Texto do documento em parágrafos (do RTF ou do XML do documento emitido; sem HTML). */
  readonly paragrafos: readonly string[];
  /** Documento do novo: a prova (hash do conteúdo, nível de assinatura, assinado em). */
  readonly prova: {
    readonly hash: string;
    readonly nivel: string;
    readonly assinadoEm: string | null;
    readonly qr: string | null;
    readonly via: number | null;
  } | null;
  readonly pdf: boolean;
  readonly marcaSuporte: string | null;
}

export const esquemaExportarProntuario = z
  .object({
    justificativa: textoCp1252(255).pipe(z.string().trim().min(10)),
    tipoJustificativa: id.optional(),
    senha: z.string().min(1).max(200).optional(),
  })
  .strict();
export type ExportarProntuario = z.infer<typeof esquemaExportarProntuario>;

// ── Alergias (regra 4) ────────────────────────────────────────────────────────────────────────────────

export const GRAVIDADES_ALERGIA = ['leve', 'moderada', 'grave', 'fatal', 'desconhecida'] as const;
export type GravidadeAlergia = (typeof GRAVIDADES_ALERGIA)[number];

/** Origem da informação (CBARA): relato do paciente, do familiar, prontuário anterior, reação observada, teste. */
export const ORIGENS_ALERGIA = [
  'relato-paciente',
  'relato-familiar',
  'prontuario-anterior',
  'reacao-observada',
  'teste-confirmado',
] as const;
export type OrigemAlergia = (typeof ORIGENS_ALERGIA)[number];

export interface AlergiaPep {
  readonly id: number;
  readonly agente: string;
  /** Alérgeno do catálogo; null na alergia de descrição livre. */
  readonly agenteId: number | null;
  readonly tipo: string | null;
  readonly principios: readonly string[];
  readonly observacao: string | null;
  readonly reacao: string | null;
  readonly gravidade: GravidadeAlergia | null;
  readonly origem: OrigemAlergia | null;
  readonly ativa: boolean;
  readonly registradaEm: string | null;
  readonly profissional: string | null;
  /** Registro clínico em que foi informada (abre no prontuário); null na alergia sem registro clínico. */
  readonly registro: number | null;
  readonly inativacao: { em: string | null; motivo: string | null; usuario: string | null } | null;
  /** Registrada pelo novo (com o detalhe guardado no novo). */
  readonly doNovo: boolean;
}

export interface RegistroParaAlergia {
  readonly registro: number;
  readonly modelo: string;
  readonly dataHora: string | null;
}

export interface AlergiasPaciente {
  readonly paciente: number;
  readonly situacao: SituacaoAlergias;
  readonly ativas: readonly AlergiaPep[];
  readonly historico: readonly AlergiaPep[];
  readonly agentes: readonly { id: number; nome: string; tipo: string | null }[];
  readonly principios: readonly { id: number; nome: string }[];
  /** Registros clínicos do atendimento, do próprio profissional, a que a alergia pode ser ligada. */
  readonly registros: readonly RegistroParaAlergia[];
  /** Catálogo de manifestações (urticária, broncoespasmo...) para a escolha ao registrar (03-PEP L100). */
  readonly manifestacoes: readonly ManifestacaoAlergica[];
  readonly criar: AcaoLiberada;
  readonly inativar: AcaoLiberada;
}

export interface ManifestacaoAlergica {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
}

/** Um passo da linha do tempo da alergia (inclusão, retirada, reativação...), da mais antiga para a mais recente. */
export interface PassoHistoricoAlergia {
  readonly id: number;
  readonly quando: string | null;
  readonly titulo: string;
  readonly quem: string | null;
  readonly motivo: string | null;
}

/** Histórico da alergia: nada é apagado; a alergia retirada mostra o histórico inteiro (03-PEP L100). */
export interface HistoricoAlergia {
  readonly alergia: number;
  readonly manifestacoes: readonly ManifestacaoAlergica[];
  readonly passos: readonly PassoHistoricoAlergia[];
}

export const esquemaRegistrarAlergia = z
  .object({
    /** Registro clínico finalizado em que foi informada (aba de alergias). */
    registro: id.optional(),
    /**
     * Atendimento aberto, sem registro: a alergia informada dentro do formulário clínico (componente de alergia) é
     * gravada na hora, ligada ao atendimento, e já vale para a prescrição.
     */
    atendimento: id.optional(),
    nega: z.boolean().default(false),
    agente: id.optional(),
    principios: z.array(id).max(10).default([]),
    observacao: textoCp1252(255).optional(),
    reacao: textoCp1252(200).optional(),
    gravidade: z.enum(GRAVIDADES_ALERGIA).optional(),
    origem: z.enum(ORIGENS_ALERGIA).optional(),
    /** Manifestações do catálogo (até 10); a declaração "nega alergias" não tem manifestação. */
    manifestacoes: z.array(id).max(10).default([]),
    /** Controle otimista: as alergias ativas lidas pela tela (IDs, em ordem). */
    versao: z.string().max(200),
  })
  .strict()
  .refine((x) => x.nega || x.agente !== undefined, {
    message: 'Escolha o agente ou marque "nega alergias".',
    path: ['agente'],
  })
  .refine((x) => x.registro !== undefined || x.atendimento !== undefined, {
    message: 'Informe o registro clínico ou o atendimento.',
    path: ['registro'],
  });
export type RegistrarAlergia = z.infer<typeof esquemaRegistrarAlergia>;

export const esquemaInativarAlergia = z
  .object({ motivo: textoCp1252(500).pipe(z.string().trim().min(10)), versao: z.string().max(200) })
  .strict();
export type InativarAlergia = z.infer<typeof esquemaInativarAlergia>;

/** Reativação da alergia retirada por engano: motivo (pelo menos 10 caracteres) e a versão da lista lida. */
export const esquemaReativarAlergia = esquemaInativarAlergia;
export type ReativarAlergia = InativarAlergia;

/**
 * Alteração da alergia ativa: o estado completo dos campos editáveis (nulo apaga). O agente não muda (agente
 * diferente é outra alergia). Motivo opcional; a versão é a da lista lida.
 */
export const esquemaAlterarAlergia = z
  .object({
    gravidade: z.enum(GRAVIDADES_ALERGIA).nullable(),
    reacao: textoCp1252(200).nullable(),
    origem: z.enum(ORIGENS_ALERGIA).nullable(),
    observacao: textoCp1252(255).nullable(),
    manifestacoes: z.array(id).max(10).default([]),
    motivo: textoCp1252(500).optional(),
    versao: z.string().max(200),
  })
  .strict();
export type AlterarAlergia = z.infer<typeof esquemaAlterarAlergia>;

// ── Lista de problemas e diagnósticos ─────────────────────────────────────────────────────────────────

export const SITUACOES_PROBLEMA = ['ativo', 'resolvido', 'descartado'] as const;
export type SituacaoProblema = (typeof SITUACOES_PROBLEMA)[number];

export interface ProblemaPep {
  readonly id: number;
  readonly descricao: string;
  readonly cid: string | null;
  readonly tipo: 'problema' | 'diagnostico';
  readonly inicio: string | null;
  readonly fim: string | null;
  readonly situacao: SituacaoProblema;
  readonly usuario: string;
  readonly em: string;
  readonly versoes: number;
}

export const esquemaGravarProblema = z
  .object({
    descricao: textoCp1252(200).pipe(z.string().trim().min(3)),
    cid: z
      .string()
      .regex(/^[A-Z]\d{2}(\.?\d{1,2})?$/)
      .optional(),
    tipo: z.enum(['problema', 'diagnostico']),
    inicio: data.optional(),
    atendimento: id.optional(),
  })
  .strict();
export type GravarProblema = z.infer<typeof esquemaGravarProblema>;

export const esquemaSituacaoProblema = z
  .object({
    situacao: z.enum(['resolvido', 'descartado', 'ativo']),
    fim: data.optional(),
    versao: id,
  })
  .strict();
export type MudarSituacaoProblema = z.infer<typeof esquemaSituacaoProblema>;

// ── Pedidos de exame (regra 11) ───────────────────────────────────────────────────────────────────────

export interface ExameCatalogo {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly ato: number;
  readonly grupo: 'laboratorio' | 'imagem' | 'outros';
  readonly sexo: 'F' | 'M' | null;
  readonly idadeMinima: number | null;
  readonly idadeMaxima: number | null;
}

export interface KitExames {
  readonly id: number;
  readonly nome: string;
  readonly exames: readonly number[];
}

export interface PedidoExame {
  readonly pedido: number;
  readonly exame: number;
  readonly nome: string;
  readonly grupo: 'laboratorio' | 'imagem' | 'outros';
  readonly solicitadoEm: string | null;
  readonly urgente: boolean;
  readonly situacao: 'solicitado' | 'em-andamento' | 'liberado' | 'suspenso';
  readonly profissional: string | null;
  readonly indicacao: string | null;
}

export interface PedidosExame {
  readonly pedidos: readonly PedidoExame[];
  readonly catalogo: readonly ExameCatalogo[];
  readonly kits: readonly KitExames[];
  readonly atendimentos: readonly AtendimentoPep[];
  readonly criar: AcaoLiberada;
}

export const esquemaSolicitarExames = z
  .object({
    atendimento: id,
    itens: z
      .array(
        z
          .object({
            exame: id,
            urgente: z.boolean().default(false),
            indicacao: textoCp1252(200).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(80),
    kit: id.optional(),
    /** Avisos de duplicidade e de sexo/idade já vistos e confirmados pelo profissional. */
    confirmarAvisos: z.boolean().default(false),
    /**
     * Justificativa da exceção à restrição clínica do exame (bloqueio que aceita exceção, 10 caracteres ou mais),
     * registrada no item com quem autorizou (05-SADT linha 5).
     */
    justificativa: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
export type SolicitarExames = z.infer<typeof esquemaSolicitarExames>;

export interface AvisoPedidoExame {
  readonly exame: number;
  readonly tipo: 'duplicidade' | 'sexo' | 'idade' | 'inativo';
  readonly texto: string;
  /** Bloqueia (exame inativo) ou só avisa (confirmável). */
  readonly bloqueia: boolean;
}

export interface ResultadoSolicitacao {
  readonly gravado: boolean;
  readonly pedido: number | null;
  readonly avisos: readonly AvisoPedidoExame[];
}

// ── Resultados (regra 12) ─────────────────────────────────────────────────────────────────────────────

export interface ValorResultado {
  readonly elemento: string;
  readonly valor: string;
  readonly numero: number | null;
  readonly unidade: string | null;
  readonly referencia: string | null;
  readonly foraDaFaixa: 'abaixo' | 'acima' | null;
  readonly critico: boolean;
}

export interface ResultadoExame {
  readonly exame: number;
  readonly nome: string;
  readonly liberadoEm: string | null;
  readonly origem: 'interno' | 'externo';
  readonly valores: readonly ValorResultado[];
  readonly texto: readonly string[];
  readonly critico: boolean;
  readonly ciencia: { usuario: string; em: string; conduta: string } | null;
}

export interface SerieTendencia {
  readonly elemento: string;
  readonly unidade: string | null;
  readonly pontos: readonly { em: string; valor: number }[];
}

export interface ResultadosPaciente {
  readonly resultados: readonly ResultadoExame[];
  readonly tendencias: readonly SerieTendencia[];
  readonly pendentesCiencia: number;
  readonly ciencia: AcaoLiberada;
  readonly externo: AcaoLiberada;
}

export const esquemaCienciaCritico = z
  .object({
    conduta: textoCp1252(500).pipe(z.string().trim().min(5)),
    escalonarPara: z.string().trim().max(31).optional(),
  })
  .strict();
export type CienciaCritico = z.infer<typeof esquemaCienciaCritico>;

export const esquemaExameExterno = z
  .object({
    atendimento: id.optional(),
    nomeExame: textoCp1252(80).pipe(z.string().trim().min(2)),
    metodo: textoCp1252(80).optional(),
    realizadoEm: horaLocal,
    laudo: textoCp1252(4000).optional(),
    critico: z.boolean().default(false),
    itens: z
      .array(
        z
          .object({
            elemento: textoCp1252(250).pipe(z.string().trim().min(1)),
            tipo: z.enum(['N', 'T']),
            resultado: textoCp1252(50).pipe(z.string().trim().min(1)),
            unidade: textoCp1252(50).optional(),
            faixa: textoCp1252(250).optional(),
          })
          .strict(),
      )
      .max(60)
      .default([]),
  })
  .strict();
export type ExameExterno = z.infer<typeof esquemaExameExterno>;

// ── Receituário (regras 6 e 7) ────────────────────────────────────────────────────────────────────────

export const TIPOS_RECEITA = ['simples', 'controle-especial', 'antimicrobiano'] as const;
export type TipoReceita = (typeof TIPOS_RECEITA)[number];

export const ROTULOS_TIPO_RECEITA: Readonly<Record<TipoReceita, string>> = {
  simples: 'Receita simples',
  'controle-especial': 'Receita de controle especial (2 vias)',
  antimicrobiano: 'Receita de antimicrobiano (2 vias)',
};

export const esquemaItemReceita = z
  .object({
    medicamento: textoCp1252(80).pipe(z.string().trim().min(2)),
    concentracao: textoCp1252(60).optional(),
    forma: textoCp1252(25).optional(),
    via: textoCp1252(20).optional(),
    posologia: textoCp1252(70).pipe(z.string().trim().min(2)),
    quantidade: textoCp1252(20).pipe(z.string().trim().min(1)),
    duracao: textoCp1252(25).optional(),
    usoContinuo: z.boolean().default(false),
  })
  .strict();
export type ItemReceita = z.infer<typeof esquemaItemReceita>;

export const esquemaEmitirReceita = z
  .object({
    atendimento: id,
    tipo: z.enum(TIPOS_RECEITA),
    itens: z.array(esquemaItemReceita).min(1).max(20),
    orientacoes: textoCp1252(2000).optional(),
    /** Horário clínico do documento (padrão: agora pelo relógio do banco). */
    dataHora: horaLocal.optional(),
  })
  .strict();
export type EmitirReceita = z.infer<typeof esquemaEmitirReceita>;

export interface DocumentoResumo {
  readonly id: number;
  readonly tipo: string;
  readonly titulo: string;
  readonly emitidoEm: string | null;
  readonly profissional: string | null;
  readonly atendimento: number | null;
  readonly situacao: 'emitido' | 'suspenso';
  readonly doNovo: boolean;
  readonly assinado: boolean;
  readonly corrigeDe: number | null;
}

export interface DocumentosPaciente {
  readonly documentos: readonly DocumentoResumo[];
  readonly atendimentos: readonly AtendimentoPep[];
  readonly emitir: AcaoLiberada;
  readonly suspender: AcaoLiberada;
  /** Modelos de impressão do legado para o tipo (atestados: as fichas em uso). */
  readonly modelos: readonly { codigo: number; nome: string; tipo: TipoAtestado }[];
}

export const esquemaSuspenderDocumento = z
  .object({ justificativa, senha: z.string().min(1).max(200).optional() })
  .strict();
export type SuspenderDocumento = z.infer<typeof esquemaSuspenderDocumento>;

export const esquemaSegundaVia = z
  .object({ motivo: textoCp1252(200).pipe(z.string().trim().min(5)) })
  .strict();

// ── Atestados, declarações e requerimentos (regra 5) ──────────────────────────────────────────────────

export const TIPOS_ATESTADO = ['atestado', 'declaracao', 'requerimento'] as const;
export type TipoAtestado = (typeof TIPOS_ATESTADO)[number];

export const esquemaEmitirAtestado = z
  .object({
    atendimento: id,
    tipo: z.enum(TIPOS_ATESTADO),
    /** Modelo de impressão do legado (a ficha em uso). */
    modelo: id,
    texto: textoCp1252(4000).pipe(z.string().trim().min(10)),
    diasAfastamento: z.number().int().min(0).max(365).optional(),
    cid: z
      .string()
      .regex(/^[A-Z]\d{2}(\.?\d{1,2})?$/)
      .optional(),
    autorizacaoCid: z.enum(['paciente', 'responsavel']).optional(),
    /** Correção: o atestado original (suspenso), ligado ao novo como o legado liga. */
    corrige: id.optional(),
    dataHora: horaLocal.optional(),
  })
  .strict()
  .refine((x) => !x.cid || x.autorizacaoCid !== undefined, {
    message: 'O CID só sai com a autorização expressa do paciente registrada.',
    path: ['autorizacaoCid'],
  })
  .refine((x) => x.tipo !== 'atestado' || x.diasAfastamento !== undefined, {
    message: 'Informe os dias de afastamento.',
    path: ['diasAfastamento'],
  });
export type EmitirAtestado = z.infer<typeof esquemaEmitirAtestado>;

// ── TCLE ─────────────────────────────────────────────────────────────────────────────────────────────

export interface TclePep {
  readonly id: number;
  readonly procedimento: string;
  readonly tipo: string | null;
  readonly situacao: 'pendente' | 'assinado' | 'revogado';
  readonly em: string;
  readonly usuario: string;
  readonly documento: number | null;
  readonly motivo: string | null;
}

export interface TclesPaciente {
  readonly termos: readonly TclePep[];
  readonly tipos: readonly { id: number; nome: string }[];
  readonly atendimentos: readonly AtendimentoPep[];
  /** O valor herdado do atendimento (baixa confiança, DP-46.7): só mostrado, "a confirmar". */
  readonly herdado: { valor: string | null; legenda: string } | null;
  readonly emitir: AcaoLiberada;
}

export const esquemaEmitirTcle = z
  .object({
    atendimento: id,
    tipo: id.optional(),
    procedimento: textoCp1252(200).pipe(z.string().trim().min(3)),
    texto: textoCp1252(4000).pipe(z.string().trim().min(20)),
  })
  .strict();
export type EmitirTcle = z.infer<typeof esquemaEmitirTcle>;

export const esquemaSituacaoTcle = z
  .object({
    situacao: z.enum(['assinado', 'revogado']),
    motivo: textoCp1252(500).optional(),
    versao: id,
  })
  .strict()
  .refine((x) => x.situacao !== 'revogado' || (x.motivo?.trim().length ?? 0) >= 10, {
    message: 'Informe o motivo da revogação.',
    path: ['motivo'],
  });

// ── Sumário de alta, transferência e óbito (regra 13) ─────────────────────────────────────────────────

export const esquemaSumarioAlta = z
  .object({
    motivoInternacao: textoCp1252(1000).optional(),
    diagnosticos: z
      .array(z.object({ cid: z.string().max(10).optional(), descricao: textoCp1252(200) }).strict())
      .max(20)
      .default([]),
    procedimentos: z.array(textoCp1252(200)).max(30).default([]),
    evolucao: textoCp1252(4000).optional(),
    medicamentosAlta: z.array(textoCp1252(200)).max(30).default([]),
    alergias: z.array(textoCp1252(200)).max(30).default([]),
    plano: textoCp1252(2000).optional(),
    encaminhamentos: z.array(textoCp1252(200)).max(20).default([]),
    condicaoAlta: textoCp1252(200).optional(),
    // F3.3 (L124): texto das seções configuradas pelo estabelecimento, pelo código da seção.
    secoes: z
      .array(
        z
          .object({
            codigo: z.string().min(1).max(30),
            titulo: textoCp1252(150).optional(),
            texto: textoCp1252(4000),
          })
          .strict(),
      )
      .max(30)
      .optional(),
  })
  .strict();
export type SumarioAltaEstruturado = z.infer<typeof esquemaSumarioAlta>;

export const esquemaSalvarSumario = z
  .object({ atendimento: id, sumario: esquemaSumarioAlta, versao: z.number().int().min(0) })
  .strict();
export type SalvarSumario = z.infer<typeof esquemaSalvarSumario>;

export interface VersaoSumario {
  readonly versao: number;
  readonly situacao: 'rascunho' | 'finalizado';
  readonly em: string;
  readonly usuario: string;
  readonly documento: number | null;
}

export interface AltaPaciente {
  readonly atendimento: AtendimentoPep | null;
  readonly atendimentos: readonly AtendimentoPep[];
  /** O sumário montado do episódio (diagnósticos, alergias, exames) ou a última versão salva. */
  readonly sumario: SumarioAltaEstruturado;
  readonly versoes: readonly VersaoSumario[];
  readonly finalizado: boolean;
  readonly transferencias: readonly { id: number; destino: string; em: string; documento: number | null }[];
  readonly obito: {
    id: number;
    em: string;
    numero: string | null;
    documento: number | null;
    /** Nome do médico que emitiu a declaração (04-INT L74: quem cancela por terceiro vê de quem é). */
    emissor?: string | null;
  } | null;
  readonly finalizar: AcaoLiberada;
  readonly obitoAcao: AcaoLiberada;
  /**
   * Cancelar a declaração vigente (03-PEP L126): quem a emitiu ou, por cima dele, o responsável técnico ou diretor
   * clínico (04-INT L74, `porTerceiro`); o médico que não pode recebe `pode: false` com o motivo, antes de preencher.
   */
  readonly cancelarObitoAcao: AcaoLiberada & { readonly porTerceiro?: boolean };
}

export const esquemaRelatorioTransferencia = z
  .object({
    atendimento: id,
    destino: textoCp1252(200).pipe(z.string().trim().min(3)),
    motivo: textoCp1252(500).pipe(z.string().trim().min(5)),
    resumo: textoCp1252(4000).pipe(z.string().trim().min(10)),
  })
  .strict();
export type RelatorioTransferencia = z.infer<typeof esquemaRelatorioTransferencia>;

export const esquemaDeclaracaoObito = z
  .object({
    atendimento: id,
    dataHora: horaLocal,
    numero: z
      .string()
      .regex(/^\d{1,20}$/)
      .optional(),
    causas: z
      .object({
        a: textoCp1252(200).pipe(z.string().trim().min(2)),
        b: textoCp1252(200).optional(),
        c: textoCp1252(200).optional(),
        d: textoCp1252(200).optional(),
        parteII: textoCp1252(400).optional(),
      })
      .strict(),
    senha: z.string().min(1).max(200).optional(),
  })
  .strict();
export type DeclaracaoObito = z.infer<typeof esquemaDeclaracaoObito>;

/** Cancelamento da declaração de óbito (03-PEP L126): motivo escrito e a senha (operação crítica). */
export const esquemaCancelamentoObito = z
  .object({
    motivo: textoCp1252(2000).pipe(z.string().trim().min(10)),
    senha: z.string().min(1).max(200).optional(),
  })
  .strict();
export type CancelamentoObito = z.infer<typeof esquemaCancelamentoObito>;

// ── Anexos e registro de tempo ────────────────────────────────────────────────────────────────────────

export const TETO_ANEXO_BYTES = 8 * 1024 * 1024;
export const EXTENSOES_ANEXO = ['pdf', 'jpg', 'jpeg', 'png'] as const;

export interface AnexoPep {
  readonly id: number;
  readonly nome: string | null;
  readonly extensao: string | null;
  readonly tipo: string | null;
  readonly em: string | null;
  readonly profissional: string | null;
  readonly suspenso: boolean;
  readonly bytes: number | null;
}

export interface AnexosPaciente {
  readonly anexos: readonly AnexoPep[];
  readonly tipos: readonly { id: number; nome: string }[];
  readonly atendimentos: readonly AtendimentoPep[];
  readonly criar: AcaoLiberada;
}

export const esquemaAnexarDocumento = z
  .object({
    atendimento: id,
    nome: textoCp1252(40).pipe(z.string().trim().min(2)),
    extensao: z.enum(EXTENSOES_ANEXO),
    tipo: id.optional(),
    /** Conteúdo em base64 (até 8 MB). */
    conteudo: z.string().max(Math.ceil((TETO_ANEXO_BYTES * 4) / 3) + 4),
    referencia: data.optional(),
  })
  .strict();
export type AnexarDocumento = z.infer<typeof esquemaAnexarDocumento>;

export interface TempoEvento {
  readonly id: number;
  readonly quando: string | null;
  readonly situacao: string | null;
  readonly profissional: string | null;
  readonly gravadoEm: string | null;
}

// ── Parecer e interconsulta (regra 10) ────────────────────────────────────────────────────────────────

export const PRIORIDADES_PARECER = ['rotina', 'prioritario', 'urgente'] as const;
export type PrioridadeParecer = (typeof PRIORIDADES_PARECER)[number];

export const SITUACOES_PARECER = ['solicitado', 'aceito', 'respondido', 'cancelado'] as const;
export type SituacaoParecer = (typeof SITUACOES_PARECER)[number];

export interface ParecerFila {
  readonly id: number;
  readonly paciente: number;
  readonly nome: string;
  readonly leito: string | null;
  readonly especialidade: string | null;
  readonly categoria: CategoriaAssistencial | null;
  readonly prioridade: PrioridadeParecer;
  readonly prazo: string | null;
  readonly atrasado: boolean;
  readonly situacao: SituacaoParecer;
  readonly solicitante: string;
  readonly pedidoEm: string;
  readonly pedido: number | null;
  readonly resposta: number | null;
  readonly origem: 'novo' | 'legado';
}

export const esquemaFiltrosParecer = z
  .object({
    especialidade: idRota.optional(),
    categoria: z.enum(CATEGORIAS_ASSISTENCIAIS).optional(),
    situacao: z.enum(SITUACOES_PARECER).optional(),
  })
  .strict();

export interface FilaPareceres {
  readonly itens: readonly ParecerFila[];
  readonly especialidades: readonly { id: number; nome: string }[];
  readonly historico: { pedidos: number; respostas: number; encaminhamentos: number };
  readonly criar: AcaoLiberada;
  readonly responder: AcaoLiberada;
}

/** Dados do parecer que viajam com o registro clínico do pedido (modelo de solicitação de parecer). */
export const esquemaFluxoParecer = z
  .object({
    tipo: z.literal('pedido'),
    especialidade: id.optional(),
    categoria: z.enum(CATEGORIAS_ASSISTENCIAIS).optional(),
    prioridade: z.enum(PRIORIDADES_PARECER),
    prazoHoras: z.number().int().min(1).max(720).optional(),
  })
  .strict()
  .or(z.object({ tipo: z.literal('resposta'), parecer: id }).strict());
export type FluxoParecer = z.infer<typeof esquemaFluxoParecer>;

export const esquemaCancelarParecer = z
  .object({ motivo: textoCp1252(500).pipe(z.string().trim().min(10)) })
  .strict();

// ── Pendências de assinatura (regra 9) ────────────────────────────────────────────────────────────────

export interface PendenciaAssinatura {
  readonly documento: number;
  readonly tipo: string;
  readonly titulo: string;
  readonly paciente: number;
  readonly nome: string;
  readonly emitidoEm: string;
  readonly hash: string;
}

/** Regra 3: o registro do residente que aguarda a coassinatura de quem está lendo (o preceptor indicado). */
export interface CoassinaturaPendente {
  readonly id: number;
  readonly registro: number;
  readonly paciente: number;
  readonly nome: string;
  readonly residente: string;
  readonly em: string | null;
}

export interface PendenciasAssinatura {
  readonly itens: readonly PendenciaAssinatura[];
  readonly total: number;
  /** Regra 3: registros de residentes que aguardam a coassinatura deste preceptor. */
  readonly coassinaturas: readonly CoassinaturaPendente[];
}

export const esquemaCoassinar = z
  .object({
    decisao: z.enum(['coassinado', 'recusado']),
    motivo: textoCp1252(500).pipe(z.string().trim().min(10)).optional(),
  })
  .strict()
  .refine((x) => x.decisao === 'coassinado' || x.motivo !== undefined, {
    path: ['motivo'],
    message: 'Informe o motivo da recusa.',
  });
export type Coassinar = z.infer<typeof esquemaCoassinar>;

export interface PreviaAssinatura {
  readonly documento: number;
  readonly titulo: string;
  readonly paragrafos: readonly string[];
  readonly hash: string;
}

export const esquemaAssinarLote = z
  .object({
    documentos: z.array(id).min(1).max(200),
    /** Hash de cada documento como a tela o mostrou (prévia exata): diferente → recusa aquele. */
    hashes: z
      .array(z.string().regex(/^[0-9a-f]{64}$/))
      .min(1)
      .max(200),
    senha: z.string().min(1).max(200).optional(),
  })
  .strict()
  .refine((x) => x.documentos.length === x.hashes.length, {
    message: 'Um hash por documento.',
    path: ['hashes'],
  });
export type AssinarLote = z.infer<typeof esquemaAssinarLote>;

export interface ResultadoAssinatura {
  readonly assinados: readonly number[];
  readonly recusados: readonly { documento: number; motivo: string }[];
}

// ── Documento gravado (resposta comum) ─────────────────────────────────────────────────────────────────

export interface DocumentoGravado {
  readonly documento: number;
  readonly origem: number;
  readonly hash: string;
  readonly pdf: boolean;
  readonly qr: string | null;
}

export const esquemaIdRota = idRota;

// 01-ADM L82: corpo da impressão do documento do prontuário (justificativa ou motivo da nova via).
export * from './impressao-prontuario.js';
