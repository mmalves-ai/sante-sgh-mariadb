// 02-REC linha 33: porta PRÓPRIA do cadastro da estrutura da recepção: grava no banco do cliente os pontos de
// recepção (ponto_recepcao), os guichês (guiche_recepcao) e os serviços de senha (gerador_senha), sempre do
// estabelecimento da sessão. Cada gravação é uma transação com a trilha junto (antes e depois). As regras vêm do
// domínio (@sgh/dominio-recepcao, estrutura.ts), conferidas contra o estado lido e travado na mesma transação; a
// unicidade do banco (código, número, prefixo) fica como a última barreira. Nada é apagado: desativar grava
// ativo = FALSE com o motivo na trilha, e só sem guichê aberto nem senha de hoje em aberto no item. A versão do
// registro evita que duas pessoas se sobreponham.
import type {
  AlterarGuicheRecepcao,
  AlterarPontoRecepcao,
  AlterarServicoSenha,
  EstruturaRecepcao,
  IncluirGuicheRecepcao,
  IncluirPontoRecepcao,
  IncluirServicoSenha,
  SituacaoEstrutura,
} from '@sgh/contratos';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import {
  bloqueioDesativar,
  ordenarBotoes,
  recusasDoGuiche,
  recusasDoPonto,
  recusasDoServico,
} from '@sgh/dominio-recepcao';
import { type Escritor, gravarTrilha, type Leitor, type Linha, recusa } from '@sgh/nucleo';
import {
  bool,
  type EstabelecimentoDaSessao,
  estabelecimentoPorCodigo,
  horaCivil,
  num,
  numOuNull,
  txt,
  txtOuNull,
} from './banco.js';
import {
  type AutorEstrutura,
  exigirSemRecusa,
  type ItemEstrutura,
  naoEncontrado,
  type PortaEstruturaRecepcao,
  tipoAConferir,
  tipoAGravar,
  versaoAntiga,
} from './estrutura-porta.js';
import type { NucleoRecepcao } from './porta-propria.js';
import type { ContextoRecepcao } from './tipos.js';

/** Situações da senha que ainda pedem atendimento. */
const EM_ABERTO = "('aguardando','chamada','em_atendimento','encaminhada')";

const TABELA: Readonly<Record<ItemEstrutura, string>> = {
  ponto: 'ponto_recepcao',
  guiche: 'guiche_recepcao',
  servico: 'gerador_senha',
};

interface Transacao {
  readonly e: Escritor;
  readonly est: EstabelecimentoDaSessao;
  readonly usuario: number;
  readonly agora: Date;
  trilha(
    acao: 'inclusao' | 'alteracao',
    tabela: string,
    id: number,
    antes: unknown,
    depois: unknown,
    motivo?: string | null,
  ): Promise<void>;
}

export class EstruturaRecepcaoPropria implements PortaEstruturaRecepcao {
  readonly destino = 'propria' as const;

  constructor(
    private readonly nucleo: NucleoRecepcao,
    /** Código do cliente (o banco cliente_<codigo>). */
    private readonly cliente: string,
    private readonly agora: () => number = Date.now,
  ) {}

  private est(c: ContextoRecepcao): Promise<EstabelecimentoDaSessao> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'recepcao-estrutura' }, (l) =>
      estabelecimentoPorCodigo(l, c.hospital),
    );
  }

  async ler(c: ContextoRecepcao): Promise<EstruturaRecepcao> {
    const est = await this.est(c);
    return this.nucleo.lerSomente(
      { cliente: this.cliente, estabelecimento: est.id, correlacao: 'recepcao-estrutura' },
      async (l) => {
        const pontos = await l.consultar(
          `SELECT id, codigo, descricao, texto_impressao_senha, ativo, versao FROM ponto_recepcao
            WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY descricao, id`,
          [est.id],
        );
        const guiches = await l.consultar(
          `SELECT gr.id, gr.ponto_recepcao_id, gr.numero, gr.descricao, gr.ativo, gr.versao,
                  EXISTS (SELECT 1 FROM ocupacao_guiche o WHERE o.guiche_recepcao_id = gr.id AND o.fim_em IS NULL) AS aberto
             FROM guiche_recepcao gr JOIN ponto_recepcao p ON p.id = gr.ponto_recepcao_id
            WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND gr.excluido_em IS NULL
            ORDER BY gr.numero, gr.id`,
          [est.id],
        );
        const servicos = await l.consultar(
          `SELECT g.id, g.ponto_recepcao_id, g.prefixo, g.descricao, g.tipo, g.gera_prioritaria, gp.codigo AS grupo,
                  g.limite_dia, g.ordem_botao, g.ativo, g.versao
             FROM gerador_senha g JOIN ponto_recepcao p ON p.id = g.ponto_recepcao_id
             LEFT JOIN grupo_prioridade_legal gp ON gp.id = g.grupo_prioridade_legal_id
            WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL ORDER BY g.id`,
          [est.id],
        );
        const grupos = await l.consultar(
          'SELECT codigo, descricao FROM grupo_prioridade_legal WHERE ativo = TRUE ORDER BY peso, descricao, id',
        );
        return {
          pontos: pontos.map((p) => {
            const id = num(p['id']);
            return {
              id,
              codigo: txt(p['codigo']),
              descricao: txt(p['descricao']),
              textoSenha: txtOuNull(p['texto_impressao_senha']),
              ativo: bool(p['ativo']),
              versao: num(p['versao']),
              guiches: guiches
                .filter((g) => num(g['ponto_recepcao_id']) === id)
                .map((g) => ({
                  id: num(g['id']),
                  numero: num(g['numero']),
                  descricao: txtOuNull(g['descricao']),
                  ativo: bool(g['ativo']),
                  aberto: bool(g['aberto']),
                  versao: num(g['versao']),
                })),
              servicos: ordenarBotoes(
                servicos
                  .filter((s) => num(s['ponto_recepcao_id']) === id)
                  .map((s) => ({
                    id: num(s['id']),
                    prefixo: txt(s['prefixo']),
                    descricao: txt(s['descricao']),
                    tipo: txt(s['tipo']),
                    prioritaria: bool(s['gera_prioritaria']),
                    grupoPrioridade: txtOuNull(s['grupo']),
                    limiteDia: numOuNull(s['limite_dia']),
                    ordemBotao: numOuNull(s['ordem_botao']),
                    ativo: bool(s['ativo']),
                    versao: num(s['versao']),
                  })),
              ),
            };
          }),
          gruposPrioridade: grupos.map((g) => ({ codigo: txt(g['codigo']), descricao: txt(g['descricao']) })),
        };
      },
    );
  }

  // ── transação com a trilha ───────────────────────────────────────────────────────────────────────────

  private async gravar<T>(
    c: ContextoRecepcao,
    a: AutorEstrutura,
    fn: (t: Transacao) => Promise<T>,
  ): Promise<T> {
    const est = await this.est(c);
    const u = await this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'recepcao-estrutura' }, (l) =>
      l.uma("SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL AND situacao = 'ativo'", [
        a.login,
      ]),
    );
    if (!u)
      throw recusa('usuario-inexistente', 'O usuário da sessão não está ativo no cadastro deste cliente.');
    const usuario = num(u['id']);
    const agora = new Date(this.agora());
    const correlacao = (a.correlacao || 'recepcao-estrutura').slice(0, 64);
    return this.nucleo.escrever(
      { cliente: this.cliente, estabelecimento: est.id, usuario, correlacao },
      (e) =>
        fn({
          e,
          est,
          usuario,
          agora,
          trilha: async (acao, tabela, id, antes, depois, motivo = null) => {
            await gravarTrilha(e, {
              estabelecimento: est.id,
              usuario,
              acao,
              entidade: tabela,
              entidadeId: id,
              dadosAntes: antes ?? undefined,
              dadosDepois: {
                ...(depois as object),
                evento: EVENTOS_AUDITAVEIS.recepcaoEstruturaAlterada.codigo,
                estacao: a.estacao ?? null,
              },
              motivo,
              correlacao,
              ocorridoEm: agora,
            });
          },
        }),
    );
  }

  /** O ponto de recepção do estabelecimento, travado até o fim da transação. */
  private async pontoTravado(t: Transacao, id: number): Promise<Linha> {
    const [p] = await t.e.consultarParaAtualizar(
      `SELECT id, codigo, descricao, texto_impressao_senha, ativo, versao FROM ponto_recepcao
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [id, t.est.id],
    );
    if (!p) throw naoEncontrado('A recepção');
    return p;
  }

  private async pontosDoEstabelecimento(l: Leitor, est: number) {
    return (
      await l.consultar(
        'SELECT id, codigo, descricao FROM ponto_recepcao WHERE estabelecimento_id = ? AND excluido_em IS NULL',
        [est],
      )
    ).map((x) => ({ id: num(x['id']), codigo: txt(x['codigo']), descricao: txt(x['descricao']) }));
  }

  // ── ponto de recepção ────────────────────────────────────────────────────────────────────────────────

  incluirPonto(c: ContextoRecepcao, a: AutorEstrutura, p: IncluirPontoRecepcao): Promise<number> {
    return this.gravar(c, a, async (t) => {
      exigirSemRecusa(recusasDoPonto(p, await this.pontosDoEstabelecimento(t.e, t.est.id)));
      const id = await t.e.inserir(
        `INSERT INTO ponto_recepcao (estabelecimento_id, codigo, descricao, texto_impressao_senha, ativo, criado_em, criado_por)
         VALUES (?, ?, ?, ?, TRUE, ?, ?)`,
        [t.est.id, p.codigo, p.descricao, p.textoSenha, t.agora, t.usuario],
      );
      await t.trilha('inclusao', 'ponto_recepcao', id, null, { ...p, ativo: true });
      return id;
    });
  }

  alterarPonto(c: ContextoRecepcao, a: AutorEstrutura, id: number, p: AlterarPontoRecepcao): Promise<void> {
    return this.gravar(c, a, async (t) => {
      const atual = await this.pontoTravado(t, id);
      if (num(atual['versao']) !== p.versao) throw versaoAntiga();
      exigirSemRecusa(recusasDoPonto(p, await this.pontosDoEstabelecimento(t.e, t.est.id), id));
      await t.e.executar(
        `UPDATE ponto_recepcao SET codigo = ?, descricao = ?, texto_impressao_senha = ?, alterado_em = ?, alterado_por = ?,
                versao = versao + 1 WHERE id = ?`,
        [p.codigo, p.descricao, p.textoSenha, t.agora, t.usuario, id],
      );
      await t.trilha(
        'alteracao',
        'ponto_recepcao',
        id,
        {
          codigo: txt(atual['codigo']),
          descricao: txt(atual['descricao']),
          textoSenha: txtOuNull(atual['texto_impressao_senha']),
        },
        { codigo: p.codigo, descricao: p.descricao, textoSenha: p.textoSenha },
      );
    });
  }

  // ── guichê ───────────────────────────────────────────────────────────────────────────────────────────

  private async guichesDoPonto(l: Leitor, ponto: number) {
    return (
      await l.consultar('SELECT id, numero FROM guiche_recepcao WHERE ponto_recepcao_id = ?', [ponto])
    ).map((x) => ({ id: num(x['id']), numero: num(x['numero']) }));
  }

  incluirGuiche(
    c: ContextoRecepcao,
    a: AutorEstrutura,
    ponto: number,
    g: IncluirGuicheRecepcao,
  ): Promise<number> {
    return this.gravar(c, a, async (t) => {
      await this.pontoTravado(t, ponto);
      exigirSemRecusa(recusasDoGuiche(g, await this.guichesDoPonto(t.e, ponto)));
      const id = await t.e.inserir(
        `INSERT INTO guiche_recepcao (ponto_recepcao_id, numero, descricao, ativo, criado_em, criado_por)
         VALUES (?, ?, ?, TRUE, ?, ?)`,
        [ponto, g.numero, g.descricao, t.agora, t.usuario],
      );
      await t.trilha('inclusao', 'guiche_recepcao', id, null, { ponto, ...g, ativo: true });
      return id;
    });
  }

  alterarGuiche(c: ContextoRecepcao, a: AutorEstrutura, id: number, g: AlterarGuicheRecepcao): Promise<void> {
    return this.gravar(c, a, async (t) => {
      const atual = await t.e.uma(
        `SELECT gr.ponto_recepcao_id, gr.numero, gr.descricao, gr.versao FROM guiche_recepcao gr
           JOIN ponto_recepcao p ON p.id = gr.ponto_recepcao_id
          WHERE gr.id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL AND gr.excluido_em IS NULL`,
        [id, t.est.id],
      );
      if (!atual) throw naoEncontrado('O guichê');
      const ponto = num(atual['ponto_recepcao_id']);
      await this.pontoTravado(t, ponto);
      if (num(atual['versao']) !== g.versao) throw versaoAntiga();
      exigirSemRecusa(recusasDoGuiche(g, await this.guichesDoPonto(t.e, ponto), id));
      if (num(atual['numero']) !== g.numero) {
        // O número identifica o guichê no painel e na chamada: não muda com o guichê aberto.
        const aberto = await t.e.uma(
          'SELECT COUNT(*) AS n FROM ocupacao_guiche WHERE guiche_recepcao_id = ? AND fim_em IS NULL',
          [id],
        );
        if (num(aberto?.['n']) > 0)
          throw recusa('guiche-aberto', 'O guichê está aberto: feche-o antes de trocar o número.', {
            campos: ['numero'],
          });
      }
      const n = await t.e.executar(
        `UPDATE guiche_recepcao SET numero = ?, descricao = ?, alterado_em = ?, alterado_por = ?, versao = versao + 1
          WHERE id = ? AND versao = ?`,
        [g.numero, g.descricao, t.agora, t.usuario, id, g.versao],
      );
      if (n === 0) throw versaoAntiga();
      await t.trilha(
        'alteracao',
        'guiche_recepcao',
        id,
        { numero: num(atual['numero']), descricao: txtOuNull(atual['descricao']) },
        { numero: g.numero, descricao: g.descricao },
      );
    });
  }

  // ── serviço de senha ─────────────────────────────────────────────────────────────────────────────────

  private async servicosDoPonto(l: Leitor, ponto: number) {
    return (
      await l.consultar('SELECT id, prefixo, descricao FROM gerador_senha WHERE ponto_recepcao_id = ?', [
        ponto,
      ])
    ).map((x) => ({ id: num(x['id']), prefixo: txt(x['prefixo']), descricao: txt(x['descricao']) }));
  }

  private async grupos(l: Leitor): Promise<Map<string, number>> {
    const ls = await l.consultar('SELECT id, codigo FROM grupo_prioridade_legal WHERE ativo = TRUE');
    return new Map(ls.map((x) => [txt(x['codigo']), num(x['id'])]));
  }

  incluirServico(
    c: ContextoRecepcao,
    a: AutorEstrutura,
    ponto: number,
    s: IncluirServicoSenha,
  ): Promise<number> {
    return this.gravar(c, a, async (t) => {
      await this.pontoTravado(t, ponto);
      const grupos = await this.grupos(t.e);
      exigirSemRecusa(recusasDoServico(s, await this.servicosDoPonto(t.e, ponto), [...grupos.keys()]));
      const id = await t.e.inserir(
        `INSERT INTO gerador_senha (ponto_recepcao_id, descricao, prefixo, tipo, grupo_prioridade_legal_id, gera_prioritaria,
                                    limite_dia, ordem_botao, ativo, criado_em, criado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?)`,
        [
          ponto,
          s.descricao,
          s.prefixo,
          s.tipo,
          s.grupoPrioridade === null ? null : (grupos.get(s.grupoPrioridade) ?? null),
          s.prioritaria,
          s.limiteDia,
          s.ordemBotao,
          t.agora,
          t.usuario,
        ],
      );
      await t.trilha('inclusao', 'gerador_senha', id, null, { ponto, ...s, ativo: true });
      return id;
    });
  }

  alterarServico(c: ContextoRecepcao, a: AutorEstrutura, id: number, s: AlterarServicoSenha): Promise<void> {
    return this.gravar(c, a, async (t) => {
      const atual = await t.e.uma(
        `SELECT g.ponto_recepcao_id, g.prefixo, g.descricao, g.tipo, g.gera_prioritaria, gp.codigo AS grupo, g.limite_dia,
                g.ordem_botao, g.versao
           FROM gerador_senha g JOIN ponto_recepcao p ON p.id = g.ponto_recepcao_id
           LEFT JOIN grupo_prioridade_legal gp ON gp.id = g.grupo_prioridade_legal_id
          WHERE g.id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL`,
        [id, t.est.id],
      );
      if (!atual) throw naoEncontrado('O serviço de senha');
      const ponto = num(atual['ponto_recepcao_id']);
      await this.pontoTravado(t, ponto);
      if (num(atual['versao']) !== s.versao) throw versaoAntiga();
      const grupos = await this.grupos(t.e);
      // O grupo já gravado segue aceito mesmo que tenha sido desativado depois (não se perde ao editar outro campo).
      const aceitos = new Set(grupos.keys());
      const grupoAtual = txtOuNull(atual['grupo']);
      if (grupoAtual !== null) aceitos.add(grupoAtual);
      const tipoAtual = txt(atual['tipo']);
      exigirSemRecusa(
        recusasDoServico(
          { ...s, tipo: tipoAConferir(s.tipo, tipoAtual) },
          await this.servicosDoPonto(t.e, ponto),
          [...aceitos],
          id,
        ),
      );
      const tipo = tipoAGravar(s.tipo, tipoAtual);
      const mesmoGrupo = s.grupoPrioridade === grupoAtual;
      const n = await t.e.executar(
        `UPDATE gerador_senha SET prefixo = ?, descricao = ?, tipo = ?, gera_prioritaria = ?,
                grupo_prioridade_legal_id = ${mesmoGrupo ? 'grupo_prioridade_legal_id' : '?'}, limite_dia = ?, ordem_botao = ?,
                alterado_em = ?, alterado_por = ?, versao = versao + 1
          WHERE id = ? AND versao = ?`,
        [
          s.prefixo,
          s.descricao,
          tipo,
          s.prioritaria,
          ...(mesmoGrupo
            ? []
            : [s.grupoPrioridade === null ? null : (grupos.get(s.grupoPrioridade) ?? null)]),
          s.limiteDia,
          s.ordemBotao,
          t.agora,
          t.usuario,
          id,
          s.versao,
        ],
      );
      if (n === 0) throw versaoAntiga();
      await t.trilha(
        'alteracao',
        'gerador_senha',
        id,
        {
          prefixo: txt(atual['prefixo']),
          descricao: txt(atual['descricao']),
          tipo: tipoAtual,
          prioritaria: bool(atual['gera_prioritaria']),
          grupoPrioridade: grupoAtual,
          limiteDia: numOuNull(atual['limite_dia']),
          ordemBotao: numOuNull(atual['ordem_botao']),
        },
        // A versão pedida não é dado do serviço: fica fora do retrato (undefined não vai ao JSON).
        { ...s, tipo, versao: undefined },
      );
    });
  }

  // ── desativar e reativar ─────────────────────────────────────────────────────────────────────────────

  situacao(
    c: ContextoRecepcao,
    a: AutorEstrutura,
    item: ItemEstrutura,
    id: number,
    s: SituacaoEstrutura,
  ): Promise<void> {
    return this.gravar(c, a, async (t) => {
      const tabela = TABELA[item];
      const atual = await t.e.uma(
        item === 'ponto'
          ? `SELECT x.id AS ponto, x.ativo, x.versao FROM ponto_recepcao x
              WHERE x.id = ? AND x.estabelecimento_id = ? AND x.excluido_em IS NULL`
          : `SELECT x.ponto_recepcao_id AS ponto, x.ativo, x.versao FROM ${tabela} x
               JOIN ponto_recepcao p ON p.id = x.ponto_recepcao_id
              WHERE x.id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL
                ${item === 'guiche' ? 'AND x.excluido_em IS NULL' : ''}`,
        [id, t.est.id],
      );
      if (!atual) throw naoEncontrado('O registro');
      await this.pontoTravado(t, num(atual['ponto']));
      if (num(atual['versao']) !== s.versao) throw versaoAntiga();
      if (!s.ativo) {
        const hoje = horaCivil(t.agora, t.est.fuso).slice(0, 10);
        const abertos =
          item === 'servico'
            ? null
            : await t.e.uma(
                `SELECT COUNT(*) AS n FROM ocupacao_guiche o JOIN guiche_recepcao gr ON gr.id = o.guiche_recepcao_id
                  WHERE o.fim_em IS NULL AND ${item === 'guiche' ? 'gr.id' : 'gr.ponto_recepcao_id'} = ?`,
                [id],
              );
        const senhas =
          item === 'guiche'
            ? null
            : await t.e.uma(
                `SELECT COUNT(*) AS n FROM senha_emitida s JOIN gerador_senha g ON g.id = s.gerador_senha_id
                  WHERE s.data_referencia = ? AND s.situacao IN ${EM_ABERTO}
                    AND ${item === 'servico' ? 'g.id' : 'g.ponto_recepcao_id'} = ?`,
                [hoje, id],
              );
        exigirSemRecusa([
          bloqueioDesativar(item, {
            guichesAbertos: num(abertos?.['n'] ?? 0),
            senhasEmAberto: num(senhas?.['n'] ?? 0),
          }),
        ]);
      }
      const n = await t.e.executar(
        `UPDATE ${tabela} SET ativo = ?, alterado_em = ?, alterado_por = ?, versao = versao + 1 WHERE id = ? AND versao = ?`,
        [s.ativo, t.agora, t.usuario, id, s.versao],
      );
      if (n === 0) throw versaoAntiga();
      await t.trilha('alteracao', tabela, id, { ativo: bool(atual['ativo']) }, { ativo: s.ativo }, s.motivo);
    });
  }
}
