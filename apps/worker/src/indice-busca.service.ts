// Leitura incremental do índice de busca do cadastro (ficha do M11, seção 4): a cada BUSCA_VIGIA_MS (padrão
// 5 s), por estabelecimento configurado, o que nasceu ou mudou no SPDATA (retratos HTPACIENTE e HTPROFIS, com a
// janela atrás da marca para os commits fora de ordem; solicitantes novos e a varredura que pega a troca de
// nome) entra em SGH_BUSCA_NOME (meta: em até 10 s na busca por nome). Os pacientes reindexados vão à fila de
// duplicidades pela regra pura do escore (regra 6: "cadastros novos feitos no SPDATA entram pela leitura
// incremental"). A cada BUSCA_CONFERENCIA_MS (padrão 1 h), a conferência por contagem (índice × tabela) vai
// ao log quando diverge. Ligado fora de dev/ci; em dev/ci só com BUSCA_VIGIA=ligado (a cópia é compartilhada:
// a carga inicial é `pnpm cadastro:indexar`, sob a trava). Log só com contagens.
import { resolve } from 'node:path';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { entraNaFila, escoreDuplicidade } from '@sgh/dominio-cadastro';
import {
  type AvaliarPar,
  ENTIDADES_BUSCA_LEGADO,
  lerCodigos,
  lerConfiguracaoNucleo,
  lerInteiroAmbiente,
  NucleoLegado,
  type PacienteLido,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { logger } from './logger.js';

/** O vigia roda? Fora de dev/ci, sempre (salvo BUSCA_VIGIA=desligado); em dev/ci, só com BUSCA_VIGIA=ligado. */
export function vigiaLigado(env: NodeJS.ProcessEnv): boolean {
  const pedido = (env['BUSCA_VIGIA'] ?? '').trim();
  if (pedido === 'desligado') return false;
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' ? pedido === 'ligado' : true;
}

const comparavel = (p: PacienteLido) => ({
  id: p.id,
  nome: p.nome,
  nascimento: p.nascimento,
  mae: p.mae,
  cpf: p.cpf,
  telefones: [p.telefone, p.celular],
});

/** A regra pura do escore (a mesma do "Atualizar a fila" da API): null fica fora da fila. */
export const avaliarPar: AvaliarPar = (a, b) => {
  const e = escoreDuplicidade(comparavel(a), comparavel(b));
  return entraNaFila(e) ? { escore: e.escore, criterios: e.criterios } : null;
};

/** O que o worker precisa do núcleo (o teste usa um dublê). */
export type NucleoVigia = Pick<
  NucleoLegado,
  'cicloIndiceBusca' | 'alimentarFilaDuplicidade' | 'contagemIndiceBusca' | 'encerrar'
>;

@Injectable()
export class IndiceBuscaService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoVigia | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;
  private conferenciaMs = 3_600_000;
  private ultimaConferencia = 0;

  /** Teste: o núcleo e o intervalo da conferência sem subir o driver. */
  usar(nucleo: NucleoVigia, conferenciaMs = 3_600_000): void {
    this.nucleo = nucleo;
    this.conferenciaMs = conferenciaMs;
  }

  onApplicationBootstrap(): void {
    if (!vigiaLigado(process.env)) return;
    try {
      const intervalo = lerInteiroAmbiente(process.env, 'BUSCA_VIGIA_MS', 5_000, 1_000, 600_000);
      this.conferenciaMs = lerInteiroAmbiente(
        process.env,
        'BUSCA_CONFERENCIA_MS',
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
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'vigia do índice de busca não subiu');
    }
  }

  async ciclo(): Promise<void> {
    if (this.rodando || !this.nucleo) return;
    this.rodando = true;
    try {
      for (const cod of lerCodigos(process.env)) {
        try {
          const rs = await this.nucleo.cicloIndiceBusca(cod);
          for (const r of rs)
            if (r.lidos > 0 || r.reparados > 0)
              logger.info(
                {
                  estabelecimento: cod,
                  entidade: r.entidade,
                  lidos: r.lidos,
                  indexados: r.indexados,
                  atrasados: r.atrasados,
                  reparados: r.reparados,
                  marca: r.marca,
                },
                'vigia do índice de busca',
              );
          const pacientes = rs.find((r) => r.entidade === 'paciente')?.ids ?? [];
          if (pacientes.length > 0) {
            const novos = await this.nucleo.alimentarFilaDuplicidade(cod, pacientes, avaliarPar);
            if (novos > 0) logger.info({ estabelecimento: cod, novos }, 'fila de duplicidades: pares novos');
          }
        } catch (e) {
          logger.warn(
            { estabelecimento: cod, erro: e instanceof Error ? e.name : 'erro' },
            'vigia do índice de busca: ciclo falhou',
          );
        }
      }
      await this.conferir();
    } finally {
      this.rodando = false;
    }
  }

  /** Conferência por contagem (entidades no índice × linhas da tabela), no máximo uma vez por intervalo. */
  private async conferir(): Promise<void> {
    if (!this.nucleo || Date.now() - this.ultimaConferencia < this.conferenciaMs) return;
    this.ultimaConferencia = Date.now();
    for (const cod of lerCodigos(process.env))
      for (const entidade of ENTIDADES_BUSCA_LEGADO) {
        try {
          const c = await this.nucleo.contagemIndiceBusca(cod, entidade);
          if (c.indice !== c.legado)
            logger.warn(
              { estabelecimento: cod, entidade, indice: c.indice, legado: c.legado },
              'índice de busca diverge da tabela: rode pnpm cadastro:indexar',
            );
        } catch (e) {
          logger.warn(
            { estabelecimento: cod, entidade, erro: e instanceof Error ? e.name : 'erro' },
            'conferência do índice de busca falhou',
          );
        }
      }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
