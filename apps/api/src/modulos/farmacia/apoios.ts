// As funcionalidades da farmácia (ficha do M29, seção 12): uma chave de liberação por funcionalidade (dispensação,
// entrega, avaliação, controlados, farmácia ambulatorial), cada uma um apoio de gravação do M18 (POL-3: completa e
// DESLIGADA até a conferência; o administrador liga por estabelecimento, unidade ou farmácia satélite e pessoa), com o
// mapa operação → permissão de agir que vale também no servidor. O livro oficial tem a chave própria
// (`suprimentos.livroControlados`, pré-requisito da VISA); o livro em modo conferência fica com os controlados.
import type { GravacaoFarmacia } from '@sgh/contratos';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../config/public-api.js';
import { ApoioGravacao } from '../exames/public-api.js';
import type { GravadorSghFarmacia, PortaFarmacia } from './porta.js';

const FUNCIONALIDADES = {
  dispensacao: {
    chave: 'suprimentos.dispensacao',
    nome: 'a dispensação por horário',
    operacoes: {
      'suprimentos.dispensarHorario': 'suprimentos.dispensacao.dispensar',
      'suprimentos.devolverDose': 'suprimentos.devolucao.registrar',
      'suprimentos.cancelarDispensacao': 'suprimentos.dispensacao.cancelar',
      'suprimentos.gravarRegraIntegracao': 'suprimentos.integracao.configurar',
      'suprimentos.gravarHorariosPadrao': 'suprimentos.integracao.configurar',
    },
    extras: {},
  },
  entrega: {
    chave: 'suprimentos.entrega',
    nome: 'a entrega da dose ao setor',
    operacoes: { 'suprimentos.confirmarEntrega': 'suprimentos.entrega.aceitar' },
    extras: {},
  },
  avaliacao: {
    chave: 'suprimentos.avaliacao',
    nome: 'a avaliação farmacêutica',
    operacoes: { 'suprimentos.avaliarPrescricao': 'suprimentos.avaliacao.decidir' },
    extras: {
      decidir: 'suprimentos.avaliacao.decidir',
      intervir: 'suprimentos.avaliacao.intervir',
      responder: 'suprimentos.intervencao.responder',
    },
  },
  controlados: {
    chave: 'suprimentos.controlados',
    nome: 'os controlados',
    operacoes: { 'suprimentos.registrarPerdaControlado': 'suprimentos.controlado.registrarPerda' },
    extras: { conferir: 'suprimentos.controlado.conferir', fecharLivro: 'suprimentos.livro.fechar' },
  },
  livroOficial: {
    chave: 'suprimentos.livroControlados',
    nome: 'o livro de controlados oficial',
    operacoes: {},
    extras: { fecharLivroOficial: 'suprimentos.livro.fechar' },
  },
  ambulatorial: {
    chave: 'suprimentos.ambulatorial',
    nome: 'a farmácia ambulatorial (SNGPC)',
    operacoes: {},
    extras: {
      dispensarAmbulatorial: 'suprimentos.ambulatorial.dispensar',
      escriturarSngpc: 'suprimentos.ambulatorial.escriturar',
    },
  },
} as const;

export type FuncionalidadeFarmacia = keyof typeof FUNCIONALIDADES;

export class ApoiosFarmacia {
  readonly apoios: Readonly<Record<FuncionalidadeFarmacia, ApoioGravacao<GravadorSghFarmacia>>>;

  constructor(
    readonly porta: PortaFarmacia,
    trilha: RegistradorTrilha,
    readonly configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
  ) {
    const a = (f: FuncionalidadeFarmacia) =>
      new ApoioGravacao<GravadorSghFarmacia>(
        {
          chave: FUNCIONALIDADES[f].chave,
          nome: FUNCIONALIDADES[f].nome,
          operacoes: FUNCIONALIDADES[f].operacoes,
        },
        porta,
        trilha,
        configuracao,
        cache,
      );
    this.apoios = {
      dispensacao: a('dispensacao'),
      entrega: a('entrega'),
      avaliacao: a('avaliacao'),
      controlados: a('controlados'),
      livroOficial: a('livroOficial'),
      ambulatorial: a('ambulatorial'),
    };
  }

  daOperacao(op: string): ApoioGravacao<GravadorSghFarmacia> {
    for (const [f, d] of Object.entries(FUNCIONALIDADES))
      if (op in d.operacoes) return this.apoios[f as FuncionalidadeFarmacia];
    return this.apoios.dispensacao;
  }

  async gravacao(s: SessaoCadastro): Promise<GravacaoFarmacia> {
    const funcionalidades: Record<string, { ligada: boolean; motivo: string | null }> = {};
    const operacoes: Record<string, { ligada: boolean; motivo: string | null }> = {};
    await Promise.all(
      (Object.keys(FUNCIONALIDADES) as FuncionalidadeFarmacia[]).map(async (f) => {
        const g = await this.apoios[f].gravacao(s, FUNCIONALIDADES[f].extras);
        funcionalidades[f] = { ligada: g.ligada, motivo: g.motivo };
        for (const [op, v] of Object.entries(g.operacoes))
          operacoes[op] = { ligada: v.pode, motivo: v.motivo };
      }),
    );
    return { funcionalidades, operacoes };
  }
}
