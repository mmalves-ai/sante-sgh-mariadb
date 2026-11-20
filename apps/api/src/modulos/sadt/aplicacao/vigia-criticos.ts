// Vigia do valor crítico (ficha do M26, regra 7; seção 4: "liberações feitas no outro sistema, leitura incremental a
// cada 1-2 s"): a cada ciclo, por estabelecimento com a funcionalidade ligada, os exames do laboratório liberados
// depois do último instante visto que têm faixa crítica cadastrada; o aviso sai com a origem "outroSistema" (a
// liberação feita aqui já avisou na mesma transação: a chave única impede o segundo aviso) e o painel relê pelo canal
// de eventos. No mesmo ciclo, o aviso sem ciência no prazo sobe ao plantonista e depois ao supervisor (nivelDoAviso).
// Nenhum dado de pessoa sai daqui: só contagens na telemetria.
import { CHAVES_SADT, EVENTOS_AUDITAVEIS, recursoDesligado } from '@sgh/contratos';
import { recursoLigado } from '@sgh/dominio-config';
import { nivelDoAviso } from '@sgh/dominio-sadt';
import type { FonteConfiguracao } from '../../config/public-api.js';
import type { PortaSadt } from '../porta.js';
import type { Notificador } from './servico.js';
import { TABELA_AVISO } from './servico.js';
import { avisarCriticoNaCentral, type CentralDeAvisos } from './central-critico.js';

export const USUARIO_VIGIA = 'SGH.VIGIA';
/**
 * Sobreposição da releitura: a marca da liberação do outro sistema vem do relógio da estação (classe "entrada" no
 * perfil) e o COMMIT pode chegar fora de ordem; a consulta só devolve o que ainda não avisou, então reler não repete.
 */
export const MARGEM_VIGIA_MS = 15 * 60_000;
const iso = (d: Date) => d.toISOString();
const doBanco = (t: string) => `${t}Z`;
const somarUmDia = (dia: string, n: number) =>
  new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

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
  async ciclo(hospital: string): Promise<{ avisos: number; escalonados: number }> {
    if (!(await this.ligada(hospital))) return { avisos: 0, escalonados: 0 };
    const c = { rede: this.rede, hospital };
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
    for (const x of vistos) {
      const novos = await this.porta.gravarSgh(
        c,
        (n: number) => ({
          rede: this.rede,
          hospital,
          usuario: USUARIO_VIGIA,
          evento: EVENTOS_AUDITAVEIS.sadtAvisoCriticoEmitido.codigo,
          recurso: CHAVES_SADT.critico,
          operacao: 'vigia do valor crítico',
          tabelaAlvo: TABELA_AVISO,
          idAlvo: String(x.exame),
          chaveNaturalAlvo: `${x.chave}|${n}`.slice(0, 120),
          resultado: 'sucesso',
          estacao: 'vigia',
          correlacao: `vigia-${hospital}-${x.liberacao}`.slice(0, 64),
          idPaciente: x.paciente,
        }),
        (g) =>
          g.avisarCriticos({
            idSilanexa: x.exame,
            chave: x.chave,
            idLiberacao: x.liberacao,
            liberadoEm: x.liberadoEm,
            origem: 'outroSistema',
            paciente: x.paciente,
            atendimento: x.atendimento,
          }),
      );
      avisos += novos;
      // Depois do COMMIT: o médico do atendimento recebe o aviso também na central (liberação no outro sistema).
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
    this.ultimo.set(hospital, cicloEm);
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
      const subiu = await this.porta.gravarSgh(
        c,
        {
          rede: this.rede,
          hospital,
          usuario: USUARIO_VIGIA,
          evento: EVENTOS_AUDITAVEIS.sadtAvisoCriticoEscalonado.codigo,
          recurso: CHAVES_SADT.critico,
          operacao: 'escalonamento do valor crítico',
          tabelaAlvo: TABELA_AVISO,
          idAlvo: String(a.id),
          chaveNaturalAlvo: `nivel ${nivel}`,
          resultado: 'sucesso',
          estacao: 'vigia',
          correlacao: `vigia-esc-${hospital}-${a.id}-${nivel}`.slice(0, 64),
          idPaciente: a.paciente.id,
        },
        (g) => g.escalonarAviso({ aviso: a.id, nivel }),
      );
      if (subiu) escalonados++;
    }
    if (avisos > 0 || escalonados > 0) this.notificador?.avisar(hospital);
    return { avisos, escalonados };
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
