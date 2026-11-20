// Porta da integração da folha sobre o núcleo do legado (M53.9): leituras numa transação curta READ ONLY no banco do
// estabelecimento da sessão (o cadastro de rotinas e o aviso de títulos manuais no outro sistema; o resto em SGH_); a
// vigência do de-para numa transação SGH_ (`somenteSgh`) com a SGH_TRILHA junto; o lançamento dos títulos pelo EXECUTOR
// (`financeiro.criarTituloPagar`, ação `incluir-folha`: títulos, SGH_PES_FOLHA_* e a outbox numa transação, regra 10).
// Em dev sobre a cópia compartilhada, as gravações são recusadas com o motivo (`sghSoLeitura` e o executor só de
// leitura): a prova é a integração, sob a trava da cópia e desfeita. `portaIntegracaoFolhaNaTransacao`: a mesma porta
// sobre UMA transação aberta (integração na cópia, desfeita).
import {
  chavesLancadasPesSgh,
  classificacoes,
  credoresFolha,
  custoPessoalPesSgh,
  type Escritor,
  type Executor,
  gravarTrilha,
  incluirIntegracaoFolhaPesSgh,
  integracoesFolhaPesSgh,
  lancamentoDaOrigemPesSgh,
  lancamentoFolhaPesSgh,
  lancamentosFolhaPesSgh,
  type Leitor,
  type NucleoLegado,
  operacao,
  retornoParaTitulosPesSgh,
  rotinasIntegracaoFolha,
  somenteSgh,
  titulosDoLancamentoPesSgh,
  titulosManuaisDaFolha,
} from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import { portaIndisponivel } from '../../exames/public-api.js';
import {
  type ContextoIntegracaoFolha,
  type GravadorIntegracaoFolha,
  METODOS_PORTA_INTEGRACAO_FOLHA,
  type PortaIntegracaoFolha,
} from './porta-integracao.js';

type Ler = <T>(c: ContextoIntegracaoFolha, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaIntegracaoFolha, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    rotinas: (c) => ler(c, (l) => rotinasIntegracaoFolha(l)),
    integracoes: (c, e) => ler(c, (l) => integracoesFolhaPesSgh(l, c.hospital, e)),
    retorno: (c, id) => ler(c, (l) => retornoParaTitulosPesSgh(l, c.hospital, id)),
    lancamentos: (c, e, ano) => ler(c, (l) => lancamentosFolhaPesSgh(l, c.hospital, e, ano)),
    lancamento: (c, id) => ler(c, (l) => lancamentoFolhaPesSgh(l, c.hospital, id)),
    lancamentoDaOrigem: (c, o, id) => ler(c, (l) => lancamentoDaOrigemPesSgh(l, c.hospital, o, id)),
    titulosDoLancamento: (c, id) => ler(c, (l) => titulosDoLancamentoPesSgh(l, c.hospital, id)),
    chavesLancadas: (c, e, a, p) => ler(c, (l) => chavesLancadasPesSgh(l, c.hospital, e, a, p)),
    custoPessoal: (c, e, p) => ler(c, (l) => custoPessoalPesSgh(l, c.hospital, e, p)),
    titulosManuais: (c, f) => ler(c, (l) => titulosManuaisDaFolha(l, { hospital: c.hospital, ...f })),
    classificacoes: (c) => ler(c, (l) => classificacoes(l)),
    credores: (c, f) => ler(c, (l) => credoresFolha(l, f)),
  };
}

function gravador(e: Escritor, c: ContextoIntegracaoFolha): GravadorIntegracaoFolha {
  return {
    integracoes: (empresa) => integracoesFolhaPesSgh(e, c.hospital, empresa),
    incluirIntegracao: (x) => incluirIntegracaoFolhaPesSgh(e, { hospital: c.hospital, ...x }),
  };
}

const recusaSoLeitura = () =>
  Promise.reject(
    new ErroProblema(
      'recurso-desligado',
      403,
      'Gravação desligada neste ambiente',
      'Neste ambiente de desenvolvimento o banco é só de leitura: a integração da folha não grava.',
      { codigo: 'somente-leitura' },
    ),
  );

export function portaIntegracaoFolhaLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente'> & Partial<Pick<NucleoLegado, 'gravarSgh'>>,
  executor: Executor,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaIntegracaoFolha {
  const ctx = (c: ContextoIntegracaoFolha) => ({
    rede: c.rede,
    hospital: c.hospital,
    traceId: 'folha-integracao',
  });
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx);
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
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
export function portaIntegracaoFolhaNaTransacao(e: Escritor, executor: Executor): PortaIntegracaoFolha {
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx, { escritor: e });
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
    async gravarSgh(c, trilha, fn) {
      const s = somenteSgh(e);
      const r = await fn(gravador(s, c));
      await gravarTrilha(s, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e)),
  };
}

export function portaIntegracaoFolhaIndisponivel(): PortaIntegracaoFolha {
  return portaIndisponivel<PortaIntegracaoFolha>(METODOS_PORTA_INTEGRACAO_FOLHA);
}
