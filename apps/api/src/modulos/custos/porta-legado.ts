// Porta da estrutura de custos sobre o núcleo do legado (M54, etapa 4): leituras READ ONLY e gravação numa transação
// SGH_ (escritor `somenteSgh` do `gravarSgh`), com a SGH_TRILHA na mesma transação. `portaCustosNasTransacoes`: a mesma
// porta sobre uma transação já aberta (integração e assinatura na cópia, sempre desfeitas).
import {
  aprovarApuracao,
  gravarApuracao,
  lerApuracao,
  lerApuracoesDaCompetencia,
  lerCodigosExportacao,
  lerContasDaApuracao,
  lerFontesCusteio,
  lerLinhasApuracao,
  lerNomesConvenios,
  lerResultadoAgrupado,
  classificarCentroCusto,
  type Escritor,
  gravarColetaEstatisticas,
  gravarTrilha,
  lancarEstatisticaManual,
  type Leitor,
  lerCentroDeCusto,
  lerCentrosDeCusto,
  lerDominiosCustos,
  lerEstatisticasVigentes,
  lerFontesEstatistica,
  lerUltimaColeta,
  type NucleoLegado,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoCustos, PortaCustos } from './porta.js';

function sobre(
  ler: <T>(c: ContextoCustos, fn: (l: Leitor) => Promise<T>) => Promise<T>,
  gravar: <T>(c: ContextoCustos, fn: (e: Escritor) => Promise<T>) => Promise<T>,
): Omit<PortaCustos, 'destino'> {
  return {
    centros: (c) => ler(c, (l) => lerCentrosDeCusto(l)),
    centro: (c, id) => ler(c, (l) => lerCentroDeCusto(l, id)),
    dominios: (c) => ler(c, (l) => lerDominiosCustos(l)),
    fontes: (c, i) => ler(c, (l) => lerFontesEstatistica(l, i)),
    estatisticas: (c, comp) => ler(c, (l) => lerEstatisticasVigentes(l, comp)),
    ultimaColeta: (c, comp) => ler(c, (l) => lerUltimaColeta(l, comp)),
    classificar: (c, x, por, trilha) =>
      gravar(c, async (e) => {
        const r = await classificarCentroCusto(e, x, por);
        if (r?.mudou) await gravarTrilha(e, { ...trilha, hospital: e.hospital, idAlvo: String(x.centro) });
        return r;
      }),
    gravarColeta: (c, x, por, trilha) =>
      gravar(c, async (e) => {
        const r = await gravarColetaEstatisticas(e, x, por);
        await gravarTrilha(e, { ...trilha, hospital: e.hospital, idAlvo: String(r.id) });
        return r;
      }),
    lancar: (c, x, por, trilha) =>
      gravar(c, async (e) => {
        const r = await lancarEstatisticaManual(e, x, por);
        await gravarTrilha(e, { ...trilha, hospital: e.hospital, idAlvo: String(r.registro.id) });
        return r;
      }),
    fontesCusteio: (c, p) => ler(c, (l) => lerFontesCusteio(l, p)),
    codigosExportacao: (c) => ler(c, (l) => lerCodigosExportacao(l)),
    nomesConvenios: (c, cs) => ler(c, (l) => lerNomesConvenios(l, cs)),
    apuracoes: (c, comp) => ler(c, (l) => lerApuracoesDaCompetencia(l, comp)),
    apuracao: (c, id) => ler(c, (l) => lerApuracao(l, id)),
    linhasApuracao: (c, id) => ler(c, (l) => lerLinhasApuracao(l, id)),
    contasApuracao: (c, id, f) => ler(c, (l) => lerContasDaApuracao(l, id, f)),
    resultadoAgrupado: (c, id, a) => ler(c, (l) => lerResultadoAgrupado(l, id, a)),
    gravarApuracao: (c, x, por, trilha) =>
      gravar(c, async (e) => {
        const r = await gravarApuracao(e, x, por);
        await gravarTrilha(e, { ...trilha, hospital: e.hospital, idAlvo: String(r.apuracao.id) });
        return r;
      }),
    aprovarApuracao: (c, id, versao, por, trilha) =>
      gravar(c, async (e) => {
        const r = await aprovarApuracao(e, id, versao, por);
        if (r) await gravarTrilha(e, { ...trilha, hospital: e.hospital, idAlvo: String(id) });
        return r;
      }),
  };
}

export function portaCustosLegado(nucleo: NucleoLegado): PortaCustos {
  const ctx = (c: ContextoCustos) => ({ rede: c.rede, hospital: c.hospital, traceId: 'custos' });
  return {
    destino: 'legado',
    ...sobre(
      (c, fn) => nucleo.lerSomente(ctx(c), fn),
      (c, fn) => nucleo.gravarSgh(ctx(c), fn),
    ),
  };
}

/** Sobre uma transação já aberta (quem abriu desfaz). */
export function portaCustosNasTransacoes(transacoes: ReadonlyMap<string, Escritor>): PortaCustos {
  const de = (c: ContextoCustos): Escritor => {
    const e = transacoes.get(c.hospital);
    if (!e) throw new ErroProblema('indisponivel', 503, 'Banco do estabelecimento indisponível');
    return e;
  };
  return {
    destino: 'legado',
    ...sobre(
      async (c, fn) => fn(de(c)),
      async (c, fn) => fn(de(c)),
    ),
  };
}

export function portaCustosIndisponivel(): PortaCustos {
  const recusa = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
      ),
    );
  return {
    destino: 'indisponivel',
    centros: recusa,
    centro: recusa,
    dominios: recusa,
    fontes: recusa,
    estatisticas: recusa,
    ultimaColeta: recusa,
    classificar: recusa,
    gravarColeta: recusa,
    lancar: recusa,
    fontesCusteio: recusa,
    codigosExportacao: recusa,
    nomesConvenios: recusa,
    apuracoes: recusa,
    apuracao: recusa,
    linhasApuracao: recusa,
    contasApuracao: recusa,
    resultadoAgrupado: recusa,
    gravarApuracao: recusa,
    aprovarApuracao: recusa,
  };
}
