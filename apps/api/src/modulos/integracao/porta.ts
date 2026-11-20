// Porta das integrações novas (M34; ficha, seções 4 a 7, regras 7 a 16): o que as telas de integração, o monitor de
// filas, a entrada idempotente e a conferência do laboratório de apoio leem e gravam, independente de onde (a API não
// escreve SQL; fronteira Nx):
//   - `legado`: leituras READ ONLY (as SGH_INTG_*, a saúde das integrações do legado que seguem pelos gatilhos, as
//     visões dos parceiros, a identificação para a RNDS, o de-para do laboratório de apoio); gravações só em SGH_ com
//     a SGH_TRILHA na mesma transação (e o evento na SGH_OUTBOX na MESMA transação: regra 7); o resultado conferido do
//     laboratório de apoio pelo EXECUTOR do M04 (`sadt.registrarResultado`, cenário origem-apoio);
//   - `memoria`: a sessão sintética de dev/ci (E2E): parceiros, mensagens (com uma na fila de mortos) e um retorno do
//     laboratório de apoio SINTÉTICOS; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import type {
  ContagemPorSituacao,
  ContextoOperacao,
  LiberacaoConsultada,
  ResultadoOperacao,
  EnvioLidoBanco,
  EnvioNovo,
  FatoResultadoLiberado,
  InterfaceApoio,
  LinhaTrilha,
  MarcaFato,
  ParceiroGravado,
  ParceiroLidoBanco,
  RecebidaLidaBanco,
  RecebidaNova,
  SaudeLegadoLida,
} from '@sgh/legado';

export const PORTA_INTEGRACAO = Symbol('PORTA_INTEGRACAO');

export interface ContextoIntegracao {
  readonly rede: string;
  readonly hospital: string;
}

export interface EventoNaOutbox {
  readonly tipo: string;
  readonly chave: string;
  readonly carga: Record<string, string>;
}

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA (e a outbox) junto. */
export interface GravadorSghIntegracao {
  criarParceiro(p: ParceiroGravado, usuario: string): Promise<string>;
  alterarParceiro(
    codigo: string,
    p: Omit<ParceiroGravado, 'codigo' | 'tipo'> & { readonly ativo: boolean },
    usuario: string,
  ): Promise<number>;
  gravarCredencial(codigo: string, clienteId: string, resumo: string, usuario: string): Promise<number>;
  tratarMorto(
    id: string,
    t: { acao: 'reprocessar' | 'corrigir' | 'descartar'; motivo: string; usuario: string },
  ): Promise<number>;
  registrarRecebida(r: RecebidaNova): Promise<{ recebida: RecebidaLidaBanco; repetida: boolean }>;
  concluirRecebida(
    id: string,
    c: {
      situacao: 'processada' | 'recusada';
      detalhe: string | null;
      tabelaObjeto: string | null;
      idObjeto: string | null;
      usuario: string;
    },
  ): Promise<number>;
  registrarEnvio(n: EnvioNovo): Promise<boolean>;
  /** Regra 7: o evento na SGH_OUTBOX na mesma transação do fato (a transação que falha não deixa evento). */
  outbox(ev: EventoNaOutbox): Promise<string>;
}

export interface VinculoResponsavel {
  readonly vinculo: number;
  readonly conselho: number;
  readonly nome: string;
  readonly ativo: boolean;
}

export interface ExameDoRetorno {
  readonly id: number;
  readonly paciente: number;
  readonly ato: number;
  readonly exame: string;
  readonly exameNome: string | null;
  readonly liberado: boolean;
  readonly digitado: boolean;
  readonly elementos: readonly { elemento: number; nome: string }[];
}

export interface PortaIntegracao {
  readonly destino: 'legado' | 'memoria';
  relogio(c: ContextoIntegracao): Promise<Date>;
  parceiros(c: ContextoIntegracao): Promise<ParceiroLidoBanco[]>;
  parceiro(c: ContextoIntegracao, codigo: string): Promise<ParceiroLidoBanco | null>;
  credencial(
    c: ContextoIntegracao,
    clienteId: string,
  ): Promise<{ codigo: string; resumo: string; ativo: boolean; escopos: string[] } | null>;
  envios(
    c: ContextoIntegracao,
    f: { readonly situacao?: string; readonly parceiro?: string; readonly limite: number },
  ): Promise<EnvioLidoBanco[]>;
  envio(c: ContextoIntegracao, id: string): Promise<EnvioLidoBanco | null>;
  mortos(c: ContextoIntegracao): Promise<EnvioLidoBanco[]>;
  contagens(c: ContextoIntegracao): Promise<{
    outbox: ContagemPorSituacao[];
    envios: ContagemPorSituacao[];
    entradas: ContagemPorSituacao[];
  }>;
  recebidas(
    c: ContextoIntegracao,
    f: { readonly situacao?: string; readonly parceiro?: string; readonly limite: number },
  ): Promise<RecebidaLidaBanco[]>;
  recebida(c: ContextoIntegracao, id: string): Promise<RecebidaLidaBanco | null>;
  saudeLegado(c: ContextoIntegracao): Promise<SaudeLegadoLida>;
  visoes(
    c: ContextoIntegracao,
    contar: boolean,
  ): Promise<{ visao: string; existe: boolean; linhas: number | string | null }[]>;
  identificacao(c: ContextoIntegracao): Promise<{
    pacientesComCpf: number | string;
    pacientesComCns: number | string;
    profissionaisComCns: number | string;
    estabelecimentoComCnes: boolean;
  }>;
  interfacesApoio(c: ContextoIntegracao): Promise<InterfaceApoio[]>;
  deParaExame(
    c: ContextoIntegracao,
    interfaceApoio: number,
    codigoExame: string,
  ): Promise<{ exame: number | null; elementos: { codigoLaboratorio: string; nome: string | null }[] }>;
  exameDoRetorno(c: ContextoIntegracao, id: number): Promise<ExameDoRetorno | null>;
  /** O exame lido para a receita (chave de 7 colunas e o carimbo, para a concorrência do executor). */
  exameLido(
    c: ContextoIntegracao,
    id: number,
  ): Promise<{ id: number; chave: unknown; versao: string | null } | null>;
  vinculos(c: ContextoIntegracao, login: string): Promise<VinculoResponsavel[]>;
  marca(c: ContextoIntegracao, fato: string): Promise<MarcaFato>;
  fatosResultadoLiberado(
    c: ContextoIntegracao,
    desde: Date | null,
    lote: number,
  ): Promise<FatoResultadoLiberado[]>;
  /** A gravação no legado pelo executor (receita do catálogo; trilha na mesma transação). */
  executar(
    c: ContextoIntegracao,
    operacao: string,
    entrada: unknown,
    octx: ContextoOperacao,
  ): Promise<{ resultado: ResultadoOperacao; repetida: boolean }>;
  podeGravar(c: ContextoIntegracao, operacao: string, usuarioLegado: string): Promise<LiberacaoConsultada>;
  gravarSgh<T>(
    c: ContextoIntegracao,
    trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorSghIntegracao) => Promise<T>,
  ): Promise<T>;
}

export const METODOS_PORTA_INTEGRACAO: ReadonlySet<string> = new Set([
  'relogio',
  'parceiros',
  'parceiro',
  'credencial',
  'envios',
  'envio',
  'mortos',
  'contagens',
  'recebidas',
  'recebida',
  'saudeLegado',
  'visoes',
  'identificacao',
  'interfacesApoio',
  'deParaExame',
  'exameDoRetorno',
  'exameLido',
  'vinculos',
  'marca',
  'fatosResultadoLiberado',
  'executar',
  'podeGravar',
  'gravarSgh',
]);
