// Relatório de contingência por posto (ficha do M40, regra 6; cap-14 §14.8 e §14.8.1): o PDF por hora e sob pedido com
// os pacientes do posto, leito, alergias, prescrição vigente, horários aprazados das próximas horas e os registros que
// só existem no novo (sinais vitais, lista de problemas, justificativas de alerta, rastreio de amostra e etapas da
// higienização). Sai pelo serviço de emissão do M09 (PDF/A no armazém de documentos, com o hash no registro das
// emissões; nada no disco nem no repositório). Toda geração é leitura de prontuário auditada; nada daqui vai a log além
// de contagens.
import {
  type ContingenciaGerada,
  EVENTOS_AUDITAVEIS,
  PARAMETRO_CONTINGENCIA_HORAS,
  PARAMETRO_CONTINGENCIA_POSTOS,
  TITULO_RELATORIO_CONTINGENCIA,
} from '@sgh/contratos';
import {
  camposDoRelatorioContingencia,
  montarRelatorioContingencia,
  somarMinutos,
} from '@sgh/dominio-enfermagem';
import type { EmissaoDocumento } from '@sgh/dominio-documento';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { FonteDocumento } from '../documento/public-api.js';
import type { ContextoEnfermagem, PortaEnfermagem } from './porta.js';

/**
 * O contexto da contingência: o do núcleo (cliente, estabelecimento por id) mais os códigos da rede e do estabelecimento
 * que o serviço de emissão de documentos usa (o contexto da sessão já traz os dois).
 */
export type ContextoContingencia = ContextoEnfermagem & { readonly rede: string; readonly hospital: string };

/** Os estabelecimentos com a geração de cada hora (o módulo entrega; vazio, nenhuma geração automática). */
export const ALVOS_CONTINGENCIA = Symbol('ALVOS_CONTINGENCIA');

/** Teto de horários lidos para o posto (as 24 h da prescrição vigente mais o horizonte). */
const TETO_HORARIOS = 3_000;

export interface PedidoGeracao {
  readonly unidade: string;
  readonly horas: number;
  readonly autor: string;
  readonly marcaSuporte?: string | null;
}

export interface GeracaoFeita {
  readonly resumo: ContingenciaGerada;
  readonly pdf: Uint8Array;
}

export interface UltimaGeracao {
  readonly resumo: ContingenciaGerada;
  readonly pdf: Uint8Array;
}

export class ServicoContingencia {
  /**
   * A última emissão de cada posto (rede, hospital e unidade), da geração de cada hora ou da tela: a estação de
   * contingência baixa o relatório da hora por `ultima`, que relê o PDF/A do armazém pela versão do registro (nunca um
   * PDF guardado no processo). Só o ponteiro fica na memória do processo: depois de reiniciar, a próxima hora repõe.
   */
  private readonly ultimas = new Map<string, { emissao: EmissaoDocumento; resumo: ContingenciaGerada }>();
  constructor(
    private readonly porta: PortaEnfermagem,
    private readonly documento: FonteDocumento | null,
  ) {}

  private static chave(c: ContextoContingencia, unidade: string): string {
    return `${c.cliente}|${c.rede}|${c.hospital}|${unidade}`;
  }

  /** O último relatório do posto (null quando nenhum foi gerado desde que a API subiu). */
  async ultima(c: ContextoContingencia, unidade: string): Promise<UltimaGeracao | null> {
    const u = this.ultimas.get(ServicoContingencia.chave(c, unidade));
    if (!u) return null;
    const fonte = this.documento;
    if (!fonte)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Emissão indisponível',
        'O serviço de emissão de documentos não está configurado: imprima a linha do tempo do turno pela tela.',
      );
    try {
      return { resumo: u.resumo, pdf: await fonte.emissao.lerPdf(u.emissao) };
    } catch {
      throw new ErroProblema(
        'indisponivel',
        503,
        'Relatório indisponível',
        'Não foi possível ler o último relatório agora: gere um novo ou imprima a linha do tempo do turno pela tela.',
      );
    }
  }

  /** Lê o posto, monta o relatório e emite o PDF/A (via 1 de um documento novo a cada geração). */
  async gerar(c: ContextoContingencia, p: PedidoGeracao): Promise<GeracaoFeita> {
    const fonte = this.documento;
    if (!fonte)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Emissão indisponível',
        'O serviço de emissão de documentos não está configurado: imprima a linha do tempo do turno pela tela.',
      );
    const agora = (await this.porta.relogio(c)).slice(0, 19);
    const internados = await this.porta.internados(c, p.unidade);
    const lidos = internados.length
      ? await this.porta.horarios(c, {
          atendimentos: internados.map((i) => i.atendimento),
          inicio: somarMinutos(agora, -24 * 60),
          fim: somarMinutos(agora, p.horas * 60),
          teto: TETO_HORARIOS,
        })
      : { itens: [], cortada: false };
    const desde = somarMinutos(agora, -24 * 60);
    const sinais = [];
    for (const i of internados) {
      const r = await this.porta.sinais(c, { paciente: i.paciente, de: desde, ate: agora }).catch(() => null);
      for (const x of r?.itens ?? [])
        sinais.push({
          paciente: i.paciente,
          tipo: x.tipo,
          valor: x.valor,
          unidade: x.unidade,
          horaReal: x.horaReal,
        });
    }
    const extras = await this.porta.extrasContingencia(c, {
      unidade: p.unidade,
      pacientes: internados.map((i) => i.paciente),
      atendimentos: internados.map((i) => i.atendimento),
      prescricoes: [...new Set(lidos.itens.map((h) => h.prescricao))],
    });
    const relatorio = montarRelatorioContingencia({
      unidade: p.unidade,
      agora,
      horas: p.horas,
      internados,
      alergias: extras.alergias,
      horarios: lidos.itens.filter((h) => h.faixa === null),
      cortado: lidos.cortada,
      sinais,
      problemas: extras.problemas,
      justificativas: extras.justificativas,
      amostras: extras.amostras,
      limpezas: extras.limpezas,
      naoLidos: extras.naoLidos ?? [],
    });
    try {
      const e = await fonte.emissao.emitir({
        rede: c.rede,
        estabelecimento: c.hospital,
        modelo: 'contingencia-posto',
        versaoModelo: '1',
        titulo: TITULO_RELATORIO_CONTINGENCIA,
        // Cada geração é um documento novo (a do minuto): nunca 2ª via de outra hora.
        origem: { tipo: 'contingencia-posto', idLegado: Math.floor(Date.now() / 1000) },
        campos: camposDoRelatorioContingencia(relatorio),
        autor: p.autor,
        marcaSuporte: p.marcaSuporte ?? null,
      });
      const resumo: ContingenciaGerada = {
        unidade: p.unidade,
        pacientes: relatorio.pacientes.length,
        horarios: relatorio.pacientes.reduce((t, x) => t + x.horarios.length, 0),
        geradoEm: relatorio.geradoEm,
        documento: e.emissao.id,
        cortado: relatorio.cortado,
      };
      this.ultimas.set(ServicoContingencia.chave(c, p.unidade), { emissao: e.emissao, resumo });
      return { resumo, pdf: e.pdf };
    } catch (x) {
      if (x instanceof ErroProblema) throw x;
      throw new ErroProblema(
        'indisponivel',
        503,
        'Emissão indisponível',
        'Não foi possível gerar o PDF agora: imprima a linha do tempo do turno pela tela.',
      );
    }
  }
}

/** Os postos com a geração de cada hora (parâmetro do estabelecimento; vazio, nenhum). */
export function postosDoParametro(valor: string | null | undefined): string[] {
  return (valor ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => /^[A-Za-z0-9._-]{1,5}$/.test(x));
}

/**
 * A geração de cada hora (regra 6: "PDF por hora"): fora de dev/ci, no processo da API, para cada estabelecimento e
 * cada posto do parâmetro. Cada geração vai à trilha como leitura do sistema (usuário `sgh.api`), com a unidade e as
 * contagens; falha numa unidade não para as outras. Em dev/ci a cópia é compartilhada: só sob pedido na tela.
 */
export class GeracaoPorHora {
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;
  constructor(
    private readonly servico: ServicoContingencia,
    private readonly trilha: RegistradorTrilha,
    private readonly parametro: (rede: string, hospital: string, chave: string) => Promise<string | null>,
    /** Cada estabelecimento com a geração de cada hora (o contexto do núcleo com os códigos da rede e dele). */
    private readonly alvos: readonly ContextoContingencia[],
  ) {}

  iniciar(intervaloMs = 3_600_000): void {
    this.temporizador = setInterval(() => void this.ciclo(), intervaloMs);
    this.temporizador.unref();
  }

  parar(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  async ciclo(): Promise<{ hospital: string; unidade: string; ok: boolean }[]> {
    if (this.rodando) return [];
    this.rodando = true;
    const feitos: { hospital: string; unidade: string; ok: boolean }[] = [];
    try {
      for (const alvo of this.alvos) {
        const { rede, hospital } = alvo;
        const postos = postosDoParametro(
          await this.parametro(rede, hospital, PARAMETRO_CONTINGENCIA_POSTOS).catch(() => null),
        );
        if (postos.length === 0) continue;
        const horas = Number(
          await this.parametro(rede, hospital, PARAMETRO_CONTINGENCIA_HORAS).catch(() => null),
        );
        for (const unidade of postos) {
          const c: ContextoContingencia = {
            ...alvo,
            usuario: null,
            correlacao: `contingencia-${Date.now()}`,
          };
          try {
            const g = await this.servico.gerar(c, {
              unidade,
              horas: Number.isInteger(horas) && horas >= 2 && horas <= 12 ? horas : 6,
              autor: 'sgh.api',
            });
            await this.trilha.registrar({
              evento: EVENTOS_AUDITAVEIS.enfermagemContingenciaGerada.codigo,
              rede,
              hospital,
              usuario: 'sgh.api',
              estacao: 'api:contingencia',
              correlacao: `contingencia-${hospital}-${unidade}-${Date.now()}`.slice(0, 64),
              recurso: 'enfermagem.contingencia',
              resultado: 'sucesso',
              tabelaAlvo: 'horario_administracao',
              idAlvo: g.resumo.documento,
              chaveNaturalAlvo: `contingencia:${unidade}:${g.resumo.pacientes}:${g.resumo.horarios}`,
            });
            feitos.push({ hospital, unidade, ok: true });
          } catch {
            feitos.push({ hospital, unidade, ok: false });
          }
        }
      }
    } finally {
      this.rodando = false;
    }
    return feitos;
  }
}
