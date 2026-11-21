// Porta da recepção (M19): o que as telas da recepção, o totem e os painéis leem e gravam, independente de onde (a
// API não escreve SQL fora da porta própria):
//   - `propria`: o banco do cliente pelo @sgh/nucleo (porta-propria.ts): leituras somente leitura; gravações pelo
//     Executor (trilha, outbox e idempotência na mesma transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E): recepções, serviços, senhas, guichês e agendados SINTÉTICOS em
//     memória, com as mesmas validações (Zod dos contratos) e as mesmas regras (máquina de estados, ordem da fila);
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  AssinarTermo,
  AssinaturaTermo,
  IncluirModeloTermo,
  ModeloTermo,
  NovaVersaoTermo,
  SignatarioTermo,
} from '@sgh/contratos';
import type {
  AgendadoRecepcao,
  ConfiguracaoFila,
  ContextoGravacao,
  ContextoRecepcao,
  DispositivoRecepcao,
  GravacaoFeita,
  GuicheEmUso,
  IndicadoresRecepcao,
  LiberacaoConsultada,
  NovoDispositivo,
  PacienteDaSenha,
  PainelTv,
  Recepcao,
  SenhaRecepcao,
  TrilhaGravacao,
} from './tipos.js';

export type { ContextoRecepcao } from './tipos.js';

export const PORTA_RECEPCAO = Symbol('PORTA_RECEPCAO');

export type GravacaoRecepcaoFeita = GravacaoFeita;

/** W1-04: os termos de consentimento: modelo versionado, assinatura imutável, revogação. */
export interface GravadorTermos {
  incluirModeloTermo(r: IncluirModeloTermo & { usuario: string }): Promise<number>;
  novaVersaoModeloTermo(
    r: NovaVersaoTermo & { codigo: string; usuario: string },
  ): Promise<{ id: number; versao: number }>;
  situacaoModeloTermo(r: { codigo: string; ativo: boolean; motivo: string; usuario: string }): Promise<void>;
  excluirModeloTermo(r: { codigo: string; motivo: string; usuario: string }): Promise<void>;
  assinarTermo(r: AssinarTermo & { usuario: string }): Promise<{ id: number; hash: string }>;
  revogarTermo(r: { assinatura: number; motivo: string; usuario: string }): Promise<void>;
}

/** Gravações de configuração da recepção, numa transação com a trilha junto. */
export interface GravadorRecepcao extends GravadorTermos {
  gravarFilaCfg(r: ConfiguracaoFila): Promise<void>;
  criarDispositivo(r: NovoDispositivo): Promise<{ id: number; token: string }>;
  renovarDispositivo(r: { id: number; validadeDias: number }): Promise<string>;
  /** W1-04: nome, recepção, locais, serviços, conteúdo e voz, sem reemitir o token. */
  alterarDispositivo(r: {
    id: number;
    nome: string;
    recepcao: number | null;
    locais: readonly number[];
    geradores: readonly number[];
    conteudo: string | null;
    voz: boolean;
  }): Promise<void>;
  revogarDispositivo(r: { id: number; usuario: string }): Promise<void>;
  /** M43 (regra 4): o login de TV ou de totem substituído pelo aparelho e a conferência no setor. */
  conferirDispositivo(r: { id: number; loginSubstituido: string; usuario: string }): Promise<void>;
}

export interface PortaRecepcao {
  readonly destino: 'propria' | 'memoria' | 'indisponivel';
  /** Passo 0 do executor sem gravar (a tela esconde a ação com o motivo). */
  podeGravar(c: ContextoRecepcao, operacao: string, login: string): Promise<LiberacaoConsultada>;
  executar(
    c: ContextoRecepcao,
    operacao: string,
    entrada: unknown,
    ctx: ContextoGravacao,
  ): Promise<GravacaoRecepcaoFeita>;
  /** Gravação de configuração (fila, dispositivos, termos) com a trilha na mesma transação. */
  gravar<T>(
    c: ContextoRecepcao,
    trilha: TrilhaGravacao | ((r: T) => TrilhaGravacao),
    fn: (g: GravadorRecepcao) => Promise<T>,
  ): Promise<T>;
  /** Último uso do dispositivo (técnico, sem trilha; no máximo uma gravação a cada 10 minutos). */
  marcarUsoDispositivo(c: ContextoRecepcao, id: number): Promise<void>;
  relogio(c: ContextoRecepcao): Promise<{ hoje: string; agora: string }>;
  recepcoes(c: ContextoRecepcao): Promise<Recepcao[]>;
  guichesEmUso(c: ContextoRecepcao): Promise<GuicheEmUso[]>;
  senhasDoDia(
    c: ContextoRecepcao,
    filtro: { recepcao?: number | null; geradores?: readonly number[] },
  ): Promise<{ senhas: SenhaRecepcao[]; cortada: boolean }>;
  senha(c: ContextoRecepcao, id: number): Promise<SenhaRecepcao | null>;
  aFrente(c: ContextoRecepcao, id: number): Promise<number>;
  agendados(
    c: ContextoRecepcao,
    f: {
      cpf?: string | null;
      marcacao?: { tipo: 'consulta' | 'exame'; id: number } | null;
      prontuario?: number | null;
      agenda?: string | null;
    },
  ): Promise<{ itens: AgendadoRecepcao[]; cortada: boolean }>;
  pacientesDasSenhas(c: ContextoRecepcao, ids: readonly number[]): Promise<Map<number, PacienteDaSenha>>;
  /** Dos prontuários pedidos, os do paciente marcado "sigiloso" (mascarado em painel, chamada, guichê e listas). */
  sigilosos(c: ContextoRecepcao, prontuarios: readonly number[]): Promise<ReadonlySet<number>>;
  /** Das fotos do cadastro, as dos prontuários pedidos (endereço da imagem); quem não tem foto não entra. */
  fotos(c: ContextoRecepcao, prontuarios: readonly number[]): Promise<ReadonlyMap<number, string>>;
  paineisTv(c: ContextoRecepcao): Promise<PainelTv[]>;
  usuariosTecnicos(c: ContextoRecepcao): Promise<string[]>;
  indicadores(
    c: ContextoRecepcao,
    de: string,
    ate: string,
    recepcao: number | null,
  ): Promise<IndicadoresRecepcao>;
  dispositivos(c: ContextoRecepcao): Promise<DispositivoRecepcao[]>;
  /** W1-04: os modelos de termo de consentimento (versões, situação e quantas assinaturas). */
  modelosTermo(c: ContextoRecepcao): Promise<ModeloTermo[]>;
  /** W1-04: os termos assinados do prontuário (os revogados também, marcados). */
  termosDoPaciente(c: ContextoRecepcao, prontuario: number): Promise<AssinaturaTermo[]>;
  /** W1-04: quem pode assinar o termo (paciente, representante legal). */
  signatariosTermo(c: ContextoRecepcao): Promise<SignatarioTermo[]>;
  /** O dispositivo do token em qualquer estabelecimento configurado (o token é único), ou null. */
  dispositivoDoToken(token: string): Promise<DispositivoRecepcao | null>;
}
