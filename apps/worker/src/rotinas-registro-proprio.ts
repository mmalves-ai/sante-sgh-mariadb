// Registro das rotinas agendadas do worker no banco do cliente (01-SIS L95, ficha F3.9), pelo @sgh/nucleo: cada volta
// de um serviço agendado (fechamento do censo, relay de eventos, envio agendado de relatórios, vigia do banco) passa
// por aqui. Regras no domínio (@sgh/dominio-integracao, rotinas-agendadas.ts); aqui só leitura e gravação.
// - sistema.rotina_volta_registrar, numa transação do Executor (trilha junto): cadastra a rotina pelo código quando
//   ainda não existe (idempotente; rotina do cliente inteiro), toma a execução pedida à mão na Administração
//   (aguardando → em execução → final) ou abre a execução agendada, grava as etapas (uma por estabelecimento ou
//   passo, com os volumes) e atualiza a rotina: situação depois da execução (a suspensa continua suspensa), última
//   e próxima execução. A volta sem trabalho só marca a rotina viva (destinoDaVolta), sem linha de histórico.
// - estado: suspensa, ativa e pedido manual pendente, lido antes da volta (a suspensa não roda).
// A mensagem de erro guardada é só o tipo do erro (nunca valores de pessoas).
import {
  conferirMudancaExecucao,
  type DefinicaoRotina,
  type DisparoExecucao,
  MENSAGEM_ROTINA,
  proximaExecucaoPorIntervalo,
  type SituacaoExecucao,
  type SituacaoRotina,
  situacaoDaRotinaApos,
} from '@sgh/dominio-integracao';
import { definirOperacao, type Executor, recusa, type TxOperacao } from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { NucleoWorker } from './servico-worker.js';

export interface EtapaVolta {
  readonly nome: string;
  readonly situacao: 'concluida' | 'concluida_com_avisos' | 'falhou' | 'ignorada';
  readonly inicioEm: Date;
  readonly fimEm: Date;
  readonly lidos: number;
  readonly gravados: number;
  readonly rejeitados: number;
  readonly mensagem?: string | null;
}

export interface VoltaRotina {
  readonly definicao: DefinicaoRotina;
  readonly situacao: SituacaoExecucao;
  readonly inicioEm: Date;
  readonly fimEm: Date;
  readonly lidos: number;
  readonly gravados: number;
  readonly rejeitados: number;
  readonly mensagemErro?: string | null;
  readonly etapas: readonly EtapaVolta[];
  /** Grava execução e etapas (falso: só a marca de vida da rotina). */
  readonly historico: boolean;
  readonly correlacao: string;
  readonly servidor?: string | null;
}

export type RotinaRegistrada = {
  readonly rotina: number;
  readonly execucao: number | null;
  readonly disparo: string | null;
  readonly situacaoRotina: string;
};

export interface EstadoRotina {
  readonly ativo: boolean;
  readonly situacao: SituacaoRotina;
  readonly manualPendente: boolean;
}

export interface PortaRotinas {
  estado(codigo: string): Promise<EstadoRotina | null>;
  registrar(v: VoltaRotina): Promise<RotinaRegistrada>;
}

const inteiro = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const ETAPA = z.object({
  nome: z.string().trim().min(1).max(100),
  situacao: z.enum(['concluida', 'concluida_com_avisos', 'falhou', 'ignorada']),
  inicioEm: z.date(),
  fimEm: z.date(),
  lidos: inteiro,
  gravados: inteiro,
  rejeitados: inteiro,
  mensagem: z.string().max(1000).nullable(),
});
const ENTRADA = z.object({
  codigo: z.string().regex(/^[a-z][a-z0-9_.-]{2,59}$/),
  nome: z.string().min(1).max(100),
  descricao: z.string().max(500),
  categoria: z.enum(['carga', 'envio', 'fechamento', 'integracao', 'manutencao', 'relatorio', 'outra']),
  intervaloSegundos: z.number().int().positive(),
  toleranciaAtrasoSegundos: z.number().int().min(0),
  permiteAcionamentoManual: z.boolean(),
  situacao: z.enum(['concluida', 'concluida_com_avisos', 'falhou', 'cancelada', 'expirada']),
  inicioEm: z.date(),
  fimEm: z.date(),
  lidos: inteiro,
  gravados: inteiro,
  rejeitados: inteiro,
  mensagemErro: z.string().max(1000).nullable(),
  etapas: z.array(ETAPA).max(500),
  historico: z.boolean(),
  correlacao: z.string().max(64),
  servidor: z.string().max(100).nullable(),
});
type Entrada = z.infer<typeof ENTRADA>;

const recusar = (r: keyof typeof MENSAGEM_ROTINA) => recusa(r, MENSAGEM_ROTINA[r]);

export class RegistroRotinasProprio implements PortaRotinas {
  private readonly executor: Executor;

  private readonly op = definirOperacao<Entrada, RotinaRegistrada>({
    nome: 'sistema.rotina_volta_registrar',
    tabelas: ['rotina_agendada', 'execucao_rotina', 'execucao_rotina_etapa'],
    entrada: ENTRADA,
    gravar: (tx, e) => this.gravar(tx, e),
    alvo: (_e, r) => ({ tabela: 'rotina_agendada', id: r.rotina }),
  });

  constructor(
    private readonly nucleo: NucleoWorker,
    readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  estado(codigo: string): Promise<EstadoRotina | null> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'rotina-estado' }, async (l) => {
      const r = await l.uma(
        'SELECT id, ativo, situacao FROM rotina_agendada WHERE estabelecimento_id IS NULL AND codigo = ? ORDER BY id LIMIT 1',
        [codigo],
      );
      if (!r) return null;
      const p = await l.uma(
        "SELECT COUNT(*) AS q FROM execucao_rotina WHERE rotina_agendada_id = ? AND situacao = 'aguardando'",
        [Number(r['id'])],
      );
      return {
        ativo: r['ativo'] === true || Number(r['ativo']) === 1,
        situacao: String(r['situacao']) as SituacaoRotina,
        manualPendente: Number(p?.['q'] ?? 0) > 0,
      };
    });
  }

  async registrar(v: VoltaRotina): Promise<RotinaRegistrada> {
    const d = v.definicao;
    const r = await this.executor.executar(
      this.op,
      this.cliente,
      {
        codigo: d.codigo,
        nome: d.nome,
        descricao: d.descricao,
        categoria: d.categoria,
        intervaloSegundos: d.intervaloSegundos,
        toleranciaAtrasoSegundos: d.toleranciaAtrasoSegundos,
        permiteAcionamentoManual: d.permiteAcionamentoManual,
        situacao: v.situacao,
        inicioEm: v.inicioEm,
        fimEm: v.fimEm,
        lidos: v.lidos,
        gravados: v.gravados,
        rejeitados: v.rejeitados,
        mensagemErro: v.mensagemErro?.slice(0, 1000) ?? null,
        etapas: v.etapas.map((x) => ({
          ...x,
          nome: x.nome.slice(0, 100),
          mensagem: x.mensagem?.slice(0, 1000) ?? null,
        })),
        historico: v.historico,
        correlacao: v.correlacao.slice(0, 64),
        servidor: v.servidor?.slice(0, 100) ?? null,
      },
      {
        cliente: this.cliente,
        estabelecimento: null,
        usuario: null,
        correlacao: v.correlacao.slice(0, 64),
        chaveIdempotencia: `worker.rotina.${randomUUID()}`,
      },
    );
    return r.resultado;
  }

  private async gravar(tx: TxOperacao, e: Entrada): Promise<RotinaRegistrada> {
    // 1) A rotina pelo código (travada: duas voltas não cadastram duas vezes nem cruzam a situação).
    let rot = (
      await tx.consultarParaAtualizar(
        'SELECT id, versao, situacao FROM rotina_agendada WHERE estabelecimento_id IS NULL AND codigo = ? ORDER BY id LIMIT 1',
        [e.codigo],
        { teto: 1 },
      )
    )[0];
    if (!rot) {
      const id = await tx.incluir('rotina_agendada', {
        estabelecimento_id: null,
        codigo: e.codigo,
        nome: e.nome,
        descricao: e.descricao,
        categoria: e.categoria,
        tipo_agenda: 'intervalo',
        intervalo_segundos: e.intervaloSegundos,
        tolerancia_atraso_segundos: e.toleranciaAtrasoSegundos,
        permite_acionamento_manual: e.permiteAcionamentoManual,
        situacao: 'ociosa',
        ativo: true,
      });
      rot = { id, versao: 1, situacao: 'ociosa' };
    }
    const rotina = Number(rot['id']);
    // 2) O pedido manual pendente mais antigo é tomado por esta volta; sem ele, a execução é a agendada.
    const pedido = (
      await tx.consultarParaAtualizar(
        "SELECT id, versao, disparo FROM execucao_rotina WHERE rotina_agendada_id = ? AND situacao = 'aguardando' ORDER BY id LIMIT 1",
        [rotina],
        { teto: 1 },
      )
    )[0];
    const volumes = { lidos: e.lidos, gravados: e.gravados, rejeitados: e.rejeitados };
    const final = {
      de: 'em_execucao' as const,
      para: e.situacao,
      mensagemErro: e.mensagemErro,
      volumes,
      inicioEm: e.inicioEm,
      fimEm: e.fimEm,
    };
    let execucao: number | null = null;
    let disparo: DisparoExecucao | null = null;
    const colunasFinais = {
      inicio_em: e.inicioEm,
      fim_em: e.fimEm,
      situacao: e.situacao,
      registros_lidos: e.lidos,
      registros_gravados: e.gravados,
      registros_rejeitados: e.rejeitados,
      mensagem_erro: e.mensagemErro,
      servidor: e.servidor,
      correlacao: e.correlacao,
    };
    if (pedido) {
      const r1 = conferirMudancaExecucao({ de: 'aguardando', para: 'em_execucao' });
      const r2 = conferirMudancaExecucao(final);
      if (r1 || r2) throw recusar((r1 ?? r2)!);
      execucao = Number(pedido['id']);
      disparo = String(pedido['disparo']) as DisparoExecucao;
      await tx.alterar('execucao_rotina', execucao, Number(pedido['versao']), colunasFinais);
    } else if (e.historico) {
      const r2 = conferirMudancaExecucao(final);
      if (r2) throw recusar(r2);
      disparo = 'agendado';
      execucao = await tx.incluir('execucao_rotina', {
        rotina_agendada_id: rotina,
        ocorrido_em: e.inicioEm,
        usuario_id: null,
        disparo,
        tentativa: 1,
        ...colunasFinais,
      });
    }
    // 3) As etapas da execução (só com histórico).
    if (execucao !== null) {
      let seq = 0;
      for (const x of e.etapas) {
        seq += 1;
        await tx.incluir('execucao_rotina_etapa', {
          execucao_rotina_id: execucao,
          sequencia: seq,
          nome: x.nome,
          situacao: x.situacao,
          inicio_em: x.inicioEm,
          fim_em: x.fimEm < x.inicioEm ? x.inicioEm : x.fimEm,
          registros_lidos: x.lidos,
          registros_gravados: x.gravados,
          registros_rejeitados: x.rejeitados,
          mensagem: x.situacao === 'falhou' ? (x.mensagem ?? 'falhou') : x.mensagem,
        });
      }
    }
    // 4) A rotina depois da volta: situação pela regra, última e próxima execução.
    const situacaoRotina = situacaoDaRotinaApos(String(rot['situacao']) as SituacaoRotina, e.situacao);
    await tx.alterar('rotina_agendada', rotina, Number(rot['versao']), {
      situacao: situacaoRotina,
      ultima_execucao_em: e.fimEm,
      proxima_execucao_em: proximaExecucaoPorIntervalo(e.fimEm, e.intervaloSegundos),
    });
    return { rotina, execucao, disparo, situacaoRotina };
  }
}
