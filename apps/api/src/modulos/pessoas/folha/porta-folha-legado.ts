// Porta da interface com a folha externa sobre o núcleo do legado (M53.1): leituras numa transação curta READ ONLY no
// banco do estabelecimento da sessão; gravações SGH_PES_* numa transação SGH_ (`somenteSgh`: nenhuma tabela do outro
// sistema) com a SGH_TRILHA junto. Em dev sobre a cópia compartilhada, as gravações são recusadas com o motivo
// (`sghSoLeitura`): a prova da gravação é a integração, sob a trava da cópia e desfeita. `portaFolhaNaTransacao`: a
// mesma porta sobre UMA transação aberta (integração na cópia, desfeita). Nenhuma operação do executor.
import {
  afastamentoPesSgh,
  afastamentosPesSgh,
  cancelarAfastamentoPesSgh,
  competenciaFolhaLancadaPesSgh,
  conselhosDosProfissionaisPesSgh,
  empresasFolha,
  encerrarAfastamentoPesSgh,
  type Escritor,
  gravarTrilha,
  incluirAfastamentoPesSgh,
  incluirLoteFolhaPesSgh,
  incluirResumoFolhaPesSgh,
  type Leitor,
  loteFolhaPesSgh,
  lotesFolhaPesSgh,
  motivosAfastamento,
  type NucleoLegado,
  proximoIdLoteFolhaPesSgh,
  relogioRecepcao,
  remessasDaFolha,
  resumoFolhaPesSgh,
  situacaoLoteFolhaPesSgh,
  somenteSgh,
  tiposFolha,
  tiposIntegracaoPonto,
  vinculosDaFolhaPesSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import { portaIndisponivel } from '../../exames/public-api.js';
import {
  type ContextoFolha,
  type GravadorFolha,
  instanteComSegundos,
  METODOS_PORTA_FOLHA,
  type PortaFolha,
} from './porta-folha.js';

type Ler = <T>(c: ContextoFolha, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaFolha, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    relogio: (c) =>
      ler(c, async (l) => {
        const r = await relogioRecepcao(l);
        return { hoje: r.hoje, agora: instanteComSegundos(r.agora) };
      }),
    empresas: (c) => ler(c, (l) => empresasFolha(l)),
    eventosPonto: (c) => ler(c, (l) => tiposIntegracaoPonto(l)),
    motivosAfastamento: (c) => ler(c, (l) => motivosAfastamento(l)),
    tiposFolha: (c) => ler(c, (l) => tiposFolha(l)),
    remessas: (c, empresa) => ler(c, (l) => remessasDaFolha(l, empresa)),
    lotes: (c, f) => ler(c, (l) => lotesFolhaPesSgh(l, c.hospital, f)),
    lote: (c, id) => ler(c, (l) => loteFolhaPesSgh(l, c.hospital, id)),
    competenciaLancada: (c, e, comp) => ler(c, (l) => competenciaFolhaLancadaPesSgh(l, c.hospital, e, comp)),
    vinculosDaFolha: (c, i, f) => ler(c, (l) => vinculosDaFolhaPesSgh(l, c.hospital, i, f)),
    conselhos: (c, ps) =>
      ps.length === 0
        ? Promise.resolve(new Map())
        : ler(c, (l) => conselhosDosProfissionaisPesSgh(l, c.hospital, ps)),
    afastamentos: (c, f) => ler(c, (l) => afastamentosPesSgh(l, c.hospital, f)),
    afastamento: (c, id) => ler(c, (l) => afastamentoPesSgh(l, c.hospital, id)),
  };
}

function gravador(e: Escritor, c: ContextoFolha): GravadorFolha {
  const h = c.hospital;
  return {
    proximoIdLote: () => proximoIdLoteFolhaPesSgh(e),
    lote: (id) => loteFolhaPesSgh(e, h, id),
    lotesDaCompetencia: (empresa, competencia) => lotesFolhaPesSgh(e, h, { empresa, competencia }),
    competenciaLancada: (empresa, competencia) => competenciaFolhaLancadaPesSgh(e, h, empresa, competencia),
    incluirLote: (x) => incluirLoteFolhaPesSgh(e, { hospital: h, ...x }),
    situacaoLote: (x) => situacaoLoteFolhaPesSgh(e, { hospital: h, ...x }),
    incluirResumo: (x) => incluirResumoFolhaPesSgh(e, { hospital: h, ...x }),
    resumo: (id) => resumoFolhaPesSgh(e, h, id),
    afastamento: (id) => afastamentoPesSgh(e, h, id),
    afastamentos: (f) => afastamentosPesSgh(e, h, f),
    incluirAfastamento: (x) => incluirAfastamentoPesSgh(e, { hospital: h, ...x }),
    encerrarAfastamento: (x) => encerrarAfastamentoPesSgh(e, { hospital: h, ...x }),
    cancelarAfastamento: (x) => cancelarAfastamentoPesSgh(e, { hospital: h, ...x }),
  };
}

const recusaSoLeitura = () =>
  Promise.reject(
    new ErroProblema(
      'recurso-desligado',
      403,
      'Gravação desligada neste ambiente',
      'Neste ambiente de desenvolvimento o banco é só de leitura: a interface com a folha não grava.',
      { codigo: 'somente-leitura' },
    ),
  );

const semExecutor = () =>
  Promise.reject(
    new ErroProblema(
      'recusa-de-negocio',
      409,
      'Operação recusada',
      'A interface com a folha não usa o executor.',
    ),
  );

export function portaFolhaLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente'> & Partial<Pick<NucleoLegado, 'gravarSgh'>>,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaFolha {
  const ctx = (c: ContextoFolha) => ({ rede: c.rede, hospital: c.hospital, traceId: 'folha' });
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
export function portaFolhaNaTransacao(e: Escritor): PortaFolha {
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

export function portaFolhaIndisponivel(): PortaFolha {
  return portaIndisponivel<PortaFolha>(METODOS_PORTA_FOLHA);
}
