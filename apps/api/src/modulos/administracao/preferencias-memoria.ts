// Preferências da conta na fonte sintética (dev e E2E, sem banco): as mesmas regras do domínio
// (dominio-acesso/preferencias) que a porta própria aplica, guardadas em memória por login. Serve para a tela de
// preferências e o /inicio funcionarem de ponta a ponta sem banco; a gravação de verdade é a do banco próprio
// (operacoes-preferencias-propria.ts, contrato de efeito no .int.spec). As telas do menu são as entradas da árvore do
// menu com endereço e permissão de leitura do cargo (o mesmo filtro `rotaPermitida` da leitura própria).
import { ARVORE_MENU } from '@sgh/contratos';
import {
  conferirTelaInicial,
  conferirVisaoTela,
  MENSAGEM_PREFERENCIA,
  NOME_VISAO_PADRAO,
  normalizarPreferenciaGeral,
  PREFERENCIA_GERAL_PADRAO,
  type PreferenciaGeralNormalizada,
  type RecusaPreferencia,
  rotaPermitida,
  textoAmpliado,
  visaoInicial,
} from '@sgh/dominio-acesso';
import { ErroOperacao } from '@sgh/nucleo';
import type { PreferenciasLidas, VisaoTelaLida } from './operacoes-preferencias-propria.js';
import { esquemaGravarPreferenciaGeral, esquemaGravarVisaoTela } from './operacoes-preferencias-propria.js';

interface TelaMenu {
  readonly codigo: string;
  readonly titulo: string;
  readonly rota: string;
}

/** Código de tela sintético a partir da rota (o banco tem o seu; aqui só precisa ser estável e válido). */
export const codigoTelaDaRota = (rota: string): string =>
  rota
    .replace(/^\//, '')
    .replace(/[^A-Za-z0-9._-]+/g, '.')
    .slice(0, 30) || 'raiz';

let telasCache: TelaMenu[] | null = null;
/** Uma tela por rota do menu (a primeira entrada com aquela rota dá o título). */
export function telasDoMenuSintetico(): TelaMenu[] {
  if (telasCache) return telasCache;
  const porRota = new Map<string, TelaMenu>();
  for (const i of ARVORE_MENU)
    if (i.rota && i.permissao && !porRota.has(i.rota))
      porRota.set(i.rota, { codigo: codigoTelaDaRota(i.rota), titulo: i.titulo, rota: i.rota });
  return (telasCache = [...porRota.values()].sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR')));
}

interface DaConta {
  geral: PreferenciaGeralNormalizada;
  telaInicial: string | null;
  visoes: VisaoTelaLida[];
}

const recusar = (r: RecusaPreferencia) =>
  new ErroOperacao(422, r, 'Preferência recusada', MENSAGEM_PREFERENCIA[r]);

export class PreferenciasMemoria {
  private readonly contas = new Map<string, DaConta>();

  reiniciar(): void {
    this.contas.clear();
  }

  ler(login: string | null, tela: string | undefined, permissoes: ReadonlySet<string>): PreferenciasLidas {
    const permitida = (rota: string) => rotaPermitida(rota, ARVORE_MENU, permissoes);
    const telasDoMenu = telasDoMenuSintetico().filter((t) => permitida(t.rota));
    const c = login ? this.contas.get(login) : undefined;
    const geral = c?.geral ?? PREFERENCIA_GERAL_PADRAO;
    const visoes = (c?.visoes ?? []).filter((v) => !tela || v.tela === tela);
    const visaoInicialPorTela: Record<string, string> = {};
    for (const codigo of new Set(visoes.map((v) => v.tela))) {
      const v = visaoInicial(visoes.filter((x) => x.tela === codigo));
      if (v) visaoInicialPorTela[codigo] = v.nome;
    }
    const inicial = c?.telaInicial ? telasDoMenuSintetico().find((t) => t.codigo === c.telaInicial) : null;
    return {
      guardadas: !!c,
      geral: { ...geral, textoAmpliado: textoAmpliado(geral.zoomPercentual) },
      telaInicial: inicial && permitida(inicial.rota) ? inicial : null,
      telasDoMenu,
      visoes,
      visaoInicialPorTela,
    };
  }

  gravarGeral(login: string | null, entrada: unknown, permissoesSessao: readonly string[]) {
    if (!login) throw recusar('sem-conta');
    const e = esquemaGravarPreferenciaGeral.parse(entrada);
    const atual = this.contas.get(login);
    const r = normalizarPreferenciaGeral(atual?.geral ?? PREFERENCIA_GERAL_PADRAO, e);
    if ('recusa' in r) throw recusar(r.recusa);
    let telaInicial = atual?.telaInicial ?? null;
    if (e.telaInicial !== undefined) {
      if (e.telaInicial === null) telaInicial = null;
      else {
        const t = telasDoMenuSintetico().find((x) => x.codigo === e.telaInicial);
        const recusa = conferirTelaInicial(
          t
            ? {
                ativa: true,
                rota: t.rota,
                avulsa: false,
                permitida: rotaPermitida(t.rota, ARVORE_MENU, new Set(permissoesSessao)),
              }
            : null,
        );
        if (recusa) throw recusar(recusa);
        telaInicial = t!.codigo;
      }
    }
    this.contas.set(login, { geral: r.preferencia, telaInicial, visoes: atual?.visoes ?? [] });
    return { criada: !atual, ...r.preferencia, textoAmpliado: textoAmpliado(r.preferencia.zoomPercentual) };
  }

  gravarVisaoTela(login: string | null, entrada: unknown) {
    if (!login) throw recusar('sem-conta');
    const e = esquemaGravarVisaoTela.parse(entrada);
    if (!telasDoMenuSintetico().some((t) => t.codigo === e.tela)) throw recusar('tela-inexistente');
    const conta = this.contas.get(login) ?? {
      geral: PREFERENCIA_GERAL_PADRAO,
      telaInicial: null,
      visoes: [],
    };
    const daTela = conta.visoes.filter((v) => v.tela === e.tela);
    const nomePedido = (e.nome ?? NOME_VISAO_PADRAO).trim();
    const mesma = daTela.find((v) => v.nome === nomePedido);
    const r = conferirVisaoTela(e, { primeiraDaTela: daTela.length === 0, padraoAtual: mesma?.padrao });
    if ('recusa' in r) throw recusar(r.recusa);
    const v = r.visao;
    const nova: VisaoTelaLida = {
      tela: e.tela,
      nome: v.nome,
      colunas: [...v.colunas],
      ordenacao: v.ordenacao.map((o) => ({ ...o })),
      filtros: e.filtros ?? null,
      itensPorPagina: v.itensPorPagina,
      padrao: v.padrao,
    };
    conta.visoes = [
      ...conta.visoes
        .filter((x) => !(x.tela === e.tela && x.nome === v.nome))
        .map((x) => (x.tela === e.tela && v.padrao && x.padrao ? { ...x, padrao: false } : x)),
      nova,
    ];
    this.contas.set(login, conta);
    return { criada: !mesma, nome: v.nome, padrao: v.padrao };
  }
}

/** Uma memória por processo, como o resto da fonte sintética. */
export const preferenciasMemoria = new PreferenciasMemoria();
