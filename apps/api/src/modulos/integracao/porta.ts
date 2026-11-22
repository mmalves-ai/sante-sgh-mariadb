// Porta das integrações (M34; ficha, seções 4 a 7, regras 7 a 16): o que as telas de integração, o monitor de filas,
// a entrada idempotente e a conferência do laboratório de apoio leem e gravam, independente de onde (a API não escreve
// SQL; fronteira Nx):
//   - `banco`: o banco do cliente pelo @sgh/nucleo (porta-propria.ts): parceiros, clientes e chaves da API, mensagens
//     de entrada e de saída, falhas tratadas e o resultado conferido do laboratório de apoio, sempre pelo Executor
//     (trilha, idempotência e a mensagem de saída na MESMA transação: regra 7);
//   - `memoria`: a sessão sintética de dev/ci (E2E): parceiros, mensagens (uma na fila de mortos) e um retorno do
//     laboratório de apoio SINTÉTICOS;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Melhoria: tipos de negócio do próprio módulo (booleano, data, id numérico); nada de nome de tabela antiga, de S/N
// nem de leitura incremental de fatos por gatilho (os fatos chegam pela mensagem de saída do Executor).
import type { RetornoApoioLido } from '@sgh/contratos';
import type { LinhaTrilha } from '@sgh/nucleo';
import type { ContextoGravacao } from '../cadastro/tipos.js';

export const PORTA_INTEGRACAO = Symbol('PORTA_INTEGRACAO');

/** Onde a gravação aconteceu: o código do estabelecimento (e, na sessão, o contexto do núcleo por id). */
export interface ContextoIntegracao {
  readonly rede: string;
  readonly hospital: string;
  readonly estabelecimento?: number | null;
  readonly usuario?: number | null;
  readonly correlacao?: string;
}

/** A linha da trilha de uma gravação da porta (o instante é o da transação). */
export type TrilhaIntegracao = Omit<LinhaTrilha, 'ocorridoEm'> & { readonly ocorridoEm?: Date };

export interface EventoNaSaida {
  readonly tipo: string;
  readonly chave: string;
  readonly carga: Readonly<Record<string, string | number | boolean | null>>;
}

export const BASES_LEGAIS_PARCEIRO = [
  'tutela-da-saude',
  'obrigacao-legal',
  'politicas-publicas',
  'execucao-de-contrato',
  'exercicio-de-direitos',
  'consentimento',
  'estudo-pesquisa',
] as const;

export interface DadosParceiro {
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: string;
  readonly canal: string | null;
  readonly escopos: readonly string[];
  readonly eventos: readonly string[];
  readonly limiteTentativas: number;
  readonly finalidade: string;
  readonly baseLegal: string;
}

export interface ParceiroIntegracao extends DadosParceiro {
  readonly id: string;
  readonly clienteId: string | null;
  readonly temSegredo: boolean;
  readonly ativo: boolean;
  readonly criadoPor: string;
  readonly alteradoEm: Date | null;
}

export type SituacaoEnvio = 'pendente' | 'enviado' | 'morto' | 'descartado';
export type TratamentoEnvio = 'reprocessar' | 'corrigir' | 'descartar';

export interface NovoEnvio {
  /** A mensagem de saída do Executor (integracao_mensagem) que originou a entrega. */
  readonly idOutbox: string;
  readonly chaveEvento: string;
  readonly tipoEvento: string;
  readonly parceiro: string;
  readonly chaveOrdem: string;
  readonly tabelaFato: string | null;
  readonly idFato: string | null;
}

export interface EnvioIntegracao extends NovoEnvio {
  readonly id: string;
  readonly situacao: SituacaoEnvio;
  readonly tentativas: number;
  readonly proximaTentativaEm: Date | null;
  readonly enviadoEm: Date | null;
  readonly recibo: string | null;
  readonly resposta: string | null;
  readonly hashConteudo: string | null;
  readonly mortoEm: Date | null;
  readonly tratamento: TratamentoEnvio | null;
  readonly tratadoPor: string | null;
  readonly motivoTratamento: string | null;
  readonly criadoEm: Date;
}

export interface ContagemPorSituacao {
  readonly chave: string;
  readonly situacao: string;
  readonly quantidade: number;
}

export type SituacaoRecebida = 'recebida' | 'conferir' | 'processada' | 'recusada';

export interface NovaRecebida {
  readonly parceiro: string;
  readonly tipo: string;
  readonly chaveParceiro: string;
  readonly hash: string;
  /** Chave do conteúdo no armazém de objetos (o conteúdo nunca vai ao banco nem à trilha). */
  readonly chaveS3: string | null;
  readonly tamanho: number;
  readonly situacao: SituacaoRecebida;
  readonly detalhe: string | null;
  readonly tabelaObjeto: string | null;
  readonly idObjeto: string | null;
}

export interface RecebidaIntegracao extends NovaRecebida {
  readonly id: string;
  readonly conferidoPor: string | null;
  readonly conferidoEm: Date | null;
  readonly recebidoEm: Date;
}

/** As filas do estabelecimento (só contagens e datas; nenhuma linha). */
export interface SaudeFilas {
  readonly filas: {
    readonly fila: string;
    readonly direcao: 'saida' | 'entrada';
    readonly quantidade: number | string;
    readonly maisAntiga: string | null;
  }[];
  readonly bi: { readonly pendentes: number | string; readonly maisAntiga: string | null };
  readonly examesApoio: {
    readonly marcados: number | string;
    readonly exportados: number | string;
    readonly pendentes: number | string;
    readonly maisAntigo: string | null;
  };
}

/** O laboratório de apoio integrado do estabelecimento (sem endereço, usuário nem segredo). */
export interface LaboratorioApoio {
  /** Identificador do laboratório de apoio. */
  readonly codigo: number;
  readonly nome: string | null;
  readonly laboratorio: string | null;
  readonly exames: number;
}

/** Gravações da integração, numa transação com a trilha (e a mensagem de saída) junto. */
export interface GravadorIntegracao {
  /** `login`: quem grava, só para a exibição na memória (no banco vale o usuário do contexto). */
  criarParceiro(p: DadosParceiro, login: string): Promise<string>;
  alterarParceiro(
    codigo: string,
    p: Omit<DadosParceiro, 'codigo' | 'tipo'> & { readonly ativo: boolean },
    login: string,
  ): Promise<number>;
  gravarCredencial(codigo: string, clienteId: string, resumo: string, login: string): Promise<number>;
  tratarMorto(id: string, t: { acao: TratamentoEnvio; motivo: string; usuario: string }): Promise<number>;
  registrarRecebida(r: NovaRecebida): Promise<{ recebida: RecebidaIntegracao; repetida: boolean }>;
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
  registrarEnvio(n: NovoEnvio): Promise<boolean>;
  /** Regra 7: o evento na mensagem de saída na mesma transação do fato (a transação que falha não deixa evento). */
  outbox(ev: EventoNaSaida): Promise<string>;
}

export interface VinculoResponsavel {
  /** O profissional que confere (responde como responsável técnico). */
  readonly vinculo: number;
  /** A inscrição no conselho de classe (0: sem inscrição ativa). */
  readonly conselho: number;
  readonly nome: string;
  readonly ativo: boolean;
}

export interface ExameDoRetorno {
  readonly id: number;
  readonly paciente: number;
  readonly atendimento: number | null;
  readonly exame: string;
  readonly exameNome: string | null;
  readonly liberado: boolean;
  readonly digitado: boolean;
  readonly elementos: readonly { elemento: number; nome: string }[];
  /** O laboratório de apoio a que o exame foi encaminhado (nulo: o pedido não diz). */
  readonly laboratorio: number | null;
}

/** O resultado conferido do laboratório de apoio, pronto para gravar no exame pedido. */
export interface ResultadoApoio {
  readonly exame: number;
  /** A versão do exame pedido lida na conferência (trava otimista). */
  readonly versao: number;
  readonly laboratorio: number | null;
  readonly elementos: readonly Pick<
    RetornoApoioLido['elementos'][number],
    'elemento' | 'numerico' | 'alfa'
  >[];
  readonly observacao: string;
  /** O profissional responsável técnico que conferiu (e libera o resultado). */
  readonly conferente: number;
  /** A mensagem recebida que trouxe o resultado: é concluída na MESMA transação do resultado. */
  readonly recebida: string | null;
}

export interface PortaIntegracao {
  readonly destino: 'banco' | 'memoria';
  relogio(c: ContextoIntegracao): Promise<Date>;
  parceiros(c: ContextoIntegracao): Promise<ParceiroIntegracao[]>;
  parceiro(c: ContextoIntegracao, codigo: string): Promise<ParceiroIntegracao | null>;
  credencial(
    c: ContextoIntegracao,
    clienteId: string,
  ): Promise<{ codigo: string; resumo: string; ativo: boolean; escopos: string[] } | null>;
  envios(
    c: ContextoIntegracao,
    f: { readonly situacao?: string; readonly parceiro?: string; readonly limite: number },
  ): Promise<EnvioIntegracao[]>;
  envio(c: ContextoIntegracao, id: string): Promise<EnvioIntegracao | null>;
  mortos(c: ContextoIntegracao): Promise<EnvioIntegracao[]>;
  contagens(c: ContextoIntegracao): Promise<{
    outbox: ContagemPorSituacao[];
    envios: ContagemPorSituacao[];
    entradas: ContagemPorSituacao[];
  }>;
  recebidas(
    c: ContextoIntegracao,
    f: { readonly situacao?: string; readonly parceiro?: string; readonly limite: number },
  ): Promise<RecebidaIntegracao[]>;
  recebida(c: ContextoIntegracao, id: string): Promise<RecebidaIntegracao | null>;
  saudeFilas(c: ContextoIntegracao): Promise<SaudeFilas>;
  identificacao(c: ContextoIntegracao): Promise<{
    pacientesComCpf: number | string;
    pacientesComCns: number | string;
    profissionaisComCns: number | string;
    estabelecimentoComCnes: boolean;
  }>;
  interfacesApoio(c: ContextoIntegracao): Promise<LaboratorioApoio[]>;
  deParaExame(
    c: ContextoIntegracao,
    laboratorio: number,
    codigoExame: string,
  ): Promise<{ exame: number | null; elementos: { codigoLaboratorio: string; nome: string | null }[] }>;
  exameDoRetorno(c: ContextoIntegracao, id: number): Promise<ExameDoRetorno | null>;
  /** O exame pedido com a versão, para a trava otimista da gravação do resultado. */
  exameLido(c: ContextoIntegracao, id: number): Promise<{ id: number; versao: number } | null>;
  vinculos(c: ContextoIntegracao, login: string): Promise<VinculoResponsavel[]>;
  /** Grava o resultado conferido do laboratório de apoio (Executor: idempotência pela chave do pedido). */
  registrarResultadoApoio(
    c: ContextoIntegracao,
    r: ResultadoApoio,
    octx: ContextoGravacao,
  ): Promise<{ resultado: number; repetida: boolean }>;
  gravar<T>(
    c: ContextoIntegracao,
    trilha: TrilhaIntegracao | ((r: T) => TrilhaIntegracao),
    fn: (g: GravadorIntegracao) => Promise<T>,
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
  'saudeFilas',
  'identificacao',
  'interfacesApoio',
  'deParaExame',
  'exameDoRetorno',
  'exameLido',
  'vinculos',
  'registrarResultadoApoio',
  'gravar',
]);
