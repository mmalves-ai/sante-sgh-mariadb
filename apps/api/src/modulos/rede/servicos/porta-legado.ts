// Porta dos serviços compartilhados sobre o núcleo do legado (M57, etapa 3): leitura READ ONLY e gravação numa
// transação SGH_ (escritor `somenteSgh` do `gravarSgh`), só no banco do estabelecimento do contexto, com a SGH_TRILHA
// na mesma transação. `portaServicosRedeNasTransacoes`: a mesma porta sobre transações já abertas (integração e
// assinatura na cópia, sempre desfeitas).
import {
  alterarServicoCompartilhado,
  type Escritor,
  gravarTrilha,
  type Leitor,
  lerServicoCompartilhado,
  lerServicosCompartilhados,
  type NucleoLegado,
  registrarServicoCompartilhado,
} from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import type { ContextoServicosRede, PortaServicosRede } from './porta.js';

function sobre(
  ler: <T>(c: ContextoServicosRede, fn: (l: Leitor) => Promise<T>) => Promise<T>,
  gravar: <T>(c: ContextoServicosRede, fn: (e: Escritor) => Promise<T>) => Promise<T>,
): Omit<PortaServicosRede, 'destino'> {
  return {
    listar: (c, f) => ler(c, (l) => lerServicosCompartilhados(l, f)),
    ler: (c, id) => ler(c, (l) => lerServicoCompartilhado(l, id)),
    registrar: (c, novo, por, trilha) =>
      gravar(c, async (e) => {
        const r = await registrarServicoCompartilhado(e, novo, por);
        await gravarTrilha(e, { ...trilha, hospital: e.hospital, idAlvo: String(r.id) });
        return r;
      }),
    alterar: (c, id, m, por, trilha) =>
      gravar(c, async (e) => {
        const r = await alterarServicoCompartilhado(e, id, m, por);
        if (r?.mudou) await gravarTrilha(e, { ...trilha, hospital: e.hospital, idAlvo: String(id) });
        return r;
      }),
  };
}

export function portaServicosRedeLegado(nucleo: NucleoLegado): PortaServicosRede {
  const ctx = (c: ContextoServicosRede) => ({ rede: c.rede, hospital: c.hospital, traceId: 'rede-servicos' });
  return {
    destino: 'legado',
    ...sobre(
      (c, fn) => nucleo.lerSomente(ctx(c), fn),
      (c, fn) => nucleo.gravarSgh(ctx(c), fn),
    ),
  };
}

/** Sobre transações já abertas, uma por banco (quem abriu desfaz). */
export function portaServicosRedeNasTransacoes(transacoes: ReadonlyMap<string, Escritor>): PortaServicosRede {
  const de = (c: ContextoServicosRede): Escritor => {
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

export function portaServicosRedeIndisponivel(): PortaServicosRede {
  const recusa = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'Os bancos dos estabelecimentos não estão configurados: nada foi lido nem gravado.',
      ),
    );
  return { destino: 'indisponivel', listar: recusa, ler: recusa, registrar: recusa, alterar: recusa };
}
