// Aplicação da conta do paciente (M30): as gravações das telas (pelo executor, com a trilha na mesma transação, ou só do
// as gravações diretas da porta, com a trilha_auditoria junto), o escopo por convênio conferido no servidor em toda leitura e gravação da conta
// (regra 13), a liberação do lançamento manual por grupo de item (meta da reprodução), a decisão do lançamento tardio
// (a reabertura pela mesma receita) e o particular (o conector de Pix e cartão simulado fora de produção).
import {
  type ConferirItemEntrada,
  type DecidirLancamentoTardioEntrada,
  EVENTOS_AUDITAVEIS,
  type FecharContaEntrada,
  type LancarItemEntrada,
  type ReabrirContaEntrada,
  type ReceberParticularEntrada,
  type ResultadoFaturamento,
} from '@sgh/contratos';
import {
  conferirEscopoConvenio,
  filtroConvenios,
  grupoDoItem,
  grupoLiberadoPelaReproducao,
  mesmoLogin,
  ROTULO_GRUPO,
} from '@sgh/dominio-faturamento';
import { ErroProblema } from '../../problema.filter.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { ApoiosFaturamento } from './apoios.js';
import type { ContextoFaturamento, GravadorSghFaturamento, PortaFaturamento } from './porta.js';
import { conferirRecebimentoDaConta } from './regras-conta.js';

const ctx = (s: SessaoCadastro): ContextoFaturamento => s.porta;

const MENSAGENS: Readonly<Record<string, string>> = {
  'faturamento.fecharConta': 'Conta fechada.',
  'faturamento.reabrirConta': 'Conta reaberta.',
  'faturamento.conferirItem': 'Itens conferidos.',
  'faturamento.lancarItem': 'Item lançado na conta.',
};

export const resultadoFat = (
  mensagem: string,
  repetida: boolean,
  ids: Record<string, unknown>,
  avisos: string[] = [],
): ResultadoFaturamento => ({
  mensagem,
  repetida,
  ids: Object.fromEntries(
    Object.entries(ids).filter(
      (e): e is [string, number | string] => typeof e[1] === 'number' || typeof e[1] === 'string',
    ),
  ),
  avisos,
});

/** O escopo de convênios da sessão (vazio = sem restrição; acesso total = sem restrição). */
export function escopoConvenios(s: SessaoCadastro): readonly string[] {
  return (s.req.sgh?.sessao.escopos as { convenios?: readonly string[] } | undefined)?.convenios ?? [];
}

/**
 * A alçada de outro usuário (as permissões efetivas dele, pelo mesmo cálculo da sessão). null: não há como conferir
 * (sem o serviço de autorização) e a aprovação é recusada.
 */
export type ConferirAlcada = (s: SessaoCadastro, login: string, permissao: string) => Promise<boolean>;

export class ServicoFaturamento {
  constructor(
    private readonly porta: PortaFaturamento,
    private readonly apoios: ApoiosFaturamento,
    private readonly ambiente: string,
    private readonly alcada: ConferirAlcada | null = null,
  ) {}

  /**
   * Regra 12: o aprovador do preço fora da faixa é um usuário real, com a alçada (faturamento.preco.manual) e diferente
   * de quem lança. O login conferido é o que vai gravado na memória de preço (e na trilha da operação).
   */
  async conferirAprovador(s: SessaoCadastro, aprovador: string): Promise<string> {
    const login = aprovador.trim().toUpperCase();
    if (mesmoLogin(login, s.login))
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Autoaprovação',
        'O preço fora da faixa é aprovado por outra pessoa, não por quem lança.',
        { codigo: 'autoaprovacao', campos: ['aprovador'] },
      );
    const ok = this.alcada
      ? await this.alcada(s, login, 'faturamento.preco.manual').catch(() => false)
      : false;
    if (!ok)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Aprovador sem alçada',
        'O aprovador informado não existe ou não tem alçada para aprovar preço fora da faixa.',
        { codigo: 'aprovador-sem-alcada', campos: ['aprovador'] },
      );
    return login;
  }

  /** Os convênios a filtrar nas listas (null: sem restrição). */
  convenios(s: SessaoCadastro, pedido: number | null = null): readonly number[] | null {
    return filtroConvenios(escopoConvenios(s), pedido);
  }

  /** Regra 13: a conta (ou o item) é de convênio do escopo? Senão, 403 (nada lido nem gravado). */
  async exigirEscopoConta(
    s: SessaoCadastro,
    conta: number,
  ): Promise<{ convenio: number; tipoConta: string }> {
    const hoje = await this.porta.hoje(ctx(s));
    const c = await this.porta.conta(ctx(s), conta, hoje);
    if (!c) throw new ErroProblema('nao-encontrado', 404, 'Conta não encontrada');
    const r = conferirEscopoConvenio(escopoConvenios(s), c.convenio);
    if (r) throw new ErroProblema('sem-permissao', 403, 'Fora do escopo', r.mensagem, { codigo: r.codigo });
    return { convenio: c.convenio, tipoConta: c.tipoConta };
  }

  async exigirEscopoItem(s: SessaoCadastro, item: number): Promise<void> {
    const conv = await this.porta.convenioDoItem(ctx(s), item);
    if (conv === null) throw new ErroProblema('nao-encontrado', 404, 'Item não encontrado');
    const r = conferirEscopoConvenio(escopoConvenios(s), conv);
    if (r) throw new ErroProblema('sem-permissao', 403, 'Fora do escopo', r.mensagem, { codigo: r.codigo });
  }

  async executar(
    s: SessaoCadastro,
    op: string,
    entrada: unknown,
    mensagem = MENSAGENS[op] ?? 'Gravado.',
  ): Promise<ResultadoFaturamento> {
    const r = await this.apoios.daOperacao(op).executar(s, op, entrada, mensagem);
    return resultadoFat(r.mensagem, r.repetida, r.resultado);
  }

  async fechar(s: SessaoCadastro, e: FecharContaEntrada): Promise<ResultadoFaturamento> {
    await this.exigirEscopoConta(s, e.conta);
    return this.executar(s, 'faturamento.fecharConta', e);
  }

  async reabrir(s: SessaoCadastro, e: ReabrirContaEntrada): Promise<ResultadoFaturamento> {
    await this.exigirEscopoConta(s, e.conta);
    return this.executar(s, 'faturamento.reabrirConta', e);
  }

  async conferir(s: SessaoCadastro, e: ConferirItemEntrada): Promise<ResultadoFaturamento> {
    await this.exigirEscopoConta(s, e.conta);
    return this.executar(
      s,
      'faturamento.conferirItem',
      e,
      e.itens.length > 1 ? `${e.itens.length} itens conferidos.` : 'Item conferido.',
    );
  }

  /** O lançamento manual: o grupo na meta da reprodução (liberação por grupo) e o preço manual só com a permissão. */
  async lancar(
    s: SessaoCadastro,
    e: LancarItemEntrada,
    aptos?: readonly string[],
  ): Promise<ResultadoFaturamento> {
    await this.exigirEscopoConta(s, e.conta);
    if (e.precoManual && !s.pode('faturamento.preco.manual'))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem permissão',
        'Seu perfil não permite informar preço manual.',
        {
          codigo: 'sem-permissao',
        },
      );
    const aprovador = e.precoManual?.aprovador
      ? await this.conferirAprovador(s, e.precoManual.aprovador)
      : null;
    const grupo = grupoDoItem(e.tipo)!;
    if (!grupoLiberadoPelaReproducao(grupo, aptos as never))
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Grupo ainda não liberado',
        `O lançamento manual de ${ROTULO_GRUPO[grupo].toLowerCase()} ainda não foi liberado: o teste de reprodução ainda não atingiu a meta deste grupo.`,
        { codigo: 'grupo-nao-liberado' },
      );
    return this.executar(
      s,
      'faturamento.lancarItem',
      e.precoManual ? { ...e, precoManual: { ...e.precoManual, aprovador } } : e,
    );
  }

  /** Gravação só do novo pela funcionalidade, com a trilha. */
  sgh<T>(
    s: SessaoCadastro,
    f: keyof ApoiosFaturamento['apoios'],
    evento: string,
    alvo: (r: T) => { tabela: string; id: string; chave?: string },
    fn: (g: GravadorSghFaturamento) => Promise<T>,
  ): Promise<T> {
    return this.apoios.apoios[f].sgh(s, evento, this.apoios.apoios[f].cfg.chave, alvo, fn);
  }

  /**
   * A decisão do lançamento tardio; "reabrir" reabre a conta pela mesma receita (supervisor). A ficha é conferida
   * ANTES da reabertura (ainda na fila e sem decisão): a reabertura grava no banco em transação própria e não pode
   * acontecer para uma decisão que depois seria recusada. `decisaoAtual` vem da leitura da fila nesta requisição.
   */
  async decidirTardio(
    s: SessaoCadastro,
    e: DecidirLancamentoTardioEntrada,
    contaVersao: { conta: number; versao: string } | null,
    decisaoAtual: string | null = null,
  ): Promise<ResultadoFaturamento> {
    if (decisaoAtual !== null)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Já decidido',
        'A decisão desta ficha já foi registrada.',
        { codigo: 'ja-decidido' },
      );
    const avisos: string[] = [];
    if (e.decisao === 'reabrir') {
      if (!contaVersao)
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          'Sem conta',
          'A ficha não tem conta para reabrir: escolha a conta complementar ou descarte.',
          {
            codigo: 'sem-conta',
          },
        );
      if (!s.pode('faturamento.conta.reabrir'))
        throw new ErroProblema(
          'sem-permissao',
          403,
          'Sem permissão',
          'Só o supervisor do faturamento reabre conta.',
          { codigo: 'sem-permissao' },
        );
    }
    // A decisão é registrada primeiro (a unicidade por ficha recusa a segunda decisão, mesmo concorrente); só então a
    // conta é reaberta. Se a reabertura for recusada, a decisão fica registrada e o aviso diz que a conta segue fechada.
    const id = await this.sgh(
      s,
      'lancamentoTardio',
      EVENTOS_AUDITAVEIS.faturamentoLancamentoTardioDecidido.codigo,
      (x: number) => ({
        tabela: 'decisao_lancamento_tardio',
        id: String(x),
        chave: `atendimento ${e.registro}`,
      }),
      (g) => g.decidirLancamentoTardio({ ...e, usuario: s.login, conta: contaVersao?.conta ?? null }),
    );
    if (e.decisao === 'reabrir' && contaVersao) {
      try {
        await this.reabrir(s, {
          conta: contaVersao.conta,
          versao: contaVersao.versao,
          motivo: `Lançamento após o fechamento: ${e.motivo}`.slice(0, 250),
        });
        avisos.push(
          'Conta reaberta. O item que ficou de fora é lançado na aba de lançamentos da conta, quando o lançamento manual do grupo estiver liberado.',
        );
      } catch (erro) {
        if (!(erro instanceof ErroProblema)) throw erro;
        avisos.push(
          'Decisão registrada, mas a conta não foi reaberta: abra a conta e use Reabrir para ver o motivo.',
        );
      }
    }
    if (e.decisao === 'complementar')
      avisos.push(
        'Decisão registrada: conta complementar pendente. A geração da conta complementar ainda não está liberada.',
      );
    return resultadoFat('Decisão registrada.', false, { id }, avisos);
  }

  /** O recebimento do particular: Pix e cartão pelo conector simulado fora de produção (nunca o real em dev/ci). */
  async receber(s: SessaoCadastro, e: ReceberParticularEntrada): Promise<ResultadoFaturamento> {
    const eletronico = e.pagamentos.some(
      (p) => (p.forma === 'pix' || p.forma.startsWith('cartao')) && !p.comprovante,
    );
    if (eletronico) {
      if (!s.pode('faturamento.pagamento.registrar'))
        throw new ErroProblema(
          'sem-permissao',
          403,
          'Sem permissão',
          'Seu perfil não permite receber por Pix ou cartão.',
          { codigo: 'sem-permissao' },
        );
      await this.apoios.apoios.pagamentoEletronico.exigirLiberacao(s);
    }
    // Contra uma conta: só a do particular e dentro do escopo por convênio (regra 13), conferidos antes de gravar.
    if (e.conta) {
      const conv = await this.porta.convenioDaConta(ctx(s), e.conta);
      if (conv === null) throw new ErroProblema('nao-encontrado', 404, 'Conta não encontrada');
      const fora = conferirEscopoConvenio(escopoConvenios(s), conv);
      if (fora)
        throw new ErroProblema('sem-permissao', 403, 'Fora do escopo', fora.mensagem, {
          codigo: fora.codigo,
        });
      const np = conferirRecebimentoDaConta((await this.porta.contaParticular(ctx(s), e.conta)) === true);
      if (np)
        throw new ErroProblema('recusa-de-negocio', 409, 'Conta de convênio', np.mensagem, {
          codigo: np.codigo,
          campos: ['conta'],
        });
    }
    // Produção: sem provedor escolhido (decisão nova, sem DP), nenhum conector; só o comprovante digitado.
    const simulado = this.ambiente !== 'producao';
    const r = await this.sgh(
      s,
      'particular',
      EVENTOS_AUDITAVEIS.faturamentoPagamentoRecebido.codigo,
      (x: { pagamentos: number[] }) => ({
        tabela: 'movimento_caixa',
        id: String(x.pagamentos[0] ?? ''),
        chave: `caixa ${e.caixa}`,
      }),
      (g) => g.receberParticular({ ...e, usuario: s.login, simulado }),
    );
    return resultadoFat(
      r.troco > 0
        ? `Pagamento recebido. Troco: R$ ${r.troco.toFixed(2).replace('.', ',')}.`
        : 'Pagamento recebido.',
      false,
      { pagamento: r.pagamentos[0] ?? 0, pagamentos: r.pagamentos.length },
      simulado && eletronico ? ['Pix e cartão pelo conector simulado (fora de produção).'] : [],
    );
  }
}
