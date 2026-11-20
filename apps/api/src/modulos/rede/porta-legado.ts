// Porta do MPI da Rede sobre o núcleo do legado (M57, etapas 1 e 2): cada chamada lê (READ ONLY) ou grava (transação SGH_,
// escritor `somenteSgh`, com a SGH_TRILHA na mesma transação) SÓ no banco do estabelecimento do contexto. Nenhuma
// transação cruza os bancos (regra 4). `portaRedeNasTransacoes`: a mesma porta sobre transações já abertas, uma por
// banco (integração na cópia, sempre desfeita).
import {
  contarAtendimentosRede,
  contarFilaRedePorFaixa,
  type Escritor,
  executarEscritasIndiceRede,
  gravarCandidatosRede,
  gravarMarcaRede,
  gravarParesDuplicidade,
  gravarTrilha,
  identidadeParaCertificado,
  type Leitor,
  lerCadastrosAlteradosRede,
  lerCadastrosRedePorIds,
  lerCandidatoRede,
  lerFilaRede,
  lerLoteCadastrosRede,
  lerLoteVinculosRede,
  lerMarcaRede,
  lerVinculoRede,
  lerVinculosDoCadastroRede,
  type LinhaTrilha,
  type NucleoLegado,
  pessoasDosCadastrosRede,
  procurarCandidatosRede,
  situacoesCandidatosRede,
} from '@sgh/legado';
import { FAIXAS_PONTUACAO_REDE } from '@sgh/contratos';
import { ErroProblema } from '../../problema.filter.js';
import {
  type ContextoRede,
  type EstabelecimentoRede,
  type GravadorRede,
  METODOS_PORTA_REDE,
  type PortaRede,
} from './porta.js';

const FAIXAS = {
  alta: FAIXAS_PONTUACAO_REDE.alta.minimo,
  media: FAIXAS_PONTUACAO_REDE.media.minimo,
  baixa: FAIXAS_PONTUACAO_REDE.baixa.minimo,
};

function gravador(e: Escritor): GravadorRede {
  return {
    escritas: (ws) => executarEscritasIndiceRede(e, ws),
    candidatos: (cs) => gravarCandidatosRede(e, cs),
    marca: (m, por) => gravarMarcaRede(e, m, por),
    duplicidadesLocais: (pares) => gravarParesDuplicidade(e, e.hospital, pares),
  };
}

async function naTransacao<T>(e: Escritor, fn: (g: GravadorRede) => Promise<T>, trilha: LinhaTrilha | null) {
  const r = await fn(gravador(e));
  if (trilha) await gravarTrilha(e, { ...trilha, hospital: e.hospital });
  return r;
}

type Ler = <T>(c: ContextoRede, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaRede, 'destino' | 'redeConfigurada' | 'estabelecimentos' | 'gravar'> {
  return {
    cadastrosPorIds: (c, ids) => ler(c, (l) => lerCadastrosRedePorIds(l, ids)),
    procurarCandidatos: (c, ch) => ler(c, (l) => procurarCandidatosRede(l, ch)),
    loteCadastros: (c, depois, n) => ler(c, (l) => lerLoteCadastrosRede(l, depois, n)),
    cadastrosAlterados: (c, desde, depois, n) =>
      ler(c, (l) => lerCadastrosAlteradosRede(l, desde, depois, n)),
    fila: (c, f) => ler(c, (l) => lerFilaRede(l, f)),
    filaPorFaixa: (c, s, recorte) => ler(c, (l) => contarFilaRedePorFaixa(l, s, FAIXAS, recorte ?? {})),
    candidato: (c, chave) => ler(c, (l) => lerCandidatoRede(l, chave)),
    situacoes: (c, chaves) => ler(c, (l) => situacoesCandidatosRede(l, chaves)),
    vinculo: (c, chave) => ler(c, (l) => lerVinculoRede(l, chave)),
    vinculosDoCadastro: (c, id) => ler(c, (l) => lerVinculosDoCadastroRede(l, id)),
    pessoasDosCadastros: (c, ids) => ler(c, (l) => pessoasDosCadastrosRede(l, ids)),
    loteVinculos: (c, depois, n) => ler(c, (l) => lerLoteVinculosRede(l, depois, n)),
    marca: (c) => ler(c, (l) => lerMarcaRede(l)),
    atendimentos: (c, prontuario) => ler(c, (l) => contarAtendimentosRede(l, prontuario)),
    cpfDoLogin: (c, login) => ler(c, async (l) => (await identidadeParaCertificado(l, login))?.cpf ?? null),
  };
}

/**
 * Sobre o núcleo: `estabelecimentos` são os configurados (ARQ-1). HS-1: com o núcleo real, só os que têm os scripts
 * SGH_REDE_* aplicados entram (`liberados`; hoje o estabelecimento do catálogo).
 */
export function portaRedeLegado(
  nucleo: NucleoLegado,
  liberados: ReadonlySet<string> | null = null,
): PortaRede {
  const ctx = (c: ContextoRede) => ({ rede: c.rede, hospital: c.hospital, traceId: 'rede-mpi' });
  const ests: EstabelecimentoRede[] = nucleo.estabelecimentos
    .filter((e) => !liberados || liberados.has(e.codigo))
    .map((e) => ({ codigo: e.codigo, nome: e.nome }));
  return {
    destino: 'legado',
    redeConfigurada: () => nucleo.rede,
    estabelecimentos: () => ests,
    gravar: (c, fn, trilha) => nucleo.gravarSgh(ctx(c), (e) => naTransacao(e, fn, trilha)),
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

/** Sobre transações já abertas, uma por banco (integração; quem abriu desfaz). */
export function portaRedeNasTransacoes(
  rede: string,
  transacoes: ReadonlyMap<string, Escritor>,
  nomes: Readonly<Record<string, string>> = {},
): PortaRede {
  const de = (c: ContextoRede): Escritor => {
    const e = transacoes.get(c.hospital);
    if (!e) throw new ErroProblema('indisponivel', 503, 'Banco do estabelecimento indisponível');
    return e;
  };
  return {
    destino: 'legado',
    redeConfigurada: () => rede,
    estabelecimentos: () =>
      [...transacoes.keys()].map((codigo) => ({ codigo, nome: nomes[codigo] ?? codigo })),
    gravar: (c, fn, trilha) => naTransacao(de(c), fn, trilha),
    ...leituras((c, fn) => fn(de(c))),
  };
}

export function portaRedeIndisponivel(): PortaRede {
  const recusa = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'Os bancos dos estabelecimentos não estão configurados: nada foi lido nem gravado.',
      ),
    );
  const base = Object.fromEntries(METODOS_PORTA_REDE.map((m) => [m, recusa]));
  return {
    ...(base as unknown as PortaRede),
    destino: 'indisponivel',
    redeConfigurada: () => null,
    estabelecimentos: () => [],
  };
}
