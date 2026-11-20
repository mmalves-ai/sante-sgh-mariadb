// Porta do eSocial sobre o núcleo do legado (M53.6): leituras numa transação curta READ ONLY no banco do estabelecimento
// da sessão (os catálogos oficiais e as pendências do outro sistema só se leem e se contam); gravações SGH_PES_ESOCIAL_*
// numa transação SGH_ (`somenteSgh`: nenhuma tabela do outro sistema) com a SGH_TRILHA junto. Em dev sobre a cópia
// compartilhada, as gravações são recusadas com o motivo (`sghSoLeitura`): a prova da gravação é a integração, sob a
// trava da cópia e desfeita. `portaEsocialNaTransacao`: a mesma porta sobre UMA transação aberta (integração).
import {
  categoriasTrabalhadorEsocial,
  cnpjsEmpresasEsocial,
  contagemEventosEsocialSgh,
  empregadoresEsocialSgh,
  type Escritor,
  eventoEsocialPorIdSgh,
  eventosCatalogoEsocial,
  eventosEsocialComTravaSgh,
  eventosEsocialSgh,
  fichaEsocialSgh,
  gravarFichaEsocialSgh,
  gravarTrilha,
  incluirConciliacaoEsocialSgh,
  incluirEmpregadorEsocialSgh,
  incluirEventoEsocialSgh,
  incluirLoteEsocialSgh,
  type Leitor,
  leiauteVigenteCatalogoEsocial,
  lotePorIdEsocialSgh,
  lotesEsocialSgh,
  motivosAfastamentoEsocial,
  mudarSituacaoEventoEsocialSgh,
  mudarSituacaoLoteEsocialSgh,
  type NucleoLegado,
  pendenciasLegadoEsocial,
  proximoIdEventoEsocialSgh,
  recibosAutonomoCompetencia,
  somenteSgh,
  ultimaConciliacaoEsocialSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import { portaIndisponivel } from '../../exames/public-api.js';
import {
  type ContextoEsocial,
  type GravadorEsocial,
  METODOS_PORTA_ESOCIAL,
  type PortaEsocial,
} from './porta-esocial.js';

type Ler = <T>(c: ContextoEsocial, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaEsocial, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    eventosCatalogo: (c) => ler(c, (l) => eventosCatalogoEsocial(l)),
    leiauteCatalogo: (c, d) => ler(c, (l) => leiauteVigenteCatalogoEsocial(l, d)),
    motivosAfastamento: (c) => ler(c, (l) => motivosAfastamentoEsocial(l)),
    categorias: (c) => ler(c, (l) => categoriasTrabalhadorEsocial(l)),
    cnpjs: (c) => ler(c, (l) => cnpjsEmpresasEsocial(l)),
    pendenciasLegado: (c, e) => ler(c, (l) => pendenciasLegadoEsocial(l, e)),
    recibosAutonomo: (c, e, comp) => ler(c, (l) => recibosAutonomoCompetencia(l, e, comp)),
    empregadores: (c, e) => ler(c, (l) => empregadoresEsocialSgh(l, c.hospital, e)),
    ficha: (c, v) => ler(c, (l) => fichaEsocialSgh(l, c.hospital, v)),
    eventos: (c, f) => ler(c, (l) => eventosEsocialSgh(l, c.hospital, f)),
    evento: (c, id) => ler(c, (l) => eventoEsocialPorIdSgh(l, c.hospital, id)),
    contagemEventos: (c, es, de, ate, ss) =>
      ler(c, (l) => contagemEventosEsocialSgh(l, c.hospital, es, de, ate, ss)),
    lotes: (c, f) => ler(c, (l) => lotesEsocialSgh(l, c.hospital, f)),
    lote: (c, id) => ler(c, (l) => lotePorIdEsocialSgh(l, c.hospital, id)),
    ultimaConciliacao: (c, e, comp) => ler(c, (l) => ultimaConciliacaoEsocialSgh(l, c.hospital, e, comp)),
  };
}

type Catalogos = Pick<
  PortaEsocial,
  'eventosCatalogo' | 'leiauteCatalogo' | 'motivosAfastamento' | 'categorias'
>;

/** Validade do cache curto dos catálogos oficiais (ficha do M53, seção 4: "versão de leiaute; cache curto"). */
export const TTL_CATALOGOS_ESOCIAL_MS = 5 * 60_000;
const TETO_ENTRADAS_CACHE = 200;

/**
 * Cache curto dos catálogos oficiais do eSocial (achado do corretor do M53.6): por rede, estabelecimento, catálogo e
 * argumento (a data do leiaute vigente), por alguns minutos, para a tela não reler o banco a cada abertura. Falha não
 * fica no cache. Os dados do SGH_ e as contagens do outro sistema nunca passam por aqui.
 */
export function comCacheCurtoDosCatalogos<T extends Catalogos>(
  base: T,
  ttlMs = TTL_CATALOGOS_ESOCIAL_MS,
  agora: () => number = Date.now,
): T {
  const cache = new Map<string, { ate: number; valor: Promise<unknown> }>();
  const memo = <R>(chave: string, ler: () => Promise<R>): Promise<R> => {
    const t = agora();
    const x = cache.get(chave);
    if (x && x.ate > t) return x.valor as Promise<R>;
    if (cache.size >= TETO_ENTRADAS_CACHE)
      for (const [k, v] of cache) if (v.ate <= t || cache.size >= TETO_ENTRADAS_CACHE) cache.delete(k);
    const valor = ler();
    cache.set(chave, { ate: t + ttlMs, valor });
    valor.catch(() => cache.delete(chave));
    return valor;
  };
  const k = (c: ContextoEsocial, nome: string, arg = '') => `${c.rede}|${c.hospital}|${nome}|${arg}`;
  return {
    ...base,
    eventosCatalogo: (c) => memo(k(c, 'eventos'), () => base.eventosCatalogo(c)),
    leiauteCatalogo: (c, d) => memo(k(c, 'leiaute', d), () => base.leiauteCatalogo(c, d)),
    motivosAfastamento: (c) => memo(k(c, 'motivos'), () => base.motivosAfastamento(c)),
    categorias: (c) => memo(k(c, 'categorias'), () => base.categorias(c)),
  };
}

function gravador(e: Escritor, c: ContextoEsocial): GravadorEsocial {
  const h = c.hospital;
  return {
    empregadores: (empresa) => empregadoresEsocialSgh(e, h, empresa),
    incluirEmpregador: (x) => incluirEmpregadorEsocialSgh(e, { hospital: h, ...x }),
    gravarFicha: (x) => gravarFichaEsocialSgh(e, { hospital: h, ...x }),
    eventos: (f) => eventosEsocialSgh(e, h, f),
    eventosComTrava: (ids) => eventosEsocialComTravaSgh(e, h, ids),
    proximoIdEvento: () => proximoIdEventoEsocialSgh(e),
    incluirEvento: (id, x) => incluirEventoEsocialSgh(e, id, { hospital: h, ...x }),
    mudarSituacaoEvento: (x) => mudarSituacaoEventoEsocialSgh(e, { hospital: h, ...x }),
    loteComTrava: (id) => lotePorIdEsocialSgh(e, h, id, true),
    incluirLote: (x) => incluirLoteEsocialSgh(e, { hospital: h, ...x }),
    mudarSituacaoLote: (x) => mudarSituacaoLoteEsocialSgh(e, { hospital: h, ...x }),
    incluirConciliacao: (x) => incluirConciliacaoEsocialSgh(e, { hospital: h, ...x }),
  };
}

const recusaSoLeitura = () =>
  Promise.reject(
    new ErroProblema(
      'recurso-desligado',
      403,
      'Gravação desligada neste ambiente',
      'Neste ambiente de desenvolvimento o banco é só de leitura: o eSocial não grava.',
      { codigo: 'somente-leitura' },
    ),
  );

const semExecutor = () =>
  Promise.reject(
    new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', 'O eSocial não usa o executor.'),
  );

export function portaEsocialLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente'> & Partial<Pick<NucleoLegado, 'gravarSgh'>>,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaEsocial {
  const ctx = (c: ContextoEsocial) => ({ rede: c.rede, hospital: c.hospital, traceId: 'pessoas-esocial' });
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: semExecutor,
    gravarSgh: (c, trilha, fn) => {
      const gravar = nucleo.gravarSgh?.bind(nucleo);
      if (opcoes.sghSoLeitura || !gravar) return recusaSoLeitura();
      return gravar(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const r = await fn(gravador(e, c));
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    ...comCacheCurtoDosCatalogos(leituras((c, fn) => nucleo.lerSomente(ctx(c), fn))),
  };
}

/** A mesma porta sobre UMA transação aberta (integração na cópia, sempre desfeita). */
export function portaEsocialNaTransacao(e: Escritor): PortaEsocial {
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: semExecutor,
    async gravarSgh(c, trilha, fn) {
      const s = somenteSgh(e);
      const r = await fn(gravador(s, c));
      await gravarTrilha(s, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e)),
  };
}

export function portaEsocialIndisponivel(): PortaEsocial {
  return portaIndisponivel<PortaEsocial>(METODOS_PORTA_ESOCIAL);
}
