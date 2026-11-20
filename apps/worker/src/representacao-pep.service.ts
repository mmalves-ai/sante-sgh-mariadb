// pep.registrarRepresentacao (ficha do M15, seção 5; só SGH_, no worker): de tempos em tempos
// (PEP_REPRESENTACAO_MS, padrão 1 h), por estabelecimento, confere o selo barato de cada modelo de formulário do
// legado (contagens e maiores IDs dos vínculos e componentes); quando o layout mudou no Delphi (selo sem
// representação gravada), lê a definição (transação curta READ ONLY), converte pelo parser DFM do M09 e grava a
// representação em SGH_PEP_FORM_VERSAO (transação só SGH_). O prontuário ao vivo usa a gravada do selo e, sem
// ela, converte na hora. Ligado fora de dev/ci; em dev/ci só com PEP_REPRESENTACAO=ligado (a cópia é
// compartilhada). Log só com contagens.
import { resolve } from 'node:path';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { converterModelo } from '@sgh/dominio-pep';
import {
  lerCodigos,
  lerConfiguracaoNucleo,
  lerDefinicaoFormulario,
  lerInteiroAmbiente,
  lerRepresentacaoGravada,
  listarModelosFormulario,
  NucleoLegado,
  registrarRepresentacao,
  seloDoModelo,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { logger } from './logger.js';

export function representacaoLigada(env: NodeJS.ProcessEnv): boolean {
  const pedido = (env['PEP_REPRESENTACAO'] ?? '').trim();
  if (pedido === 'desligado') return false;
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' ? pedido === 'ligado' : true;
}

export type NucleoRepresentacao = Pick<NucleoLegado, 'lerSomente' | 'gravarSgh' | 'rede' | 'encerrar'>;

export interface ResultadoRepresentacao {
  readonly modelos: number;
  readonly gravadas: number;
  readonly iguais: number;
  readonly falhas: number;
}

/** Um ciclo num estabelecimento: grava a representação dos modelos cujo selo ainda não tem uma. */
export async function atualizarRepresentacoes(
  nucleo: NucleoRepresentacao,
  cod: string,
): Promise<ResultadoRepresentacao> {
  const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'pep-representacao' };
  const modelos = await nucleo.lerSomente(ctx, (l) => listarModelosFormulario(l));
  let gravadas = 0;
  let iguais = 0;
  let falhas = 0;
  for (const m of modelos) {
    try {
      const pendente = await nucleo.lerSomente(ctx, async (l) => {
        const selo = await seloDoModelo(l, m.id);
        if (await lerRepresentacaoGravada(l, cod, m.id, selo)) return null;
        return { selo, definicao: await lerDefinicaoFormulario(l, m) };
      });
      if (!pendente) {
        iguais++;
        continue;
      }
      const rep = await converterModelo(pendente.definicao);
      const versao = pendente.definicao.versoes.reduce((a, v) => Math.max(a, v.versao), 0);
      const r = await nucleo.gravarSgh(ctx, (e) =>
        registrarRepresentacao(e, {
          hospital: cod,
          modelo: m.id,
          codigo: m.codigo,
          versaoLayout: versao > 0 ? versao : null,
          selo: pendente.selo,
          impressao: rep.impressaoLayout,
          origem: 'DFM',
          representacao: rep,
        }),
      );
      if (r.gravou) gravadas++;
      else iguais++;
    } catch {
      falhas++;
    }
  }
  return { modelos: modelos.length, gravadas, iguais, falhas };
}

@Injectable()
export class RepresentacaoPepService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoRepresentacao | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  /** Teste: o núcleo sem subir o driver. */
  usar(nucleo: NucleoRepresentacao): void {
    this.nucleo = nucleo;
  }

  onApplicationBootstrap(): void {
    if (!representacaoLigada(process.env)) return;
    try {
      const intervalo = lerInteiroAmbiente(
        process.env,
        'PEP_REPRESENTACAO_MS',
        3_600_000,
        60_000,
        86_400_000,
      );
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
      this.temporizador = setInterval(() => void this.ciclo(), intervalo);
      this.temporizador.unref();
      setTimeout(() => void this.ciclo(), 30_000).unref();
    } catch (e) {
      logger.error(
        { erro: e instanceof Error ? e.message : 'erro' },
        'representação dos formulários não subiu',
      );
    }
  }

  async ciclo(): Promise<void> {
    if (this.rodando || !this.nucleo) return;
    this.rodando = true;
    try {
      for (const cod of lerCodigos(process.env)) {
        try {
          const r = await atualizarRepresentacoes(this.nucleo, cod);
          if (r.gravadas > 0 || r.falhas > 0)
            logger.info({ estabelecimento: cod, ...r }, 'representação dos formulários');
        } catch (e) {
          logger.warn(
            { estabelecimento: cod, erro: e instanceof Error ? e.name : 'erro' },
            'representação: ciclo falhou',
          );
        }
      }
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar().catch(() => undefined);
  }
}
