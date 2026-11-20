// A porta da notificação compulsória sobre o núcleo do legado (a cópia; M48, etapa 4): leituras numa transação só de
// leitura; gravações só SGH_ (somenteSgh recusa tabela do legado) com a SGH_TRILHA na mesma transação.
import * as L from '@sgh/legado';
import { type Escritor, gravarTrilha, type Leitor, type NucleoLegado, somenteSgh } from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoAgravo,
  type GravadorAgravo,
  METODOS_PORTA_AGRAVO,
  type PortaAgravo,
} from './porta-agravo.js';

type Leituras = Omit<PortaAgravo, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'>;

function gravador(e: Escritor, h: string): GravadorAgravo {
  return {
    abrirCaso: (x) => L.abrirCasoAgravoSgh(e, { hospital: h, ...x }),
    registrarNotificacao: (x) => L.registrarNotificacaoAgravoSgh(e, { hospital: h, ...x }),
    descartarCaso: (x) => L.descartarCasoAgravoSgh(e, { hospital: h, ...x }),
    configurarGatilhoExame: (x) => L.configurarGatilhoExameSgh(e, { hospital: h, ...x }),
  };
}

function leituras(ler: <T>(c: ContextoAgravo, fn: (l: Leitor) => Promise<T>) => Promise<T>): Leituras {
  return {
    relogio: async (c) => (await ler(c, (l) => L.relogioRecepcao(l))).agora.slice(0, 19),
    cidsNotificaveis: (c) => ler(c, (l) => L.cidsNotificaveis(l)),
    cidDoCadastro: (c, cid) => ler(c, (l) => L.cidDoCadastro(l, cid)),
    atendimentosComCid: (c, desde) => ler(c, (l) => L.atendimentosComCidNotificavel(l, desde)),
    obitos: (c, desde) => ler(c, (l) => L.obitosDesde(l, c.hospital, desde)),
    resultados: (c, desde, padroes, termos) =>
      ler(c, (l) => L.resultadosCandidatos(l, desde, padroes, termos)),
    atendimento: (c, id) => ler(c, (l) => L.atendimentoParaAgravo(l, id)),
    declaracaoObito: (c, atd) => ler(c, (l) => L.declaracaoObitoDoAtendimento(l, c.hospital, atd)),
    exame: (c, id) => ler(c, (l) => L.exameParaAgravo(l, id)),
    pacientes: (c, ids) => ler(c, (l) => L.pacientesParaAgravo(l, ids)),
    unidades: (c) => ler(c, (l) => L.unidadesParaAgravo(l)),
    modelosFicha: (c) => ler(c, (l) => L.modelosFichaAgravo(l)),
    perguntasFicha: (c, m) => ler(c, (l) => L.perguntasDaFichaAgravo(l, m)),
    caso: (c, id) => ler(c, (l) => L.casoAgravoSgh(l, c.hospital, id)),
    casos: (c, f) => ler(c, (l) => L.casosAgravoSgh(l, c.hospital, f)),
    casosDesde: (c, desde) => ler(c, (l) => L.casosDesdeSgh(l, c.hospital, desde)),
    contagem: (c, agora, mes) => ler(c, (l) => L.contagemAgravosSgh(l, c.hospital, agora, mes)),
    gatilhosExame: (c) => ler(c, (l) => L.gatilhosExameSgh(l, c.hospital)),
  };
}

export function portaAgravoLegado(
  nucleo: NucleoLegado,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaAgravo {
  const ctx = (c: ContextoAgravo) => ({ rede: c.rede, hospital: c.hospital, traceId: 'agravo' });
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: (_c, op) => Promise.reject(new Error(`Operação ${op} sem receita do executor: só SGH_.`)),
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

/**
 * A mesma porta sobre UMA transação já aberta (a integração na cópia, desfeita no fim): leituras e gravações SGH_ na
 * mesma transação, com a trilha junto; `hospital` troca o estabelecimento da sessão sintética pelo da cópia.
 */
export function portaAgravoNaTransacao(e: Escritor, hospital: string): PortaAgravo {
  const naCopia = (c: ContextoAgravo): ContextoAgravo => ({ ...c, hospital });
  const base = leituras((_c, fn) => fn(e));
  const l = Object.fromEntries(
    Object.entries(base).map(([k, f]) => [
      k,
      (c: ContextoAgravo, ...r: unknown[]) => (f as (...a: unknown[]) => unknown)(naCopia(c), ...r),
    ]),
  ) as Leituras;
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: (_c, op) => Promise.reject(new Error(`Operação ${op} sem receita do executor: só SGH_.`)),
    async gravarSgh(_c, trilha, fn) {
      const s = somenteSgh(e);
      const r = await fn(gravador(s, hospital));
      const linha = typeof trilha === 'function' ? trilha(r) : trilha;
      await gravarTrilha(s, { ...linha, hospital });
      return r;
    },
    ...l,
  };
}

export function portaAgravoIndisponivel(): PortaAgravo {
  return portaIndisponivel<PortaAgravo>(METODOS_PORTA_AGRAVO);
}
