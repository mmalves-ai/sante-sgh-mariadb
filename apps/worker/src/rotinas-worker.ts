// Rotinas agendadas do worker vistas na Administração (01-SIS L95, ficha F3.9): o registrador que envolve cada volta
// de um serviço agendado por cliente. Antes da volta lê o estado da rotina (suspensa ou inativa: não roda; pedido
// manual pendente: a volta é a do pedido e recebe o disparo 'manual', que muda o trabalho feito: no censo, a janela de
// recuperação dos dias sem retrato passa de 7 para 31 dias); depois grava pela porta própria (rotinas-registro-proprio.ts) a execução,
// as etapas e a situação da rotina, pela regra do domínio (destinoDaVolta: volta vazia só marca a rotina viva). O
// registro nunca derruba o serviço: a falha de gravar o histórico vai ao log (só códigos) e a volta segue.
import {
  type DefinicaoRotina,
  type DisparoExecucao,
  destinoDaVolta,
  situacaoFinalSemErro,
} from '@sgh/dominio-integracao';
import { clientesDoWorker, type NucleoClientes } from './clientes-worker.js';
import { logger } from './logger.js';
import type { EtapaVolta, PortaRotinas } from './rotinas-registro-proprio.js';
import type { AlvoEstabelecimento, Volta } from './servico-worker.js';

/** As rotinas do worker, pelo código (o cadastro no banco do cliente é criado na primeira volta). */
export const ROTINAS_WORKER = {
  censo: {
    codigo: 'internacao.censo.fechamento',
    nome: 'Fechamento do censo diário',
    descricao:
      'Retrato do censo de cada unidade de internação no fechamento do dia, por estabelecimento. Acionada à mão, ' +
      'recupera os dias sem retrato dos últimos 31 dias (a volta agendada confere 7).',
    categoria: 'fechamento',
    intervaloSegundos: 60,
    toleranciaAtrasoSegundos: 1800,
    permiteAcionamentoManual: true,
  },
  relay: {
    codigo: 'integracao.eventos.relay',
    nome: 'Envio dos eventos às integrações',
    descricao: 'Publica os eventos gravados pelo sistema para as integrações e o financeiro.',
    categoria: 'integracao',
    intervaloSegundos: 1,
    toleranciaAtrasoSegundos: 1800,
    // Roda a cada segundo: um pedido à mão não anteciparia nada.
    permiteAcionamentoManual: false,
  },
  envioRelatorios: {
    codigo: 'relatorio.envio.agendado',
    nome: 'Envio agendado de relatórios',
    descricao: 'Gera e envia por e-mail os relatórios com agenda vencida.',
    categoria: 'relatorio',
    intervaloSegundos: 60,
    toleranciaAtrasoSegundos: 1800,
    // A volta já envia todo relatório vencido; enviar antes da agenda é o "enviar agora" do próprio relatório.
    permiteAcionamentoManual: false,
  },
  vigiaBanco: {
    codigo: 'manutencao.vigia.banco',
    nome: 'Vigia do banco de dados',
    descricao: 'Confere a saúde do banco, as transações longas e os serviços; registra os alertas.',
    categoria: 'manutencao',
    intervaloSegundos: 60,
    toleranciaAtrasoSegundos: 1800,
    permiteAcionamentoManual: false,
    // Vigia da plataforma inteira (métricas e alertas de todos os clientes): não para pela suspensão de um cliente.
    permiteSuspensao: false,
  },
} as const satisfies Record<string, DefinicaoRotina>;

/** O que a volta mediu: os volumes e as etapas (uma por estabelecimento ou passo). */
export interface MedidaVolta<R> {
  readonly resultado: R;
  readonly lidos?: number;
  readonly gravados?: number;
  readonly rejeitados?: number;
  readonly avisos?: number;
  readonly etapas?: readonly EtapaVolta[];
}

/** O tipo do erro, sem a mensagem (que pode trazer valores). */
export const tipoDoErro = (e: unknown): string =>
  (e instanceof Error
    ? `${e.name}${(e as { code?: unknown }).code ? ` ${String((e as { code?: unknown }).code)}` : ''}`
    : 'erro'
  ).slice(0, 200);

export class RegistradorRotinas {
  /** Última marca de vida por cliente e rotina (a volta vazia só marca de tempos em tempos). */
  private readonly marcas = new Map<string, Date>();
  private readonly portas = new Map<string, PortaRotinas>();

  constructor(
    private readonly fabrica: (cliente: string) => PortaRotinas,
    private readonly agora: () => Date = () => new Date(),
    private readonly servidor: string | null = process.env['HOSTNAME']?.slice(0, 100) ?? null,
  ) {}

  private porta(cliente: string): PortaRotinas {
    let p = this.portas.get(cliente);
    if (!p) {
      p = this.fabrica(cliente);
      this.portas.set(cliente, p);
    }
    return p;
  }

  /**
   * Roda a volta de uma rotina num cliente e registra. Devolve `null` sem rodar quando a rotina está suspensa ou
   * inativa. A falha da volta é registrada e repassada a quem chamou.
   */
  async rodar<R>(
    cliente: string,
    def: DefinicaoRotina,
    correlacao: string,
    fn: (disparo: DisparoExecucao) => Promise<MedidaVolta<R>>,
  ): Promise<R | null> {
    const porta = this.porta(cliente);
    const estado = await porta.estado(def.codigo).catch(() => null);
    // A rotina que não aceita suspensão (vigia da plataforma) segue registrando mesmo se ficou suspensa de antes:
    // os alertas não somem do painel; a tela só oferece "Retomar" para ela.
    const suspensa = estado?.situacao === 'suspensa' && def.permiteSuspensao !== false;
    if (estado && (!estado.ativo || suspensa)) return null;
    const disparo: DisparoExecucao = estado?.manualPendente ? 'manual' : 'agendado';
    const inicioEm = this.agora();
    let medida: MedidaVolta<R> | null = null;
    let erro: unknown = null;
    try {
      medida = await fn(disparo);
    } catch (e) {
      erro = e;
    }
    const fimEm = this.agora();
    const volumes = {
      lidos: medida?.lidos ?? 0,
      gravados: medida?.gravados ?? 0,
      rejeitados: medida?.rejeitados ?? 0,
    };
    const situacao = erro ? 'falhou' : situacaoFinalSemErro(volumes, medida?.avisos ?? 0);
    const chave = `${cliente}|${def.codigo}`;
    const destino = destinoDaVolta({ situacao, volumes, disparo }, this.marcas.get(chave) ?? null, fimEm);
    if (destino !== 'nada') {
      try {
        await porta.registrar({
          definicao: def,
          situacao,
          inicioEm,
          fimEm,
          ...volumes,
          mensagemErro: erro ? tipoDoErro(erro) : null,
          etapas: medida?.etapas ?? [],
          historico: destino === 'historico',
          correlacao,
          servidor: this.servidor,
        });
        this.marcas.set(chave, fimEm);
      } catch (e) {
        logger.warn({ cliente, rotina: def.codigo, erro: tipoDoErro(e) }, 'rotina: registro da volta falhou');
      }
    }
    if (erro) throw erro;
    return medida?.resultado ?? null;
  }
}

/** Volumes de uma volta por estabelecimento (cada serviço diz o que leu, gravou e rejeitou). */
export interface VolumesDaVolta {
  readonly lidos: number;
  readonly gravados: number;
  readonly rejeitados: number;
}

/**
 * A volta por cliente e estabelecimento (como voltaPorEstabelecimento) com o registro da rotina: uma execução por
 * cliente, uma etapa por estabelecimento (a que falhou fica "falhou" com o tipo do erro e a execução, com avisos).
 */
export async function voltaPorEstabelecimentoComRotina<
  P extends { estabelecimentos(): Promise<AlvoEstabelecimento[]> },
  R,
>(
  registrador: RegistradorRotinas,
  def: DefinicaoRotina,
  medir: (r: R) => VolumesDaVolta,
  nucleo: NucleoClientes,
  env: NodeJS.ProcessEnv,
  correlacao: string,
  fabrica: (cliente: string) => P,
  fn: (porta: P, est: AlvoEstabelecimento, disparo: DisparoExecucao) => Promise<R>,
  falhou: (cliente: string, estabelecimento: string | null, erro: unknown) => void,
  agora: () => Date = () => new Date(),
): Promise<Volta<R>[]> {
  const r: Volta<R>[] = [];
  let clientes: string[];
  try {
    clientes = await clientesDoWorker(nucleo, env, correlacao);
  } catch (e) {
    falhou('', null, e);
    return r;
  }
  for (const cliente of clientes) {
    try {
      await registrador.rodar(cliente, def, correlacao, async (disparo) => {
        const porta = fabrica(cliente);
        const ests = await porta.estabelecimentos();
        const etapas: EtapaVolta[] = [];
        let avisos = 0;
        const soma = { lidos: 0, gravados: 0, rejeitados: 0 };
        for (const est of ests) {
          const inicioEm = agora();
          try {
            const resultado = await fn(porta, est, disparo);
            r.push({ cliente, estabelecimento: est.codigo, resultado });
            const v = medir(resultado);
            soma.lidos += v.lidos;
            soma.gravados += v.gravados;
            soma.rejeitados += v.rejeitados;
            etapas.push({
              nome: est.codigo,
              situacao: v.rejeitados > 0 ? 'concluida_com_avisos' : 'concluida',
              inicioEm,
              fimEm: agora(),
              ...v,
            });
          } catch (e) {
            avisos += 1;
            falhou(cliente, est.codigo, e);
            etapas.push({
              nome: est.codigo,
              situacao: 'falhou',
              inicioEm,
              fimEm: agora(),
              lidos: 0,
              gravados: 0,
              rejeitados: 0,
              mensagem: tipoDoErro(e),
            });
          }
        }
        return { resultado: null, ...soma, avisos, etapas };
      });
    } catch (e) {
      falhou(cliente, null, e);
    }
  }
  return r;
}
