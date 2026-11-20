// A porta do M59-F5 sobre o núcleo do legado: leituras READ ONLY (lerSomente) e gravações só pela transação SGH_
// (gravarSgh), com a SGH_TRILHA na mesma transação. Só @sgh/legado fala com o banco. A variante sobre uma transação
// (portaSbisNaTransacao) serve a integração da API na cópia, sempre desfeita.
import {
  abrirCicloSbis,
  avaliarItemSbis,
  cancelarCicloSbis,
  concluirCicloSbis,
  corrigirItemSbis,
  encerrarConcessaoSgh,
  lerCicloSbis,
  lerCiclosSbis,
  lerConcessoes,
  lerConfigLogin,
  lerDadosFiscais,
  lerIdentificacao,
  lerItensCicloSbis,
  lerRestauracoes,
  type Escritor,
  type Leitor,
  type NucleoLegado,
  preverFimConcessaoSgh,
  reabrirConcessaoSgh,
  registrarRestauracaoSgh,
  sbisFaltando,
  somenteSgh,
  verificarCadeiaDosDias,
  verificarItemSbis,
} from '@sgh/legado';
import type { PortaSbis } from './porta.js';

type Ler = <T>(h: string, fn: (l: Leitor) => Promise<T>) => Promise<T>;
type Gravar = <T>(h: string, correlacao: string, fn: (e: Escritor) => Promise<T>) => Promise<T>;

/** A porta sobre duas funções: ler (READ ONLY) e gravar (transação SGH_ com a trilha). */
function portaSbis(ler: Ler, gravar: Gravar): PortaSbis {
  return {
    destino: 'legado',
    faltando: (h) => ler(h, (l) => sbisFaltando(l)),
    concessoes: (h) => ler(h, (l) => lerConcessoes(l, h)),
    encerrar: (h, c, t) => gravar(h, t.correlacao, (e) => encerrarConcessaoSgh(e, { ...c, hospital: h }, t)),
    reabrir: (h, c, t) => gravar(h, t.correlacao, (e) => reabrirConcessaoSgh(e, { ...c, hospital: h }, t)),
    prever: (h, c, t) => gravar(h, t.correlacao, (e) => preverFimConcessaoSgh(e, { ...c, hospital: h }, t)),
    ciclos: (h) => ler(h, (l) => lerCiclosSbis(l, h)),
    ciclo: (h, id) => ler(h, (l) => lerCicloSbis(l, h, id)),
    itens: (h, id) => ler(h, (l) => lerItensCicloSbis(l, id)),
    abrir: (h, n, t) => gravar(h, t.correlacao, (e) => abrirCicloSbis(e, { ...n, hospital: h }, t)),
    avaliar: (h, a, t) => gravar(h, t.correlacao, (e) => avaliarItemSbis(e, { ...a, hospital: h }, t)),
    corrigir: (h, a, t) => gravar(h, t.correlacao, (e) => corrigirItemSbis(e, { ...a, hospital: h }, t)),
    verificar: (h, a, t) => gravar(h, t.correlacao, (e) => verificarItemSbis(e, { ...a, hospital: h }, t)),
    concluir: (h, c, t) => gravar(h, t.correlacao, (e) => concluirCicloSbis(e, { ...c, hospital: h }, t)),
    cancelar: (h, c, t) => gravar(h, t.correlacao, (e) => cancelarCicloSbis(e, { ...c, hospital: h }, t)),
    restauracoes: (h) => ler(h, (l) => lerRestauracoes(l, h)),
    registrarRestauracao: (h, r, t) =>
      gravar(h, t.correlacao, (e) => registrarRestauracaoSgh(e, { ...r, hospital: h }, t)),
    identificacao: (h) =>
      ler(h, async (l) => {
        const id = await lerIdentificacao(l);
        const fiscal = await lerDadosFiscais(l);
        const cnes = id.cnesHospital ?? id.cnesEmpresa;
        return {
          nome: id.nomeHospital ?? id.razaoSocial,
          cnes: cnes === null ? null : String(cnes),
          cnpj: fiscal?.cnpj ?? null,
        };
      }),
    configSeguranca: (h) =>
      ler(h, async (l) => {
        const c = await lerConfigLogin(l);
        return { limiteTentativas: c.limiteTentativas, inatividadeSegundos: c.tempo.inatividadeSegundos };
      }),
    verificarDias: (h, dias) => ler(h, (l) => verificarCadeiaDosDias(l, h, dias)),
  };
}

export function portaSbisLegado(nucleo: Pick<NucleoLegado, 'rede' | 'lerSomente' | 'gravarSgh'>): PortaSbis {
  const ctx = (hospital: string, traceId = 'auditoria-sbis') => ({ rede: nucleo.rede, hospital, traceId });
  return portaSbis(
    (h, fn) => nucleo.lerSomente(ctx(h), fn),
    (h, correlacao, fn) => nucleo.gravarSgh(ctx(h, correlacao), fn),
  );
}

/**
 * A porta sobre UMA transação da cópia (integração, sempre desfeita): o hospital da sessão sintética vira o da cópia;
 * as gravações passam pela mesma guarda das tabelas SGH_ (somenteSgh).
 */
export function portaSbisNaTransacao(e: Escritor, hospital: string): PortaSbis {
  const p = portaSbis(
    (_h, fn) => fn(e),
    (_h, _c, fn) => fn(somenteSgh(e)),
  );
  return Object.fromEntries(
    Object.entries(p).map(([k, v]) => [
      k,
      typeof v === 'function'
        ? (_h: string, ...r: unknown[]) => (v as (...a: unknown[]) => unknown)(hospital, ...r)
        : v,
    ]),
  ) as unknown as PortaSbis;
}

export function portaSbisIndisponivel(): PortaSbis {
  const falha = () => Promise.reject(new Error('banco do estabelecimento indisponível neste servidor'));
  return {
    destino: 'legado',
    faltando: falha,
    concessoes: falha,
    encerrar: falha,
    reabrir: falha,
    prever: falha,
    ciclos: falha,
    ciclo: falha,
    itens: falha,
    abrir: falha,
    avaliar: falha,
    corrigir: falha,
    verificar: falha,
    concluir: falha,
    cancelar: falha,
    restauracoes: falha,
    registrarRestauracao: falha,
    identificacao: falha,
    configSeguranca: falha,
    verificarDias: falha,
  };
}
