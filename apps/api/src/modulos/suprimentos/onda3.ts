// Onda 3 (ficha do M41): o painel "Efeito no estoque dos documentos do novo" (campo 7, na tela de saldos do M28), a
// conferência numérica de saldo e preço médio (campo 10) e a regra 1 da onda (a dispensação só depois da prescrição
// eletrônica em uso nas unidades atendidas), oferecida à tela "Chaves de liberação" pelo registro injetável do config.
// Tudo leitura (READ ONLY): nada grava no banco do estabelecimento; a conferência compara o retrato que o chave-usuário
// leu na outra estação com o lido agora aqui, e o resultado vai às evidências do marco.
import {
  type ConferenciaNumericaOnda3,
  esquemaConferenciaNumerica,
  esquemaConsultaPainelOnda3,
  esquemaPainelOnda3,
  esquemaPedidoConferenciaNumerica,
  type PainelMigracaoOnda3,
  type PainelOnda3,
} from '@sgh/contratos';
import { conferenciaNumerica } from '@sgh/contratos/regras-suprimentos';
import {
  CHAVE_PRESCRICAO_REGRA_1,
  chaveExigePrescricao,
  motivoLigarRegraFarmacia,
  regra1PorLocal,
  unidadesComPrescricaoEmUso,
} from '@sgh/dominio-config';
import { ErroProblema } from '../../problema.filter.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { FonteConfiguracao } from '../config/public-api.js';
import type { ContextoSuprimentos, PortaSuprimentos } from './porta.js';

const ctx = (s: SessaoCadastro): ContextoSuprimentos => s.porta;

export class ServicoOnda3 {
  constructor(
    private readonly porta: PortaSuprimentos,
    private readonly configuracao: FonteConfiguracao | null,
  ) {}

  /** Os locais que a sessão vê (o escopo do usuário do estoque); null = sem escopo lido (plataforma): todos. */
  private async locaisDaSessao(s: SessaoCadastro): Promise<Set<number> | null> {
    const e = await this.porta.escopo(ctx(s), s.login).catch(() => null);
    if (!e || e.locais.length === 0) return null;
    return new Set(e.locais.map((l) => l.local));
  }

  async painel(s: SessaoCadastro, consulta: unknown): Promise<PainelOnda3> {
    const q = esquemaConsultaPainelOnda3.safeParse(consulta ?? {});
    if (!q.success)
      throw new ErroProblema('entrada-invalida', 400, 'Consulta inválida', 'Use dia AAAA-MM-DD e o local.');
    const r = await this.porta.relogio(ctx(s));
    const dia = q.data.dia ?? r.hoje;
    const escopo = await this.locaisDaSessao(s);
    if (q.data.local !== undefined && escopo && !escopo.has(q.data.local))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Local fora do seu escopo',
        'Você não tem acesso a este local de estoque.',
      );
    const [l, fechados] = await Promise.all([
      this.porta.onda3(ctx(s), dia, r.hoje),
      this.porta.mesesFechados(ctx(s)),
    ]);
    const noLocal = (local: number | null) =>
      q.data.local !== undefined ? local === q.data.local : !escopo || local === null || escopo.has(local);
    const efeitos = l.efeitos.filter((e) => noLocal(e.local));
    const ultimo = [...fechados].sort((a, b) => b.ano - a.ano || b.mes - a.mes)[0];
    return esquemaPainelOnda3.parse({
      hospital: s.hospital,
      dia,
      documentos: l.documentos.filter((d) => noLocal(d.local)),
      efeitos,
      comAlerta: efeitos.filter((e) => e.alertas.length > 0).length,
      horarios: l.horarios,
      requisicoes: l.requisicoes.filter((x) => noLocal(x.local)),
      uso: l.uso.filter((x) => noLocal(x.local)),
      ultimoMesFechado: ultimo ? { ano: ultimo.ano, mes: ultimo.mes } : null,
      cortada: l.cortada,
    });
  }

  /** Local pedido fora do escopo do usuário do estoque: 403 (D-ESCOPO-41). */
  private foraDoEscopo(escopo: Set<number> | null, local: number | null | undefined): void {
    if (local !== undefined && local !== null && escopo && !escopo.has(local))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Local fora do seu escopo',
        'Você não tem acesso a este local de estoque.',
      );
  }

  /**
   * O retrato dos itens movimentados pelo novo no dia (o chave-usuário confere na outra estação), no escopo de locais
   * da sessão como o painel (D-ESCOPO-41); com `local`, só os pares desse local (403 fora do escopo).
   */
  async retratoNumerico(s: SessaoCadastro, consulta: unknown): Promise<ConferenciaNumericaOnda3> {
    const q = esquemaConsultaPainelOnda3.safeParse(consulta ?? {});
    if (!q.success)
      throw new ErroProblema('entrada-invalida', 400, 'Data inválida', 'Use dia AAAA-MM-DD e o local.');
    const r = await this.porta.relogio(ctx(s));
    const d = q.data.dia ?? r.hoje;
    const escopo = await this.locaisDaSessao(s);
    this.foraDoEscopo(escopo, q.data.local);
    const lidos = (await this.porta.onda3Numerica(ctx(s), d)).filter((x) =>
      q.data.local !== undefined
        ? x.local === q.data.local
        : !escopo || x.local === null || escopo.has(x.local),
    );
    return esquemaConferenciaNumerica.parse({ dia: d, lidos, divergencias: [], conferidos: 0 });
  }

  /**
   * Compara o que a outra estação mostrou (esperado) com o lido agora aqui: 0 divergência é o critério (campo 10).
   * Cada par informado é lido agora na competência do dia, tenha o novo movimentado o item no dia ou não (nenhum par
   * vira "saldo 0" por não estar entre os do dia). Par num local fora do escopo da sessão: 403 (D-ESCOPO-41).
   */
  async conferir(s: SessaoCadastro, corpo: unknown): Promise<ConferenciaNumericaOnda3> {
    const p = esquemaPedidoConferenciaNumerica.safeParse(corpo);
    if (!p.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Conferência inválida',
        'Informe o dia e, para cada item, o local, o saldo e o preço médio lidos na outra estação (até 500).',
      );
    const escopo = await this.locaisDaSessao(s);
    for (const e of p.data.esperado) this.foraDoEscopo(escopo, e.local);
    const pares = [
      ...new Map(
        p.data.esperado.map((e) => [`${e.item}|${e.local ?? ''}`, { item: e.item, local: e.local }]),
      ).values(),
    ];
    const daqui = await this.porta.onda3LerPares(ctx(s), p.data.dia, pares);
    return esquemaConferenciaNumerica.parse({
      dia: p.data.dia,
      lidos: daqui,
      divergencias: conferenciaNumerica(p.data.esperado, daqui),
      conferidos: p.data.esperado.length,
    });
  }

  // ── Regra 1 ─────────────────────────────────────────────────────────────────────────────────────────────

  /** O mapa da regra 1 para o painel da onda 3 (local → unidades atendidas e as que faltam). */
  async regra1(c: ContextoSuprimentos): Promise<PainelMigracaoOnda3['regra1']> {
    try {
      const { hoje } = await this.porta.relogio(c);
      const [l, chaves] = await Promise.all([this.porta.onda3Regra1(c, hoje), this.chavesPrescricao(c)]);
      const com = unidadesComPrescricaoEmUso(chaves, l.prescricoes);
      return { lido: true, locais: regra1PorLocal(l.atendidas, com), unidadesComPrescricao: com };
    } catch {
      return { lido: false, locais: [], unidadesComPrescricao: [] };
    }
  }

  private async chavesPrescricao(c: ContextoSuprimentos) {
    if (!this.configuracao) return [];
    const todas = await this.configuracao.chaves(c.rede, c.hospital);
    return todas
      .filter((x) => x.chave === CHAVE_PRESCRICAO_REGRA_1 && x.tipo === 'recurso')
      .map((x) => ({ escopo: x.escopo, valor: x.valor, ligada: x.ligada }));
  }

  /**
   * Para a tela "Chaves de liberação": o que falta para ligar a dispensação ou a entrega (null: pode, ou a chave não é
   * da regra 1). Sem conseguir ler o mapa ou as chaves, não liga (falha fechada). Desligar nunca chega aqui.
   */
  async motivoLigar(c: ContextoSuprimentos, chave: string): Promise<string | null> {
    if (!chaveExigePrescricao(chave)) return null;
    // A mesma conferência do comando de terminal `liberacao:ligar-tudo` (M61; @sgh/dominio-config).
    try {
      const { hoje } = await this.porta.relogio(c);
      const [leitura, chaves] = await Promise.all([
        this.porta.onda3Regra1(c, hoje),
        this.chavesPrescricao(c),
      ]);
      return motivoLigarRegraFarmacia(chave, leitura, chaves);
    } catch {
      return motivoLigarRegraFarmacia(chave, null, []);
    }
  }
}
