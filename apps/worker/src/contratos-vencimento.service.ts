// Alerta diário de vencimento dos contratos com fornecedores no `worker` (M55, etapa 3; ficha, seção 4; regra 5; lote
// F2.2 05-15): por cliente e estabelecimento com a chave `contratos` ligada, lê os contratos vigentes com o fim da
// vigência e o gestor e o fiscal vigentes pela porta própria; para cada contrato que cruzou 90, 60 ou 30 dias do fim ou
// venceu (regra pura do domínio), grava um aviso na central de avisos a cada destinatário, com a trilha. Uma vez por
// faixa e por fim (a chave leva o contrato, o fim e a faixa): o aditivo de prazo ou a renovação muda o fim e reabre os
// alertas. A cada hora (o primeiro ciclo do dia avisa; os seguintes não repetem). Ligado fora de dev/ci; em dev/ci só
// com CONTRATOS_ALERTA_DIARIO=ligado. Log só com contagens.
// Melhoria: o dia do alerta é o dia civil do fuso do estabelecimento; o contrato em alerta sem gestor principal, gestor
// nem fiscal vigente é contado e avisado no log (ninguém receberia o aviso).
// Melhoria: a antecedência própria do contrato (dias_alerta_vencimento) é uma faixa a mais, uma vez por fim, quando não
// coincide com 90, 60 ou 30; o assunto e a mensagem próprios do contrato vão ao título e ao texto do aviso.
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { DIAS_ALERTA_VENCIMENTO, FAIXAS_VIGENCIA, type FaixaVigencia } from '@sgh/contratos';
import { alertaDeVencimento } from '@sgh/dominio-suprimentos';
import { NucleoProprio } from '@sgh/nucleo';
import {
  type ContratoParaAlerta,
  type PortaContratos,
  PortaContratosPropria,
  TIPO_AVISO_CONTRATO,
} from './contratos-vencimento-propria.js';
import { logger } from './logger.js';
import {
  type AlvoEstabelecimento,
  diaEHoraLocal,
  type NucleoServico,
  servicoLigado,
  voltaPorEstabelecimento,
} from './servico-worker.js';

export { TIPO_AVISO_CONTRATO };
export type { ContratoParaAlerta };

export function alertaContratosLigado(env: NodeJS.ProcessEnv): boolean {
  return servicoLigado(env, 'CONTRATOS_ALERTA_DIARIO');
}

export interface AlertaContrato {
  readonly contrato: number;
  readonly numero: string;
  /** A faixa padrão (90, 60, 30 dias, vencido) ou a antecedência própria do contrato. */
  readonly faixa: FaixaVigencia | 'antecedencia-contrato';
  readonly fim: string;
  readonly destinatarios: readonly number[];
  /** A chave do aviso: o contrato, o fim vigente e a faixa (uma vez por faixa e por fim). */
  readonly chave: string;
  readonly titulo: string;
  readonly texto: string;
}

type EntradaAlerta = Parameters<typeof alertaDeVencimento>[0];
const dataBr = (d: string) => d.split('-').reverse().join('/');
/** A situação do cadastro na forma da regra do domínio (vigente = ativo). */
const situacaoDaRegra = (s: string) => (s === 'vigente' ? 'ativo' : s) as EntradaAlerta['situacao'];

const DIA_MS = 86_400_000;
const diasAte = (fim: string, hoje: string) =>
  Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / DIA_MS);

/** O título e o texto do aviso: o assunto e a mensagem próprios do contrato, quando preenchidos. */
function textos(c: ContratoParaAlerta, padrao: string, quando: string): { titulo: string; texto: string } {
  const titulo = (c.assunto ? `${c.assunto} (${quando})` : padrao).slice(0, 200);
  return { titulo, texto: c.mensagem ?? titulo };
}

/**
 * Os alertas do dia (regra pura sobre o que foi lido): quem cruzou 90, 60 ou 30 dias ou venceu (regra do domínio) e,
 * à parte, quem entrou na antecedência própria do contrato (dias_alerta_vencimento, quando não é uma das padrão).
 */
export function alertasDoDia(contratos: readonly ContratoParaAlerta[], hoje: string): AlertaContrato[] {
  const out: AlertaContrato[] = [];
  for (const c of contratos) {
    const destinatarios = [...new Set(c.destinatarios)];
    const faixa = alertaDeVencimento({
      situacao: situacaoDaRegra(c.situacao),
      inicio: c.inicio,
      fim: c.fim,
      hoje,
      faixaJaAvisada: null,
    });
    if (faixa) {
      const rotulo = FAIXAS_VIGENCIA.find((f) => f.codigo === faixa)?.rotulo ?? faixa;
      const vencido = faixa === 'vencido';
      out.push({
        contrato: c.id,
        numero: c.numero,
        faixa,
        fim: c.fim,
        destinatarios,
        chave: `${c.id}:${c.fim}:${faixa}`,
        ...textos(
          c,
          vencido
            ? `Contrato ${c.numero} vencido em ${dataBr(c.fim)}`
            : `Contrato ${c.numero}: ${rotulo.toLowerCase()} (${dataBr(c.fim)})`,
          vencido ? `vencido em ${dataBr(c.fim)}` : `vence em ${dataBr(c.fim)}`,
        ),
      });
    }
    const dias = c.diasAlerta;
    const restam = diasAte(c.fim, hoje);
    if (
      dias !== null &&
      dias > 0 &&
      !(DIAS_ALERTA_VENCIMENTO as readonly number[]).includes(dias) &&
      c.situacao === 'vigente' &&
      c.inicio <= hoje &&
      restam >= 0 &&
      restam <= dias
    )
      out.push({
        contrato: c.id,
        numero: c.numero,
        faixa: 'antecedencia-contrato',
        fim: c.fim,
        destinatarios,
        chave: `${c.id}:${c.fim}:antecedencia-${dias}`,
        ...textos(
          c,
          `Contrato ${c.numero}: vence em até ${dias} dias (${dataBr(c.fim)})`,
          `vence em ${dataBr(c.fim)}`,
        ),
      });
  }
  return out;
}

/** Um ciclo num estabelecimento: os contratos em alerta, os avisos novos e os sem destinatário. */
export async function cicloContratos(
  porta: PortaContratos,
  est: AlvoEstabelecimento,
  agora: Date = new Date(),
): Promise<{ ligada: boolean; emAlerta: number; avisos: number; semDestinatario: number }> {
  if (!(await porta.ligada(est, agora))) return { ligada: false, emAlerta: 0, avisos: 0, semDestinatario: 0 };
  const hoje = diaEHoraLocal(agora, est.fuso).data;
  const alertas = alertasDoDia(await porta.contratos(est, hoje), hoje);
  let avisos = 0;
  let semDestinatario = 0;
  for (const a of alertas) {
    if (a.destinatarios.length === 0) {
      semDestinatario++;
      continue;
    }
    avisos += await porta.avisar(est, {
      contrato: a.contrato,
      chave: a.chave,
      titulo: a.titulo,
      texto: a.texto,
      destinatarios: a.destinatarios,
    });
  }
  return { ligada: true, emAlerta: alertas.length, avisos, semDestinatario };
}

export type FabricaPortaContratos = (cliente: string) => PortaContratos;

@Injectable()
export class ContratosVencimentoService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoServico | null = null;
  private fabrica: FabricaPortaContratos | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  /** Teste: o núcleo e a porta sem subir o banco. */
  usar(nucleo: NucleoServico, fabrica: FabricaPortaContratos): void {
    this.nucleo = nucleo;
    this.fabrica = fabrica;
  }

  onApplicationBootstrap(): void {
    if (!alertaContratosLigado(process.env)) return;
    try {
      const nucleo = new NucleoProprio({ env: process.env });
      this.usar(nucleo, (cliente) => new PortaContratosPropria(nucleo, cliente));
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
    agora: Date = new Date(),
  ): Promise<{ cliente: string; estabelecimento: string; emAlerta: number; avisos: number }[]> {
    const nucleo = this.nucleo;
    const fabrica = this.fabrica;
    if (this.rodando || !nucleo || !fabrica) return [];
    this.rodando = true;
    try {
      const voltas = await voltaPorEstabelecimento(
        nucleo,
        process.env,
        'contratos-vencimento',
        fabrica,
        (porta, est) => cicloContratos(porta, est, agora),
        (cliente, estabelecimento, e) =>
          logger.warn(
            { cliente, estabelecimento, erro: e instanceof Error ? e.name : 'erro' },
            'alerta de vencimento dos contratos falhou',
          ),
      );
      for (const v of voltas) {
        const x = v.resultado;
        if (x.avisos > 0)
          logger.info(
            {
              cliente: v.cliente,
              estabelecimento: v.estabelecimento,
              emAlerta: x.emAlerta,
              avisos: x.avisos,
            },
            'vencimento de contratos avisado',
          );
        if (x.semDestinatario > 0)
          logger.warn(
            { cliente: v.cliente, estabelecimento: v.estabelecimento, semDestinatario: x.semDestinatario },
            'contrato em alerta sem gestor nem fiscal vigente (sem aviso)',
          );
      }
      return voltas.map((v) => ({
        cliente: v.cliente,
        estabelecimento: v.estabelecimento,
        emAlerta: v.resultado.emAlerta,
        avisos: v.resultado.avisos,
      }));
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
