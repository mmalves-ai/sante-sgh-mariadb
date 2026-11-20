// Porta da contratualização SUS (M55, fatia F5) sobre o núcleo do legado: leituras READ ONLY pelos repositórios de
// @sgh/legado; as gravações só do novo numa transação SGH_ com a SGH_TRILHA junto (o escritor só das SGH_). Recurso só
// do novo: o executor não é usado (os domínios CM* recusam gravação pelo gatilho). Em dev sobre a cópia compartilhada,
// as gravações SGH_ recusam (`sghSoLeitura`), como nos outros módulos. `portaContratualizacaoNaTransacao`: a mesma
// porta sobre UMA transação aberta (os testes de integração na cópia, desfeita).
import {
  alterarContratoSusSgh,
  alterarMetaSusSgh,
  apuracaoSus,
  apuracaoSusPelaChave,
  apuracoesSus,
  buscarSigtapSus,
  contratoSus,
  contratoSusPelaChave,
  contratosSus,
  corrigirApuracaoSusSgh,
  dominiosContratualizacao,
  encerrarContratoSusSgh,
  type Escritor,
  gravarTrilha,
  incluirContratoSusSgh,
  incluirMetaSusSgh,
  type Leitor,
  metaSus,
  metaSusPelaChave,
  metasSus,
  type NucleoLegado,
  numeroContratoSusEmUso,
  producaoContasSus,
  producaoFaturamentoSus,
  registrarApuracaoSusSgh,
  relogioContratualizacao,
  sigtapComPrefixo,
  somenteSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type GravadorContratualizacao,
  METODOS_PORTA_CONTRATUALIZACAO,
  type PortaContratualizacao,
} from './porta.js';

const SEM_EXECUTOR = 'A contratualização SUS não usa operação do executor: tudo é gravado só no novo.';

function gravador(e: Escritor, hospital: string): GravadorContratualizacao {
  return {
    relogio: () => relogioContratualizacao(e),
    contrato: (id) => contratoSus(e, hospital, id, { travar: true }),
    contratoPelaChave: (chave) => contratoSusPelaChave(e, hospital, chave),
    numeroEmUso: (numero, excetoId) => numeroContratoSusEmUso(e, hospital, numero, excetoId),
    metas: (contrato) => metasSus(e, hospital, contrato),
    meta: (id) => metaSus(e, hospital, id, { travar: true }),
    metaPelaChave: (chave) => metaSusPelaChave(e, hospital, chave),
    apuracao: (meta, competencia) => apuracaoSus(e, hospital, meta, competencia, { travar: true }),
    apuracaoPelaChave: (chave) => apuracaoSusPelaChave(e, hospital, chave),
    incluirContrato: (c) => incluirContratoSusSgh(e, { hospital, ...c }),
    alterarContrato: (c) => alterarContratoSusSgh(e, { hospital, ...c }),
    encerrarContrato: (c) => encerrarContratoSusSgh(e, { hospital, ...c }),
    incluirMeta: (m) => incluirMetaSusSgh(e, { hospital, ...m }),
    alterarMeta: (m) => alterarMetaSusSgh(e, { hospital, ...m }),
    registrarApuracao: (a) => registrarApuracaoSusSgh(e, { hospital, ...a }),
    corrigirApuracao: (a) => corrigirApuracaoSusSgh(e, { hospital, ...a }),
  };
}

type Ler = <T>(c: ContextoPortaM18, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(
  ler: Ler,
): Omit<PortaContratualizacao, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    relogio: (c) => ler(c, (l) => relogioContratualizacao(l)),
    dominios: (c) => ler(c, (l) => dominiosContratualizacao(l)),
    contratos: (c) => ler(c, (l) => contratosSus(l, c.hospital)),
    contrato: (c, id) => ler(c, (l) => contratoSus(l, c.hospital, id)),
    metas: (c, contrato) => ler(c, (l) => metasSus(l, c.hospital, contrato)),
    meta: (c, id) => ler(c, (l) => metaSus(l, c.hospital, id)),
    apuracoes: (c, metas) => ler(c, (l) => apuracoesSus(l, c.hospital, metas)),
    sigtapExiste: (c, prefixo) => ler(c, (l) => sigtapComPrefixo(l, prefixo)),
    buscarSigtap: (c, termo) =>
      ler(c, async (l) =>
        (await buscarSigtapSus(l, termo, null)).map((x) => ({ codigo: x.codigo, nome: x.nome })),
      ),
    producaoFaturamentoSus: (c, de, ate) => ler(c, (l) => producaoFaturamentoSus(l, c.hospital, de, ate)),
    producaoContasSus: (c, competencia, convenios) =>
      ler(c, (l) => producaoContasSus(l, competencia, convenios)),
  };
}

const semExecutor = {
  podeGravar: () => Promise.resolve({ pode: false, codigo: 'sem-operacao', motivo: SEM_EXECUTOR }),
  executar: (): Promise<never> => Promise.reject(new Error(SEM_EXECUTOR)),
};

export function portaContratualizacaoLegado(
  nucleo: NucleoLegado,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaContratualizacao {
  const ctx = (c: ContextoPortaM18) => ({ rede: c.rede, hospital: c.hospital, traceId: 'contratualizacao' });
  return {
    destino: 'legado',
    ...semExecutor,
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: nada é gravado.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const r = await fn(gravador(e, c.hospital));
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

/** A porta sobre uma transação aberta (testes de integração na cópia, desfeita no fim). */
export function portaContratualizacaoNaTransacao(e: Escritor): PortaContratualizacao {
  return {
    destino: 'legado',
    ...semExecutor,
    async gravarSgh(c, trilha, fn) {
      const r = await fn(gravador(e, c.hospital));
      await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e as unknown as Leitor)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaContratualizacaoIndisponivel(): PortaContratualizacao {
  return portaIndisponivel<PortaContratualizacao>(METODOS_PORTA_CONTRATUALIZACAO);
}
