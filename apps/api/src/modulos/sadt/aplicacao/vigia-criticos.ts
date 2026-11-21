// Vigia do valor crítico (ficha do M26, regra 7): a cada ciclo, por estabelecimento com a funcionalidade ligada, os
// exames do laboratório liberados depois do último instante visto que têm faixa crítica cadastrada e ainda não têm
// aviso (a liberação pela tela já avisa na mesma transação; a vigia cobre a autoliberação e o resultado que chega pela
// interface do equipamento ou do apoio — a chave única impede o segundo aviso) e o painel relê pelo canal de eventos.
// No mesmo ciclo, o aviso sem ciência no prazo sobe ao plantonista e depois ao supervisor (nivelDoAviso).
// Nenhum dado de pessoa sai daqui: só contagens no log.
// Pendência (pedido ao 02-09, saida/02-10.json): no banco do cliente a criação do aviso (avisarCriticos) ainda responde
// 409 modelo-pendente. A falha é isolada por exame: o escalonamento dos avisos existentes segue, o cursor não avança
// (o exame volta no ciclo seguinte, sem perda) e cada ciclo registra no log quantos exames ficaram sem aviso e o código.
// Melhoria: a vigia opera no banco do cliente pelo contexto do núcleo (processo automático: sem usuário), e cada aviso
// e escalonamento vai à trilha_auditoria do cliente na mesma transação, com a tabela do modelo (aviso_valor_critico).
import { CHAVES_SADT, EVENTOS_AUDITAVEIS, recursoDesligado } from '@sgh/contratos';
import { Logger } from '@nestjs/common';
import { recursoLigado } from '@sgh/dominio-config';
import { nivelDoAviso } from '@sgh/dominio-sadt';
import { contextoDoEstabelecimento } from '../../cadastro/contexto-nucleo.js';
import type { FonteConfiguracao } from '../../config/public-api.js';
import type { TrilhaDaGravacao } from '../../exames/public-api.js';
import type { ContextoSadt, PortaSadt } from '../porta.js';
import type { Notificador } from './servico.js';
import { TABELA_AVISO, TABELA_EXAME } from './servico.js';
import { avisarCriticoNaCentral, type CentralDeAvisos } from './central-critico.js';

export const USUARIO_VIGIA = 'SGH.VIGIA';
/**
 * Sobreposição da releitura: o COMMIT de uma liberação pode chegar fora de ordem em relação à marca de tempo dela; a
 * consulta só devolve o que ainda não avisou, então reler não repete.
 */
export const MARGEM_VIGIA_MS = 15 * 60_000;
const iso = (d: Date) => d.toISOString();
const doBanco = (t: string) => `${t}Z`;
const somarUmDia = (dia: string, n: number) =>
  new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Resolve o cliente e o id do estabelecimento pelo código (o mapa ativo do núcleo; nos testes, um dublê). */
export type ResolverEstabelecimento = (codigo: string) => { cliente: string; estabelecimento: number | null };

/** Resultado de um ciclo: avisos criados, escalonados e exames que ficaram sem aviso (com o código do erro). */
export interface CicloVigia {
  avisos: number;
  escalonados: number;
  /** Exames críticos que não ganharam aviso neste ciclo (voltam no seguinte). Só presente quando > 0. */
  semAviso?: number;
  /** Escalonamentos que falharam neste ciclo. Só presente quando > 0. */
  semEscalonar?: number;
  /** Códigos dos erros (sem dado de pessoa). */
  codigos?: string[];
}

const codigoDoErro = (e: unknown): string => {
  const p = (e as { problema?: { codigo?: unknown } } | null)?.problema;
  if (p && typeof p.codigo === 'string') return p.codigo.slice(0, 60);
  return e instanceof Error ? e.name.slice(0, 60) : 'erro';
};

/** Contexto do núcleo da vigia no estabelecimento (processo automático: sem usuário). */
const contextoVigia = (
  resolver: ResolverEstabelecimento,
  rede: string,
  hospital: string,
  correlacao: string,
): ContextoSadt => ({
  ...resolver(hospital),
  usuario: null,
  correlacao: correlacao.slice(0, 64),
  rede,
  hospital,
});

/**
 * Linha da trilha de um aviso emitido ou escalonado pela vigia (sem usuário; o paciente vai nos dados). A emissão aponta
 * para o exame (exame_item: o id do aviso só existe depois da gravação); o escalonamento, para o aviso.
 */
function trilhaVigia(
  c: ContextoSadt,
  evento: string,
  operacao: string,
  alvo: { entidade: string; id: number; chave: string; paciente: number | null; correlacao: string },
): TrilhaDaGravacao {
  return {
    estabelecimento: c.estabelecimento,
    usuario: null,
    acao: 'operacao',
    entidade: alvo.entidade,
    entidadeId: alvo.id,
    dadosDepois: {
      evento,
      recurso: CHAVES_SADT.critico,
      operacao,
      chave: alvo.chave,
      ...(alvo.paciente ? { paciente: alvo.paciente } : {}),
      estacao: 'vigia',
    },
    correlacao: alvo.correlacao.slice(0, 64),
  };
}

export class VigiaCriticos {
  private readonly ultimo = new Map<string, Date>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private emCiclo = false;

  constructor(
    private readonly porta: PortaSadt,
    private readonly rede: string,
    private readonly hospitais: readonly string[],
    private readonly configuracao: FonteConfiguracao | null,
    private readonly notificador: Notificador | null,
    private readonly agora: () => Date = () => new Date(),
    private readonly central: CentralDeAvisos | null = null,
    private readonly resolver: ResolverEstabelecimento = contextoDoEstabelecimento,
    private readonly log: Pick<Logger, 'warn'> = new Logger('VigiaCriticos'),
  ) {}

  /** A funcionalidade do valor crítico vale no estabelecimento (escopo do estabelecimento; sem pessoa nem setor). */
  async ligada(hospital: string): Promise<boolean> {
    const f = this.configuracao;
    if (!f) return this.porta.destino === 'memoria';
    try {
      const chaves = (await f.chaves(this.rede, hospital))
        .filter((c) => c.chave === CHAVES_SADT.critico && c.tipo === 'recurso' && c.ligada !== null)
        .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
      const registrados = (await f.prerequisitos(this.rede, hospital)).filter(
        (p) => p.recurso === CHAVES_SADT.critico,
      );
      return recursoLigado(
        chaves,
        recursoDesligado(CHAVES_SADT.critico)?.prerequisitos ?? [],
        registrados,
        { pessoa: USUARIO_VIGIA },
        this.agora(),
      );
    } catch {
      return false;
    }
  }

  /** Um ciclo no estabelecimento: os avisos das liberações vistas e o escalonamento dos sem ciência no prazo. */
  async ciclo(hospital: string): Promise<CicloVigia> {
    if (!(await this.ligada(hospital))) return { avisos: 0, escalonados: 0 };
    const c = contextoVigia(this.resolver, this.rede, hospital, `vigia-${hospital}`);
    const { hoje, agora: agoraBanco } = await this.porta.relogio(c);
    // A janela pelo relógio do BANCO, com sobreposição (MARGEM_VIGIA_MS). Sem cursor (a API acabou de subir), desde o
    // início da véspera: as liberações do tempo em que a API ficou fora não se perdem (o cursor fica em memória; a
    // consulta exclui o que já avisou, então recomeçar não repete aviso).
    const marca = this.ultimo.get(hospital);
    const desde = marca
      ? new Date(marca.getTime() - MARGEM_VIGIA_MS)
      : new Date(Date.parse(doBanco(`${somarUmDia(hoje, -1)}T00:00:00`)));
    const cicloEm = new Date(Date.parse(doBanco(agoraBanco)));
    const vistos = await this.porta.liberadosComCritico(c, { desde, hoje });
    let avisos = 0;
    let semAviso = 0;
    let semEscalonar = 0;
    const codigos = new Set<string>();
    for (const x of vistos) {
      let novos: number;
      try {
        novos = await this.porta.gravarSgh(
          c,
          (n: number) =>
            trilhaVigia(c, EVENTOS_AUDITAVEIS.sadtAvisoCriticoEmitido.codigo, 'vigia do valor crítico', {
              entidade: TABELA_EXAME,
              id: x.exame,
              chave: `${x.chave}|${n}`.slice(0, 120),
              paciente: x.paciente,
              correlacao: `vigia-${hospital}-${x.liberacao}`,
            }),
          (g) =>
            g.avisarCriticos({
              exameItem: x.exame,
              chave: x.chave,
              idLiberacao: x.liberacao,
              liberadoEm: x.liberadoEm,
              paciente: x.paciente,
              atendimento: x.atendimento,
            }),
        );
      } catch (e) {
        // Um exame que não ganhou aviso não trava os outros, o escalonamento nem o ciclo seguinte (cursor parado).
        semAviso++;
        codigos.add(codigoDoErro(e));
        continue;
      }
      avisos += novos;
      // Depois do COMMIT: o médico do atendimento recebe o aviso também na central (liberação sem aviso na transação).
      if (novos > 0)
        await avisarCriticoNaCentral(
          this.central,
          this.porta,
          c,
          {
            login: USUARIO_VIGIA,
            estacao: 'vigia',
            correlacao: `vigia-${hospital}-${x.liberacao}`.slice(0, 64),
          },
          { exame: x.exame, liberacao: x.liberacao, paciente: x.paciente, atendimento: x.atendimento },
        );
    }
    // O cursor é o relógio do banco no início do ciclo (não o maior instante visto, que pode vir adiantado da estação).
    // Com exame sem aviso, o cursor fica onde estava: a próxima leitura o devolve (a consulta exclui o que já avisou).
    if (semAviso === 0) this.ultimo.set(hospital, cicloEm);
    let escalonados = 0;
    // O escalonamento pelo relógio do BANCO, o mesmo do emitidoEm e do prazoEm (hora local, sem fuso). Com o relógio do
    // processo, num servidor fora de UTC a hora local lida como UTC adiantava o prazo (W0-10, 11d2b: o aviso subia ao
    // supervisor no primeiro ciclo).
    const agora = cicloEm;
    const inicio = somarUmDia(hoje, -2);
    for (const a of await this.porta.avisos(c, { inicio, fim: hoje, pendentes: true })) {
      if (a.ciencia) continue;
      const prazo = Math.max(
        1,
        Math.round((Date.parse(doBanco(a.prazoEm)) - Date.parse(doBanco(a.emitidoEm))) / 60_000),
      );
      const nivel = nivelDoAviso({ emitidoEm: doBanco(a.emitidoEm), prazoMinutos: prazo, agora: iso(agora) });
      if (nivel <= a.nivel) continue;
      let subiu: boolean;
      try {
        subiu = await this.porta.gravarSgh(
          c,
          trilhaVigia(
            c,
            EVENTOS_AUDITAVEIS.sadtAvisoCriticoEscalonado.codigo,
            'escalonamento do valor crítico',
            {
              entidade: TABELA_AVISO,
              id: a.id,
              chave: `nivel ${nivel}`,
              paciente: a.paciente.id,
              correlacao: `vigia-esc-${hospital}-${a.id}-${nivel}`,
            },
          ),
          (g) => g.escalonarAviso({ aviso: a.id, nivel }),
        );
      } catch (e) {
        semEscalonar++;
        codigos.add(codigoDoErro(e));
        continue;
      }
      if (subiu) escalonados++;
    }
    if (avisos > 0 || escalonados > 0) this.notificador?.avisar(hospital);
    if (semAviso === 0 && semEscalonar === 0) return { avisos, escalonados };
    const lista = [...codigos].sort();
    // Só contagens e códigos: nenhum dado de pessoa no log.
    this.log.warn(
      `vigia do valor crítico (${hospital}): ${semAviso} exame(s) sem aviso, ${semEscalonar} escalonamento(s) não gravado(s); códigos: ${lista.join(', ')}`,
    );
    return {
      avisos,
      escalonados,
      ...(semAviso ? { semAviso } : {}),
      ...(semEscalonar ? { semEscalonar } : {}),
      codigos: lista,
    };
  }

  /** Liga a vigia (um ciclo por estabelecimento a cada `intervaloMs`; um ciclo de cada vez). */
  iniciar(intervaloMs = 2000): void {
    if (this.timer || this.hospitais.length === 0) return;
    this.timer = setInterval(() => {
      if (this.emCiclo) return;
      this.emCiclo = true;
      void Promise.all(
        this.hospitais.map((h) => this.ciclo(h).catch(() => ({ avisos: 0, escalonados: 0 }))),
      ).finally(() => {
        this.emCiclo = false;
      });
    }, intervaloMs);
    this.timer.unref?.();
  }

  parar(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
