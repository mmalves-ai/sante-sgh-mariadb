// Geração automática da lista de trabalho de imagem no `worker` (M47, etapa 3; ficha, regra 8: "todo exame de imagem
// lançado gera um item da lista de trabalho"; lote F2.2 05-16): a cada minuto, por cliente e estabelecimento com a
// chave `imagem.worklist` valendo para o estabelecimento inteiro, lê os exames de imagem pedidos na janela do parâmetro
// `pacs.janelaDias` que ainda não têm item e cria cada item numa operação própria (Executor): o item com o número de
// acesso, o evento da fila comum (`imagem.mwl`, entregue pelas integrações do M34) e a trilha, juntos. Dois
// consumidores: a chave de idempotência do exame e a trava do exame fazem o segundo desistir sem duplicar. Ligado fora
// de dev/ci; em dev/ci só com PACS_WORKLIST=ligado. Log só com contagens.
// Melhoria: a modalidade vem do cadastro do exame (exame.modalidade_imagem_id), sem tabela de códigos de setor; o exame
// sem modalidade ou com modalidade inativa vira item 'sem_modalidade' (tela de pendências), contado em semModalidade, e
// é promovido a 'a_enviar' quando o cadastro ganha a modalidade.
// Melhoria: a falha de um exame não para o estabelecimento: cada exame é isolado e contado em falhas (log só com contagem).
// Melhoria: só entra o exame de serviço de imagem (exame.tipo_servico), ainda não realizado (solicitado, autorizado ou agendado) e não cancelado.
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { modalidadeDoExame } from '@sgh/dominio-sadt';
import { NucleoProprio } from '@sgh/nucleo';
import { clientesDoWorker, codigosDosEstabelecimentos } from './clientes-worker.js';
import { logger } from './logger.js';
import { type ExameSemItem, PortaWorklistPropria, type PortaWorklist } from './pacs-worklist-propria.js';

/** Teto por ciclo e estabelecimento (ficha, seção 4: 500). */
export const TETO_CICLO_PACS = 500;
export const JANELA_PADRAO_PACS = 2;

export function geracaoPacsLigada(env: NodeJS.ProcessEnv): boolean {
  const pedido = (env['PACS_WORKLIST'] ?? '').trim();
  if (pedido === 'desligado' || (env['PACS_MODO'] ?? '').trim() === 'desligado') return false;
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' ? pedido === 'ligado' : true;
}

export interface ResultadoCicloPacs {
  readonly situacao: 'desligado' | 'feito';
  readonly pendentes: number;
  readonly criados: number;
  readonly semModalidade: number;
  /** Exames que falharam neste ciclo (os demais seguem; voltam no próximo ciclo). */
  readonly falhas: number;
  readonly cortada: boolean;
}

/** A janela de dias do parâmetro, entre 1 e 30 (fora disso ou ausente: 2). */
export function janelaPacs(v: number | null): number {
  return v !== null && Number.isInteger(v) && v >= 1 && v <= 30 ? v : JANELA_PADRAO_PACS;
}

/** A modalidade do item: a do cadastro do exame, quando ativa (regra do domínio). */
export function modalidadeDoItem(x: ExameSemItem): { id: number; sigla: string } | null {
  if (!x.modalidade || !x.modalidade.ativa) return null;
  const m = modalidadeDoExame({ ato: 0, modalidadeCadastro: x.modalidade }, new Map(), [x.modalidade]);
  return m && m.id !== null ? { id: m.id, sigla: m.sigla } : null;
}

/** Um ciclo num estabelecimento: com a chave valendo no estabelecimento, cria os itens que faltam na janela. */
export async function cicloWorklist(
  porta: PortaWorklist,
  cod: string,
  agora: Date = new Date(),
): Promise<ResultadoCicloPacs> {
  const nada = { pendentes: 0, criados: 0, semModalidade: 0, falhas: 0, cortada: false };
  if (!(await porta.ligada(cod, agora))) return { situacao: 'desligado', ...nada };
  const janela = janelaPacs(await porta.janelaDias(cod, agora));
  const desde = new Date(agora.getTime() - janela * 86_400_000);
  const lidos = await porta.examesSemItem(cod, desde, agora, TETO_CICLO_PACS);
  let criados = 0;
  let semModalidade = 0;
  let falhas = 0;
  for (const x of lidos.itens) {
    const mod = modalidadeDoItem(x);
    // O item 'sem_modalidade' do exame já existe e o cadastro ainda não tem modalidade ativa: nada a fazer.
    if (!mod && x.itemPendente !== null) continue;
    try {
      // null: outro consumidor criou o item deste exame (ou está criando): ele segue; este desiste sem duplicar.
      const r = await porta.registrarItem(cod, x, mod);
      if (r?.situacao === 'sem_modalidade') semModalidade++;
      else if (r) criados++;
    } catch {
      // Isolado: um exame com problema (cadastro, número de acesso) não impede os demais do estabelecimento.
      falhas++;
    }
  }
  return {
    situacao: 'feito',
    pendentes: lidos.itens.length,
    criados,
    semModalidade,
    falhas,
    cortada: lidos.cortada,
  };
}

/** O que o serviço usa do núcleo (os testes trocam). */
export interface NucleoPacs {
  lerPlataforma: NucleoProprio['lerPlataforma'];
  lerSomente: NucleoProprio['lerSomente'];
  encerrar(): Promise<void>;
}

export type FabricaPortaWorklist = (cliente: string) => PortaWorklist;

@Injectable()
export class PacsWorklistService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoPacs | null = null;
  private fabrica: FabricaPortaWorklist | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  /** Teste: o núcleo e a porta sem subir o banco. */
  usar(nucleo: NucleoPacs, fabrica: FabricaPortaWorklist): void {
    this.nucleo = nucleo;
    this.fabrica = fabrica;
  }

  onApplicationBootstrap(): void {
    if (!geracaoPacsLigada(process.env)) return;
    try {
      const nucleo = new NucleoProprio({ env: process.env });
      this.usar(nucleo, (cliente) => new PortaWorklistPropria(nucleo, cliente));
      this.temporizador = setInterval(() => void this.ciclo(), 60_000);
      this.temporizador.unref();
    } catch (e) {
      logger.error(
        { erro: e instanceof Error ? e.message : 'erro' },
        'lista de trabalho de imagem não subiu',
      );
    }
  }

  async ciclo(
    agora: Date = new Date(),
  ): Promise<{ cliente: string; estabelecimento: string; criados: number }[]> {
    const nucleo = this.nucleo;
    const fabrica = this.fabrica;
    if (this.rodando || !nucleo || !fabrica) return [];
    this.rodando = true;
    const r: { cliente: string; estabelecimento: string; criados: number }[] = [];
    try {
      for (const cliente of await clientesDoWorker(nucleo, process.env, 'pacs-worklist')) {
        const porta = fabrica(cliente);
        let ests: string[] = [];
        try {
          ests = await nucleo.lerSomente(
            { cliente, correlacao: 'pacs-worklist' },
            codigosDosEstabelecimentos,
          );
        } catch (e) {
          logger.warn(
            { cliente, erro: e instanceof Error ? e.name : 'erro' },
            'lista de trabalho: cliente indisponível',
          );
        }
        for (const cod of ests) {
          try {
            const x = await cicloWorklist(porta, cod, agora);
            r.push({ cliente, estabelecimento: cod, criados: x.criados });
            if (x.criados > 0 || x.cortada || x.semModalidade > 0 || x.falhas > 0)
              logger[x.falhas > 0 ? 'warn' : 'info'](
                {
                  cliente,
                  estabelecimento: cod,
                  criados: x.criados,
                  semModalidade: x.semModalidade,
                  falhas: x.falhas,
                  cortada: x.cortada,
                },
                'lista de trabalho de imagem: itens criados',
              );
          } catch (e) {
            logger.warn(
              { cliente, estabelecimento: cod, erro: e instanceof Error ? e.name : 'erro' },
              'lista de trabalho de imagem: ciclo falhou',
            );
          }
        }
      }
    } catch (e) {
      logger.warn(
        { erro: e instanceof Error ? e.name : 'erro' },
        'lista de trabalho de imagem: clientes indisponíveis',
      );
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
