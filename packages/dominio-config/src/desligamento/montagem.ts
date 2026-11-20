// Montagem do estado dos passos do M58 por hospital (ficha, seções 8, 12 e 14): junta o que a F1 mede (sessões,
// inventário, funções externas) com o que fica registrado por PR no registro versionado do hospital (autorização,
// ensaio e execução de cada passo, resolução das funções, aviso aos parceiros, contratos da API da Hal-AI) e com o
// registro do fim do M43 (fim registrado e DP-6). Pura; falha fechada: o que não está registrado não conta.
import {
  JANELA_SEM_SESSAO_DIAS,
  PASSOS_DESLIGAMENTO,
  type RegistroDesligamento,
  type ResolucaoFuncaoExterna,
  type SessoesOutroSistema,
} from '@sgh/contratos';
import type { EstadoDesligamento, EstadoPasso } from './passos.js';

/** A resolução de cada função externa como está no registro (a que não está lá fica pendente). */
export function resolucoesDoRegistro(r: RegistroDesligamento): Record<string, ResolucaoFuncaoExterna> {
  return Object.fromEntries(r.funcoes.map((f) => [f.nome, f.resolucao]));
}

export interface MedidaDiariaSessoes {
  /** Dias seguidos limpos até hoje, pela medida diária do M43 (retratos e série das conexões). */
  readonly dias: number;
}

/**
 * Regra 3 inteira (D-SESS2-58): a tabela de conexões sem pessoa na janela E a medida diária com `exigidos` dias
 * limpos seguidos. A tabela sozinha não basta: ela só guarda a última conexão, e um relógio parado do outro lado (ou
 * uma cópia congelada) a deixaria "sem uso" sem ninguém ter medido.
 */
export function sessoesCumpridas(
  tabela: SessoesOutroSistema,
  medida: MedidaDiariaSessoes,
  exigidos = JANELA_SEM_SESSAO_DIAS,
): boolean {
  return tabela.cumprido && medida.dias >= exigidos;
}

export interface FatosDesligamento {
  readonly fimRegistrado: boolean;
  readonly dp6Decidida: boolean;
  readonly sessoesCumprido: boolean;
  readonly inventarioResolvido: boolean;
  readonly funcoesPendentes: readonly string[];
}

/** O estado que `avaliarPassos` recebe, a partir dos fatos medidos e do registro versionado. */
export function estadoDesligamento(r: RegistroDesligamento, f: FatosDesligamento): EstadoDesligamento {
  const passos = Object.fromEntries(
    PASSOS_DESLIGAMENTO.map((p): [string, EstadoPasso] => {
      const x = r.passos[p];
      return [
        p,
        {
          autorizado: x.autorizacao !== null,
          ensaioAprovado: x.ensaio?.resultado === 'aprovado',
          executado: x.execucao !== null,
        },
      ];
    }),
  ) as unknown as EstadoDesligamento['passos'];
  return {
    fimDaCoexistencia: f.fimRegistrado,
    dp6Decidida: f.dp6Decidida,
    sessoesCumprido: f.sessoesCumprido,
    inventarioResolvido: f.inventarioResolvido,
    funcoesPendentes: [...f.funcoesPendentes],
    parceirosAvisados: r.parceirosAvisados !== null,
    contratosHalAi: r.contratosHalAi !== null,
    passos,
  };
}
