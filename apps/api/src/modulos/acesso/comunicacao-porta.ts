// Porta da comunicação interna do M27 (mensagens, comunicados, avisos, mensagens do sistema anterior e o dicionário
// pessoal): o que as telas leem e gravam, independente de onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: leituras READ ONLY dos repositórios de @sgh/legado; o dicionário pelo EXECUTOR do M04 (as receitas
//     acesso.incluirPalavraDicionario e acesso.excluirPalavraDicionario, com a trilha na mesma transação); mensagens,
//     ciência e avisos numa transação SGH_ com a SGH_TRILHA junto (o texto nunca vai à trilha);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas validações e recusas; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// Em dev sobre a cópia compartilhada (ACESSO_FONTE_DEV=copia), o executor só de leitura recusa o dicionário e as
// gravações SGH_ são recusadas também (`sghSoLeitura`), como no prontuário de uso diário (M23).
import {
  atendimentoDoContexto,
  type AvisoLido,
  type AvisoSgh,
  avisosDoUsuario,
  type ComunicadoLido,
  comunicadoDetalhe,
  corrigirComunicado,
  encerrarComunicado,
  encurtarVigenciaComunicado,
  dicionarioDoUsuario,
  type DestinatarioResolvido,
  type Escritor,
  type Executor,
  type FonteCatalogo,
  gravarAviso,
  gravarMensagem,
  gravarTrilha,
  type LiberacaoConsultada,
  type Leitor,
  type LinhaTrilha,
  marcarMensagemLida,
  type MensagemAnteriorLida,
  type MensagemEnviadaLida,
  mensagemRecebida,
  type MensagemRecebidaLida,
  type MensagemSgh,
  mensagensAnteriores,
  mensagensEnviadas,
  mensagensRecebidas,
  type MetricasExecutor,
  mudarEstadoAviso,
  type NucleoLegado,
  operacao,
  registrarCienciaMensagem,
  resolverDestinatarios,
  type ContextoOperacao,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';

export const PORTA_COMUNICACAO = Symbol('PORTA_COMUNICACAO');

export interface ContextoComunicacao {
  readonly rede: string;
  readonly hospital: string;
}

/** Gravações SGH_ da comunicação, na transação com a SGH_TRILHA (o estabelecimento vem do contexto). */
export interface GravadorComunicacao {
  gravarMensagem(m: Omit<MensagemSgh, 'hospital' | 'rede'>): Promise<{ id: number; repetida: boolean }>;
  marcarLida(r: { login: string; id: number }): Promise<boolean>;
  registrarCiencia(r: { login: string; id: number }): Promise<boolean>;
  gravarAviso(a: Omit<AvisoSgh, 'hospital' | 'rede'>): Promise<number | null>;
  mudarEstadoAviso(r: { login: string; id: number; estado: 'lido' | 'resolvido' }): Promise<boolean>;
  /** W0-09: corrige o texto ainda não lido (lido: recusa 409); o anterior vai ao evento do comunicado. */
  corrigirComunicado(r: {
    id: number;
    assunto: string;
    texto: string;
    motivo: string;
    por: string;
  }): Promise<void>;
  /** W0-09: encurta a vigência (nunca estende). */
  encurtarVigencia(r: { id: number; vigenciaFim: string; motivo: string; por: string }): Promise<void>;
  /** W0-09: encerra com o motivo (o comunicado e as ciências continuam visíveis). */
  encerrarComunicado(r: { id: number; motivo: string; por: string }): Promise<void>;
}

export interface PortaComunicacao {
  readonly destino: 'legado' | 'memoria';
  recebidas(c: ContextoComunicacao, login: string): Promise<MensagemRecebidaLida[]>;
  recebida(c: ContextoComunicacao, login: string, id: number): Promise<MensagemRecebidaLida | null>;
  enviadas(c: ContextoComunicacao, login: string): Promise<MensagemEnviadaLida[]>;
  anteriores(c: ContextoComunicacao, login: string): Promise<MensagemAnteriorLida[]>;
  dicionario(c: ContextoComunicacao, login: string): Promise<{ palavra: string; fonetica: string }[]>;
  avisos(c: ContextoComunicacao, login: string): Promise<AvisoLido[]>;
  /** W0-09: o comunicado por inteiro (texto, vigência, destinatários com a ciência e os eventos). */
  comunicado(c: ContextoComunicacao, id: number): Promise<ComunicadoLido | null>;
  /** O atendimento de contexto existe neste estabelecimento? (só o paciente dele, para conferir a autorização). */
  atendimentoDoContexto(c: ContextoComunicacao, atendimento: number): Promise<{ paciente: number } | null>;
  destinatarios(
    c: ContextoComunicacao,
    destinos: readonly { tipo: 'usuario' | 'grupo' | 'setor' | 'unidade'; valor: string }[],
    teto: number,
  ): Promise<{ destinatarios: DestinatarioResolvido[]; desconhecidos: string[]; passou: boolean }>;
  podeGravar(c: ContextoComunicacao, operacao: string, login: string): Promise<LiberacaoConsultada>;
  executar(
    c: ContextoComunicacao,
    operacao: string,
    entrada: unknown,
    octx: ContextoOperacao,
  ): Promise<{ resultado: Record<string, unknown>; repetida: boolean }>;
  gravarSgh<T>(
    c: ContextoComunicacao,
    trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorComunicacao) => Promise<T>,
  ): Promise<T>;
}

export const METODOS_PORTA_COMUNICACAO: ReadonlySet<string> = new Set([
  'recebidas',
  'recebida',
  'enviadas',
  'anteriores',
  'dicionario',
  'avisos',
  'comunicado',
  'atendimentoDoContexto',
  'destinatarios',
  'executar',
  'gravarSgh',
]);

function gravador(e: Escritor, c: ContextoComunicacao): GravadorComunicacao {
  return {
    gravarMensagem: (m) => gravarMensagem(e, { ...m, rede: c.rede, hospital: c.hospital }),
    marcarLida: (r) => marcarMensagemLida(e, { hospital: c.hospital, ...r }),
    registrarCiencia: (r) => registrarCienciaMensagem(e, { hospital: c.hospital, ...r }),
    gravarAviso: (a) => gravarAviso(e, { ...a, rede: c.rede, hospital: c.hospital }),
    mudarEstadoAviso: (r) => mudarEstadoAviso(e, { hospital: c.hospital, ...r }),
    corrigirComunicado: (r) => corrigirComunicado(e, { hospital: c.hospital, ...r }),
    encurtarVigencia: (r) => encurtarVigenciaComunicado(e, { hospital: c.hospital, ...r }),
    encerrarComunicado: (r) => encerrarComunicado(e, { hospital: c.hospital, ...r }),
  };
}

type Ler = <T>(c: ContextoComunicacao, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(
  ler: Ler,
): Pick<
  PortaComunicacao,
  | 'recebidas'
  | 'recebida'
  | 'enviadas'
  | 'anteriores'
  | 'dicionario'
  | 'avisos'
  | 'comunicado'
  | 'atendimentoDoContexto'
  | 'destinatarios'
> {
  return {
    recebidas: (c, login) => ler(c, (l) => mensagensRecebidas(l, c.hospital, login)),
    recebida: (c, login, id) => ler(c, (l) => mensagemRecebida(l, c.hospital, login, id)),
    enviadas: (c, login) => ler(c, (l) => mensagensEnviadas(l, c.hospital, login)),
    anteriores: (_c, login) => ler(_c, (l) => mensagensAnteriores(l, login)),
    dicionario: (_c, login) => ler(_c, (l) => dicionarioDoUsuario(l, login)),
    avisos: (c, login) => ler(c, (l) => avisosDoUsuario(l, c.hospital, login)),
    comunicado: (c, id) => ler(c, (l) => comunicadoDetalhe(l, c.hospital, id)),
    atendimentoDoContexto: (c, a) => ler(c, (l) => atendimentoDoContexto(l, a)),
    destinatarios: (c, destinos, teto) => ler(c, (l) => resolverDestinatarios(l, c.hospital, destinos, teto)),
  };
}

const SO_LEITURA = () =>
  new ErroProblema(
    'operacao-bloqueada',
    409,
    'Gravação desligada neste ambiente',
    'Sobre a cópia compartilhada de desenvolvimento, as mensagens e os avisos não são gravados.',
    { codigo: 'somente-leitura' },
  );

export function portaComunicacaoLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
  opcoes: { readonly sghSoLeitura?: boolean } = {},
): PortaComunicacao {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoComunicacao) => ({ rede: c.rede, hospital: c.hospital, traceId: 'comunicacao' });
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx);
      return { resultado: r.resultado, repetida: r.repetida };
    },
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura) return Promise.reject(SO_LEITURA());
      return nucleo.gravarSgh(ctx(c), async (e) => {
        const r = await fn(gravador(e, c));
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

/** A porta sobre uma transação aberta (testes de integração na cópia, desfeita no fim). */
export function portaComunicacaoNaTransacao(e: Escritor, executor: Executor): PortaComunicacao {
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx, { escritor: e });
      return { resultado: r.resultado, repetida: r.repetida };
    },
    async gravarSgh(c, trilha, fn) {
      const r = await fn(gravador(e, c));
      await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e)),
  };
}

export function portaComunicacaoIndisponivel(): PortaComunicacao {
  return portaIndisponivel<PortaComunicacao>(METODOS_PORTA_COMUNICACAO);
}
