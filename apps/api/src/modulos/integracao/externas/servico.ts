// Central de integrações externas (decisão 53): o serviço da tela e o helper único dos adaptadores.
// - painel: o catálogo com o modo, a situação, os parâmetros, as credenciais ("definida" ou não, nunca o valor) e o
//   que falta para o real;
// - configurar: os parâmetros não secretos; guardarCredencial: o valor vai só ao cofre (só na ida);
// - definirModo: liga ou desliga o real (a senha de novo é conferida no controlador). Fora de produção grava, mas o
//   resultado diz "neutralizado" e o adaptador segue no simulador;
// - modoDaIntegracao: o que o adaptador pergunta (modo efetivo, parâmetros e a leitura da credencial do cofre, só
//   quando o modo efetivo é o real). Nenhum adaptador lê credencial de cliente do ambiente.
import {
  CATALOGO_INTEGRACOES_EXTERNAS,
  entradaIntegracaoExterna,
  type EntradaIntegracaoExterna,
  type IntegracaoExternaLida,
  type ModoIntegracaoExterna,
  type PainelIntegracoesExternas,
  type PedidoConfigurarIntegracaoExterna,
  type PedidoDefinirModoIntegracao,
  type PedidoGuardarCredencialIntegracao,
  referenciaCofreIntegracao,
  type ResultadoIntegracaoExterna,
} from '@sgh/contratos';
import {
  type EstadoIntegracaoExterna,
  faltasDoReal,
  modoEfetivo,
  situacaoDaIntegracao,
} from '@sgh/dominio-integracao';
import { ErroOperacao } from '@sgh/nucleo';
import type { Cofre } from '../../assinatura/infra/cofre.js';
import type { GravacaoIntegracaoExterna, LinhaIntegracaoExterna, PortaIntegracoesExternas } from './porta.js';

/** O que o adaptador recebe da central. */
export interface ModoDaIntegracao {
  readonly integracao: string;
  /** O modo que o adaptador usa: 'real' só em produção, com o real ligado e completo. */
  readonly modo: ModoIntegracaoExterna;
  /** O real está ligado, mas o ambiente não é produção (o adaptador segue no simulador). */
  readonly neutralizado: boolean;
  readonly parametros: Readonly<Record<string, string>>;
  /** Lê a credencial do cofre; nulo fora do modo real (nunca vai a log, tela ou trilha). */
  credencial(campo: string): Promise<string | null>;
  /** Registra a falha do real (a tela mostra "real com falha"); sem dado de pessoa nem segredo no motivo. */
  registrarFalha(motivo: string): Promise<void>;
}

const LINHA_PADRAO = (integracao: string): LinhaIntegracaoExterna => ({
  integracao,
  modo: 'simulador',
  parametros: {},
  versao: 0,
  alteradoEm: null,
  alteradoPor: null,
  modoAlteradoEm: null,
  ultimaFalhaEm: null,
  ultimaFalha: null,
});

const recusa = (status: number, codigo: string, titulo: string, detalhe: string) =>
  new ErroOperacao(status, codigo, titulo, detalhe);

export class ServicoIntegracoesExternas {
  constructor(
    private readonly porta: PortaIntegracoesExternas,
    private readonly cofre: Cofre | null,
    private readonly cliente: string,
    readonly producao: boolean,
  ) {}

  private entrada(id: string): EntradaIntegracaoExterna {
    const e = entradaIntegracaoExterna(id);
    if (!e) throw recusa(404, 'integracao-desconhecida', 'Integração', 'Integração externa desconhecida.');
    return e;
  }

  /** Prefixo gravado na linha (o campo completa a referência). */
  private prefixo(id: string): string {
    return referenciaCofreIntegracao(this.cliente, id, this.entrada(id).camposCredencial[0]!.id).replace(
      /\/[^/]+$/,
      '',
    );
  }

  private async credenciais(e: EntradaIntegracaoExterna): Promise<Map<string, boolean | null>> {
    const r = new Map<string, boolean | null>();
    for (const c of e.camposCredencial) {
      if (!this.cofre?.disponivel) r.set(c.id, null);
      else
        r.set(
          c.id,
          await this.cofre.existe(referenciaCofreIntegracao(this.cliente, e.id, c.id)).catch(() => null),
        );
    }
    return r;
  }

  private estado(l: LinhaIntegracaoExterna, cred: Map<string, boolean | null>): EstadoIntegracaoExterna {
    const indefinida = [...cred.values()].some((v) => v === null);
    return {
      modo: l.modo,
      parametros: l.parametros,
      credenciaisDefinidas: indefinida
        ? null
        : new Set([...cred.entries()].filter(([, v]) => v).map(([k]) => k)),
      ultimaFalhaEm: l.ultimaFalhaEm,
      modoAlteradoEm: l.modoAlteradoEm,
    };
  }

  private async lida(e: EntradaIntegracaoExterna, l: LinhaIntegracaoExterna): Promise<IntegracaoExternaLida> {
    const cred = await this.credenciais(e);
    const s = this.estado(l, cred);
    return {
      id: e.id,
      modo: l.modo,
      situacao: situacaoDaIntegracao(e, s, this.producao),
      parametros: l.parametros,
      credenciais: e.camposCredencial.map((c) => ({ campo: c.id, definida: cred.get(c.id) ?? null })),
      faltam: faltasDoReal(e, s),
      versao: l.versao > 0 ? l.versao : null,
      alteradoEm: l.alteradoEm?.toISOString() ?? null,
      alteradoPor: l.alteradoPor,
      ultimaFalhaEm: l.ultimaFalhaEm?.toISOString() ?? null,
      ultimaFalha: l.ultimaFalha,
    };
  }

  private async linhaDe(id: string): Promise<LinhaIntegracaoExterna> {
    return (await this.porta.ler()).find((l) => l.integracao === id) ?? LINHA_PADRAO(id);
  }

  private async resultado(
    id: string,
    modoPedido?: ModoIntegracaoExterna,
  ): Promise<ResultadoIntegracaoExterna> {
    const e = this.entrada(id);
    const integracao = await this.lida(e, await this.linhaDe(id));
    return { integracao, neutralizado: (modoPedido ?? integracao.modo) === 'real' && !this.producao };
  }

  async painel(): Promise<PainelIntegracoesExternas> {
    const linhas = new Map((await this.porta.ler()).map((l) => [l.integracao, l]));
    const integracoes: IntegracaoExternaLida[] = [];
    for (const e of CATALOGO_INTEGRACOES_EXTERNAS)
      integracoes.push(await this.lida(e, linhas.get(e.id) ?? LINHA_PADRAO(e.id)));
    return { producao: this.producao, cofreDisponivel: this.cofre?.disponivel === true, integracoes };
  }

  async configurar(c: GravacaoIntegracaoExterna, p: PedidoConfigurarIntegracaoExterna) {
    const e = this.entrada(p.integracao);
    const limpos = Object.fromEntries(
      e.parametros.map((x) => [x.id, (p.parametros[x.id] ?? '').trim()] as const).filter(([, v]) => v !== ''),
    );
    for (const x of e.parametros)
      if (x.tipo === 'endereco' && limpos[x.id] && !/^https?:\/\/[^\s]+$/i.test(limpos[x.id]!))
        throw recusa(422, 'endereco-invalido', 'Parâmetro', `${x.rotulo}: informe um endereço http(s).`);
    await this.porta.gravarParametros(c, e.id, this.prefixo(e.id), limpos);
    return this.resultado(e.id);
  }

  async guardarCredencial(c: GravacaoIntegracaoExterna, p: PedidoGuardarCredencialIntegracao) {
    const e = this.entrada(p.integracao);
    const cofre = this.cofre;
    if (!cofre?.disponivel)
      throw recusa(
        503,
        'cofre-indisponivel',
        'Cofre de segredos',
        'O cofre de segredos não está disponível neste ambiente.',
      );
    const ref = referenciaCofreIntegracao(this.cliente, e.id, p.campo);
    await this.porta.registrarCredencial(c, e.id, this.prefixo(e.id), p.campo, () =>
      cofre.gravar(ref, p.valor),
    );
    return this.resultado(e.id);
  }

  async definirModo(c: GravacaoIntegracaoExterna, p: PedidoDefinirModoIntegracao) {
    const e = this.entrada(p.integracao);
    await this.porta.definirModo(c, e.id, this.prefixo(e.id), p.modo, p.justificativa);
    return this.resultado(e.id, p.modo);
  }

  /** O helper único dos adaptadores (ver docs/obra/integracoes-externas.md). */
  async modoDaIntegracao(id: string): Promise<ModoDaIntegracao> {
    const e = this.entrada(id);
    const l = await this.linhaDe(id);
    const s = this.estado(l, await this.credenciais(e));
    const modo = modoEfetivo(e, s, this.producao);
    const cofre = this.cofre;
    return {
      integracao: id,
      modo,
      neutralizado: l.modo === 'real' && !this.producao,
      parametros: l.parametros,
      credencial: async (campo) => {
        if (modo !== 'real' || !cofre?.disponivel || !e.camposCredencial.some((x) => x.id === campo))
          return null;
        return cofre.ler(referenciaCofreIntegracao(this.cliente, id, campo)).catch(() => null);
      },
      registrarFalha: (motivo) => this.porta.registrarFalha(id, this.prefixo(id), motivo),
    };
  }
}

// ── o helper único (ligado pelo módulo das integrações ao montar a API) ──────────────────────────────

let central: ServicoIntegracoesExternas | null = null;

export function ligarCentralIntegracoes(s: ServicoIntegracoesExternas | null): void {
  central = s;
}

/**
 * O modo da integração para o adaptador. Sem a central montada (módulo das integrações fora da API, testes de
 * unidade de outro módulo), o simulador: nada sai.
 */
export async function modoDaIntegracao(id: string): Promise<ModoDaIntegracao> {
  if (central) return central.modoDaIntegracao(id);
  if (!entradaIntegracaoExterna(id)) throw new Error(`Integração externa desconhecida: ${id}.`);
  return {
    integracao: id,
    modo: 'simulador',
    neutralizado: false,
    parametros: {},
    credencial: async () => null,
    registrarFalha: async () => undefined,
  };
}
