// M58-F4 (ficha do M58, seção 7 e regras 8 e 9; cap-12, Decisão): o serviço da fachada da API de integração da Hal-AI.
// Recebe o pedido no caminho da API original, confere o token da superfície, decide o modo da operação (servida,
// repassada ou desligada) pela configuração do estabelecimento e responde no contrato de erro da API original. As
// rotas servidas leem pela porta da fachada; a ação de situação do convênio passa pelo motor de dois tempos e grava
// pelo Executor, assinada por hal-ai. O painel mostra o estado sem nunca mostrar o token.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  AMBIENTE_TOKENS_FACHADA,
  CATALOGO_FACHADA,
  CHAVES_PARAMETRO_FACHADA,
  CODIGOS_ERRO_FACHADA as E,
  type ConfiguracaoFachada,
  CONFIGURACAO_FACHADA_PADRAO,
  definicaoParametro,
  LIMITES_FACHADA,
  type OperacaoFachada,
  type PainelFachada,
  USUARIO_INTEGRACAO_FACHADA,
  type ValorParametro,
} from '@sgh/contratos';
import { resolverParametro } from '@sgh/dominio-config';
import {
  acoesDesabilitadas,
  autenticar,
  casarRota,
  ContadorUsoFachada,
  corpoSaude,
  corpoSaudeBanco,
  corpoStatusAcoes,
  erroFachada,
  erroValidacao,
  extrairToken,
  lerCodigoConvenio,
  lerConfiguracaoFachada,
  lerCorpoSituacao,
  lerFiltroConvenios,
  modoDaOperacao,
  montarPainelFachada,
  MotorAcoesFachada,
  prepararSituacao,
  responderConvenio,
  responderConvenios,
  respostaDeErro,
  resultadoSituacao,
  type RetratoConvenio,
  rotaNaoEncontrada,
  type TokensFachada,
  conferirDiaria,
} from '@sgh/dominio-integracao';
import type { ContextoFachada, PortaFachada } from './porta.js';

/** As variáveis do ambiente com os tokens (vazias: o escopo não tem token próprio). */
export function tokensDoAmbiente(env: NodeJS.ProcessEnv): TokensFachada {
  const ler = (n: string) => {
    const v = env[n]?.trim();
    return v ? v : null;
  };
  return {
    principal: ler(AMBIENTE_TOKENS_FACHADA.principal),
    gestao: ler(AMBIENTE_TOKENS_FACHADA.gestao),
    auditoria: ler(AMBIENTE_TOKENS_FACHADA.auditoria),
  };
}

/** Os valores vigentes de um conjunto de parâmetros no estabelecimento (sujeito: o usuário de integração). */
export function valoresVigentes(
  chaves: readonly string[],
  valores: readonly ValorParametro[],
  rede: string,
  hospital: string,
  agora: Date,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const chave of chaves) {
    const def = definicaoParametro(chave);
    if (!def) continue;
    const e = resolverParametro(
      def,
      valores,
      {
        rede,
        empresa: null,
        estabelecimento: hospital,
        unidade: null,
        perfis: [],
        usuario: USUARIO_INTEGRACAO_FACHADA,
      },
      agora,
    );
    out.set(chave, e.valor.replace(/^"(.*)"$/, '$1'));
  }
  return out;
}

export interface PedidoFachada {
  readonly rede: string;
  readonly hospital: string;
  readonly metodo: string;
  /** O caminho da API original (ex.: /convenios/315), sem o prefixo da fachada. */
  readonly caminho: string;
  /** A query string crua (sem o "?"), repassada como veio. */
  readonly consulta: string;
  readonly query: Readonly<Record<string, unknown>>;
  readonly corpo: unknown;
  readonly cabecalhos: Readonly<Record<string, unknown>>;
}

export interface RespostaFachada {
  readonly status: number;
  readonly corpo: unknown;
}

/** O repasse à API original (injetável; o padrão usa fetch com o tempo máximo da fachada). */
export type Repassador = (p: {
  readonly url: string;
  readonly metodo: string;
  readonly cabecalhos: Readonly<Record<string, string>>;
  readonly corpo: string | null;
}) => Promise<RespostaFachada>;

export const repassarPorFetch: Repassador = async (p) => {
  const r = await fetch(p.url, {
    method: p.metodo,
    headers: p.cabecalhos,
    ...(p.corpo !== null ? { body: p.corpo } : {}),
    redirect: 'manual',
    signal: AbortSignal.timeout(LIMITES_FACHADA.repasseTimeoutMs),
  });
  const texto = await r.text();
  let corpo: unknown = texto;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    // A API original só responde JSON; texto cru (proxy no meio) segue como texto.
  }
  return { status: r.status, corpo };
};

export interface DependenciasFachada {
  readonly porta: PortaFachada;
  readonly tokens: TokensFachada;
  /** Os valores de parâmetro do estabelecimento (configuração); null: só os padrões. */
  readonly valores: ((rede: string, hospital: string) => Promise<readonly ValorParametro[]>) | null;
  readonly repassar?: Repassador;
  /** docs/marcos/M58 (o relatório do ensaio do UTF-8 por hospital: <h>/utf8.json). */
  readonly raizEnsaios?: string | null;
  readonly agora?: () => Date;
  readonly registrarErro?: (id: string, e: unknown) => void;
  readonly motor?: MotorAcoesFachada;
  readonly uptime?: () => number;
  /** Validade do cache da configuração (ms). */
  readonly cacheMs?: number;
}

/** O corpo de /acoes/confirmar: propostaId obrigatório, texto de até 64 caracteres. */
function lerPropostaId(corpo: unknown): string {
  const b = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const id = b['propostaId'];
  if (id === undefined) throw erroValidacao('body', [{ tipo: 'required', campo: 'propostaId' }]);
  if (typeof id !== 'string')
    throw erroValidacao('body', [{ tipo: 'type', campo: 'propostaId', esperado: 'string' }]);
  if (id.length > 64) throw erroValidacao('body', [{ tipo: 'maxLength', campo: 'propostaId', limite: 64 }]);
  return id;
}

/** A chave do escopo das propostas e do uso: a rede e o estabelecimento do caminho. */
export function escopoFachada(rede: string, hospital: string): string {
  return `${rede}:${hospital}`;
}

const CABECALHOS_REPASSADOS = ['authorization', 'x-api-key', 'content-type', 'accept'];

export class ServicoFachada {
  readonly motor: MotorAcoesFachada;
  /** O uso por estabelecimento (rede:hospital): o painel de um não mostra o volume do outro. */
  private readonly usos = new Map<string, ContadorUsoFachada>();
  private readonly inicio: Date;
  private readonly cache = new Map<string, { em: number; v: Map<string, string> }>();

  constructor(private readonly d: DependenciasFachada) {
    this.motor = d.motor ?? new MotorAcoesFachada();
    this.inicio = this.agora();
  }

  /** O contador de uso do estabelecimento (desde o início do processo). */
  usoDe(rede: string, hospital: string): ContadorUsoFachada {
    const k = escopoFachada(rede, hospital);
    let u = this.usos.get(k);
    if (!u) {
      u = new ContadorUsoFachada(this.inicio);
      this.usos.set(k, u);
    }
    return u;
  }

  private agora() {
    return this.d.agora?.() ?? new Date();
  }

  /** Os parâmetros da fachada e o charset do estabelecimento, com cache curto (cada pedido da Hal-AI lê). */
  async valores(rede: string, hospital: string): Promise<Map<string, string>> {
    const chave = `${rede}:${hospital}`;
    const agora = this.agora();
    const c = this.cache.get(chave);
    if (c && agora.getTime() - c.em < (this.d.cacheMs ?? 10_000)) return c.v;
    const lidos = this.d.valores ? await this.d.valores(rede, hospital) : [];
    const v = valoresVigentes([...CHAVES_PARAMETRO_FACHADA, 'legado.charset'], lidos, rede, hospital, agora);
    this.cache.set(chave, { em: agora.getTime(), v });
    return v;
  }

  /** Esquece a configuração lida (depois de configurar). */
  esquecer(rede: string, hospital: string) {
    this.cache.delete(`${rede}:${hospital}`);
  }

  async configuracao(rede: string, hospital: string): Promise<ConfiguracaoFachada> {
    return this.d.valores
      ? lerConfiguracaoFachada(await this.valores(rede, hospital))
      : CONFIGURACAO_FACHADA_PADRAO;
  }

  async painel(rede: string, hospital: string, podeConfigurar: boolean): Promise<PainelFachada> {
    const v = await this.valores(rede, hospital);
    const raiz = this.d.raizEnsaios ?? null;
    return montarPainelFachada({
      hospital,
      configuracao: lerConfiguracaoFachada(v),
      tokens: this.d.tokens,
      estado: (op) => this.d.porta.estado(op, hospital),
      uso: this.usoDe(rede, hospital),
      pendentes: this.motor.pendentes(escopoFachada(rede, hospital)),
      charset: v.get('legado.charset') ?? 'CP1252',
      ensaioUtf8Concluido: raiz !== null && existsSync(join(raiz, hospital, 'utf8.json')),
      podeConfigurar,
    });
  }

  /** Atende um pedido da Hal-AI: sempre responde (nunca lança); o erro sai no contrato de erro. */
  async atender(p: PedidoFachada): Promise<RespostaFachada> {
    const casada = casarRota(p.metodo, p.caminho);
    const id = casada?.operacao.id ?? `${p.metodo.toUpperCase()} ?`;
    let r: RespostaFachada;
    try {
      r = await this.despachar(p, casada);
    } catch (e) {
      const x = respostaDeErro(e);
      if (x.interno) this.d.registrarErro?.(id, e);
      r = { status: x.status, corpo: x.corpo };
    }
    if (casada) this.usoDe(p.rede, p.hospital).registrar(id, r.status >= 400);
    return r;
  }

  private async despachar(p: PedidoFachada, casada: ReturnType<typeof casarRota>): Promise<RespostaFachada> {
    const token = extrairToken(p.cabecalhos['authorization'], p.cabecalhos['x-api-key']);
    if (!casada) {
      // Como na API original, a autenticação vem antes do 404 (rota inexistente sem token: 401).
      autenticar(
        CATALOGO_FACHADA.find((o) => o.id === 'GET /health/db')!,
        token,
        this.d.tokens,
      );
      throw rotaNaoEncontrada(p.metodo.toUpperCase(), p.caminho);
    }
    const op = casada.operacao;
    autenticar(op, token, this.d.tokens);
    const cfg = await this.configuracao(p.rede, p.hospital);
    if (!cfg.ligada)
      throw erroFachada(
        503,
        'A fachada da API de integração está desligada neste estabelecimento. Use o endereço da API original.',
        E.fachadaDesligada,
      );
    const m = modoDaOperacao(op, cfg, (n) => this.d.porta.estado(n, p.hospital));
    if (m.causa === 'escrita' || m.causa === 'nao-provada')
      throw op.superficie === 'acoes'
        ? acoesDesabilitadas()
        : erroFachada(
            403,
            'A escrita pela fachada está desligada neste estabelecimento. NÃO tente de novo: isto é configuração, ' +
              'não falha temporária.',
            E.acoesDesabilitadas,
            m.causa === 'nao-provada' ? { motivo: m.motivo } : {},
          );
    if (m.modo === 'desligada')
      throw erroFachada(503, m.motivo ?? 'Operação fora da fachada.', E.superficieDesligada);
    if (op.id === 'POST /acoes/confirmar') {
      const id = lerPropostaId(p.corpo);
      // A proposta feita na API original (pelo repasse) é confirmada lá; a desta fachada, aqui.
      // A proposta fica presa ao estabelecimento em que nasceu: por outro caminho ela não existe (404), e a
      // trava de escrita conferida acima é sempre a do estabelecimento dela.
      const escopo = escopoFachada(p.rede, p.hospital);
      if (!this.motor.conhece(id, escopo) && cfg.destino) return this.repassar(p, cfg);
      return { status: 200, corpo: await this.motor.confirmar(id, escopo) };
    }
    if (m.modo === 'repassada') return this.repassar(p, cfg);
    return { status: 200, corpo: await this.servir(p, op, casada.parametros, cfg) };
  }

  private async servir(
    p: PedidoFachada,
    op: OperacaoFachada,
    parametros: Readonly<Record<string, string>>,
    cfg: ConfiguracaoFachada,
  ): Promise<unknown> {
    const c: ContextoFachada = { rede: p.rede, hospital: p.hospital };
    switch (op.id) {
      case 'GET /health':
        return corpoSaude(this.d.uptime?.() ?? process.uptime());
      case 'GET /health/db': {
        const s = await this.d.porta.saudeBanco(c);
        return corpoSaudeBanco({ ...s, conexao: 'NONE' });
      }
      case 'GET /convenios':
        return responderConvenios(await this.d.porta.convenios(c), lerFiltroConvenios(p.query));
      case 'GET /convenios/{codigo}': {
        const cod = lerCodigoConvenio(parametros['codigo']);
        return responderConvenio(await this.d.porta.convenio(c, cod));
      }
      case 'GET /acoes/status':
        return corpoStatusAcoes(
          cfg.escrita,
          this.motor.pendentes(escopoFachada(p.rede, p.hospital)),
          (rota) => {
            const o = CATALOGO_FACHADA.find((x) => x.metodo === 'POST' && x.caminho === rota);
            return o
              ? modoDaOperacao(o, cfg, (n) => this.d.porta.estado(n, p.hospital)).modo === 'servida'
              : false;
          },
        );
      case 'POST /acoes/convenios/situacao':
        return this.proporSituacao(c, p.corpo);
      default:
        // Catálogo marcou como servida sem implementação: nunca deveria acontecer (teste de cobertura do catálogo).
        throw erroFachada(500, 'Operação sem implementação.', E.erroInterno);
    }
  }

  private async proporSituacao(c: ContextoFachada, corpo: unknown) {
    const pedido = lerCorpoSituacao(corpo);
    const retrato = await this.d.porta.retratoConvenio(c, pedido.cod);
    const diaria = retrato.existe ? await this.d.porta.diariaConvenio(c, pedido.cod) : null;
    const impacto = await this.d.porta.impactoConvenio(c, pedido.cod);
    const prep = prepararSituacao(pedido, retrato, diaria, impacto);
    const lerEstado = () => this.d.porta.retratoConvenio(c, pedido.cod);
    return this.motor.propor<{ cod: number }, RetratoConvenio>(
      'convenios/situacao',
      {
        params: prep.params,
        estadoAntes: retrato,
        corpo: prep.corpo,
        executar: async () => {
          // A receita refaz a pré-checagem e o compare-and-swap dentro da transação; aqui só a diária relida.
          conferirDiaria(pedido.cod, prep.nome, await this.d.porta.diariaConvenio(c, pedido.cod));
          const chave = `fachada-${pedido.cod}-${this.agora().getTime()}`;
          const relida = await this.d.porta.gravarSituacaoConvenio(c, {
            cod: pedido.cod,
            operacao: pedido.operacao,
            justificativa: `Pela fachada da API de integração da Hal-AI (${pedido.operacao}).`,
            chave,
          });
          return resultadoSituacao(
            { ...pedido, nome: prep.nome, origem: prep.origem, reversao: prep.reversao },
            relida,
          );
        },
      },
      lerEstado,
      escopoFachada(c.rede, c.hospital),
    );
  }

  private async repassar(p: PedidoFachada, cfg: ConfiguracaoFachada): Promise<RespostaFachada> {
    if (!cfg.destino)
      throw erroFachada(503, 'Sem endereço da API original para o repasse.', E.destinoIndisponivel);
    const cabecalhos: Record<string, string> = {};
    for (const h of CABECALHOS_REPASSADOS) {
      const v = p.cabecalhos[h];
      const s = Array.isArray(v) ? v[0] : v;
      if (typeof s === 'string') cabecalhos[h] = s;
    }
    const corpo =
      p.metodo.toUpperCase() === 'GET' || p.corpo === undefined || p.corpo === null
        ? null
        : JSON.stringify(p.corpo);
    if (corpo !== null) cabecalhos['content-type'] = 'application/json';
    try {
      return await (this.d.repassar ?? repassarPorFetch)({
        url: `${cfg.destino}${p.caminho}${p.consulta ? `?${p.consulta}` : ''}`,
        metodo: p.metodo.toUpperCase(),
        cabecalhos,
        corpo,
      });
    } catch (e) {
      this.d.registrarErro?.(`repasse ${p.metodo.toUpperCase()} ${p.caminho}`, e);
      throw erroFachada(
        503,
        'A API original não respondeu ao repasse. Tente de novo em instantes; se persistir, acione o suporte.',
        E.destinoIndisponivel,
      );
    }
  }
}
