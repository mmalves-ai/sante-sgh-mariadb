// Expiração das reservas de leito do NIR no `worker` (M44, etapa 2; ficha, regra 11 e seção 5,
// `internacao.expirarReserva`): a cada minuto, por estabelecimento, lê as reservas vigentes com a validade passada no
// relógio (o do banco ou o injetado, nos testes) numa transação curta READ ONLY; cada uma expira numa transação SGH_
// própria: a reserva sai da vigência (o leito volta a livre no mapa), a solicitação reservada ou a caminho volta à análise e o
// evento `internacao.reservaLeito.expirada` vai à SGH_TRILHA, tudo junto. Com dois consumidores, a condição da gravação
// (ainda vigente e vencida) faz o segundo não alterar nada, e a linha travada pelo primeiro faz o segundo desistir sem
// esperar: nunca expiração duplicada. A expiração vale com a chave `nir` ligada ou não (a reserva feita antes de
// recolher a funcionalidade também vence). Ligado fora de dev/ci; em dev/ci só com NIR_EXPIRACAO=ligado (a cópia é
// compartilhada). Log só com contagens.
import { resolve } from 'node:path';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { chaveExpiracao, transicao } from '@sgh/dominio-internacao';
import {
  ehTravaOcupada,
  encerrarReservaSgh,
  gravarTrilha,
  lerCodigos,
  lerConfiguracaoNucleo,
  NucleoLegado,
  relogioRecepcao,
  reservasVencidasNir,
  type ReservaNirLida,
  solicitacaoNir,
  somenteSgh,
  transicionarSolicitacaoSgh,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { logger } from './logger.js';

export const USUARIO_NIR = 'SGH.NIR';
/** A situação de regulação do sistema anterior equivalente a "em análise" pelo de-para proposto (1). */
const SITUACAO_EM_ANALISE = 1;

export function expiracaoLigada(env: NodeJS.ProcessEnv): boolean {
  const pedido = (env['NIR_EXPIRACAO'] ?? '').trim();
  if (pedido === 'desligado') return false;
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' ? pedido === 'ligado' : true;
}

export type NucleoNir = Pick<NucleoLegado, 'lerSomente' | 'gravarSgh' | 'rede' | 'encerrar'>;

/** As vencidas ainda vigentes (só leitura), no relógio injetado (hora local, sem fuso) ou no do banco. */
export async function reservasAExpirar(
  nucleo: NucleoNir,
  cod: string,
  agora: string | null = null,
): Promise<{ agora: string; vencidas: ReservaNirLida[] }> {
  const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'nir-expiracao' };
  return nucleo.lerSomente(ctx, async (l) => {
    const instante = agora ?? (await relogioRecepcao(l)).agora;
    return { agora: instante, vencidas: await reservasVencidasNir(l, cod, instante) };
  });
}

/** Expira UMA reserva com a volta da solicitação e a trilha (false: outro consumidor expirou ou está expirando). */
export async function expirarReserva(
  nucleo: NucleoNir,
  cod: string,
  r: ReservaNirLida,
  agora: string,
): Promise<boolean> {
  const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'nir-expiracao' };
  try {
    return await nucleo.gravarSgh(ctx, async (e0) => {
      const e = somenteSgh(e0);
      const n = await encerrarReservaSgh(e, {
        hospital: cod,
        reserva: r.id,
        situacao: 'expirada',
        motivo: 'Validade vencida',
        vencidaEm: agora,
        usuario: USUARIO_NIR,
      });
      if (n === 0) return false;
      const s = await solicitacaoNir(e, cod, r.solicitacao);
      // A reservada ou a em trânsito volta à análise (regra 11): nunca fica a caminho sem leito.
      if (s && transicao(s.estado, 'liberarReserva').ok)
        await transicionarSolicitacaoSgh(e, {
          hospital: cod,
          solicitacao: r.solicitacao,
          acao: 'liberarReserva',
          de: s.estado,
          para: 'em_analise',
          situacaoLegado: SITUACAO_EM_ANALISE,
          reserva: r.id,
          motivo: 'Reserva expirada',
          usuario: USUARIO_NIR,
        });
      await gravarTrilha(e, {
        rede: nucleo.rede,
        hospital: cod,
        usuario: USUARIO_NIR,
        evento: EVENTOS_AUDITAVEIS.nirReservaExpirada.codigo,
        recurso: 'internacao.reservaLeito',
        operacao: 'internacao.expirarReserva',
        tabelaAlvo: 'SGH_INT_RESERVA_LEITO',
        idAlvo: String(r.id),
        chaveNaturalAlvo: `${r.bloco}|${r.acomodacao}|${r.leito}`,
        resultado: 'sucesso',
        estacao: 'SGH-WORKER:nir',
        correlacao: chaveExpiracao(cod, r.id).slice(0, 64),
        origem: 'SGH-WORKER:nir',
      });
      return true;
    });
  } catch (x) {
    // A linha travada por outro consumidor: ele expira; este desiste sem esperar nem errar.
    if (ehTravaOcupada(x)) return false;
    throw x;
  }
}

/** Um ciclo num estabelecimento: as reservas expiradas por este consumidor. */
export async function cicloExpiracao(
  nucleo: NucleoNir,
  cod: string,
  agora: string | null = null,
): Promise<{ vencidas: number; expiradas: number }> {
  const p = await reservasAExpirar(nucleo, cod, agora);
  let expiradas = 0;
  for (const r of p.vencidas) if (await expirarReserva(nucleo, cod, r, p.agora)) expiradas++;
  return { vencidas: p.vencidas.length, expiradas };
}

@Injectable()
export class NirReservaService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoNir | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  /** Teste: o núcleo sem subir o driver. */
  usar(nucleo: NucleoNir): void {
    this.nucleo = nucleo;
  }

  onApplicationBootstrap(): void {
    if (!expiracaoLigada(process.env)) return;
    try {
      process.env['SGH_PROCESSO'] ??= 'worker';
      this.nucleo = new NucleoLegado({
        env: process.env,
        driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(process.env).bibliotecaCliente }),
        pastaHomologada: resolve(
          process.cwd(),
          process.env['SCHEMA_HOMOLOGADO_DIR'] ?? 'tools/schema-check/homologado',
        ),
        aviso: (m, c) => logger.warn(c, m),
      });
      this.temporizador = setInterval(() => void this.ciclo(), 60_000);
      this.temporizador.unref();
    } catch (e) {
      logger.error(
        { erro: e instanceof Error ? e.message : 'erro' },
        'expiração das reservas do NIR não subiu',
      );
    }
  }

  async ciclo(agora: string | null = null): Promise<{ estabelecimento: string; expiradas: number }[]> {
    if (this.rodando || !this.nucleo) return [];
    this.rodando = true;
    const r: { estabelecimento: string; expiradas: number }[] = [];
    try {
      for (const cod of lerCodigos(process.env)) {
        try {
          const x = await cicloExpiracao(this.nucleo, cod, agora);
          r.push({ estabelecimento: cod, expiradas: x.expiradas });
          if (x.expiradas > 0)
            logger.info({ estabelecimento: cod, expiradas: x.expiradas }, 'reservas expiradas');
        } catch (e) {
          logger.warn(
            { estabelecimento: cod, erro: e instanceof Error ? e.name : 'erro' },
            'expiração das reservas falhou',
          );
        }
      }
    } finally {
      this.rodando = false;
    }
    return r;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
