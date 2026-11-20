// internacao.fecharCenso no worker (M16; ficha, seções 5 e 12): a cada minuto, por estabelecimento, se a chave
// `internacao.censo.fechamento` está ligada (onda 2, M40; até lá o censo de qualquer dia é calculado na hora), para
// o último dia do censo que já fechou na hora de fechamento do estabelecimento (parâmetro do M08) e os dias dos
// últimos 7 que ficaram sem retrato (worker parado na hora de fechar), calcula o censo de cada dia pela trajetória
// (transação curta READ ONLY) e grava o retrato em SGH_INT_CENSO_DIA, com o evento na SGH_TRILHA, numa transação
// só SGH_ por dia. Dia já fechado (outro processo foi antes): desiste em silêncio. Ligado fora de
// dev/ci; em dev/ci só com CENSO_FECHAMENTO=ligado (a cópia é compartilhada). Log só com contagens.
import { resolve } from 'node:path';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import {
  definicaoParametro,
  EVENTOS_AUDITAVEIS,
  HORA_FECHAMENTO_PADRAO,
  recursoDesligado,
  TIPOS_INTENSIVA_PADRAO,
} from '@sgh/contratos';
import { recursoLigado, resolverParametro, valorTipado } from '@sgh/dominio-config';
import {
  dataDoDia,
  diaDoCenso,
  MotorInternacao,
  relogioDeParede,
  VERSAO_CALCULO_CENSO,
} from '@sgh/dominio-internacao';
import {
  diasFechados,
  ErroCensoJaFechado,
  fecharCenso,
  gravarTrilha,
  lerChavesLiberacao,
  lerCodigos,
  lerConfiguracaoNucleo,
  lerMovimentoInternacao,
  lerPrerequisitos,
  lerValoresParametro,
  NucleoLegado,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { logger } from './logger.js';

export const CHAVE_FECHAMENTO = 'internacao.censo.fechamento';
export const USUARIO_CENSO = 'SGH.CENSO';
/** Dias para trás que cada ciclo confere (o último fechado e os que ficaram sem retrato). */
export const JANELA_FECHAMENTO_DIAS = 7;

export function fechamentoLigado(env: NodeJS.ProcessEnv): boolean {
  const pedido = (env['CENSO_FECHAMENTO'] ?? '').trim();
  if (pedido === 'desligado') return false;
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' ? pedido === 'ligado' : true;
}

export type NucleoCenso = Pick<NucleoLegado, 'lerSomente' | 'gravarSgh' | 'rede' | 'encerrar'>;

export type ResultadoFechamento =
  | { readonly situacao: 'desligado' | 'ja-fechado' | 'aguardando' }
  | {
      readonly situacao: 'fechado';
      /** O último dia fechado neste ciclo (linhas e internados dele). */
      readonly data: string;
      readonly linhas: number;
      readonly internados: number;
      /** Todos os dias fechados neste ciclo, em ordem (o último e os que tinham ficado sem retrato). */
      readonly dias: readonly string[];
    };

/**
 * Um ciclo num estabelecimento: com a chave valendo, fecha o último dia do censo e os dias da janela que ficaram
 * sem retrato (em ordem); nada pendente: "já fechado".
 */
export async function fecharCensoDoEstabelecimento(
  nucleo: NucleoCenso,
  cod: string,
  agoraReal: number,
): Promise<ResultadoFechamento> {
  const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'censo-fechamento' };
  const cfg = await nucleo.lerSomente(ctx, async (l) => ({
    chaves: await lerChavesLiberacao(l, cod),
    prerequisitos: await lerPrerequisitos(l, cod),
    valores: await lerValoresParametro(l, cod),
  }));
  const chaves = cfg.chaves
    .filter(
      (c) =>
        c.chave === CHAVE_FECHAMENTO && c.tipo === 'recurso' && c.ligada !== null && c.escopo === 'hospital',
    )
    .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
  const declarados = recursoDesligado(CHAVE_FECHAMENTO)?.prerequisitos ?? [];
  const registrados = cfg.prerequisitos.filter((p) => p.recurso === CHAVE_FECHAMENTO);
  if (!recursoLigado(chaves, declarados, registrados, { pessoa: USUARIO_CENSO }, new Date(agoraReal)))
    return { situacao: 'desligado' };
  const sujeito = {
    rede: nucleo.rede,
    empresa: null,
    estabelecimento: cod,
    unidade: null,
    perfis: [],
    usuario: '',
  };
  const ler = (chave: string) => {
    const def = definicaoParametro(chave);
    return def
      ? valorTipado(def, resolverParametro(def, cfg.valores, sujeito, new Date(agoraReal)).valor)
      : null;
  };
  const hora = ler('internacao.censo.horaFechamento');
  const horaFechamento = typeof hora === 'number' && hora >= 1 && hora <= 24 ? hora : HORA_FECHAMENTO_PADRAO;
  const tipos = String(ler('internacao.acomodacao.intensiva') ?? '')
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n));
  const intensivas = tipos.length > 0 ? tipos : [...TIPOS_INTENSIVA_PADRAO];
  const agora = relogioDeParede(agoraReal);
  // Os dias já fechados na hora de fechamento, numa janela curta: o último e os anteriores que ficaram sem retrato
  // (worker parado na hora de fechar: deploy, queda, banco fora). Cada um, em ordem, com a mesma trava e prova.
  const ultimo = diaDoCenso(agora, horaFechamento) - 1;
  const de = dataDoDia(ultimo - JANELA_FECHAMENTO_DIAS + 1);
  const ate = dataDoDia(ultimo);
  const ja = new Set(await nucleo.lerSomente(ctx, (l) => diasFechados(l, cod, de, ate)));
  const pendentes: string[] = [];
  for (let d = ultimo - JANELA_FECHAMENTO_DIAS + 1; d <= ultimo; d++)
    if (!ja.has(dataDoDia(d))) pendentes.push(dataDoDia(d));
  if (pendentes.length === 0) return { situacao: 'ja-fechado' };
  const mov = await nucleo.lerSomente(ctx, (l) => lerMovimentoInternacao(l));
  const motor = new MotorInternacao(mov, { horaFechamento, intensivas, agora });
  const fechados: { data: string; linhas: number; internados: number }[] = [];
  for (const dia of pendentes) {
    const g = await fecharUmDia(nucleo, cod, dia, horaFechamento, motor);
    if (g) fechados.push({ data: dia, ...g });
  }
  const fim = fechados.at(-1);
  if (!fim) return { situacao: 'ja-fechado' };
  return { situacao: 'fechado', ...fim, dias: fechados.map((f) => f.data) };
}

/** Grava o retrato de um dia; null quando outro processo fechou antes (o UNIQUE ou a trava do dia). */
async function fecharUmDia(
  nucleo: NucleoCenso,
  cod: string,
  dia: string,
  horaFechamento: number,
  motor: MotorInternacao,
): Promise<{ linhas: number; internados: number } | null> {
  const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'censo-fechamento' };
  const linhas = motor.censoDoDia(dia);
  try {
    return await nucleo.gravarSgh(ctx, async (e) => {
      const g = await fecharCenso(e, {
        hospital: cod,
        data: dia,
        horaFechamento,
        versaoCalculo: VERSAO_CALCULO_CENSO,
        linhas,
      });
      await gravarTrilha(e, {
        rede: nucleo.rede,
        hospital: cod,
        usuario: USUARIO_CENSO,
        evento: EVENTOS_AUDITAVEIS.censoFechado.codigo,
        recurso: 'internacao.censo',
        operacao: 'internacao.fecharCenso',
        tabelaAlvo: 'SGH_INT_CENSO_DIA',
        idAlvo: null,
        chaveNaturalAlvo: dia,
        resultado: 'sucesso',
        estacao: 'SGH-WORKER:censo',
        correlacao: `censo-${cod}-${dia}`,
        origem: 'SGH-WORKER:censo',
      });
      return g;
    });
  } catch (x) {
    if (
      x instanceof ErroCensoJaFechado ||
      (x instanceof Error && /SGH_UQ_INT_CENSO_DIA|unique|duplicate/i.test(x.message))
    )
      return null;
    throw x;
  }
}

@Injectable()
export class CensoFechamentoService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoCenso | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  /** Teste: o núcleo sem subir o driver. */
  usar(nucleo: NucleoCenso): void {
    this.nucleo = nucleo;
  }

  onApplicationBootstrap(): void {
    if (!fechamentoLigado(process.env)) return;
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
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'fechamento do censo não subiu');
    }
  }

  async ciclo(agoraReal = Date.now()): Promise<ResultadoFechamento[]> {
    if (this.rodando || !this.nucleo) return [];
    this.rodando = true;
    const r: ResultadoFechamento[] = [];
    try {
      for (const cod of lerCodigos(process.env)) {
        try {
          const x = await fecharCensoDoEstabelecimento(this.nucleo, cod, agoraReal);
          r.push(x);
          if (x.situacao === 'fechado')
            logger.info(
              { estabelecimento: cod, data: x.data, linhas: x.linhas, internados: x.internados },
              'censo fechado',
            );
        } catch (e) {
          logger.warn(
            { estabelecimento: cod, erro: e instanceof Error ? e.name : 'erro' },
            'fechamento do censo falhou',
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
