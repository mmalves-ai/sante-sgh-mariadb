// M59-F1 (ficha do M59, seção 4 "Inventário de contas e privilégios"; regras 1, 4 e 5): o serviço do painel "Contas
// do banco de dados e privilégios". Só consulta: junta o que a porta leu do catálogo de privilégios do banco do cliente
// e o plano de privilégio mínimo por módulo, quando existir, e devolve o que o domínio decide. Nada aqui revoga: a
// revogação é script da TI com autorização do dono por passo (ficha, seção 12).
// Melhoria (ADR 0003): sem o sistema de origem não há passo de desligamento nem contingência a esperar: o banco do
// cliente é o único, e cada conta segue direto para a medição do uso ou o privilégio mínimo.
// Melhoria: a imutabilidade conta todas as tabelas do banco próprio, não uma lista de tabelas clínicas de outro sistema.
// As operações que apagam linha (tx.excluir do Executor) e as exceções aceitas vêm de um catálogo injetado
// (CATALOGO_EXCLUSOES); sem ele, a imutabilidade responde 409 "catalogo-pendente" em vez de afirmar zero.
// Pendência (pedido ao orquestrador): o plano de privilégio mínimo por módulo sobre o MariaDB (contas por módulo e
// alcance de cada uma). Sem ele, os desvios respondem 404 "plano ausente" e a imutabilidade vai sem o plano.
// Pendência (pedido ao orquestrador): o catálogo das operações com exclusão física, derivado das operações registradas.
import {
  type AlcanceModulo,
  esquemaDesviosPrivilegiosResposta,
  esquemaImutabilidadeResposta,
  esquemaInventarioContasBancoResposta,
  sufixoModuloBanco,
  type DesviosPrivilegiosResposta,
  type ImutabilidadeResposta,
  type InventarioContasBancoResposta,
} from '@sgh/contratos';
import {
  itensPlanoComDeleteClinico,
  montarDesvios,
  montarInventarioContas,
  nomesLegiveis,
  planejarPrivilegios,
  resumirDeleteClinico,
} from '@sgh/dominio-acesso';
import { ErroProblema } from '../../../problema.filter.js';
import type { ContextoContasBanco, PortaContasBanco } from './porta.js';

/**
 * O contrato ainda aceita só identificadores em maiúsculas (nomes do banco antigo): o nome da tabela do modelo próprio
 * vai em maiúsculas na resposta, até o contrato aceitar minúsculas (pedido ao orquestrador).
 */
const ident = (tabela: string): string => tabela.toUpperCase();

/** Janela mínima de medição do uso antes de revogar por desuso (D-JANELA-59). */
export const JANELA_MINIMA_DIAS = 90;

/** O plano de privilégio mínimo de um estabelecimento: o alcance de cada módulo. */
export interface PlanoPrivilegios {
  readonly alcances: readonly AlcanceModulo[];
}

/**
 * O catálogo das operações do produto que apagam linha (exclusão física, tx.excluir) e das tabelas do modelo próprio
 * em que isso é aceito, com o motivo. Montado a partir das operações registradas (pedido ao orquestrador).
 */
export interface CatalogoExclusoes {
  readonly operacoes: readonly { readonly operacao: string; readonly tabela: string }[];
  readonly excecoes: readonly { readonly tabela: string; readonly motivo: string }[];
}

/** Token do provedor do catálogo das exclusões (opcional no módulo). */
export const CATALOGO_EXCLUSOES = Symbol('CATALOGO_EXCLUSOES');

export interface DependenciasContasBanco {
  readonly porta: PortaContasBanco;
  /** O catálogo das exclusões físicas (null ou ausente: ainda não montado; a imutabilidade responde 409). */
  readonly exclusoes?: () => CatalogoExclusoes | null;
  /** O plano por módulo do estabelecimento (null: ainda não gerado). */
  readonly plano?: (hospital: string) => PlanoPrivilegios | null;
  readonly agora?: () => number;
}

export interface SituacaoHospital {
  readonly desligado: boolean;
  readonly contingenciaAtiva: boolean;
  readonly avisos: readonly string[];
}

export class ServicoContasBanco {
  constructor(private readonly d: DependenciasContasBanco) {}

  private agora(): number {
    return this.d.agora ? this.d.agora() : Date.now();
  }

  private plano(hospital: string): PlanoPrivilegios | null {
    return this.d.plano?.(hospital) ?? null;
  }

  /** O banco do cliente é o único (sem sistema anterior a desligar nem contingência a esperar). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async situacao(_c: ContextoContasBanco): Promise<SituacaoHospital> {
    return { desligado: true, contingenciaAtiva: false, avisos: [] };
  }

  async inventario(c: ContextoContasBanco): Promise<InventarioContasBancoResposta> {
    const sgh = this.d.porta.contasSgh(c.hospital);
    const [lido, situacao] = await Promise.all([
      this.d.porta.lerInventario(c, nomesLegiveis(sgh)),
      this.situacao(c),
    ]);
    const avisos = [
      ...situacao.avisos,
      'uso das contas ainda não medido: a medição é feita no servidor do banco, pela TI',
      'o catálogo mostra o que a conta da aplicação enxerga no banco do cliente',
    ];
    return esquemaInventarioContasBancoResposta.parse(
      montarInventarioContas({
        hospital: c.hospital,
        em: new Date(this.agora()).toISOString(),
        contas: lido.contas,
        loginsNaoLegiveis: lido.loginsNaoLegiveis,
        usos: [],
        sgh,
        contexto: {
          desligado: situacao.desligado,
          contingenciaAtiva: situacao.contingenciaAtiva,
          decisoes: new Set(),
          janelaMinimaDias: JANELA_MINIMA_DIAS,
        },
        avisos,
      }),
    );
  }

  async desvios(c: ContextoContasBanco): Promise<DesviosPrivilegiosResposta> {
    const plano = this.plano(c.hospital);
    if (!plano) {
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Plano de privilégios ausente',
        'O plano de privilégios por módulo deste estabelecimento ainda não foi gerado.',
      );
    }
    const reais = await this.d.porta.lerPrivilegiosSgh(c);
    const comConta = new Set(this.d.porta.modulosComConta(c.hospital));
    return esquemaDesviosPrivilegiosResposta.parse(
      montarDesvios({
        hospital: c.hospital,
        em: new Date(this.agora()).toISOString(),
        alcances: plano.alcances,
        reais,
        contasConfiguradas: new Set(
          plano.alcances.map((a) => a.modulo).filter((m) => comConta.has(sufixoModuloBanco(m))),
        ),
      }),
    );
  }

  /**
   * M59-F3 (regra 6; SBIS-26): a imutabilidade por privilégio. Quem ainda pode apagar linha no banco do cliente (a
   * conta ampla da aplicação, enquanto existir, é a concessão vigente) e o plano por módulo, quando existir.
   */
  async imutabilidade(c: ContextoContasBanco): Promise<ImutabilidadeResposta> {
    const catalogo = this.d.exclusoes?.() ?? null;
    if (!catalogo)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Catálogo das exclusões pendente',
        'O catálogo das operações que apagam linha ainda não foi montado neste servidor: a imutabilidade não pode ser afirmada.',
        { codigo: 'catalogo-pendente' },
      );
    const sgh = this.d.porta.contasSgh(c.hospital);
    const plano = this.plano(c.hospital);
    const itens = plano ? planejarPrivilegios(plano.alcances) : [];
    const [linhas, tabelas] = await Promise.all([
      this.d.porta.lerDeleteClinico(c, nomesLegiveis(sgh)),
      this.d.porta.contarTabelas(c),
    ]);
    const doSante = new Set([...sgh.aplicacao, ...(sgh.scripts ? [sgh.scripts] : [])]);
    const r = resumirDeleteClinico(linhas, (t) => doSante.has(t));
    return esquemaImutabilidadeResposta.parse({
      hospital: c.hospital,
      em: new Date(this.agora()).toISOString(),
      // Sem sistema anterior: 0 do lado antigo; todas as tabelas do banco próprio têm exclusão lógica.
      tabelasClinicas: { legado: 0, sgh: tabelas },
      // As operações que apagam linha fora das exceções aceitas (catálogo); o plano diz o que ainda concede DELETE.
      operacoesComDelete: catalogo.operacoes
        .filter((o) => !catalogo.excecoes.some((e) => e.tabela === o.tabela))
        .map((o) => ({ operacao: o.operacao, tabela: ident(o.tabela) })),
      planoComDelete: itensPlanoComDeleteClinico(itens).length,
      excecoes: catalogo.excecoes.map((e) => ({ tabela: ident(e.tabela), motivo: e.motivo })),
      titulares: r.titulares,
      concessaoVigente: r.concessaoVigente,
    });
  }
}
