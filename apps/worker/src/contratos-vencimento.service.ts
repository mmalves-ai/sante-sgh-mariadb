// Alerta diário de vencimento dos contratos com fornecedores no `worker` (M55, etapa 3; ficha, seção 4: "Contratos a
// vencer: agregado diário no worker"; regra 5): por estabelecimento com a chave `contratos` ligada, numa transação curta
// READ ONLY, lê os contratos ativos com o fim vigente (SGH_SUP_CONTRATO e os aditivos de prazo e as renovações) e, para
// cada contrato que cruzou 90, 60 ou 30 dias do fim ou venceu, grava um aviso na central (SGH_ADM_AVISO) ao gestor e ao
// fiscal, com a trilha, numa transação SGH_. Uma vez por faixa: a chave do objeto leva o contrato, o fim vigente e a
// faixa (a central não grava duas vezes o mesmo destinatário, evento e objeto); o aditivo de prazo ou a renovação muda
// o fim e reabre os alertas. A cada hora (o primeiro ciclo do dia avisa; os seguintes não repetem). Ligado fora de
// dev/ci; em dev/ci só com CONTRATOS_ALERTA_DIARIO=ligado (a cópia é compartilhada). Log só com contagens.
import { resolve } from 'node:path';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import {
  CHAVE_LIBERACAO_CONTRATOS,
  EVENTOS_AUDITAVEIS,
  type FaixaVigencia,
  FAIXAS_VIGENCIA,
} from '@sgh/contratos';
import { alertaDeVencimento } from '@sgh/dominio-suprimentos';
import {
  type ContratoParaAlerta,
  contratosParaAlerta,
  gravarAviso,
  gravarTrilha,
  lerChavesLiberacao,
  lerCodigos,
  lerConfiguracaoNucleo,
  NucleoLegado,
  somenteSgh,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { logger } from './logger.js';

const USUARIO_ALERTA = 'SGH-WORKER';
export const TIPO_AVISO_CONTRATO = 'contrato-vencimento';

export function alertaContratosLigado(env: NodeJS.ProcessEnv): boolean {
  const pedido = (env['CONTRATOS_ALERTA_DIARIO'] ?? '').trim();
  if (pedido === 'desligado') return false;
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' ? pedido === 'ligado' : true;
}

export type NucleoContratos = Pick<NucleoLegado, 'lerSomente' | 'gravarSgh' | 'rede' | 'encerrar'>;

export interface AlertaContrato {
  readonly contrato: number;
  readonly numero: string;
  readonly faixa: FaixaVigencia;
  readonly fim: string;
  /** O gestor e o fiscal (sem repetir). */
  readonly destinatarios: readonly string[];
  /** A chave do objeto na central: o contrato, o fim vigente e a faixa (uma vez por faixa e por fim). */
  readonly chave: string;
  readonly titulo: string;
}

const dataBr = (d: string) => d.split('-').reverse().join('/');

/** Os alertas do dia (regra pura sobre o que foi lido): só quem cruzou 90, 60 ou 30 dias ou venceu. */
export function alertasDoDia(contratos: readonly ContratoParaAlerta[], hoje: string): AlertaContrato[] {
  const out: AlertaContrato[] = [];
  for (const c of contratos) {
    const faixa = alertaDeVencimento({
      situacao: c.situacao,
      inicio: c.inicio,
      fim: c.fim,
      hoje,
      faixaJaAvisada: null,
    });
    if (!faixa) continue;
    const rotulo = FAIXAS_VIGENCIA.find((f) => f.codigo === faixa)?.rotulo ?? faixa;
    out.push({
      contrato: c.id,
      numero: c.numero,
      faixa,
      fim: c.fim,
      destinatarios: [...new Set([c.gestor.toUpperCase(), c.fiscal.toUpperCase()])],
      chave: `${c.id}:${c.fim}:${faixa}`,
      titulo:
        faixa === 'vencido'
          ? `Contrato ${c.numero} vencido em ${dataBr(c.fim)}`
          : `Contrato ${c.numero}: ${rotulo.toLowerCase()} (${dataBr(c.fim)})`,
    });
  }
  return out;
}

/** Lê (READ ONLY) os alertas do dia num estabelecimento; vazio com a funcionalidade desligada. */
export async function alertasPendentes(
  nucleo: NucleoContratos,
  cod: string,
  hoje: string | null = null,
): Promise<{ ligada: boolean; hoje: string; alertas: AlertaContrato[] }> {
  const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'contratos-vencimento' };
  return nucleo.lerSomente(ctx, async (l) => {
    const chaves = await lerChavesLiberacao(l, cod);
    const ligada = chaves.some(
      (c) => c.chave === CHAVE_LIBERACAO_CONTRATOS && c.tipo === 'recurso' && c.ligada === true,
    );
    if (!ligada) return { ligada, hoje: hoje ?? '', alertas: [] };
    const lido = await contratosParaAlerta(l, cod, hoje);
    const dia = hoje ?? lido.hoje;
    return { ligada, hoje: dia, alertas: alertasDoDia(lido.contratos, dia) };
  });
}

/** Grava os avisos de UM contrato com a trilha; devolve quantos avisos novos (0: já avisado nesta faixa). */
export async function avisarContrato(
  nucleo: NucleoContratos,
  cod: string,
  a: AlertaContrato,
): Promise<number> {
  const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'contratos-vencimento' };
  return nucleo.gravarSgh(ctx, async (e0) => {
    const e = somenteSgh(e0);
    let novos = 0;
    for (const login of a.destinatarios) {
      const id = await gravarAviso(e, {
        rede: nucleo.rede,
        hospital: cod,
        login,
        tipo: TIPO_AVISO_CONTRATO,
        gravidade: 'atencao',
        modulo: 'suprimentos',
        evento: EVENTOS_AUDITAVEIS.contratoAlertaVencimento.codigo,
        titulo: a.titulo,
        link: '/suprimentos/contratos',
        objetoTabela: 'SGH_SUP_CONTRATO',
        objetoChave: a.chave,
      });
      if (id !== null) novos++;
    }
    if (novos > 0)
      await gravarTrilha(e, {
        rede: nucleo.rede,
        hospital: cod,
        usuario: USUARIO_ALERTA,
        evento: EVENTOS_AUDITAVEIS.contratoAlertaVencimento.codigo,
        recurso: 'suprimentos.contrato',
        operacao: 'suprimentos.alertarVencimentoContrato',
        tabelaAlvo: 'SGH_SUP_CONTRATO',
        idAlvo: String(a.contrato),
        chaveNaturalAlvo: a.chave,
        resultado: 'sucesso',
        estacao: 'SGH-WORKER:contratos',
        correlacao: a.chave.slice(0, 64),
        origem: 'SGH-WORKER:contratos',
      });
    return novos;
  });
}

/** Um ciclo num estabelecimento: os contratos em alerta e os avisos novos gravados. */
export async function cicloContratos(
  nucleo: NucleoContratos,
  cod: string,
  hoje: string | null = null,
): Promise<{ ligada: boolean; emAlerta: number; avisos: number }> {
  const p = await alertasPendentes(nucleo, cod, hoje);
  let avisos = 0;
  for (const a of p.alertas) avisos += await avisarContrato(nucleo, cod, a);
  return { ligada: p.ligada, emAlerta: p.alertas.length, avisos };
}

@Injectable()
export class ContratosVencimentoService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoContratos | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  /** Teste: o núcleo sem subir o driver. */
  usar(nucleo: NucleoContratos): void {
    this.nucleo = nucleo;
  }

  onApplicationBootstrap(): void {
    if (!alertaContratosLigado(process.env)) return;
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
      void this.ciclo();
      this.temporizador = setInterval(() => void this.ciclo(), 3_600_000);
      this.temporizador.unref();
    } catch (e) {
      logger.error(
        { erro: e instanceof Error ? e.message : 'erro' },
        'alerta de vencimento dos contratos não subiu',
      );
    }
  }

  async ciclo(
    hoje: string | null = null,
  ): Promise<{ estabelecimento: string; emAlerta: number; avisos: number }[]> {
    if (this.rodando || !this.nucleo) return [];
    this.rodando = true;
    const r: { estabelecimento: string; emAlerta: number; avisos: number }[] = [];
    try {
      for (const cod of lerCodigos(process.env)) {
        try {
          const x = await cicloContratos(this.nucleo, cod, hoje);
          r.push({ estabelecimento: cod, emAlerta: x.emAlerta, avisos: x.avisos });
          if (x.avisos > 0)
            logger.info(
              { estabelecimento: cod, emAlerta: x.emAlerta, avisos: x.avisos },
              'vencimento de contratos avisado',
            );
        } catch (e) {
          logger.warn(
            { estabelecimento: cod, erro: e instanceof Error ? e.name : 'erro' },
            'alerta de vencimento dos contratos falhou',
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
