// Fonte do CRUD genérico na API (M08): onde as leituras e as gravações acontecem.
//   - `legado`: o núcleo do legado (READ ONLY nas leituras; gravação pelo EXECUTOR do M04, com a receita
//     genérica, a trilha na mesma transação e o catálogo de operações em tempo de execução);
//   - `memoria`: a sessão sintética (AMBIENTE dev ou ci; E2E): o MESMO executor e a mesma receita sobre um
//     banco sintético em memória (@sgh/legado, BancoMemoriaDominios). Nada vai à cópia.
//   - `indisponivel`: fora de dev/ci SEM o núcleo (configuração incompleta): toda chamada responde 503; nunca
//     cai em silêncio para a memória.
// A escolha (app.module.ts): núcleo real fora de dev/ci; em dev/ci, sempre a memória (a sessão de dev/ci é
// sintética: gravar na cópia com ela gravaria com COMMIT em nome de um usuário que não existe). A validação
// humana na cópia roda com AMBIENTE=homolog ou treino e o login real.
import { resolve } from 'node:path';
import type { EstadoOperacao } from '@sgh/contratos';
import { ErroProblema } from '../../problema.filter.js';
import {
  BancoMemoriaDominios,
  carregarDominiosVistos,
  DECLARACOES,
  type Escritor,
  type Executor,
  type FonteCatalogo,
  type Leitor,
  type Linha,
  linhasSinteticas,
  type MetricasExecutor,
  type NucleoLegado,
} from '@sgh/legado';

export const FONTE_DOMINIOS = Symbol('FONTE_DOMINIOS');

/** Fora de dev/ci sem o núcleo: falha fechada, 503 em toda leitura e gravação. */
export class ErroFonteIndisponivel extends ErroProblema {
  constructor() {
    super(
      'indisponivel',
      503,
      'Banco do estabelecimento indisponível',
      'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
    );
  }
}

export interface FonteDominios {
  readonly destino: 'legado' | 'memoria';
  ler<T>(rede: string, hospital: string, fn: (l: Leitor) => Promise<T>): Promise<T>;
  /** M14: transação confirmada só sobre tabelas SGH_ (inativação só no novo). */
  gravarSgh<T>(rede: string, hospital: string, fn: (e: Escritor) => Promise<T>): Promise<T>;
  readonly executor: Executor;
  estado(operacao: string, hospital: string): EstadoOperacao | null;
  /** Legenda de baixa confiança (DP-46) da coluna: "a confirmar". */
  aConfirmar(tabela: string, coluna: string): boolean;
}

function baixaConfianca(): (tabela: string, coluna: string) => boolean {
  try {
    const v = carregarDominiosVistos(resolve(process.cwd(), 'packages/legado/src'));
    return (t, c) => v.aConfirmar(t, c);
  } catch {
    return () => false;
  }
}

export function fonteDominiosLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
): FonteDominios {
  const executor = nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const aConfirmar = baixaConfianca();
  return {
    destino: 'legado',
    ler: (rede, hospital, fn) => nucleo.lerSomente({ rede, hospital, traceId: 'crud-generico' }, fn),
    gravarSgh: (rede, hospital, fn) => nucleo.gravarSgh({ rede, hospital, traceId: 'crud-generico' }, fn),
    executor,
    estado: (op, h) => catalogo.estado(op, h),
    aConfirmar,
  };
}

export function fonteDominiosIndisponivel(): FonteDominios {
  const recusar = async (): Promise<never> => {
    throw new ErroFonteIndisponivel();
  };
  return {
    destino: 'legado',
    ler: recusar,
    gravarSgh: recusar,
    executor: { executar: recusar } as unknown as Executor,
    estado: () => null,
    aConfirmar: () => false,
  };
}

/** Tabelas de opções das referências que não são domínio declarado (sintéticas). */
const OPCOES_SINTETICAS = {
  TBTPDIETA: {
    chave: 'ID',
    linhas: [
      { ID: 1, NOME: 'Dieta sintética 1' },
      { ID: 2, NOME: 'Dieta sintética 2' },
    ],
  },
  PRTPLAN: {
    chave: 'ID',
    linhas: [
      { ID: 1, NOME: 'Plano sintético 1' },
      { ID: 2, NOME: 'Plano sintético 2' },
    ],
  },
  // M24 (P-CAD-1): o item de estoque, a unidade, a via e o bloco que os cadastros de prescrição oferecem.
  GEITENS: {
    chave: 'COD',
    linhas: [
      { COD: 1, NOME: 'ITEM SINTETICO 1' },
      { COD: 2, NOME: 'ITEM SINTETICO 2' },
      { COD: 501, NOME: 'DIPIRONA SINTETICA' },
    ],
  },
  TBUNICON: {
    chave: 'COD',
    linhas: [
      { COD: 'ML', NOME: 'Mililitro' },
      { COD: 'UN', NOME: 'Unidade' },
    ],
  },
  GETABVIA: {
    chave: 'COD',
    linhas: [
      { COD: 'EV', NOME: 'Endovenosa' },
      { COD: 'VO', NOME: 'Oral' },
    ],
  },
  RIBLOCOS: {
    chave: 'BLOCO',
    linhas: [
      { BLOCO: 'INT-1', NOME: 'Internação sintética 1' },
      { BLOCO: 'UTI-1', NOME: 'Terapia intensiva sintética' },
    ],
  },
};

/**
 * W1-04 (revisão): as configurações de painel sintéticas são do tipo 2 (atendimento, o tipo travado do cadastro); para
 * a inclusão do painel de TV de setor (só sob o portal, tipo 3) funcionar no banco em memória, uma configuração de
 * portal (ID 4) com o cabeçalho que o executável grava, como a ID 1 da rede real.
 */
function configuracoesDePainel(): { chave: string; linhas: Linha[] } {
  const d = DECLARACOES.find((x) => x.tabela === 'PNCONFIG');
  const linhas = d ? linhasSinteticas(d) : [];
  return {
    chave: 'ID',
    linhas: [
      ...linhas,
      {
        ...(linhas[0] ?? {}),
        ID: 4,
        ID_PNTIPO: 3,
        ID_TBLOCAL: null,
        CONFIGURACAO: '<PainelPortal_cabecalho Codigo="PORTAL-SINTETICO" Nome="Portal sintetico" />',
      },
    ],
  };
}

export function fonteDominiosMemoria(catalogo: FonteCatalogo, ambiente: string): FonteDominios {
  const banco = new BancoMemoriaDominios(DECLARACOES, {
    ...OPCOES_SINTETICAS,
    PNCONFIG: configuracoesDePainel(),
  });
  const aConfirmar = baixaConfianca();
  return {
    destino: 'memoria',
    ler: (_rede, hospital, fn) => banco.ler(hospital, fn),
    gravarSgh: (_rede, hospital, fn) => banco.escrever(hospital, fn, true),
    executor: banco.criarExecutor(catalogo, ambiente),
    estado: (op, h) => catalogo.estado(op, h),
    aConfirmar,
  };
}

export { linhasSinteticas };
