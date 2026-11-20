// M58-F4: o painel de estado da fachada (/administracao/integracoes/fachada; ficha, seção 7), a necessidade dela
// (DP-8: só quando a API original não acompanha a conversão para UTF-8 a tempo), a prontidão para liberar a entrada
// em UTF-8 sem quebrar os Squads (toda operação usada servida pelo Sante SGH), o uso medido por operação e os corpos
// de /acoes/status e /health/db servidos pela fachada.
import {
  ACOES_FACHADA,
  CATALOGO_FACHADA,
  type ConfiguracaoFachada,
  CONTRATO_SANTE_API,
  LIMITES_FACHADA,
  type NecessidadeFachada,
  type OperacaoFachada,
  type OperacaoFachadaDescrita,
  type PainelFachada,
  type ProntidaoUtf8Fachada,
  SUPERFICIES_FACHADA,
} from '@sgh/contratos';
import { modoDaOperacao, type TokensFachada } from './rotas.js';

// ── Uso por operação (desde a partida do processo) ──────────────────────────────────────────────────

export class ContadorUsoFachada {
  private readonly uso = new Map<string, { chamadas: number; erros: number }>();
  readonly desde: string;
  constructor(agora: Date = new Date()) {
    this.desde = agora.toISOString();
  }
  registrar(id: string, erro: boolean) {
    const u = this.uso.get(id) ?? { chamadas: 0, erros: 0 };
    u.chamadas++;
    if (erro) u.erros++;
    this.uso.set(id, u);
  }
  de(id: string) {
    return this.uso.get(id) ?? { chamadas: 0, erros: 0 };
  }
  usadas(): string[] {
    return [...this.uso.entries()].filter(([, u]) => u.chamadas > 0).map(([id]) => id);
  }
}

// ── Necessidade (DP-8) e prontidão para o UTF-8 ─────────────────────────────────────────────────────

export function necessidadeFachada(
  charset: string,
  ensaioUtf8Concluido: boolean,
): {
  situacao: NecessidadeFachada;
  motivo: string;
} {
  if (charset === 'UTF8')
    return {
      situacao: 'necessaria',
      motivo:
        'O banco do estabelecimento está em UTF-8 e a API de integração original segue como está (DP-8): a fachada atende os Squads.',
    };
  if (ensaioUtf8Concluido)
    return {
      situacao: 'necessaria',
      motivo:
        'A conversão para UTF-8 foi ensaiada na cópia; antes da janela, a fachada precisa atender as operações que os Squads usam (DP-8).',
    };
  return {
    situacao: 'nao-necessaria',
    motivo: 'O banco segue em CP1252: a API de integração original atende sem fachada.',
  };
}

export function prontidaoUtf8(
  usadas: readonly string[],
  servidas: ReadonlySet<string>,
): ProntidaoUtf8Fachada {
  const usadasNaoServidas = usadas.filter((id) => !servidas.has(id)).sort();
  if (!usadas.length)
    return {
      pronta: false,
      usadasNaoServidas: [],
      motivo:
        'Sem uso medido pela fachada: ligue a fachada (com o repasse) e meça as operações que os Squads usam.',
    };
  return usadasNaoServidas.length
    ? {
        pronta: false,
        usadasNaoServidas,
        motivo: `${usadasNaoServidas.length} operação(ões) usada(s) pelos Squads ainda repassada(s) ou desligada(s).`,
      }
    : {
        pronta: true,
        usadasNaoServidas: [],
        motivo: 'Toda operação usada pelos Squads é servida pelo Sante SGH.',
      };
}

// ── Painel ──────────────────────────────────────────────────────────────────────────────────────────

export interface EntradaPainelFachada {
  readonly hospital: string;
  readonly configuracao: ConfiguracaoFachada;
  readonly tokens: TokensFachada;
  readonly estado: (operacaoSgh: string) => string | null;
  readonly uso: ContadorUsoFachada;
  readonly pendentes: number;
  readonly charset: string;
  readonly ensaioUtf8Concluido: boolean;
  readonly podeConfigurar: boolean;
  readonly catalogo?: readonly OperacaoFachada[];
}

export function montarPainelFachada(e: EntradaPainelFachada): PainelFachada {
  const catalogo = e.catalogo ?? CATALOGO_FACHADA;
  const operacoes: OperacaoFachadaDescrita[] = catalogo.map((o) => {
    const m = modoDaOperacao(o, e.configuracao, e.estado);
    const u = e.uso.de(o.id);
    return {
      id: o.id,
      superficie: o.superficie,
      metodo: o.metodo,
      caminho: o.caminho,
      escreve: o.escreve,
      modo: m.modo,
      motivo: m.motivo,
      operacoesSgh: o.operacoesSgh.map((nome) => ({ nome, estado: e.estado(nome) })),
      chamadas: u.chamadas,
      erros: u.erros,
    };
  });
  const conta = (lista: readonly OperacaoFachadaDescrita[], modo: string) =>
    lista.filter((o) => o.modo === modo).length;
  const superficies = SUPERFICIES_FACHADA.map((s) => {
    const daS = operacoes.filter((o) => o.superficie === s);
    const escopo = catalogo.find((o) => o.superficie === s)?.escopo ?? 'principal';
    return {
      superficie: s,
      ligada: e.configuracao.ligada && e.configuracao.superficies.includes(s),
      escopo,
      // Sem token próprio, a superfície aceita o principal (o painel diz se há o que aceitar, nunca o token).
      tokenConfigurado: Boolean(e.tokens[escopo] ?? e.tokens.principal),
      operacoes: daS.length,
      servidas: conta(daS, 'servida'),
      repassadas: conta(daS, 'repassada'),
      desligadas: conta(daS, 'desligada'),
    };
  });
  const servidas = new Set(catalogo.filter((o) => o.servidaPeloSante).map((o) => o.id));
  return {
    hospital: e.hospital,
    versaoContrato: CONTRATO_SANTE_API.versao,
    necessidade: necessidadeFachada(e.charset, e.ensaioUtf8Concluido),
    configuracao: e.configuracao,
    destinoConfigurado: e.configuracao.destino !== null,
    superficies,
    operacoes,
    motor: {
      pendentes: e.pendentes,
      validadeMinutos: Math.round(LIMITES_FACHADA.validadePropostaMs / 60000),
      maxPropostas: LIMITES_FACHADA.maxPropostas,
    },
    prontidaoUtf8: prontidaoUtf8(e.uso.usadas(), servidas),
    totais: {
      operacoes: operacoes.length,
      servidas: conta(operacoes, 'servida'),
      repassadas: conta(operacoes, 'repassada'),
      desligadas: conta(operacoes, 'desligada'),
    },
    usoDesde: e.uso.desde,
    pode: { configurar: e.podeConfigurar },
  };
}

// ── Corpos servidos ─────────────────────────────────────────────────────────────────────────────────

/** GET /acoes/status: a mesma forma da API original, com quem atende cada ação (campo a mais, aditivo). */
export function corpoStatusAcoes(
  escritaLigada: boolean,
  pendentes: number,
  atendidaPeloSante: (rota: string) => boolean,
) {
  return {
    habilitada: escritaLigada,
    propostasPendentes: pendentes,
    validadePropostaMinutos: Math.round(LIMITES_FACHADA.validadePropostaMs / 60000),
    acoesDisponiveis: ACOES_FACHADA.map((a) => ({
      acao: a.acao,
      rotas: [...a.rotas],
      resumo: a.resumo,
      reversivel: a.reversivel,
      atendidaPor: a.rotas.every(atendidaPeloSante) ? 'sante' : 'repasse',
    })),
    comoFunciona:
      'Toda ação tem dois tempos. A primeira chamada devolve uma proposta com o efeito exato e ' +
      'NÃO altera nada; a segunda, em /acoes/confirmar, aplica. Proposta expira em 15 minutos, ' +
      'vale uma vez só, e é recusada se o estado mudar nesse intervalo.',
  };
}

/** GET /health: liveness (não toca no banco). */
export const corpoSaude = (uptimeSegundos: number) => ({ status: 'ok', uptime: uptimeSegundos });

/** GET /health/db: a tripla de charset (banco, coluna de texto livre, conexão e o efetivo). */
export function corpoSaudeBanco(r: {
  readonly banco: string | null;
  readonly colunaObs: string | null;
  readonly conexao: string;
  readonly efetivo: string;
}) {
  return {
    status: 'ok',
    db: 'firebird',
    result: { ok: 1 },
    charset: { banco: r.banco, colunaObs: r.colunaObs, conexao: r.conexao, efetivo: r.efetivo },
  };
}
