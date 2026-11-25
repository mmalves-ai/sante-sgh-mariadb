// Rotina diária das contas (F3, motores): uma vez por dia e por estabelecimento ativo do cliente da API, roda
// faturamento.apurar-lancamentos-do-dia (conta-entrada.ts): abre a conta da internação que ficou sem conta e lança a
// diária do dia de corte sem depender de evento do ADT. A operação é idempotente (a chave do lançamento automático):
// duas instâncias da API ou um reinício no mesmo dia não lançam em dobro. O ciclo roda a cada hora e dispara no
// primeiro ciclo de cada dia civil no fuso do estabelecimento, a partir da hora de início. Ligar, desligar e a hora de
// início são parâmetros tipados do faturamento por rede ou estabelecimento (faturamento.rotinaDiaria e
// faturamento.rotinaDiariaHora, 06-FAT linha 38), lidos a cada ciclo. A variável de ambiente ficou só como trava de
// dev/ci (lá, só com FATURAMENTO_ROTINA_DIARIA=ligado). Log só com códigos e contagens.
import { randomUUID } from 'node:crypto';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { instanteParaDataHora } from '@sgh/contratos';
import type { Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { logger } from '../../logger.js';
import { rotinaDiariaNaHora } from '@sgh/dominio-faturamento';
import { apurarLancamentosDoDia } from './conta-entrada.js';
import { parametrosDoEstabelecimento } from './parametros-faturamento-propria.js';

const FUSO_PADRAO = 'America/Sao_Paulo';

/**
 * Trava do ambiente: fora de dev/ci o temporizador sempre sobe (quem liga e desliga é o parâmetro
 * faturamento.rotinaDiaria de cada estabelecimento); em dev/ci, só com FATURAMENTO_ROTINA_DIARIA=ligado.
 */
export function rotinaDiariaLigada(env: Readonly<Record<string, string | undefined>>): boolean {
  const pedido = (env['FATURAMENTO_ROTINA_DIARIA'] ?? '').trim();
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' ? pedido === 'ligado' : true;
}

export interface ResultadoRotinaDiaria {
  readonly estabelecimento: string;
  readonly dia: string;
  readonly contas: number;
  readonly lancados: number;
  readonly abertas: number;
}

type NucleoRotina = Pick<NucleoProprio, 'criarExecutor' | 'lerSomente'>;

/** Um ciclo: para cada estabelecimento ativo cujo dia civil ainda não rodou nesta instância, apura o dia. */
export async function cicloRotinaDiaria(
  nucleo: NucleoRotina,
  cliente: string,
  jaRodou: Map<number, string>,
  agora: Date = new Date(),
  executor: Executor = nucleo.criarExecutor(),
): Promise<ResultadoRotinaDiaria[]> {
  const ests = await nucleo.lerSomente(
    { cliente, estabelecimento: null, correlacao: 'faturamento-rotina-diaria' },
    (l: Leitor) =>
      l.consultar<Record<string, unknown>>(
        'SELECT id, codigo, fuso_horario FROM estabelecimento WHERE excluido_em IS NULL AND ativo = TRUE ORDER BY codigo',
        [],
        { teto: 1000 },
      ),
  );
  const feitos: ResultadoRotinaDiaria[] = [];
  for (const e of ests) {
    const id = Number(e['id']);
    const codigo = String(e['codigo']);
    const fuso = typeof e['fuso_horario'] === 'string' && e['fuso_horario'] ? e['fuso_horario'] : FUSO_PADRAO;
    const local = instanteParaDataHora(agora.toISOString(), fuso);
    const dia = local.data;
    if (jaRodou.get(id) === dia) continue;
    try {
      const p = await nucleo.lerSomente(
        { cliente, estabelecimento: id, correlacao: 'faturamento-rotina-diaria' },
        (l: Leitor) => parametrosDoEstabelecimento(l, id),
      );
      if (!rotinaDiariaNaHora(p, Number(local.hora.slice(0, 2)))) continue;
      const r = await executor.executar(
        apurarLancamentosDoDia,
        cliente,
        {},
        {
          cliente,
          estabelecimento: id,
          usuario: null,
          correlacao: `fat-dia-${codigo}-${dia}`.slice(0, 64),
          chaveIdempotencia: `api.faturamento.dia.${id}.${dia}.${randomUUID()}`,
        },
      );
      jaRodou.set(id, dia);
      const x = r.resultado;
      feitos.push({
        estabelecimento: codigo,
        dia,
        contas: Number(x['contas'] ?? 0),
        lancados: Number(x['lancados'] ?? 0),
        abertas: Number(x['abertas'] ?? 0),
      });
    } catch (erro) {
      logger.warn(
        { estabelecimento: codigo, erro: erro instanceof Error ? erro.name : 'erro' },
        'rotina diária das contas falhou',
      );
    }
  }
  return feitos;
}

@Injectable()
export class RotinaDiariaContas implements OnApplicationBootstrap, OnApplicationShutdown {
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;
  private readonly jaRodou = new Map<number, string>();

  constructor(
    private readonly nucleo: NucleoRotina | null,
    private readonly cliente: string | null,
    private readonly env: Readonly<Record<string, string | undefined>>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.nucleo || !this.cliente || !rotinaDiariaLigada(this.env)) return;
    void this.ciclo();
    this.temporizador = setInterval(() => void this.ciclo(), 3_600_000);
    this.temporizador.unref();
  }

  async ciclo(agora: Date = new Date()): Promise<ResultadoRotinaDiaria[]> {
    if (this.rodando || !this.nucleo || !this.cliente) return [];
    this.rodando = true;
    try {
      const r = await cicloRotinaDiaria(this.nucleo, this.cliente, this.jaRodou, agora);
      for (const x of r) logger.info(x, 'rotina diária das contas');
      return r;
    } catch (erro) {
      logger.warn({ erro: erro instanceof Error ? erro.name : 'erro' }, 'rotina diária das contas falhou');
      return [];
    } finally {
      this.rodando = false;
    }
  }

  onApplicationShutdown(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }
}
