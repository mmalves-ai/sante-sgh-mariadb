// Contratos do portal do médico externo, etapa 3 do M50 (ficha, seções 4, 5 e 7; regra 6; DP-43). O portal é o do M26
// (`/resultados`, conta própria em SGH_SADT_PORTAL_ACESSO com segundo fator): o médico vê o extrato de produção e
// repasse e a agenda cirúrgica DELE e pede cirurgia (o pedido nasce "solicitado" e não ocupa a sala; a secretaria do
// bloco confirma pela agenda do M18). O portal nunca manda o ID do profissional nem o código de prestador: o servidor
// tira os dois do vínculo da conta, decidido por uma pessoa do hospital. Vocabulário do novo; nenhum nome de tabela.
import { z } from 'zod';
import { esquemaHhmm } from '../agenda/entradas.js';
import { esquemaDuracaoMin, esquemaSala } from '../cirurgia/entradas.js';
import { esquemaDataIso } from '../preco/entradas.js';
import type {
  CertificadoVinculadoResumo,
  ExigenciaAssinatura,
  SituacaoIcpDocumento,
} from '../documento-assinatura/respostas.js';
import { type MotivoRecusaAssinatura, TETO_LOTE_ASSINATURA } from '../documento-assinatura/vocabulario.js';
import type { ExtratoRepasseResposta } from '../repasse/respostas.js';
import { textoCp1252 } from '../texto-cp1252.js';

const id = z.number().int().positive().max(2_147_483_647);
const smallint = z.number().int().min(0).max(32767);
const espacos = (t: string) => t.replace(/\s+/g, ' ').trim();

/** A chave da funcionalidade (Funcionalidades por estabelecimento; POL-3): desligada até o DPO e o bloco aprovarem. */
export const CHAVE_PORTAL_MEDICO = 'portal.medicoExterno';

/** Até quantos dias à frente o médico externo pede cirurgia (a secretaria decide a sala e a hora na confirmação). */
export const PORTAL_MEDICO_PEDIDO_DIAS_MAX = 180;
/** A janela da agenda do cirurgião no portal: até 62 dias por consulta. */
export const PORTAL_MEDICO_AGENDA_DIAS_MAX = 62;

// ── Portal (sessão do médico externo) ────────────────────────────────────────────────────────────────────────────

/** Pedido de cirurgia pelo portal: o paciente como o médico informou (o cadastro é localizado na confirmação). */
export const esquemaPedidoCirurgiaPortal = z
  .object({
    sala: esquemaSala,
    data: esquemaDataIso,
    hora: esquemaHhmm,
    duracaoMin: esquemaDuracaoMin,
    procedimento: id,
    convenio: smallint,
    carater: smallint.default(2),
    anestesia: smallint.default(0),
    paciente: z
      .object({
        nome: textoCp1252(70)
          .overwrite((t) => espacos(t).toUpperCase())
          .pipe(z.string().min(5, 'Informe o nome completo do paciente.')),
        nascimento: esquemaDataIso,
      })
      .strict(),
    observacao: textoCp1252(150).overwrite(espacos).nullable().optional(),
  })
  .strict();
export type PedidoCirurgiaPortal = z.infer<typeof esquemaPedidoCirurgiaPortal>;

/** O médico retira o próprio pedido ainda não confirmado (o motivo é opcional). */
export const esquemaRetirarPedidoPortal = z
  .object({ motivo: textoCp1252(200).overwrite(espacos).nullable().optional() })
  .strict();
export type RetirarPedidoPortal = z.infer<typeof esquemaRetirarPedidoPortal>;

/**
 * W0-10: o médico altera o próprio pedido ainda não confirmado: o pedido inteiro como deve ficar, a versão que ele viu
 * (a desatualizada é recusada) e o motivo (a versão anterior fica guardada e visível). O confirmado devolve 409.
 */
export const esquemaAlterarPedidoPortal = esquemaPedidoCirurgiaPortal
  .extend({
    versao: z.number().int().min(1).max(32_000),
    motivo: textoCp1252(200)
      .overwrite(espacos)
      .pipe(z.string().min(5, 'Informe o motivo da alteração (ao menos 5 letras).')),
  })
  .strict();
export type AlterarPedidoPortal = z.infer<typeof esquemaAlterarPedidoPortal>;

/** W0-10: uma versão anterior do pedido (como estava antes da alteração, com o motivo de quem alterou). */
export interface VersaoPedidoPortalMedico {
  readonly versao: number;
  readonly data: string;
  readonly hora: string;
  readonly duracaoMin: number;
  readonly sala: string;
  readonly procedimento: string;
  readonly convenio: string;
  readonly paciente: string | null;
  readonly observacao: string | null;
  /** O motivo da alteração que substituiu esta versão, e quando. */
  readonly motivo: string;
  readonly substituidaEm: string;
}

/** Situação do vínculo da conta com o corpo clínico, mostrada ao médico (sem dado de outra pessoa). */
export interface VinculoDoPortalMedico {
  readonly vinculado: boolean;
  readonly profissional: string | null;
}

export interface ExtratoPortalMedico extends VinculoDoPortalMedico {
  /** O extrato do repasse dos códigos de prestador do profissional (null sem vínculo). */
  readonly extrato: ExtratoRepasseResposta | null;
  /**
   * Códigos do profissional que ficaram fora do extrato porque outro cadastro do corpo clínico tem o mesmo número (o
   * repasse é lançado pelo número): o hospital confere antes de mostrar (0 = nada retido).
   */
  readonly retidos: number;
}

export interface AgendamentoPortalMedico {
  /** O agendamento da sala (null no pedido ainda não confirmado). */
  readonly agendamento: number | null;
  readonly data: string;
  readonly hora: string;
  readonly duracaoMin: number;
  readonly sala: string;
  /** Nome mascarado ("MARIA S. O."), como no mapa do bloco. */
  readonly paciente: string;
  readonly procedimento: string;
  readonly convenio: string;
  readonly estado: string;
  readonly estadoRotulo: string;
}

export interface PedidoPortalMedico {
  readonly id: number;
  readonly data: string;
  readonly hora: string;
  readonly duracaoMin: number;
  readonly sala: string;
  /** O paciente como o médico informou (o próprio pedido dele). */
  readonly paciente: string;
  readonly nascimento: string | null;
  readonly procedimento: string;
  readonly convenio: string;
  readonly estado: string;
  readonly estadoRotulo: string;
  readonly motivo: string | null;
  /** Pode retirar: ainda solicitado, sem sala ocupada. */
  readonly retiravel: boolean;
  /** W0-10: a versão vigente (1 + as anteriores) e os códigos para a alteração (null quando não se altera mais). */
  readonly versao: number;
  readonly edicao: {
    readonly sala: number;
    readonly data: string;
    /** HHMM. */
    readonly hora: string;
    readonly duracaoMin: number;
    readonly procedimento: number;
    readonly convenio: number;
    readonly carater: number;
    readonly anestesia: number;
    readonly observacao: string | null;
  } | null;
  /** As versões anteriores, da mais nova à mais antiga (vazio no pedido nunca alterado). */
  readonly versoes: readonly VersaoPedidoPortalMedico[];
}

export interface AgendaPortalMedico extends VinculoDoPortalMedico {
  readonly de: string;
  readonly ate: string;
  readonly agendamentos: readonly AgendamentoPortalMedico[];
  /** Mais de 100 agendamentos no período: a lista foi cortada (estreite o período). */
  readonly truncado: boolean;
  readonly pedidos: readonly PedidoPortalMedico[];
  /** O pedido de cirurgia pelo portal está liberado no estabelecimento. */
  readonly podePedir: boolean;
}

export interface OpcoesPortalMedico {
  readonly salas: readonly { codigo: number; nome: string }[];
  readonly convenios: readonly { codigo: number; nome: string }[];
  readonly caracteres: readonly { codigo: number; nome: string }[];
  readonly anestesias: readonly { codigo: number; nome: string }[];
  readonly hoje: string;
}

export interface ResultadoPortalMedico {
  readonly ok: true;
  readonly id: number;
  readonly mensagem: string;
}

// ── Telas internas (quem aprova o autocadastro do médico externo) ────────────────────────────────────────────────

export const esquemaVincularMedicoExterno = z.object({ profissional: id }).strict();
export type VincularMedicoExterno = z.infer<typeof esquemaVincularMedicoExterno>;

/** Quantas contas por página na lista interna. */
export const PORTAL_MEDICO_CONTAS_POR_PAGINA = 25;

/** O filtro da lista interna: nome ou número do conselho, a situação do vínculo e a página. */
export const esquemaFiltroContasMedicoExterno = z
  .object({
    q: z.string().max(60).optional(),
    // W0-10: 'todas' são as ativas e as bloqueadas; as encerradas só pelo filtro próprio.
    situacao: z.enum(['todas', 'ligadas', 'sem-vinculo', 'bloqueadas', 'encerradas']).default('todas'),
    pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .strict();
export type FiltroContasMedicoExterno = z.infer<typeof esquemaFiltroContasMedicoExterno>;

/** Um pedido de cirurgia da conta aguardando a secretaria do bloco (a tela leva ao detalhe e ao mapa no dia). */
export interface PedidoAbertoDaConta {
  readonly id: number;
  readonly data: string;
  readonly hora: string;
  readonly sala: string;
  readonly procedimento: string;
  /** Nome mascarado, como no mapa do bloco. */
  readonly paciente: string;
}

export interface ContaMedicoExterno {
  readonly acesso: number;
  /** W0-10: a situação da conta aprovada (a bloqueada não entra no portal; a encerrada é definitiva). */
  readonly situacao: SituacaoContaMedicoExterno;
  readonly nome: string;
  readonly conselho: string;
  readonly uf: string;
  readonly numero: string;
  readonly profissional: { id: number; nome: string } | null;
  readonly vinculadoPor: string | null;
  readonly vinculadoEm: string | null;
  /** Profissionais do corpo clínico com registro do mesmo número e UF (a sugestão; a pessoa decide). */
  readonly sugestoes: readonly { id: number; nome: string }[];
  /** Pedidos de cirurgia desta conta aguardando a secretaria do bloco. */
  readonly pedidosAbertos: number;
  /** Os pedidos em aberto, do mais próximo ao mais distante. */
  readonly pedidos: readonly PedidoAbertoDaConta[];
  /**
   * Números do conselho do profissional ligado que outro cadastro do corpo clínico também tem: o extrato desses números
   * fica retido no portal até o cadastro ser corrigido.
   */
  readonly codigosCompartilhados: readonly number[];
}

export interface ContasMedicoExterno {
  readonly contas: readonly ContaMedicoExterno[];
  /** Contas que passam no filtro (todas as páginas). */
  readonly total: number;
  readonly pagina: number;
  readonly porPagina: number;
  /** O portal do médico externo está liberado no estabelecimento. */
  readonly liberado: boolean;
}

// ── W0-10: bloqueio, desbloqueio e encerramento da conta (NGS1.03.08/09 d: a conta que operou não se exclui) ───────

export type SituacaoContaMedicoExterno = 'ativo' | 'bloqueado' | 'encerrado';

/**
 * O ato do hospital sobre a conta aprovada, sempre com motivo. No encerramento com pedidos de cirurgia aguardando o bloco,
 * `pedidos` é obrigatório: 'retirar' (cancelados com o motivo) ou 'manter' (ficam para a secretaria do bloco decidir).
 */
export const esquemaAtoContaMedicoExterno = z
  .object({
    ato: z.enum(['bloqueio', 'desbloqueio', 'encerramento']),
    motivo: textoCp1252(250)
      .overwrite(espacos)
      .refine((t) => t.trim().length >= 5, 'Escreva o motivo (5 letras ou mais).'),
    pedidos: z.enum(['retirar', 'manter']).nullable().optional(),
  })
  .strict();
export type AtoContaMedicoExternoEntrada = z.infer<typeof esquemaAtoContaMedicoExterno>;

/** Um ato do histórico da conta (bloqueio, desbloqueio, encerramento e, na parte seguinte, as trocas). */
export interface AtoContaMedicoExternoItem {
  readonly id: number;
  readonly ato: 'bloqueio' | 'desbloqueio' | 'encerramento' | 'troca-senha' | 'troca-email';
  readonly situacaoAnterior: string;
  readonly motivo: string | null;
  readonly pedidosPendentes: number;
  readonly decisaoPedidos: 'retirar' | 'manter' | null;
  readonly usuario: string;
  readonly em: string;
}

export interface ResultadoAtoContaMedicoExterno extends ResultadoPortalMedico {
  readonly situacao: SituacaoContaMedicoExterno;
  /** Pedidos retirados pela decisão 'retirar' (e os que não puderam ser, já confirmados pelo bloco entre a leitura e o ato). */
  readonly pedidosRetirados: number;
  readonly pedidosNaoRetirados: number;
}

// ── W0-10: o médico troca a senha e o e-mail da própria conta ─────────────────────────────────────────────────────────

const codigoTotpMedico = z.string().regex(/^\d{6}$/, 'O código tem 6 dígitos.');

/** A senha nova (a mesma regra do autocadastro: 10 a 128) com a atual e o código do autenticador. */
export const esquemaTrocarSenhaMedico = z
  .object({
    atual: z.string().min(1).max(200),
    nova: z.string().min(10, 'Use pelo menos 10 caracteres.').max(128),
    confirmacao: z.string().min(1).max(128),
    codigo: codigoTotpMedico,
  })
  .strict()
  .refine((x) => x.nova === x.confirmacao, { message: 'A confirmação não confere.', path: ['confirmacao'] })
  .refine((x) => x.nova !== x.atual, { message: 'A senha nova é igual à atual.', path: ['nova'] });
export type TrocarSenhaMedicoEntrada = z.infer<typeof esquemaTrocarSenhaMedico>;

/** O e-mail novo só vale depois do link confirmado nele (o pedido leva a senha e o código atuais). */
export const esquemaPedirTrocaEmailMedico = z
  .object({
    email: z.string().trim().toLowerCase().email('E-mail inválido.').max(100),
    senha: z.string().min(1).max(200),
    codigo: codigoTotpMedico,
  })
  .strict();
export type PedirTrocaEmailMedicoEntrada = z.infer<typeof esquemaPedirTrocaEmailMedico>;

/** O token do link enviado ao e-mail novo (256 bits em base64url) e o estabelecimento. */
export const esquemaConfirmarTrocaEmailMedico = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Link de confirmação inválido.') })
  .strict();
export type ConfirmarTrocaEmailMedicoEntrada = z.infer<typeof esquemaConfirmarTrocaEmailMedico>;

/** O pedido de troca do e-mail aberto (para onde foi o link e até quando vale). */
export interface TrocaEmailMedicoPedida {
  readonly envio: 'simulador' | 'halai';
  readonly emailMascarado: string;
  readonly validoAte: string;
}

// ── W0-10 (M4): meus pacientes no portal do médico externo ──────────────────────────────────────────────────────────
// O serviço da fila do médico interno (M27) pelo vínculo assistencial dos registros do profissional ligado à conta: o
// atendimento é dele (responsável; na internação também o médico assistente) ou ele registrou no episódio. Só esses
// pacientes aparecem e só esses abrem; cada abertura vai à trilha com o paciente (log de acesso remoto).

/** Teto da lista (o mesmo da fila interna). */
export const PORTAL_MEDICO_PACIENTES_TETO = 100;

export interface PacientePortalMedico {
  readonly paciente: number;
  readonly nome: string;
  readonly idade: string | null;
  readonly sexo: string | null;
  readonly prontuario: string;
  readonly tipo: 'internacao' | 'externo' | 'urgencia';
  readonly unidade: string | null;
  readonly leito: string | null;
  readonly dias: number | null;
  readonly previsaoAlta: string | null;
  /** Resultados liberados ainda não vistos e, deles, os críticos (a mesma conta da fila interna). */
  readonly resultadosNovos: number;
  readonly criticos: number;
  /** Maior = mais urgente (a ordem da fila interna). */
  readonly prioridade: number;
}

export interface MeusPacientesPortalMedico {
  /** A conta ainda não foi ligada a um profissional do corpo clínico pelo hospital. */
  readonly vinculado: boolean;
  readonly profissional: string | null;
  readonly pacientes: readonly PacientePortalMedico[];
  readonly total: number;
  readonly teto: number;
  readonly limitado: boolean;
  readonly geradaEm: string | null;
}

export interface ValorResultadoPortalMedico {
  readonly elemento: string;
  readonly valor: string | null;
  readonly unidade: string | null;
  readonly referencia: string | null;
}

export interface ResultadoProntuarioPortalMedico {
  readonly exame: number;
  readonly nome: string;
  readonly liberadoEm: string | null;
  readonly critico: boolean;
  readonly valores: readonly ValorResultadoPortalMedico[];
  readonly texto: string | null;
}

/** O resumo do prontuário aberto pelo médico externo (só leitura; o acesso fica na trilha). */
export interface ProntuarioPortalMedico {
  readonly paciente: PacientePortalMedico;
  readonly resultados: readonly ResultadoProntuarioPortalMedico[];
}

// ── W0-10 (M5): aviso de resultado crítico ao médico assistente externo ────────────────────────────────────────────
// O aviso é o do valor crítico do hospital (prazo pelo cadastro do valor crítico; sem ciência no prazo, sobe ao
// plantonista e depois ao supervisor). O portal mostra os avisos dos pacientes com vínculo assistencial do médico, e a
// ciência dele é registro novo com a conduta (a mesma ciência do prontuário, que para o escalonamento). A notificação ao
// médico vai pela Hal-AI (no dev, ao simulador; fora, desligada até o dono ligar), sem dado do paciente.

/** Janela dos avisos mostrados no portal (dias para trás, contando hoje). */
export const PORTAL_MEDICO_CRITICOS_DIAS = 3;

export interface AvisoCriticoPortalMedico {
  readonly aviso: number;
  readonly paciente: number;
  readonly nome: string;
  readonly prontuario: string;
  readonly exame: number;
  readonly elemento: string;
  readonly valor: string;
  readonly liberadoEm: string;
  readonly emitidoEm: string;
  readonly prazoEm: string;
  /** 0 = com o médico; 1 = já com o plantonista; 2 = já com o supervisor. */
  readonly nivel: 0 | 1 | 2;
  readonly nivelRotulo: string;
  readonly situacao: 'aguardandoCiencia' | 'escalonado' | 'comCiencia';
  readonly ciencia: { readonly usuario: string; readonly em: string } | null;
  /** Por onde a conta foi notificada (null: ainda não notificada). */
  readonly notificacao: { readonly envio: 'simulador' | 'halai' | 'desligado'; readonly em: string } | null;
}

export interface CriticosPortalMedico {
  readonly vinculado: boolean;
  readonly avisos: readonly AvisoCriticoPortalMedico[];
  readonly pendentes: number;
}

export const esquemaCienciaCriticoMedico = z
  .object({ conduta: textoCp1252(500).overwrite(espacos).pipe(z.string().min(5)) })
  .strict();
export type CienciaCriticoMedico = z.infer<typeof esquemaCienciaCriticoMedico>;

// ── W0-10 (M6): fila de assinatura remota no portal do médico externo ───────────────────────────────────────────────
// Os documentos emitidos pelo profissional ligado à conta (o login interno dele) que aguardam a assinatura ICP-Brasil
// (Lei 14.063 art. 13), assinados de fora do hospital com o certificado em NUVEM vinculado a ele (PSC por OAuth 2.0 +
// PKCE; o titular do certificado é conferido pelo CPF do cadastro). O documento assinado não se edita. Desligado por
// parâmetro (a chave `assinatura.icp` e o provedor com a credencial do PSC) até a credencial existir.

/** A tela do portal para onde o provedor devolve (o redirect_uri do portal; cadastrado no PSC). */
export const PORTAL_MEDICO_ROTA_RETORNO_ASSINATURA = '/medico-externo/assinaturas/retorno';

export interface DocumentoAssinaturaPortalMedico {
  readonly documento: number;
  readonly titulo: string;
  readonly paciente: number;
  readonly nome: string;
  readonly emitidoEm: string;
  readonly exigencia: ExigenciaAssinatura;
  readonly situacao: SituacaoIcpDocumento;
}

export interface AssinaturasPortalMedico {
  readonly vinculado: boolean;
  /** O profissional ligado tem login no sistema (é dele a autoria dos documentos). */
  readonly comLogin: boolean;
  readonly ligada: boolean;
  readonly motivoDesligada: string | null;
  /** O certificado em nuvem ativo do profissional (null: vincular no hospital primeiro). */
  readonly certificado: CertificadoVinculadoResumo | null;
  readonly documentos: readonly DocumentoAssinaturaPortalMedico[];
  readonly limitado: boolean;
}

export const esquemaAssinarPortalMedico = z
  .object({ documentos: z.array(id).min(1).max(TETO_LOTE_ASSINATURA) })
  .strict()
  .refine((x) => new Set(x.documentos).size === x.documentos.length, {
    path: ['documentos'],
    message: 'Documento repetido no lote.',
  });
export type AssinarPortalMedico = z.infer<typeof esquemaAssinarPortalMedico>;

export interface InicioAssinaturaPortalMedico {
  /** O endereço do provedor que o navegador abre (null: nada a assinar). */
  readonly endereco: string | null;
  readonly expiraEm: string | null;
  readonly recusados: readonly { readonly documento: number; readonly motivo: MotivoRecusaAssinatura }[];
}

/** A volta do provedor (a tela do portal manda o que recebeu na URL). */
export const esquemaRetornoAssinaturaPortalMedico = z
  .object({
    state: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
    code: z.string().min(1).max(2048).nullable().default(null),
    erro: z.string().max(200).nullable().default(null),
  })
  .strict();
export type RetornoAssinaturaPortalMedico = z.infer<typeof esquemaRetornoAssinaturaPortalMedico>;

export interface ResultadoAssinaturaPortalMedico {
  readonly ok: boolean;
  readonly motivo: string | null;
  readonly assinados: number;
  readonly pendentes: number;
  readonly recusados: number;
}
