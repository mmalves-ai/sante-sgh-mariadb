// Porta do ponto sobre o núcleo do legado (M52.4): leituras numa transação curta READ ONLY no banco do estabelecimento
// da sessão; gravações SGH_PES_* numa transação SGH_ (`somenteSgh`: nenhuma tabela do outro sistema) com a SGH_TRILHA
// junto. Em dev sobre a cópia compartilhada, as gravações são recusadas com o motivo (`sghSoLeitura`): a prova da
// gravação é a integração, sob a trava da cópia e desfeita. `portaPontoNaTransacao`: a mesma porta sobre UMA transação
// aberta (integração na cópia, desfeita). Nenhuma operação do executor: o ponto não grava no outro sistema.
import {
  ajustePontoPesSgh,
  ajustesDoVinculoPesSgh,
  arquivoAfdPesSgh,
  arquivoAfdPorHashPesSgh,
  arquivosAfdDoPeriodoPesSgh,
  arquivosAfdPesSgh,
  contagemMarcacoesPesSgh,
  decidirAjustePontoPesSgh,
  desistirAjustePesSgh,
  situacaoRegraBancoPesSgh,
  dominiosPonto,
  type Escritor,
  eventosPeriodoDaCompetenciaPesSgh,
  eventosPeriodoDoVinculoPesSgh,
  feriadosDoPeriodo,
  gravarOutbox,
  gravarRegraBancoPesSgh,
  gravarTrilha,
  hmacsDosVinculosPesSgh,
  incluirAjustePontoPesSgh,
  incluirArquivoAfdPesSgh,
  incluirEventoPeriodoPesSgh,
  incluirMarcacaoPesSgh,
  incluirMovimentoBancoPesSgh,
  type Leitor,
  marcacoesDaPessoaPesSgh,
  movimentosBancoPesSgh,
  nsrsImportadosPesSgh,
  type NucleoLegado,
  pendentesPorVinculoPesSgh,
  regrasBancoPesSgh,
  correcoesPesSgh,
  registrarCorrecaoPesSgh,
  relogioRecepcao,
  saldosBancoPesSgh,
  somenteSgh,
  travarPessoaPesSgh,
  vinculosDoLoginPesSgh,
  vinculosPorHmacsPesSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import { portaIndisponivel } from '../../exames/public-api.js';
import {
  type ContextoPonto,
  type GravadorPonto,
  METODOS_PORTA_PONTO,
  type PortaPonto,
} from './porta-ponto.js';

type Ler = <T>(c: ContextoPonto, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaPonto, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    relogio: (c) =>
      ler(c, async (l) => {
        const r = await relogioRecepcao(l);
        return { hoje: r.hoje, agora: r.agora.slice(0, 16) };
      }),
    dominios: (c) => ler(c, (l) => dominiosPonto(l)),
    feriados: (c, de, ate) => ler(c, (l) => feriadosDoPeriodo(l, de, ate)),
    arquivos: (c, f) => ler(c, (l) => arquivosAfdPesSgh(l, c.hospital, f)),
    arquivo: (c, id) => ler(c, (l) => arquivoAfdPesSgh(l, c.hospital, id)),
    arquivosDoPeriodo: (c, de, ate) => ler(c, (l) => arquivosAfdDoPeriodoPesSgh(l, c.hospital, de, ate)),
    marcacoes: (c, h, de, ate) => ler(c, (l) => marcacoesDaPessoaPesSgh(l, c.hospital, h, de, ate)),
    contagemMarcacoes: (c, hs, de, ate) =>
      hs.length === 0
        ? Promise.resolve(new Map())
        : ler(c, (l) => contagemMarcacoesPesSgh(l, c.hospital, hs, de, ate)),
    hmacs: (c, vs) =>
      vs.length === 0 ? Promise.resolve(new Map()) : ler(c, (l) => hmacsDosVinculosPesSgh(l, c.hospital, vs)),
    ajustes: (c, v, de, ate) => ler(c, (l) => ajustesDoVinculoPesSgh(l, c.hospital, v, de, ate)),
    ajuste: (c, id) => ler(c, (l) => ajustePontoPesSgh(l, c.hospital, id)),
    pendentesPorVinculo: (c, de, ate) => ler(c, (l) => pendentesPorVinculoPesSgh(l, c.hospital, de, ate)),
    eventosPeriodo: (c, v) => ler(c, (l) => eventosPeriodoDoVinculoPesSgh(l, c.hospital, v)),
    eventosDaCompetencia: (c, comp) => ler(c, (l) => eventosPeriodoDaCompetenciaPesSgh(l, c.hospital, comp)),
    regrasBanco: (c) => ler(c, (l) => regrasBancoPesSgh(l, c.hospital)),
    correcoes: (c, t, ids) =>
      ids.length === 0 ? Promise.resolve([]) : ler(c, (l) => correcoesPesSgh(l, c.hospital, t, ids)),
    movimentosBanco: (c, v) => ler(c, (l) => movimentosBancoPesSgh(l, c.hospital, v)),
    saldosBanco: (c, vs) =>
      vs.length === 0 ? Promise.resolve(new Map()) : ler(c, (l) => saldosBancoPesSgh(l, c.hospital, vs)),
    vinculosDoLogin: (c, login) => ler(c, (l) => vinculosDoLoginPesSgh(l, c.hospital, login)),
    vinculosPorHmacs: (c, hs) =>
      hs.length === 0 ? Promise.resolve(new Map()) : ler(c, (l) => vinculosPorHmacsPesSgh(l, c.hospital, hs)),
  };
}

function gravador(e: Escritor, c: ContextoPonto): GravadorPonto {
  const h = c.hospital;
  return {
    arquivoPorHash: (hash) => arquivoAfdPorHashPesSgh(e, h, hash),
    nsrsImportados: (rep, de, ate) => nsrsImportadosPesSgh(e, h, rep, de, ate),
    incluirArquivo: (a) => incluirArquivoAfdPesSgh(e, { hospital: h, ...a }),
    incluirMarcacao: (m) => incluirMarcacaoPesSgh(e, { hospital: h, ...m }),
    marcacoes: (hm, de, ate) => marcacoesDaPessoaPesSgh(e, h, hm, de, ate),
    ajuste: (id) => ajustePontoPesSgh(e, h, id),
    ajustes: (v, de, ate) => ajustesDoVinculoPesSgh(e, h, v, de, ate),
    incluirAjuste: (a) => incluirAjustePontoPesSgh(e, { hospital: h, ...a }),
    decidirAjuste: (d) => decidirAjustePontoPesSgh(e, { hospital: h, ...d }),
    eventosPeriodo: (v) => eventosPeriodoDoVinculoPesSgh(e, h, v),
    incluirEventoPeriodo: (p) => incluirEventoPeriodoPesSgh(e, { hospital: h, ...p }),
    movimentosBanco: (v) => movimentosBancoPesSgh(e, h, v),
    incluirMovimentoBanco: (m) => incluirMovimentoBancoPesSgh(e, { hospital: h, ...m }),
    regrasBanco: () => regrasBancoPesSgh(e, h),
    gravarRegraBanco: (r) => gravarRegraBancoPesSgh(e, { hospital: h, ...r }),
    desistirAjuste: (d) => desistirAjustePesSgh(e, { hospital: h, ...d }),
    situacaoRegraBanco: (x) => situacaoRegraBancoPesSgh(e, { hospital: h, ...x }),
    registrarCorrecao: (x) => registrarCorrecaoPesSgh(e, { hospital: h, ...x }),
    travarPessoa: (p) => travarPessoaPesSgh(e, h, p),
    outbox: (ev) => gravarOutbox(e, { rede: c.rede, hospital: h, ...ev }),
  };
}

const recusaSoLeitura = () =>
  Promise.reject(
    new ErroProblema(
      'recurso-desligado',
      403,
      'Gravação desligada neste ambiente',
      'Neste ambiente de desenvolvimento o banco é só de leitura: o ponto não grava.',
      { codigo: 'somente-leitura' },
    ),
  );

const semExecutor = () =>
  Promise.reject(
    new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', 'O ponto não usa o executor.'),
  );

export function portaPontoLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente'> & Partial<Pick<NucleoLegado, 'gravarSgh'>>,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaPonto {
  const ctx = (c: ContextoPonto) => ({ rede: c.rede, hospital: c.hospital, traceId: 'ponto' });
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
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

/** A mesma porta sobre UMA transação aberta (integração na cópia, sempre desfeita). */
export function portaPontoNaTransacao(e: Escritor): PortaPonto {
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

export function portaPontoIndisponivel(): PortaPonto {
  return portaIndisponivel<PortaPonto>(METODOS_PORTA_PONTO);
}

/** O gravador sobre um escritor já `somenteSgh` (W0-06: a aprovação da solicitação grava o efeito na mesma transação). */
export { gravador as gravadorPontoSgh };
