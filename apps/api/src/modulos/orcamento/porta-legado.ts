// Porta do orçamento empresarial sobre o núcleo do legado (M54, etapa 7): leituras READ ONLY e gravação numa transação
// SGH_ (escritor `somenteSgh` do `gravarSgh`), com a SGH_TRILHA na mesma transação. `portaOrcamentoNasTransacoes`: a
// mesma porta sobre uma transação já aberta (integração na cópia, sempre desfeita).
import {
  aprovarVersaoOrcamento,
  criarVersaoOrcamento,
  descartarVersaoOrcamento,
  type Escritor,
  gravarLinhasOrcamento,
  gravarTrilha,
  type Leitor,
  lerCentrosOrcamento,
  lerEmpresasOrcamento,
  lerItensGerenciais,
  lerLinhasOrcamento,
  lerParametrosOrcamento,
  lerRealizadoAno,
  lerVersaoOrcamento,
  lerVersoesOrcamento,
  type NucleoLegado,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoOrcamento, PortaOrcamento } from './porta.js';

function sobre(
  ler: <T>(c: ContextoOrcamento, fn: (l: Leitor) => Promise<T>) => Promise<T>,
  gravar: <T>(c: ContextoOrcamento, fn: (e: Escritor) => Promise<T>) => Promise<T>,
): Omit<PortaOrcamento, 'destino'> {
  return {
    apoio: (c) =>
      ler(c, async (l) => ({
        centros: await lerCentrosOrcamento(l),
        itens: await lerItensGerenciais(l),
        empresas: await lerEmpresasOrcamento(l),
        parametros: await lerParametrosOrcamento(l),
      })),
    versoes: (c, ano) => ler(c, (l) => lerVersoesOrcamento(l, ano)),
    versao: (c, id) => ler(c, (l) => lerVersaoOrcamento(l, id)),
    linhas: (c, id) => ler(c, (l) => lerLinhasOrcamento(l, id)),
    realizado: (c, empresa, ano) => ler(c, (l) => lerRealizadoAno(l, empresa, ano)),
    criar: (c, x, por, trilha) =>
      gravar(c, async (e) => {
        const r = await criarVersaoOrcamento(e, x, por);
        await gravarTrilha(e, { ...trilha, hospital: e.hospital, idAlvo: String(r.id) });
        return r;
      }),
    gravarLinhas: (c, id, versao, g, por, trilha) =>
      gravar(c, async (e) => {
        const r = await gravarLinhasOrcamento(e, id, versao, g, por);
        await gravarTrilha(e, { ...trilha, hospital: e.hospital, idAlvo: String(id) });
        return r;
      }),
    aprovar: (c, x, obs, por, trilha) =>
      gravar(c, async (e) => {
        const r = await aprovarVersaoOrcamento(e, x, obs, por);
        await gravarTrilha(e, { ...trilha, hospital: e.hospital, idAlvo: String(x.id) });
        return r;
      }),
    descartar: (c, id, versao, motivo, por, trilha) =>
      gravar(c, async (e) => {
        await descartarVersaoOrcamento(e, id, versao, motivo, por);
        await gravarTrilha(e, { ...trilha, hospital: e.hospital, idAlvo: String(id) });
      }),
  };
}

export function portaOrcamentoLegado(nucleo: NucleoLegado): PortaOrcamento {
  const ctx = (c: ContextoOrcamento) => ({ rede: c.rede, hospital: c.hospital, traceId: 'orcamento' });
  return {
    destino: 'legado',
    ...sobre(
      (c, fn) => nucleo.lerSomente(ctx(c), fn),
      (c, fn) => nucleo.gravarSgh(ctx(c), fn),
    ),
  };
}

/** Sobre uma transação já aberta (quem abriu desfaz). */
export function portaOrcamentoNasTransacoes(transacoes: ReadonlyMap<string, Escritor>): PortaOrcamento {
  const de = (c: ContextoOrcamento): Escritor => {
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

export function portaOrcamentoIndisponivel(): PortaOrcamento {
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
    apoio: recusa,
    versoes: recusa,
    versao: recusa,
    linhas: recusa,
    realizado: recusa,
    criar: recusa,
    gravarLinhas: recusa,
    aprovar: recusa,
    descartar: recusa,
  };
}
