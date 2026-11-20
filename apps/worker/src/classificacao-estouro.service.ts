// Estouro do tempo-alvo da classificação de risco no `worker` (M44, etapa 1; ficha, regra 4): a cada minuto, por
// estabelecimento com a chave `pa.classificacao` ligada, lê os atendimentos abertos do PA (as marcas reais de
// SGH_PA_ETAPA) e as classificações (SGH_PA_CLASSIFICACAO) numa transação curta READ ONLY; a classificação vigente que
// passou do prazo sem o atendimento médico iniciado recebe UM aviso (SGH_PA_CLASSIF_AVISO, chave única) com o evento
// `recepcao.classificacao.estourada` na SGH_TRILHA, numa transação SGH_ por aviso. Com dois consumidores, a chave única
// (ou a trava da linha em gravação na outra transação) faz o segundo desistir sem erro: nunca aviso duplicado. A
// reclassificação obrigatória aparece na hora nas telas (o quadro e a fila calculam do relógio); o aviso é o registro
// do estouro para os indicadores e a auditoria. O relógio é injetado (testes). Ligado fora de dev/ci; em dev/ci só com
// CLASSIFICACAO_ESTOURO=ligado (a cópia é compartilhada). Log só com contagens.
import { resolve } from 'node:path';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CHAVE_LIBERACAO_CLASSIFICACAO, EVENTOS_AUDITAVEIS, type CorRisco } from '@sgh/contratos';
import {
  chaveAvisoEstouro,
  type ClassificacaoVigente,
  classificacaoVigente,
  reclassificacaoObrigatoria,
} from '@sgh/dominio-recepcao';
import {
  atendimentosPaAbertos,
  avisosJaGravados,
  classificacoesDosAtendimentos,
  gravarTrilha,
  lerChavesLiberacao,
  lerCodigos,
  lerConfiguracaoNucleo,
  NucleoLegado,
  registrarAvisoEstouro,
  relogioRecepcao,
  somenteSgh,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { logger } from './logger.js';

export const USUARIO_ESTOURO = 'SGH.CLASSIFICACAO';

export function estouroLigado(env: NodeJS.ProcessEnv): boolean {
  const pedido = (env['CLASSIFICACAO_ESTOURO'] ?? '').trim();
  if (pedido === 'desligado') return false;
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' ? pedido === 'ligado' : true;
}

export type NucleoEstouro = Pick<NucleoLegado, 'lerSomente' | 'gravarSgh' | 'rede' | 'encerrar'>;

export interface EstouroPendente {
  readonly chave: string;
  readonly classificacao: number;
  readonly reg: number;
  readonly prazoEm: string;
  readonly cor: CorRisco;
}

const ms = (iso: string) => Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);

/** Os estourados ainda não avisados (só leitura). `agora`: o relógio injetado (hora local, sem fuso) ou o do banco. */
export async function estourosPendentes(
  nucleo: NucleoEstouro,
  cod: string,
  agora: string | null = null,
): Promise<{ ligada: boolean; agora: string; pendentes: EstouroPendente[] }> {
  const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'classificacao-estouro' };
  return nucleo.lerSomente(ctx, async (l) => {
    const chaves = await lerChavesLiberacao(l, cod);
    const ligada = chaves.some(
      (c) => c.chave === CHAVE_LIBERACAO_CLASSIFICACAO && c.tipo === 'recurso' && c.ligada === true,
    );
    const rel = await relogioRecepcao(l);
    const instante = agora ?? rel.agora;
    if (!ligada) return { ligada, agora: instante, pendentes: [] };
    const abertos = (await atendimentosPaAbertos(l, cod, { hoje: instante.slice(0, 10) })).itens.filter(
      (a) => a.saida === null && !a.marcas.some((m) => m.etapa === 'decisao' || m.etapa === 'saida'),
    );
    const linhas = await classificacoesDosAtendimentos(
      l,
      cod,
      abertos.map((a) => a.cabecalho),
    );
    const r: EstouroPendente[] = [];
    for (const a of abertos) {
      const v = classificacaoVigente(
        linhas
          .filter((x) => x.cabecalho === a.cabecalho)
          .map((x): ClassificacaoVigente => ({
            id: x.id,
            cor: x.corFinal as CorRisco,
            classificadoEm: x.em,
            tempoAlvoMin: x.tempoAlvoMin,
            motivo: x.motivo,
          })),
      );
      const medico = a.marcas.find((m) => m.etapa === 'atendimentoMedico')?.em ?? null;
      if (!v || !reclassificacaoObrigatoria(v, instante, medico)) continue;
      r.push({
        chave: chaveAvisoEstouro(cod, v.id),
        classificacao: v.id,
        reg: a.reg,
        prazoEm: new Date(ms(v.classificadoEm) + v.tempoAlvoMin * 60_000).toISOString(),
        cor: v.cor,
      });
    }
    const ja = await avisosJaGravados(
      l,
      r.map((x) => x.chave),
    );
    return { ligada, agora: instante, pendentes: r.filter((x) => !ja.has(x.chave)) };
  });
}

/** Grava UM aviso com a trilha (false: outro consumidor avisou antes ou está avisando agora). */
export async function avisarEstouro(
  nucleo: NucleoEstouro,
  cod: string,
  p: EstouroPendente,
): Promise<boolean> {
  const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'classificacao-estouro' };
  return nucleo.gravarSgh(ctx, async (e0) => {
    const e = somenteSgh(e0);
    const gravou = await registrarAvisoEstouro(e, {
      hospital: cod,
      chave: p.chave,
      classificacao: p.classificacao,
      reg: p.reg,
      prazoEm: p.prazoEm,
    });
    if (gravou)
      await gravarTrilha(e, {
        rede: nucleo.rede,
        hospital: cod,
        usuario: USUARIO_ESTOURO,
        evento: EVENTOS_AUDITAVEIS.classificacaoEstourada.codigo,
        recurso: 'recepcao.classificacao',
        operacao: 'recepcao.avisarEstouro',
        tabelaAlvo: 'SGH_PA_CLASSIF_AVISO',
        idAlvo: String(p.classificacao),
        chaveNaturalAlvo: `${p.reg}:${p.cor}`,
        resultado: 'sucesso',
        estacao: 'SGH-WORKER:classificacao',
        correlacao: p.chave.slice(0, 64),
        origem: 'SGH-WORKER:classificacao',
      });
    return gravou;
  });
}

/** Um ciclo num estabelecimento: os avisos gravados por este consumidor. */
export async function cicloEstouro(
  nucleo: NucleoEstouro,
  cod: string,
  agora: string | null = null,
): Promise<{ ligada: boolean; pendentes: number; avisados: number }> {
  const p = await estourosPendentes(nucleo, cod, agora);
  let avisados = 0;
  for (const x of p.pendentes) if (await avisarEstouro(nucleo, cod, x)) avisados++;
  return { ligada: p.ligada, pendentes: p.pendentes.length, avisados };
}

@Injectable()
export class ClassificacaoEstouroService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoEstouro | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  /** Teste: o núcleo sem subir o driver. */
  usar(nucleo: NucleoEstouro): void {
    this.nucleo = nucleo;
  }

  onApplicationBootstrap(): void {
    if (!estouroLigado(process.env)) return;
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
        'aviso de estouro da classificação não subiu',
      );
    }
  }

  async ciclo(agora: string | null = null): Promise<{ estabelecimento: string; avisados: number }[]> {
    if (this.rodando || !this.nucleo) return [];
    this.rodando = true;
    const r: { estabelecimento: string; avisados: number }[] = [];
    try {
      for (const cod of lerCodigos(process.env)) {
        try {
          const x = await cicloEstouro(this.nucleo, cod, agora);
          r.push({ estabelecimento: cod, avisados: x.avisados });
          if (x.avisados > 0)
            logger.info({ estabelecimento: cod, avisados: x.avisados }, 'estouros avisados');
        } catch (e) {
          logger.warn(
            { estabelecimento: cod, erro: e instanceof Error ? e.name : 'erro' },
            'aviso de estouro falhou',
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
