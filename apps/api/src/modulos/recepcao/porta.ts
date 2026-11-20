// Porta da recepção (M19): o que as telas da recepção, o totem e os painéis leem e gravam, independente de onde (a
// API não escreve SQL; fronteira Nx):
//   - `legado`: o núcleo do legado (leituras READ ONLY dos repositórios de @sgh/legado; gravações pelo EXECUTOR do
//     M04, com a trilha na mesma transação; as gravações só do novo — fila por gerador e dispositivos — por transação
//     SGH_ com a SGH_TRILHA junto);
//   - `memoria`: a sessão sintética de dev/ci (E2E): recepções, geradores, senhas, guichês e agendados SINTÉTICOS em
//     memória, com as mesmas validações (Zod dos contratos) e as mesmas regras (máquina de estados, ordem da fila);
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  AgendadoLidoLegado,
  ContextoOperacao,
  DispositivoLidoLegado,
  DispositivoSgh,
  FilaCfgSgh,
  GuicheEmUsoLegado,
  IndicadoresRecepcaoLegado,
  LiberacaoConsultada,
  LinhaTrilha,
  PacienteDaSenha,
  PainelTvLegado,
  RecepcaoLidaLegado,
  ResultadoOperacao,
  SenhaLidaLegado,
} from '@sgh/legado';
import type { LeituraCanal, MarcaVigia } from '@sgh/legado';
import type {
  AssinarTermo,
  AssinaturaTermo,
  SignatarioTermo,
  CanalVigia,
  IncluirModeloTermo,
  ModeloTermo,
  NovaVersaoTermo,
} from '@sgh/contratos';

export const PORTA_RECEPCAO = Symbol('PORTA_RECEPCAO');

export interface ContextoRecepcao {
  readonly rede: string;
  readonly hospital: string;
}

export interface GravacaoRecepcaoFeita {
  readonly resultado: ResultadoOperacao;
  readonly repetida: boolean;
  readonly trilha: string | null;
}

/** W1-04: os termos de consentimento (SGH_REC_TERMO_*): modelo versionado, assinatura imutável, revogação. */
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

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto. */
export interface GravadorSghRecepcao extends GravadorTermos {
  gravarFilaCfg(r: Omit<FilaCfgSgh, 'hospital'>): Promise<void>;
  criarDispositivo(r: Omit<DispositivoSgh, 'hospital'>): Promise<{ id: number; token: string }>;
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
  readonly destino: 'legado' | 'memoria' | 'indisponivel';
  /** Passo 0 do executor sem gravar (a tela esconde a ação com o motivo). */
  podeGravar(c: ContextoRecepcao, operacao: string, usuarioLegado: string): Promise<LiberacaoConsultada>;
  executar(
    c: ContextoRecepcao,
    operacao: string,
    entrada: unknown,
    ctx: ContextoOperacao,
  ): Promise<GravacaoRecepcaoFeita>;
  gravarSgh<T>(
    c: ContextoRecepcao,
    trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorSghRecepcao) => Promise<T>,
  ): Promise<T>;
  /** Último uso do dispositivo (técnico, sem trilha; no máximo uma gravação a cada 10 minutos). */
  marcarUsoDispositivo(c: ContextoRecepcao, id: number): Promise<void>;
  /**
   * As chamadas do outro sistema que o vigia viu (o guichê passou de 0 a um número): a primeira chamada vai à
   * extensão da senha (tempos por etapa dos dois sistemas), com a trilha junto. Devolve quantas gravou.
   */
  registrarChamadasDeFora(
    c: ContextoRecepcao,
    chamadas: readonly { senha: number; guiche: number; local: number | null }[],
  ): Promise<number>;

  relogio(c: ContextoRecepcao): Promise<{ hoje: string; agora: string }>;
  recepcoes(c: ContextoRecepcao): Promise<RecepcaoLidaLegado[]>;
  guichesEmUso(c: ContextoRecepcao): Promise<GuicheEmUsoLegado[]>;
  senhasDoDia(
    c: ContextoRecepcao,
    filtro: { recepcao?: number | null; geradores?: readonly number[] },
  ): Promise<{ senhas: SenhaLidaLegado[]; cortada: boolean }>;
  senha(c: ContextoRecepcao, id: number): Promise<SenhaLidaLegado | null>;
  aFrente(c: ContextoRecepcao, id: number): Promise<number>;
  agendados(
    c: ContextoRecepcao,
    f: {
      cpf?: string | null;
      marcacao?: { tipo: 'consulta' | 'exame'; id: number } | null;
      prontuario?: number | null;
      agenda?: string | null;
    },
  ): Promise<{ itens: AgendadoLidoLegado[]; cortada: boolean }>;
  pacientesDasSenhas(c: ContextoRecepcao, ids: readonly number[]): Promise<Map<number, PacienteDaSenha>>;
  /** Dos prontuários pedidos, os do paciente marcado "sigiloso" (mascarado em painel, chamada, guichê e listas). */
  sigilosos(c: ContextoRecepcao, prontuarios: readonly number[]): Promise<ReadonlySet<number>>;
  /** Das fotos do cadastro, as dos prontuários pedidos (endereço da imagem); quem não tem foto não entra. */
  fotos(c: ContextoRecepcao, prontuarios: readonly number[]): Promise<ReadonlyMap<number, string>>;
  parametros(c: ContextoRecepcao): Promise<Record<string, string | number | null>>;
  paineisTv(c: ContextoRecepcao): Promise<PainelTvLegado[]>;
  usuariosTecnicos(c: ContextoRecepcao): Promise<string[]>;
  indicadores(
    c: ContextoRecepcao,
    de: string,
    ate: string,
    recepcao: number | null,
  ): Promise<IndicadoresRecepcaoLegado>;
  dispositivos(c: ContextoRecepcao): Promise<DispositivoLidoLegado[]>;
  /** W1-04: os modelos de termo de consentimento (versões, situação e quantas assinaturas). */
  modelosTermo(c: ContextoRecepcao): Promise<ModeloTermo[]>;
  /** W1-04: os termos assinados do prontuário (os revogados também, marcados). */
  termosDoPaciente(c: ContextoRecepcao, prontuario: number): Promise<AssinaturaTermo[]>;
  /** W1-04: quem pode assinar o termo (TBTIPOREPRE ativo: paciente, representante legal). */
  signatariosTermo(c: ContextoRecepcao): Promise<SignatarioTermo[]>;
  /** O dispositivo do token em qualquer estabelecimento configurado (o token é único), ou null. */
  dispositivoDoToken(token: string): Promise<DispositivoLidoLegado | null>;
  /** Canal "senhas" do vigia na fonte sintética (a fonte do legado usa o canal do M16). */
  canalSenhas?(c: ContextoRecepcao, marca: MarcaVigia): Promise<LeituraCanal>;
}

export type { CanalVigia };
