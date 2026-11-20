// Porta do patrimônio sobre o núcleo do legado (M54, etapa 6): leituras READ ONLY e gravação numa transação SGH_
// (escritor `somenteSgh` do `gravarSgh`), com a SGH_TRILHA na mesma transação. `portaPatrimonioNasTransacoes`: a mesma
// porta sobre uma transação já aberta (integração e assinatura na cópia, sempre desfeitas).
import {
  abrirInventarioBens,
  alterarBem,
  alterarGrupoBemSgh,
  excluirGrupoBemSgh,
  inativarGrupoBemSgh,
  incluirGrupoBemSgh,
  lerContasDoGrupoBem,
  lerGruposBem,
  lerVersoesGrupoBem,
  reativarGrupoBemSgh,
  cadastrarBens,
  calcularDepreciacaoSgh,
  estornarDepreciacaoSgh,
  anexarLaudoBemSgh,
  estornarAjusteBemSgh,
  lerLaudo,
  lerLaudosDoBem,
  lerAjustesDoBem,
  registrarAjusteBemSgh,
  cancelarMovimentoBem,
  decidirMovimentoBem,
  encerrarInventarioBens,
  cancelarInventarioBens,
  type Escritor,
  gravarTrilha,
  type Leitor,
  lerBem,
  lerBemPorPlaqueta,
  lerBens,
  lerBensEsperados,
  lerBensParaDepreciar,
  lerCalculos,
  lerCotasDoCalculo,
  lerEstornosDaCompetencia,
  lerDominiosPatrimonio,
  lerInventario,
  lerInventarios,
  lerItemNota,
  lerItensDaNota,
  lerLeiturasDoInventario,
  lerMovimento,
  lerMovimentos,
  lerNotaEntrada,
  lerNotasEntrada,
  lerUltimaSaidaDoBem,
  type LinhaTrilha,
  type NucleoLegado,
  registrarLeituraInventario,
  registrarMovimentoBem,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro } from '../cadastro/comum.js';
import type { ContextoPatrimonio, PortaPatrimonio } from './porta.js';

type Ler = <T>(c: ContextoPatrimonio, fn: (l: Leitor) => Promise<T>) => Promise<T>;
type Gravar = <T>(c: ContextoPatrimonio, fn: (e: Escritor) => Promise<T>) => Promise<T>;

const trilhaEm = (e: Escritor, t: LinhaTrilha, id: number | string) =>
  gravarTrilha(e, { ...t, hospital: e.hospital, idAlvo: String(id) });

function sobre(ler: Ler, gravar: Gravar): Omit<PortaPatrimonio, 'destino'> {
  return {
    dominios: (c) => ler(c, (l) => lerDominiosPatrimonio(l)),
    bens: (c, f) => ler(c, (l) => lerBens(l, f)),
    bem: (c, id) => ler(c, (l) => lerBem(l, id)),
    bemPorPlaqueta: (c, p) => ler(c, (l) => lerBemPorPlaqueta(l, p)),
    notas: (c, ano, mes, busca) => ler(c, (l) => lerNotasEntrada(l, ano, mes, busca)),
    nota: (c, id) => ler(c, (l) => lerNotaEntrada(l, id)),
    itensDaNota: (c, n) => ler(c, (l) => lerItensDaNota(l, n)),
    itemNota: (c, id) => ler(c, (l) => lerItemNota(l, id)),
    bensParaDepreciar: (c, emp, comp) => ler(c, (l) => lerBensParaDepreciar(l, emp, comp)),
    calculos: (c, emp, comp) => ler(c, (l) => lerCalculos(l, emp, comp)),
    cotas: (c, id) => ler(c, (l) => lerCotasDoCalculo(l, id)),
    estornos: (c, emp, comp) => ler(c, (l) => lerEstornosDaCompetencia(l, emp, comp)),
    ajustes: (c, bem) => ler(c, (l) => lerAjustesDoBem(l, bem)),
    laudos: (c, bem) => ler(c, (l) => lerLaudosDoBem(l, bem)),
    laudo: (c, id) => ler(c, (l) => lerLaudo(l, id)),
    movimentos: (c, f) => ler(c, (l) => lerMovimentos(l, f)),
    movimento: (c, id) => ler(c, (l) => lerMovimento(l, id)),
    ultimaSaida: (c, bem) => ler(c, (l) => lerUltimaSaidaDoBem(l, bem)),
    inventarios: (c) => ler(c, (l) => lerInventarios(l)),
    inventario: (c, id) => ler(c, (l) => lerInventario(l, id)),
    leituras: (c, id) => ler(c, (l) => lerLeiturasDoInventario(l, id)),
    esperados: (c, centro) => ler(c, (l) => lerBensEsperados(l, centro)),
    grupos: (c) => ler(c, (l) => lerGruposBem(l)),
    versoesGrupo: (c, id) => ler(c, (l) => lerVersoesGrupoBem(l, id)),
    contasDoGrupo: (c) => ler(c, (l) => lerContasDoGrupoBem(l)),
    // W0-08: as recusas do núcleo (409 com os dependentes e a oferta de inativar) viram o problema da API.
    incluirGrupo: (c, x, por, t) =>
      gravar(c, async (e) => {
        const g = await incluirGrupoBemSgh(e, x, por);
        await trilhaEm(e, t, g.id ?? x.codigo);
        return g;
      }).catch((e: unknown) => {
        throw problemaDoCadastro(e);
      }),
    alterarGrupo: (c, x, por, t) =>
      gravar(c, async (e) => {
        const r = await alterarGrupoBemSgh(e, x, por);
        await trilhaEm(e, t, r.depois.id ?? x.codigo);
        return r;
      }).catch((e: unknown) => {
        throw problemaDoCadastro(e);
      }),
    situacaoGrupo: (c, x, por, t) =>
      gravar(c, async (e) => {
        const r = x.ativo ? await reativarGrupoBemSgh(e, x, por) : await inativarGrupoBemSgh(e, x, por);
        await trilhaEm(e, t, r.depois.id ?? x.codigo);
        return r;
      }).catch((e: unknown) => {
        throw problemaDoCadastro(e);
      }),
    excluirGrupo: (c, x, por, t) =>
      gravar(c, async (e) => {
        const g = await excluirGrupoBemSgh(e, x, por);
        await trilhaEm(e, t, g.id ?? x.codigo);
        return g;
      }).catch((e: unknown) => {
        throw problemaDoCadastro(e);
      }),
    cadastrar: (c, x, por, gerar, t) =>
      gravar(c, async (e) => {
        const bens = await cadastrarBens(e, x, por, gerar);
        for (const b of bens) await trilhaEm(e, t, b.id);
        return bens;
      }),
    alterar: (c, x, por, conferir, t) =>
      gravar(c, async (e) => {
        const r = await alterarBem(e, x, por, conferir);
        if (r?.mudou) await trilhaEm(e, t, x.id);
        return r;
      }),
    registrarMovimento: (c, x, por, t) =>
      gravar(c, async (e) => {
        const r = await registrarMovimentoBem(e, x, por);
        await trilhaEm(e, t, r.movimento.id);
        return r;
      }),
    decidir: (c, x, por, conferir, t) =>
      gravar(c, async (e) => {
        const r = await decidirMovimentoBem(e, x, por, conferir);
        if (r) await trilhaEm(e, t, x.id);
        return r;
      }),
    cancelar: (c, x, por, conferir, t) =>
      gravar(c, async (e) => {
        const r = await cancelarMovimentoBem(e, x, por, conferir);
        if (r) await trilhaEm(e, t, x.id);
        return r;
      }),
    calcular: (c, x, por, montar, t) =>
      gravar(c, async (e) => {
        const r = await calcularDepreciacaoSgh(e, x, por, montar);
        await trilhaEm(e, t, r.calculo.id);
        return r;
      }),
    estornar: (c, x, por, conferir, t) =>
      gravar(c, async (e) => {
        const r = await estornarDepreciacaoSgh(e, x, por, conferir);
        await trilhaEm(e, t, r.estorno.id);
        return r;
      }),
    abrirInventario: (c, x, por, t) =>
      gravar(c, async (e) => {
        const id = await abrirInventarioBens(e, x, por);
        await trilhaEm(e, t, id);
        return id;
      }),
    registrarLeitura: (c, x, por, t) =>
      gravar(c, async (e) => {
        const id = await registrarLeituraInventario(e, x, por);
        await trilhaEm(e, t, id);
        return id;
      }),
    registrarAjuste: (c, x, por, planejar, t) =>
      gravar(c, async (e) => {
        const r = await registrarAjusteBemSgh(e, x, por, planejar);
        await trilhaEm(e, t, r.id);
        return r;
      }),
    anexarLaudo: (c, x, por, t) =>
      gravar(c, async (e) => {
        const r = await anexarLaudoBemSgh(e, x, por);
        await trilhaEm(e, t, r.id);
        return r;
      }),
    estornarAjuste: (c, x, por, conferir, t) =>
      gravar(c, async (e) => {
        const r = await estornarAjusteBemSgh(e, x, por, conferir);
        await trilhaEm(e, t, r.id);
        return r;
      }),
    cancelarInventario: (c, x, por, t) =>
      gravar(c, async (e) => {
        const ok = await cancelarInventarioBens(e, x, por);
        if (ok) await trilhaEm(e, t, x.id);
        return ok;
      }),
    encerrarInventario: (c, x, por, t) =>
      gravar(c, async (e) => {
        const ok = await encerrarInventarioBens(e, x, por);
        if (ok) await trilhaEm(e, t, x.id);
        return ok;
      }),
  };
}

export function portaPatrimonioLegado(nucleo: NucleoLegado): PortaPatrimonio {
  const ctx = (c: ContextoPatrimonio) => ({ rede: c.rede, hospital: c.hospital, traceId: 'patrimonio' });
  return {
    destino: 'legado',
    ...sobre(
      (c, fn) => nucleo.lerSomente(ctx(c), fn),
      (c, fn) => nucleo.gravarSgh(ctx(c), fn),
    ),
  };
}

/** Sobre uma transação já aberta (quem abriu desfaz). */
export function portaPatrimonioNasTransacoes(transacoes: ReadonlyMap<string, Escritor>): PortaPatrimonio {
  const de = (c: ContextoPatrimonio): Escritor => {
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

export function portaPatrimonioIndisponivel(): PortaPatrimonio {
  const recusa = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
      ),
    );
  const metodos = [
    'dominios',
    'bens',
    'bem',
    'bemPorPlaqueta',
    'notas',
    'nota',
    'itensDaNota',
    'itemNota',
    'bensParaDepreciar',
    'calculos',
    'cotas',
    'estornos',
    'ajustes',
    'laudos',
    'laudo',
    'movimentos',
    'movimento',
    'ultimaSaida',
    'inventarios',
    'inventario',
    'leituras',
    'esperados',
    'grupos',
    'versoesGrupo',
    'cadastrar',
    'alterar',
    'registrarMovimento',
    'decidir',
    'cancelar',
    'calcular',
    'estornar',
    'registrarAjuste',
    'estornarAjuste',
    'anexarLaudo',
    'abrirInventario',
    'registrarLeitura',
    'encerrarInventario',
    'cancelarInventario',
    'incluirGrupo',
    'alterarGrupo',
    'situacaoGrupo',
    'excluirGrupo',
  ] as const satisfies readonly (keyof Omit<PortaPatrimonio, 'destino'>)[];
  return {
    destino: 'indisponivel',
    ...(Object.fromEntries(metodos.map((m) => [m, recusa])) as unknown as Omit<PortaPatrimonio, 'destino'>),
  };
}
