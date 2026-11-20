// Porta das rubricas sobre o núcleo do legado (M53, etapa F1): leituras numa transação curta READ ONLY no banco do
// estabelecimento da sessão. Nenhuma gravação: o executor e a transação SGH_ recusam (a tela grava pelo CRUD genérico).
// `portaRubricasNaTransacao`: a mesma porta sobre UMA transação aberta (integração na cópia).
import {
  type Leitor,
  lerApoioRubricasFolha,
  lerRubricasFolha,
  lerTabelasLegaisFolha,
  lerDiasAfastamentoFolha,
  type NucleoLegado,
} from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import { portaIndisponivel } from '../../exames/public-api.js';
import { type ContextoRubricas, METODOS_PORTA_RUBRICAS, type PortaRubricas } from './porta-rubricas.js';

type Ler = <T>(c: ContextoRubricas, fn: (l: Leitor) => Promise<T>) => Promise<T>;

const semGravacao = () =>
  Promise.reject(
    new ErroProblema(
      'recusa-de-negocio',
      409,
      'Operação recusada',
      'As rubricas e as tabelas legais são gravadas pelo cadastro de cada uma.',
    ),
  );

function leituras(
  ler: Ler,
): Pick<PortaRubricas, 'rubricas' | 'tabelasLegais' | 'diasAfastamento' | 'dominios'> {
  return {
    rubricas: (c, empresa) => ler(c, (l) => lerRubricasFolha(l, empresa)),
    tabelasLegais: (c) => ler(c, (l) => lerTabelasLegaisFolha(l)),
    diasAfastamento: (c) => ler(c, (l) => lerDiasAfastamentoFolha(l)),
    dominios: (c) => ler(c, (l) => lerApoioRubricasFolha(l)),
  };
}

export function portaRubricasLegado(nucleo: Pick<NucleoLegado, 'lerSomente'>): PortaRubricas {
  const ctx = (c: ContextoRubricas) => ({ rede: c.rede, hospital: c.hospital, traceId: 'rubricas' });
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: semGravacao,
    gravarSgh: semGravacao,
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

/** A mesma porta sobre UMA transação aberta (integração na cópia). */
export function portaRubricasNaTransacao(l: Leitor): PortaRubricas {
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: semGravacao,
    gravarSgh: semGravacao,
    ...leituras((_c, fn) => fn(l)),
  };
}

export function portaRubricasIndisponivel(): PortaRubricas {
  return portaIndisponivel<PortaRubricas>(METODOS_PORTA_RUBRICAS);
}
