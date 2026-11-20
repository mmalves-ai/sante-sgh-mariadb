// Porta da onda 0 (ficha do M38): se o executor aceitaria uma gravação para quem pergunta (a faixa "só consulta nesta
// etapa" das telas), a leitura de SGH_CFG_COEX_VIGIA (aba Vigilância diária da tela de testes de assinatura) e a
// saúde do banco de um estabelecimento (sonda da implantação). Com o núcleo real, o executor e o banco; na memória
// (dev/ci sintético), o catálogo e uma vigilância sintética (dois dias: um limpo e um com divergência), sem banco.
import type { EstadoOperacao, ExecucaoVigia } from '@sgh/contratos';
import {
  type Executor,
  type FonteCatalogo,
  lerResultadosVigia,
  type NucleoLegado,
  operacao,
  OPERACOES,
  relogioDoBanco,
} from '@sgh/legado';

export interface PortaOnda0 {
  readonly destino: 'legado' | 'memoria';
  /** Estabelecimentos configurados (ESTABELECIMENTOS). */
  readonly estabelecimentos: readonly string[];
  /** O executor aceitaria a gravação (catálogo, chave da operação e schema) para quem pergunta? */
  podeEscrever(rede: string, hospital: string, login: string, op: string): Promise<boolean>;
  vigia(hospital: string, de: string, ate: string): Promise<ExecucaoVigia[]>;
  /** O banco do estabelecimento responde a uma leitura curta (sonda `saude`). */
  bancoResponde(rede: string, hospital: string): Promise<boolean>;
}

export const PORTA_ONDA0 = Symbol('PORTA_ONDA0');

export function portaOnda0Legado(
  nucleo: NucleoLegado,
  executor: Executor,
  estabelecimentos: readonly string[],
): PortaOnda0 {
  return {
    destino: 'legado',
    estabelecimentos,
    async podeEscrever(rede, hospital, login, op) {
      if (!OPERACOES[op]) return false;
      const r = await executor.liberacao(operacao(op), { rede, hospital, usuarioLegado: login });
      return r.pode;
    },
    vigia: (hospital, de, ate) =>
      nucleo.lerSomente({ rede: nucleo.rede, hospital, traceId: 'onda0-vigia' }, (l) =>
        lerResultadosVigia(l, hospital, de, ate),
      ),
    async bancoResponde(rede, hospital) {
      try {
        await nucleo.lerSomente({ rede, hospital, traceId: 'sonda-saude' }, (l) => relogioDoBanco(l));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Vigilância sintética do dev/ci: ontem limpo e anteontem com uma divergência (só estrutura). */
export function vigiaSintetica(hospital: string, hoje: Date = new Date()): ExecucaoVigia[] {
  const dia = (n: number) => new Date(hoje.getTime() - n * 86_400_000).toISOString().slice(0, 10);
  const executado = (n: number) => `${dia(n - 1)}T06:00:00.000Z`;
  return [
    {
      resultado: {
        hospital,
        data: dia(1),
        operacao: 'auditoria.registrarEventoLegado',
        amostradas: 50,
        divergentes: 0,
        elementos: [],
      },
      executadoEm: executado(1),
    },
    {
      resultado: {
        hospital,
        data: dia(2),
        operacao: 'auditoria.registrarEventoLegado',
        amostradas: 50,
        divergentes: 1,
        elementos: [
          {
            tipo: 'classe',
            tabela: 'TBCABTRILHA',
            coluna: 'FUSO_HORARIO_LOCAL',
            classe: 'constante',
            ocorrencias: 1,
          },
        ],
      },
      executadoEm: executado(2),
    },
  ];
}

export function portaOnda0Memoria(catalogo: FonteCatalogo | null, hospitais: readonly string[]): PortaOnda0 {
  const estado = (op: string, h: string): EstadoOperacao | null => catalogo?.estado(op, h) ?? 'verde';
  return {
    destino: 'memoria',
    estabelecimentos: hospitais,
    async podeEscrever(_rede, hospital, _login, op) {
      const e = estado(op, hospital);
      if (e === null || e === 'bloqueada' || !OPERACOES[op]) return false;
      return !operacao(op).receita.pendente;
    },
    async vigia(hospital, de, ate) {
      if (!hospitais.includes(hospital)) return [];
      return vigiaSintetica(hospital).filter((x) => x.resultado.data >= de && x.resultado.data <= ate);
    },
    async bancoResponde() {
      return true;
    },
  };
}
