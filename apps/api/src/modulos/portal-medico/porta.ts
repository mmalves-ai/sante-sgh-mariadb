// Porta do portal do médico externo (M50, etapa 3): o vínculo da conta do portal (SGH_SADT_PORTAL_ACESSO, do M26) com o
// profissional do corpo clínico e as leituras do profissional (a API não escreve SQL; fronteira Nx). A agenda do bloco e
// o pedido de cirurgia vão pela porta do M18 (PORTA_CIRURGIA); o extrato, pela do M33 (PORTA_REPASSE).
//   - `legado`: o núcleo (READ ONLY nas leituras; transação SGH_ com a SGH_TRILHA nas gravações);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo.
import type {
  AtoContaMedico,
  AtoContaMedicoLido,
  DecisaoPedidosConta,
  LinhaTrilha,
  ProfissionalCorpoClinicoLido,
  EnvioCriticoMedico,
  EnvioTrocaEmailMedico,
  NotificacaoCriticoMedicoLida,
  SituacaoContaMedico,
  TrocaEmailMedicoLida,
  VinculoMedicoExternoLido,
} from '@sgh/legado';

export const PORTA_PORTAL_MEDICO = Symbol('PORTA_PORTAL_MEDICO');

export interface ContextoPortalMedico {
  readonly rede: string;
  readonly hospital: string;
}

export interface GravadorPortalMedico {
  vincular(r: { acesso: number; profissional: number; por: string }): Promise<void>;
  desvincular(r: { acesso: number; por: string }): Promise<void>;
  /** W0-10: bloqueio, desbloqueio ou encerramento com motivo (fato novo; a conta relida sob trava). */
  atoConta(r: {
    acesso: number;
    ato: AtoContaMedico;
    motivo: string;
    pedidosPendentes: number;
    decisaoPedidos: DecisaoPedidosConta | null;
    amostraPedidos: readonly string[];
    por: string;
  }): Promise<{ situacao: SituacaoContaMedico; anterior: string; id: number }>;
  /** W0-10: a senha nova da conta ativa (o resumo já calculado) e o ato 'troca-senha'. */
  trocarSenha(r: { acesso: number; senhaResumo: string; por: string }): Promise<{ id: number }>;
  /** W0-10: o pedido da troca do e-mail (cancela o pendente anterior). */
  pedirTrocaEmail(r: {
    acesso: number;
    emailNovo: string;
    tokenResumo: string;
    validoAte: Date;
    envio: EnvioTrocaEmailMedico;
  }): Promise<{ id: number }>;
  cancelarTrocaEmail(troca: number): Promise<void>;
  /** W0-10: o link do e-mail novo confirmado: a conta ativa passa ao e-mail novo e o ato 'troca-email'. */
  confirmarTrocaEmail(r: {
    tokenResumo: string;
    agora: Date;
    por: string;
  }): Promise<{ acesso: number; emailNovo: string; id: number }>;
  /** W0-10 (M5): a conta notificada do aviso de crítico (false: já notificada; uma por aviso e conta). */
  notificarCritico(r: {
    aviso: number;
    acesso: number;
    envio: EnvioCriticoMedico;
    motivo: string | null;
  }): Promise<boolean>;
}

export interface PortaPortalMedico {
  readonly destino: 'legado' | 'memoria';
  gravar<T>(
    c: ContextoPortalMedico,
    fn: (g: GravadorPortalMedico) => Promise<T>,
    trilha: LinhaTrilha | null,
  ): Promise<T>;
  /** Só a linha da trilha (a leitura auditada do extrato e da agenda pelo portal). */
  registrarLeitura(c: ContextoPortalMedico, trilha: LinhaTrilha): Promise<void>;
  vinculos(
    c: ContextoPortalMedico,
    acessos: readonly number[],
  ): Promise<Map<number, VinculoMedicoExternoLido>>;
  profissional(c: ContextoPortalMedico, id: number): Promise<ProfissionalCorpoClinicoLido | null>;
  /** Vários profissionais numa consulta (a lista interna das contas). */
  profissionais(
    c: ContextoPortalMedico,
    ids: readonly number[],
  ): Promise<Map<number, ProfissionalCorpoClinicoLido>>;
  /** Quem tem cada código de prestador (TBPROFIS.ID; 0 = registro sem profissional): o código repetido fica retido. */
  donosDosCodigos(c: ContextoPortalMedico, codigos: readonly number[]): Promise<Map<number, Set<number>>>;
  sugestoes(c: ContextoPortalMedico, uf: string, numero: number): Promise<{ id: number; nome: string }[]>;
  /** A sugestão de várias contas numa consulta (chave "UF:número"). */
  sugestoesEmLote(
    c: ContextoPortalMedico,
    pares: readonly { uf: string; numero: number }[],
  ): Promise<Map<string, { id: number; nome: string }[]>>;
  buscarProfissionais(c: ContextoPortalMedico, texto: string): Promise<{ id: number; nome: string }[]>;
  /** W0-10: o histórico dos atos da conta (mais recente primeiro). */
  atosConta(c: ContextoPortalMedico, acesso: number): Promise<AtoContaMedicoLido[]>;
  /** W0-10: o pedido pendente da troca do e-mail da conta e o pedido pelo resumo do token. */
  trocaEmailPendente(c: ContextoPortalMedico, acesso: number): Promise<TrocaEmailMedicoLida | null>;
  trocaEmailPorToken(c: ContextoPortalMedico, tokenResumo: string): Promise<TrocaEmailMedicoLida | null>;
  /** W0-10 (M5): as notificações de crítico da conta (mais recente primeiro). */
  notificacoesCritico(c: ContextoPortalMedico, acesso: number): Promise<NotificacaoCriticoMedicoLida[]>;
  /** W0-10 (M6): o login do sistema do profissional ligado (autor dos documentos a assinar); null sem login. */
  loginDoProfissional(c: ContextoPortalMedico, profissional: number): Promise<string | null>;
}

export const METODOS_PORTA_PORTAL_MEDICO: ReadonlySet<string> = new Set([
  'gravar',
  'registrarLeitura',
  'vinculos',
  'profissional',
  'profissionais',
  'donosDosCodigos',
  'sugestoes',
  'sugestoesEmLote',
  'buscarProfissionais',
  'atosConta',
  'trocaEmailPendente',
  'trocaEmailPorToken',
  'notificacoesCritico',
  'loginDoProfissional',
]);
