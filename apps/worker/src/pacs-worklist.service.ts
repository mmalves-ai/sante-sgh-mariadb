// Geração automática da lista de trabalho DICOM no `worker` (M47, etapa 3; ficha, regra 8: "todo exame de imagem
// lançado de setor com modalidade DICOM gera um item da MWL"): a cada minuto, por estabelecimento com a chave
// `imagem.worklist` ligada para o estabelecimento inteiro, lê (READ ONLY) os exames de imagem lançados na janela do
// parâmetro `pacs.janelaDias` que ainda não têm item — também os lançados pelo outro sistema durante a coexistência — e
// cria cada item numa transação SGH_ própria: o item com o número de acesso, o evento da SGH_OUTBOX e a SGH_TRILHA
// juntos (a entrega segue pelas integrações novas do M34). Dois consumidores: a chave única do exame faz o segundo
// desistir sem duplicar. Ligado fora de dev/ci; em dev/ci só com PACS_WORKLIST=ligado (a cópia é compartilhada). Log só
// com contagens.
import { resolve } from 'node:path';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { definicaoParametro, EVENTOS_AUDITAVEIS, SETORES_SADT } from '@sgh/contratos';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import {
  accessionDoItem,
  chaveIdempotenciaMwl,
  chaveNaturalExame,
  lerModalidadePorSetor,
  modalidadeDoExame,
} from '@sgh/dominio-sadt';
import {
  ErroOperacao,
  examesImagemSemItem,
  examesSadtPorId,
  gravarTrilha,
  lerChavesLiberacao,
  lerCodigos,
  lerConfiguracaoNucleo,
  lerPrerequisitos,
  lerValoresParametro,
  modalidadeDoCadastroDosExames,
  modalidadesDicom,
  NucleoLegado,
  registrarItemMwlSgh,
  relogioRecepcao,
  somenteSgh,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { worklistLigada } from './integracao/liberacao-worklist.js';
import { logger } from './logger.js';

export const USUARIO_PACS = 'SGH.PACS';
const ATOS_IMAGEM: readonly number[] = SETORES_SADT.find((s) => s.codigo === 'imagem')!.atos;
const PADRAO_MODALIDADES = '16:CR;24:US;25:CT;26:MR;27:US;42:OT';
/** Teto por ciclo e estabelecimento (ficha, seção 4: 500). */
export const TETO_CICLO_PACS = 500;

export function geracaoPacsLigada(env: NodeJS.ProcessEnv): boolean {
  const pedido = (env['PACS_WORKLIST'] ?? '').trim();
  if (pedido === 'desligado' || (env['PACS_MODO'] ?? '').trim() === 'desligado') return false;
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' ? pedido === 'ligado' : true;
}

export type NucleoPacs = Pick<NucleoLegado, 'lerSomente' | 'gravarSgh' | 'rede' | 'encerrar'>;

const diaMenos = (dia: string, n: number) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

export interface ResultadoCicloPacs {
  readonly situacao: 'desligado' | 'feito';
  readonly pendentes: number;
  readonly criados: number;
  readonly semModalidade: number;
  readonly cortada: boolean;
}

/** Um ciclo num estabelecimento: com a chave valendo no estabelecimento, cria os itens que faltam na janela. */
export async function cicloWorklist(
  nucleo: NucleoPacs,
  cod: string,
  agora: Date = new Date(),
): Promise<ResultadoCicloPacs> {
  const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'pacs-worklist' };
  const cfg = await nucleo.lerSomente(ctx, async (l) => ({
    chaves: await lerChavesLiberacao(l, cod),
    prerequisitos: await lerPrerequisitos(l, cod),
    valores: await lerValoresParametro(l, cod),
    hoje: (await relogioRecepcao(l)).hoje,
  }));
  const nada = { pendentes: 0, criados: 0, semModalidade: 0, cortada: false };
  if (!worklistLigada(cfg.chaves, cfg.prerequisitos, agora)) return { situacao: 'desligado', ...nada };
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
    return def ? valorTipado(def, resolverParametro(def, cfg.valores, sujeito, agora).valor) : null;
  };
  const porSetor = lerModalidadePorSetor(String(ler('pacs.modalidadePorSetor') ?? PADRAO_MODALIDADES));
  const janela = Math.max(1, Math.min(30, Number(ler('pacs.janelaDias') ?? 2) || 2));
  const atos = ATOS_IMAGEM.filter((a) => porSetor.has(a));
  const lidos = await nucleo.lerSomente(ctx, async (l) => {
    const p = await examesImagemSemItem(l, cod, {
      desde: diaMenos(cfg.hoje, janela - 1),
      ate: cfg.hoje,
      atos: atos.length > 0 ? atos : ATOS_IMAGEM,
      teto: TETO_CICLO_PACS,
    });
    const ids = p.itens.map((x) => x.exame);
    return {
      ...p,
      exames: await examesSadtPorId(l, cod, ids),
      cadastro: await modalidadeDoCadastroDosExames(l, ids),
      modalidades: await modalidadesDicom(l),
    };
  });
  let criados = 0;
  let semModalidade = 0;
  for (const x of lidos.exames) {
    const mod = modalidadeDoExame(
      { ato: x.ato, modalidadeCadastro: lidos.cadastro.get(x.id) ?? null },
      porSetor,
      lidos.modalidades,
    );
    if (!mod) {
      semModalidade++;
      continue;
    }
    try {
      await nucleo.gravarSgh(ctx, async (e0) => {
        const e = somenteSgh(e0);
        const r = await registrarItemMwlSgh(e, {
          hospital: cod,
          rede: nucleo.rede,
          exame: x.id,
          paciente: x.paciente.id,
          chaveNatural: chaveNaturalExame(x.chave),
          ato: x.ato,
          modalidade: mod,
          accession: (id) => accessionDoItem(cod, id),
          chaveIdempotencia: chaveIdempotenciaMwl(cod, x.id),
          origem: 'automatico',
          por: USUARIO_PACS,
        });
        await gravarTrilha(e, {
          rede: nucleo.rede,
          hospital: cod,
          usuario: USUARIO_PACS,
          evento: EVENTOS_AUDITAVEIS.mwlEnviada.codigo,
          recurso: 'sadt.pacs',
          operacao: 'sadt.enviarWorklist',
          tabelaAlvo: 'SGH_SADT_PACS_MWL',
          idAlvo: String(r.id),
          chaveNaturalAlvo: `${r.accession}:${mod.sigla}:1`,
          resultado: 'sucesso',
          estacao: 'SGH-WORKER:pacs',
          correlacao: `pacs-${cod}-${x.id}`.slice(0, 64),
          origem: 'SGH-WORKER:pacs',
          idPaciente: x.paciente.id,
        });
      });
      criados++;
    } catch (erro) {
      // Outro consumidor criou o item deste exame (ou está criando): ele segue; este desiste sem duplicar.
      if (erro instanceof ErroOperacao && erro.problema.codigo === 'ja-na-worklist') continue;
      throw erro;
    }
  }
  return { situacao: 'feito', pendentes: lidos.itens.length, criados, semModalidade, cortada: lidos.cortada };
}

@Injectable()
export class PacsWorklistService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoPacs | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  /** Teste: o núcleo sem subir o driver. */
  usar(nucleo: NucleoPacs): void {
    this.nucleo = nucleo;
  }

  onApplicationBootstrap(): void {
    if (!geracaoPacsLigada(process.env)) return;
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
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'lista de trabalho DICOM não subiu');
    }
  }

  async ciclo(agora: Date = new Date()): Promise<{ estabelecimento: string; criados: number }[]> {
    if (this.rodando || !this.nucleo) return [];
    this.rodando = true;
    const r: { estabelecimento: string; criados: number }[] = [];
    try {
      for (const cod of lerCodigos(process.env)) {
        try {
          const x = await cicloWorklist(this.nucleo, cod, agora);
          r.push({ estabelecimento: cod, criados: x.criados });
          if (x.criados > 0 || x.cortada)
            logger.info(
              {
                estabelecimento: cod,
                criados: x.criados,
                semModalidade: x.semModalidade,
                cortada: x.cortada,
              },
              'lista de trabalho DICOM: itens criados',
            );
        } catch (e) {
          logger.warn(
            { estabelecimento: cod, erro: e instanceof Error ? e.name : 'erro' },
            'lista de trabalho DICOM: ciclo falhou',
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
