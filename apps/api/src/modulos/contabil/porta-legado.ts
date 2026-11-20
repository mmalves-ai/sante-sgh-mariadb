// Porta da contabilidade sobre o núcleo do legado (M54-F1): cada leitura numa transação curta READ ONLY no banco do
// estabelecimento; as gravações só do novo (SGH_CTB_PLANO_CONTA, SGH_CTB_REGRA e a situação em SGH_CTB_FATO) numa
// transação SGH_ com a SGH_TRILHA junto (`somenteSgh` recusa qualquer escrita fora de SGH_). Em dev sobre a cópia
// compartilhada, as gravações são recusadas (`sghSoLeitura`).
import {
  apuracoesDoExercicioSgh,
  arquivosSpedSgh,
  conteudoArquivoSpedSgh,
  diarioSgh,
  empresaParaSpedLegado,
  gravarArquivoSpedSgh,
  lancamentosDoExercicioSgh,
  situacaoArquivoSpedSgh,
  somasPorContaSgh,
  alterarContaSgh,
  conciliacoesSgh,
  conciliarSgh,
  desfazerConciliacaoSgh,
  encerrarPeriodoSgh,
  fatosDoPeriodoPorSituacaoSgh,
  fatosParaContabilizarSgh,
  gravarLancamentoSgh,
  lancamentoSgh,
  lancamentosSgh,
  movimentoPorCompetenciaSgh,
  pendentesConciliacaoSgh,
  periodosSgh,
  razaoSgh,
  reabrirPeriodoSgh,
  totaisDoPeriodoSgh,
  deParaDaExportacao,
  centrosDeCusto,
  empresasComPlanoSgh,
  estadosDasFontesSgh,
  fatosDaCompetenciaSgh,
  fatosSgh,
  gravarTrilha,
  incluirContaSgh,
  type Leitor,
  lancamentosDosFatosSgh,
  marcarSituacaoFatoSgh,
  type NucleoLegado,
  planoDeContasSgh,
  publicarRegraSgh,
  referenciasContabeis,
  regrasPublicadasSgh,
  relogioRecepcao,
  resumoDosFatosSgh,
  somenteSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoContabil, METODOS_PORTA_CONTABIL, type PortaContabil } from './porta.js';

export function portaContabilLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente' | 'gravarSgh'>,
  opcoes: { readonly sghSoLeitura?: boolean } = {},
): PortaContabil {
  const ctx = (c: ContextoContabil) => ({ rede: c.rede, hospital: c.hospital, traceId: 'contabil' });
  const ler = <T>(c: ContextoContabil, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    hoje: (c) => ler(c, async (l) => (await relogioRecepcao(l)).hoje),
    referencias: (c) => ler(c, (l) => referenciasContabeis(l)),
    dePara: (c, empresa) => ler(c, (l) => deParaDaExportacao(l, empresa)),
    empresas: (c) => ler(c, (l) => empresasComPlanoSgh(l, c.hospital)),
    centrosCusto: (c) =>
      ler(c, async (l) =>
        (await centrosDeCusto(l)).map((x) => ({ codigo: x.codigo, nome: x.nome, ativo: x.ativo })),
      ),
    plano: (c, empresa) => ler(c, (l) => planoDeContasSgh(l, c.hospital, empresa)),
    regras: (c, empresa, f) => ler(c, (l) => regrasPublicadasSgh(l, c.hospital, empresa, f)),
    fontes: (c) => ler(c, (l) => estadosDasFontesSgh(l, c.hospital)),
    resumoFatos: (c) => ler(c, (l) => resumoDosFatosSgh(l, c.hospital)),
    fatos: (c, f, pagina, tamanho) => ler(c, (l) => fatosSgh(l, c.hospital, f, pagina, tamanho)),
    fatosDaCompetencia: (c, empresa, competencia, teto) =>
      ler(c, (l) => fatosDaCompetenciaSgh(l, c.hospital, empresa, competencia, teto)),
    periodos: (c, empresa) => ler(c, (l) => periodosSgh(l, c.hospital, empresa)),
    movimentoPorCompetencia: (c, empresa) =>
      ler(c, (l) => movimentoPorCompetenciaSgh(l, c.hospital, empresa)),
    totaisDoPeriodo: (c, empresa, competencia) =>
      ler(c, (l) => totaisDoPeriodoSgh(l, c.hospital, empresa, competencia)),
    fatosDoPeriodo: (c, empresa, competencia) =>
      ler(c, (l) => fatosDoPeriodoPorSituacaoSgh(l, c.hospital, empresa, competencia)),
    lancamentos: (c, f, pagina, tamanho) => ler(c, (l) => lancamentosSgh(l, c.hospital, f, pagina, tamanho)),
    lancamento: (c, id) => ler(c, (l) => lancamentoSgh(l, c.hospital, id)),
    razao: (c, f, teto, pagina) => ler(c, (l) => razaoSgh(l, c.hospital, f, teto, pagina)),
    pendentesConciliacao: (c, empresa, conta, ate, teto) =>
      ler(c, (l) => pendentesConciliacaoSgh(l, c.hospital, empresa, conta, ate, teto)),
    conciliacoes: (c, empresa, conta, teto) =>
      ler(c, (l) => conciliacoesSgh(l, c.hospital, empresa, conta, teto)),
    lancamentosDosFatos: (c, ids) => ler(c, (l) => lancamentosDosFatosSgh(l, c.hospital, ids)),
    paraContabilizar: (c, empresa, situacoes, competencia, lote) =>
      ler(c, (l) => fatosParaContabilizarSgh(l, c.hospital, empresa, situacoes, competencia, lote)),
    somas: (c, f, teto) => ler(c, (l) => somasPorContaSgh(l, c.hospital, f, teto)),
    apuracoes: (c, empresa, exercicio) =>
      ler(c, (l) => apuracoesDoExercicioSgh(l, c.hospital, empresa, exercicio)),
    diario: (c, empresa, de, ate, teto, pagina) =>
      ler(c, (l) => diarioSgh(l, c.hospital, empresa, de, ate, teto, pagina)),
    lancamentosDoExercicio: (c, empresa, exercicio, teto) =>
      ler(c, (l) => lancamentosDoExercicioSgh(l, c.hospital, empresa, exercicio, teto)),
    empresaSped: (c, empresa) => ler(c, (l) => empresaParaSpedLegado(l, empresa)),
    arquivosSped: (c, empresa, teto) => ler(c, (l) => arquivosSpedSgh(l, c.hospital, empresa, teto)),
    conteudoSped: (c, empresa, id) => ler(c, (l) => conteudoArquivoSpedSgh(l, c.hospital, empresa, id)),
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: a contabilidade não é gravada.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const h = c.hospital;
        const r = await fn({
          incluirConta: (x) => incluirContaSgh(e, { hospital: h, ...x }),
          alterarConta: (x) => alterarContaSgh(e, { hospital: h, ...x }),
          publicarRegra: (x) => publicarRegraSgh(e, { hospital: h, ...x }),
          marcarSituacao: (x) => marcarSituacaoFatoSgh(e, { hospital: h, ...x }),
          gravarLancamento: (x, usuario) => gravarLancamentoSgh(e, h, x, usuario),
          encerrarPeriodo: (x) => encerrarPeriodoSgh(e, { hospital: h, ...x }),
          reabrirPeriodo: (x) => reabrirPeriodoSgh(e, { hospital: h, ...x }),
          conciliar: (x) => conciliarSgh(e, { hospital: h, ...x }),
          desfazerConciliacao: (x) => desfazerConciliacaoSgh(e, { hospital: h, ...x }),
          gravarArquivoSped: (x) => gravarArquivoSpedSgh(e, { hospital: h, ...x }),
          situacaoArquivoSped: (x) => situacaoArquivoSpedSgh(e, { hospital: h, ...x }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
  };
}

/** Fora de dev/ci sem o núcleo: 503 em tudo (falha fechada). */
export function portaContabilIndisponivel(): PortaContabil {
  return portaIndisponivel<PortaContabil>(METODOS_PORTA_CONTABIL);
}
