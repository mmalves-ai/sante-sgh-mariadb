// Porta do SESMT sobre o núcleo do legado (M52.5): leituras numa transação curta READ ONLY no banco do estabelecimento
// da sessão; gravações SGH_PES_* numa transação SGH_ (`somenteSgh`: nenhuma tabela do outro sistema) com a SGH_TRILHA
// junto. Em dev sobre a cópia compartilhada, as gravações são recusadas com o motivo (`sghSoLeitura`): a prova da
// gravação é a integração, sob a trava da cópia e desfeita. `portaSesmtNaTransacao`: a mesma porta sobre UMA transação
// aberta (integração na cópia, desfeita). Nenhuma operação do executor: o SESMT não grava no outro sistema.
import {
  acidentePesSgh,
  anularAcidentePesSgh,
  assinarEntregaEpiPesSgh,
  cancelarEntregaEpiPesSgh,
  correcoesPesSgh,
  registrarCorrecaoPesSgh,
  retificarAcidentePesSgh,
  atualizarProfilaxiaPesSgh,
  buscarFatoresRisco,
  dominiosSesmt,
  emitirCatPesSgh,
  encerrarAcidentePesSgh,
  encerrarLinhaRiscoPesSgh,
  type Escritor,
  fatoresRiscoPorCodigo,
  gravarTrilha,
  incluirAcidentePesSgh,
  incluirAsoPesSgh,
  incluirExameOcupacionalPesSgh,
  incluirLinhaRiscoPesSgh,
  incluirRegistroEpiPesSgh,
  incluirSorologiaPesSgh,
  incluirVacinaPesSgh,
  type Leitor,
  listarAcidentesPesSgh,
  mapaRiscosPesSgh,
  type NucleoLegado,
  ocupacionalDoVinculoPesSgh,
  registrarSorologiaPesSgh,
  registroEpiPesSgh,
  registrosEpiDoVinculoPesSgh,
  relogioRecepcao,
  resumoSesmtPesSgh,
  somenteSgh,
  sorologiasPesSgh,
  vacinasDoVinculoPesSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import { portaIndisponivel } from '../../exames/public-api.js';
import {
  type ContextoSesmt,
  type GravadorSesmt,
  METODOS_PORTA_SESMT,
  type PortaSesmt,
} from './porta-sesmt.js';

type Ler = <T>(c: ContextoSesmt, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaSesmt, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    relogio: (c) =>
      ler(c, async (l) => {
        const r = await relogioRecepcao(l);
        return { hoje: r.hoje, agora: r.agora.slice(0, 16) };
      }),
    dominios: (c) => ler(c, (l) => dominiosSesmt(l)),
    fatoresRisco: (c, t) => ler(c, (l) => buscarFatoresRisco(l, t)),
    fatoresPorCodigo: (c, cs) =>
      cs.length === 0 ? Promise.resolve(new Map()) : ler(c, (l) => fatoresRiscoPorCodigo(l, cs)),
    ocupacional: (c, v) => ler(c, (l) => ocupacionalDoVinculoPesSgh(l, c.hospital, v)),
    vacinas: (c, v) => ler(c, (l) => vacinasDoVinculoPesSgh(l, c.hospital, v)),
    acidente: (c, id) => ler(c, (l) => acidentePesSgh(l, c.hospital, id)),
    listarAcidentes: (c, f) => ler(c, (l) => listarAcidentesPesSgh(l, c.hospital, f)),
    sorologias: (c, a) =>
      a.length === 0 ? Promise.resolve([]) : ler(c, (l) => sorologiasPesSgh(l, c.hospital, a)),
    mapaRiscos: (c, f) => ler(c, (l) => mapaRiscosPesSgh(l, c.hospital, f)),
    registrosEpi: (c, v) => ler(c, (l) => registrosEpiDoVinculoPesSgh(l, c.hospital, v)),
    registroEpi: (c, id) => ler(c, (l) => registroEpiPesSgh(l, c.hospital, id)),
    resumo: (c, ano) => ler(c, (l) => resumoSesmtPesSgh(l, c.hospital, ano)),
    correcoes: (c, t, ids) =>
      ids.length === 0 ? Promise.resolve([]) : ler(c, (l) => correcoesPesSgh(l, c.hospital, t, ids)),
  };
}

function gravador(e: Escritor, c: ContextoSesmt): GravadorSesmt {
  const h = c.hospital;
  return {
    ocupacional: (v) => ocupacionalDoVinculoPesSgh(e, h, v),
    vacinas: (v) => vacinasDoVinculoPesSgh(e, h, v),
    acidente: (id) => acidentePesSgh(e, h, id),
    sorologias: (a) => sorologiasPesSgh(e, h, [a]),
    registroEpi: (id) => registroEpiPesSgh(e, h, id),
    incluirAso: (a) => incluirAsoPesSgh(e, { hospital: h, ...a }),
    incluirExame: (x) => incluirExameOcupacionalPesSgh(e, { hospital: h, ...x }),
    incluirVacina: (v) => incluirVacinaPesSgh(e, { hospital: h, ...v }),
    incluirAcidente: (a) => incluirAcidentePesSgh(e, { hospital: h, ...a }),
    incluirSorologia: (x) => incluirSorologiaPesSgh(e, { hospital: h, ...x }),
    atualizarProfilaxia: (x) => atualizarProfilaxiaPesSgh(e, { hospital: h, ...x }),
    registrarSorologia: (x) => registrarSorologiaPesSgh(e, { hospital: h, ...x }),
    emitirCat: (x) => emitirCatPesSgh(e, { hospital: h, ...x }),
    encerrarAcidente: (x) => encerrarAcidentePesSgh(e, { hospital: h, ...x }),
    incluirLinhaRisco: (x) => incluirLinhaRiscoPesSgh(e, { hospital: h, ...x }),
    encerrarLinhaRisco: (x) => encerrarLinhaRiscoPesSgh(e, { hospital: h, ...x }),
    incluirRegistroEpi: (x) => incluirRegistroEpiPesSgh(e, { hospital: h, ...x }),
    assinarEntregaEpi: (x) => assinarEntregaEpiPesSgh(e, { hospital: h, ...x }),
    retificarAcidente: (x) => retificarAcidentePesSgh(e, { hospital: h, ...x }),
    anularAcidente: (x) => anularAcidentePesSgh(e, { hospital: h, ...x }),
    cancelarEntregaEpi: (x) => cancelarEntregaEpiPesSgh(e, { hospital: h, ...x }),
    registrarCorrecao: (x) => registrarCorrecaoPesSgh(e, { hospital: h, ...x }),
  };
}

const recusaSoLeitura = () =>
  Promise.reject(
    new ErroProblema(
      'recurso-desligado',
      403,
      'Gravação desligada neste ambiente',
      'Neste ambiente de desenvolvimento o banco é só de leitura: o SESMT não grava.',
      { codigo: 'somente-leitura' },
    ),
  );

const semExecutor = () =>
  Promise.reject(
    new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', 'O SESMT não usa o executor.'),
  );

export function portaSesmtLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente'> & Partial<Pick<NucleoLegado, 'gravarSgh'>>,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaSesmt {
  const ctx = (c: ContextoSesmt) => ({ rede: c.rede, hospital: c.hospital, traceId: 'sesmt' });
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
export function portaSesmtNaTransacao(e: Escritor): PortaSesmt {
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

export function portaSesmtIndisponivel(): PortaSesmt {
  return portaIndisponivel<PortaSesmt>(METODOS_PORTA_SESMT);
}
