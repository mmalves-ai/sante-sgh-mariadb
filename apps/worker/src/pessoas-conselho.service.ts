// Retrato diário da validade do conselho no `worker` (M52.1; ficha do M52, seção 4: "Validade do conselho: agregado
// diário no worker"; regra 3): por estabelecimento, numa transação curta READ ONLY, lê os registros do conselho
// (TBCBOPRO) dos colaboradores com vínculo ativo e as validades conferidas pelo RH (SGH_PES_HABILITACAO); conta os
// vencidos, os a vencer na janela do parâmetro `pessoas.alertaConselhoDias` e os sem validade conferida; grava só as
// contagens em SGH_PES_CONSELHO_DIA numa transação SGH_ (refaz o dia se rodar de novo). A cada hora (o primeiro ciclo
// do dia grava; os seguintes refazem). Ligado fora de dev/ci; em dev/ci só com PESSOAS_CONSELHO_DIARIO=ligado (a cópia
// é compartilhada). Log só com contagens.
import { resolve } from 'node:path';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { definicaoParametro, JANELA_ALERTA_CONSELHO_DIAS } from '@sgh/contratos';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import { alertasDeConselho } from '@sgh/dominio-pessoas';
import {
  type ConselhoDiaSgh,
  gravarConselhoDiaPesSgh,
  habilitacoesPesSgh,
  lerCodigos,
  lerConfiguracaoNucleo,
  lerValoresParametro,
  NucleoLegado,
  registrosDosColaboradoresAtivos,
  relogioRecepcao,
  somenteSgh,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { logger } from './logger.js';

export function retratoConselhoLigado(env: NodeJS.ProcessEnv): boolean {
  const pedido = (env['PESSOAS_CONSELHO_DIARIO'] ?? '').trim();
  if (pedido === 'desligado') return false;
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' ? pedido === 'ligado' : true;
}

export type NucleoConselho = Pick<NucleoLegado, 'lerSomente' | 'gravarSgh' | 'rede' | 'encerrar'>;

/** As contagens do dia (regra pura sobre o que foi lido): só os registros ativos entram. */
export function contarAlertas(
  registros: readonly {
    registro: number;
    profissional: number;
    ativo: boolean | null;
    validade: string | null;
  }[],
  hoje: string,
  janelaDias: number,
): Pick<ConselhoDiaSgh, 'registros' | 'vencidos' | 'aVencer' | 'semValidade'> {
  const alertas = alertasDeConselho(registros, hoje, janelaDias);
  return {
    registros: registros.filter((r) => r.ativo !== false).length,
    vencidos: alertas.filter((a) => a.situacao === 'vencida').length,
    aVencer: alertas.filter((a) => a.situacao === 'aVencer').length,
    semValidade: alertas.filter((a) => a.situacao === 'semValidade').length,
  };
}

/** Lê (READ ONLY) e grava (SGH_) o retrato do dia num estabelecimento. `hoje`: o relógio injetado nos testes. */
export async function retratoDoEstabelecimento(
  nucleo: NucleoConselho,
  cod: string,
  hoje: string | null = null,
): Promise<ConselhoDiaSgh> {
  const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'pessoas-conselho' };
  const lido = await nucleo.lerSomente(ctx, async (l) => {
    const dia = hoje ?? (await relogioRecepcao(l)).hoje;
    const regs = await registrosDosColaboradoresAtivos(l, cod);
    const hab = await habilitacoesPesSgh(
      l,
      cod,
      regs.map((r) => r.registro),
    );
    const valores = await lerValoresParametro(l, cod);
    return { dia, regs, hab, valores };
  });
  const def = definicaoParametro('pessoas.alertaConselhoDias');
  const v = def
    ? valorTipado(
        def,
        resolverParametro(
          def,
          lido.valores,
          { rede: nucleo.rede, empresa: null, estabelecimento: cod, unidade: null, perfis: [], usuario: '' },
          new Date(),
        ).valor,
      )
    : null;
  const janelaDias = typeof v === 'number' && v > 0 ? v : JANELA_ALERTA_CONSELHO_DIAS;
  const retrato: ConselhoDiaSgh = {
    hospital: cod,
    dia: lido.dia,
    janelaDias,
    ...contarAlertas(
      lido.regs.map((r) => {
        const h = lido.hab.get(r.registro);
        const vale = h && h.numero === r.numero && (h.conselho ?? null) === (r.conselho ?? null);
        return {
          registro: r.registro,
          profissional: r.profissional,
          ativo: r.ativo,
          validade: vale ? h.validade : null,
        };
      }),
      lido.dia,
      janelaDias,
    ),
  };
  await nucleo.gravarSgh(ctx, (e) => gravarConselhoDiaPesSgh(somenteSgh(e), retrato));
  return retrato;
}

@Injectable()
export class PessoasConselhoService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoConselho | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  /** Teste: o núcleo sem subir o driver. */
  usar(nucleo: NucleoConselho): void {
    this.nucleo = nucleo;
  }

  onApplicationBootstrap(): void {
    if (!retratoConselhoLigado(process.env)) return;
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
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'retrato diário do conselho não subiu');
    }
  }

  async ciclo(hoje: string | null = null): Promise<ConselhoDiaSgh[]> {
    if (this.rodando || !this.nucleo) return [];
    this.rodando = true;
    const r: ConselhoDiaSgh[] = [];
    try {
      for (const cod of lerCodigos(process.env)) {
        try {
          const x = await retratoDoEstabelecimento(this.nucleo, cod, hoje);
          r.push(x);
          logger.info(
            {
              estabelecimento: cod,
              registros: x.registros,
              vencidos: x.vencidos,
              aVencer: x.aVencer,
              semValidade: x.semValidade,
            },
            'retrato do conselho',
          );
        } catch (e) {
          logger.warn(
            { estabelecimento: cod, erro: e instanceof Error ? e.name : 'erro' },
            'retrato do conselho falhou',
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
