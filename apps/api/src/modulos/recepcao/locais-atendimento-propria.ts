// 02-REC linha 33 (C2-005): porta PRÓPRIA do cadastro dos locais de atendimento (local_atendimento) e dos
// encaminhamentos entre locais (local_atendimento_encaminhamento), sempre do estabelecimento da sessão. Cada gravação
// é uma transação com a trilha junto (antes e depois). As regras vêm do domínio (@sgh/dominio-recepcao,
// locais-atendimento.ts), conferidas contra o estado lido e travado na mesma transação; a unicidade e o CHECK do banco
// ficam como a última barreira. Nada é apagado: desativar grava ativo = FALSE com o motivo na trilha, e só sem guichê
// aberto nem senha de hoje em aberto no local; o destino retirado da lista ganha excluido_em (e volta, na mesma
// linha, se for escolhido de novo). A versão do local evita que duas pessoas se sobreponham.
import type {
  AlterarLocalAtendimento,
  DestinosEncaminhamento,
  IncluirLocalAtendimento,
  LocaisDaRecepcao,
  SituacaoEstrutura,
} from '@sgh/contratos';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import {
  bloqueioDesativarLocal,
  diferencaDestinos,
  recusasDoLocal,
  recusasDosDestinos,
} from '@sgh/dominio-recepcao';
import { type Escritor, gravarTrilha, type Leitor, type Linha, recusa } from '@sgh/nucleo';
import {
  bool,
  type EstabelecimentoDaSessao,
  estabelecimentoPorCodigo,
  horaCivil,
  num,
  txt,
  txtOuNull,
} from './banco.js';
import { type AutorEstrutura, exigirSemRecusa, naoEncontrado, versaoAntiga } from './estrutura-porta.js';
import type { PortaLocaisAtendimento } from './locais-atendimento-porta.js';
import type { NucleoRecepcao } from './porta-propria.js';
import type { ContextoRecepcao } from './tipos.js';

/** Situações da senha que ainda pedem atendimento. */
const EM_ABERTO = "('aguardando','chamada','em_atendimento','encaminhada')";
const TABELA = 'local_atendimento';
const TABELA_DESTINO = 'local_atendimento_encaminhamento';

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

const campos = (l: Linha) => ({
  codigo: txt(l['codigo']),
  descricao: txt(l['descricao']),
  permiteEncaminhamento: bool(l['permite_encaminhamento']),
  baseTempoEspera: bool(l['base_tempo_espera']),
  reavaliacaoMedica: bool(l['reavaliacao_medica']),
  canalAudio: txtOuNull(l['canal_audio']),
});

export class LocaisAtendimentoPropria implements PortaLocaisAtendimento {
  readonly destino = 'propria' as const;

  constructor(
    private readonly nucleo: NucleoRecepcao,
    /** Código do cliente (o banco cliente_<codigo>). */
    private readonly cliente: string,
    private readonly agora: () => number = Date.now,
  ) {}

  private est(c: ContextoRecepcao): Promise<EstabelecimentoDaSessao> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'recepcao-locais' }, (l) =>
      estabelecimentoPorCodigo(l, c.hospital),
    );
  }

  async ler(c: ContextoRecepcao): Promise<LocaisDaRecepcao> {
    const est = await this.est(c);
    return this.nucleo.lerSomente(
      { cliente: this.cliente, estabelecimento: est.id, correlacao: 'recepcao-locais' },
      async (l) => {
        const pontos = await l.consultar(
          `SELECT id, codigo, descricao, ativo FROM ponto_recepcao
            WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY descricao, id`,
          [est.id],
        );
        const locais = await this.locaisDoEstabelecimento(l, est.id);
        const destinos = await l.consultar(
          `SELECT e.local_atendimento_id AS origem, e.destino_local_atendimento_id AS destino
             FROM local_atendimento_encaminhamento e JOIN local_atendimento l ON l.id = e.local_atendimento_id
            WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL AND e.excluido_em IS NULL
            ORDER BY e.id`,
          [est.id],
        );
        return {
          pontos: pontos.map((p) => ({
            id: num(p['id']),
            codigo: txt(p['codigo']),
            descricao: txt(p['descricao']),
            ativo: bool(p['ativo']),
          })),
          locais: locais.map((x) => ({
            id: num(x['id']),
            pontoId: num(x['ponto_recepcao_id']),
            ...campos(x),
            ativo: bool(x['ativo']),
            versao: num(x['versao']),
            destinos: destinos.filter((d) => num(d['origem']) === num(x['id'])).map((d) => num(d['destino'])),
          })),
        };
      },
    );
  }

  private locaisDoEstabelecimento(l: Leitor, est: number): Promise<Linha[]> {
    return l.consultar(
      `SELECT id, ponto_recepcao_id, codigo, descricao, permite_encaminhamento, base_tempo_espera, reavaliacao_medica,
              canal_audio, ativo, versao
         FROM local_atendimento WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY descricao, id`,
      [est],
    );
  }

  // ── transação com a trilha ───────────────────────────────────────────────────────────────────────────

  private async gravar<T>(
    c: ContextoRecepcao,
    a: AutorEstrutura,
    fn: (t: Transacao) => Promise<T>,
  ): Promise<T> {
    const est = await this.est(c);
    const u = await this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'recepcao-locais' }, (l) =>
      l.uma("SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL AND situacao = 'ativo'", [
        a.login,
      ]),
    );
    if (!u)
      throw recusa('usuario-inexistente', 'O usuário da sessão não está ativo no cadastro deste cliente.');
    const usuario = num(u['id']);
    const agora = new Date(this.agora());
    const correlacao = (a.correlacao || 'recepcao-locais').slice(0, 64);
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

  /** O local do estabelecimento, travado até o fim da transação. */
  private async localTravado(t: Transacao, id: number): Promise<Linha> {
    const [l] = await t.e.consultarParaAtualizar(
      `SELECT id, ponto_recepcao_id, codigo, descricao, permite_encaminhamento, base_tempo_espera, reavaliacao_medica,
              canal_audio, ativo, versao
         FROM local_atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [id, t.est.id],
    );
    if (!l) throw naoEncontrado('O local de atendimento');
    return l;
  }

  private async existentes(t: Transacao) {
    return (await this.locaisDoEstabelecimento(t.e, t.est.id)).map((x) => ({
      id: num(x['id']),
      codigo: txt(x['codigo']),
      descricao: txt(x['descricao']),
      ponto: num(x['ponto_recepcao_id']),
      ativo: bool(x['ativo']),
    }));
  }

  private async destinosVigentes(t: Transacao, id: number): Promise<number[]> {
    return (
      await t.e.consultar(
        `SELECT destino_local_atendimento_id AS d FROM local_atendimento_encaminhamento
          WHERE local_atendimento_id = ? AND excluido_em IS NULL ORDER BY id`,
        [id],
      )
    ).map((x) => num(x['d']));
  }

  incluir(
    c: ContextoRecepcao,
    a: AutorEstrutura,
    ponto: number,
    l: IncluirLocalAtendimento,
  ): Promise<number> {
    return this.gravar(c, a, async (t) => {
      const [p] = await t.e.consultarParaAtualizar(
        'SELECT id, ativo FROM ponto_recepcao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [ponto, t.est.id],
      );
      if (!p) throw naoEncontrado('A recepção');
      exigirSemRecusa(recusasDoLocal(l, { id: ponto, ativo: bool(p['ativo']) }, await this.existentes(t)));
      const id = await t.e.inserir(
        `INSERT INTO local_atendimento (estabelecimento_id, ponto_recepcao_id, codigo, descricao, permite_encaminhamento,
                base_tempo_espera, reavaliacao_medica, canal_audio, ativo, criado_em, criado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?)`,
        [
          t.est.id,
          ponto,
          l.codigo,
          l.descricao,
          l.permiteEncaminhamento,
          l.baseTempoEspera,
          l.reavaliacaoMedica,
          l.canalAudio,
          t.agora,
          t.usuario,
        ],
      );
      await t.trilha('inclusao', TABELA, id, null, { ...l, ponto, ativo: true });
      return id;
    });
  }

  alterar(c: ContextoRecepcao, a: AutorEstrutura, id: number, l: AlterarLocalAtendimento): Promise<void> {
    return this.gravar(c, a, async (t) => {
      const atual = await this.localTravado(t, id);
      if (num(atual['versao']) !== l.versao) throw versaoAntiga();
      const todos = await this.existentes(t);
      exigirSemRecusa(recusasDoLocal(l, { id: num(atual['ponto_recepcao_id']), ativo: true }, todos, id));
      // Desligar o encaminhamento com destinos na lista é recusado: a pessoa retira os destinos antes.
      const vigentes = await this.destinosVigentes(t, id);
      if (!l.permiteEncaminhamento)
        exigirSemRecusa(recusasDosDestinos({ id, permiteEncaminhamento: false }, vigentes, todos, vigentes));
      const n = await t.e.executar(
        `UPDATE local_atendimento SET codigo = ?, descricao = ?, permite_encaminhamento = ?, base_tempo_espera = ?,
                reavaliacao_medica = ?, canal_audio = ?, alterado_em = ?, alterado_por = ?, versao = versao + 1
          WHERE id = ? AND versao = ?`,
        [
          l.codigo,
          l.descricao,
          l.permiteEncaminhamento,
          l.baseTempoEspera,
          l.reavaliacaoMedica,
          l.canalAudio,
          t.agora,
          t.usuario,
          id,
          l.versao,
        ],
      );
      if (n === 0) throw versaoAntiga();
      await t.trilha('alteracao', TABELA, id, campos(atual), {
        codigo: l.codigo,
        descricao: l.descricao,
        permiteEncaminhamento: l.permiteEncaminhamento,
        baseTempoEspera: l.baseTempoEspera,
        reavaliacaoMedica: l.reavaliacaoMedica,
        canalAudio: l.canalAudio,
      });
    });
  }

  destinos(c: ContextoRecepcao, a: AutorEstrutura, id: number, d: DestinosEncaminhamento): Promise<void> {
    return this.gravar(c, a, async (t) => {
      const atual = await this.localTravado(t, id);
      if (num(atual['versao']) !== d.versao) throw versaoAntiga();
      const vigentes = await this.destinosVigentes(t, id);
      exigirSemRecusa(
        recusasDosDestinos(
          { id, permiteEncaminhamento: bool(atual['permite_encaminhamento']) },
          d.destinos,
          await this.existentes(t),
          vigentes,
        ),
      );
      const { entram, saem } = diferencaDestinos(vigentes, d.destinos);
      for (const destino of saem)
        await t.e.executar(
          `UPDATE local_atendimento_encaminhamento SET excluido_em = ?, excluido_por = ?, alterado_em = ?, alterado_por = ?,
                  versao = versao + 1
            WHERE local_atendimento_id = ? AND destino_local_atendimento_id = ? AND excluido_em IS NULL`,
          [t.agora, t.usuario, t.agora, t.usuario, id, destino],
        );
      for (const destino of entram) {
        // O par retirado antes volta na mesma linha (a chave única do par não deixa duplicar).
        const volta = await t.e.executar(
          `UPDATE local_atendimento_encaminhamento SET excluido_em = NULL, excluido_por = NULL, alterado_em = ?,
                  alterado_por = ?, versao = versao + 1
            WHERE local_atendimento_id = ? AND destino_local_atendimento_id = ? AND excluido_em IS NOT NULL`,
          [t.agora, t.usuario, id, destino],
        );
        if (volta === 0)
          await t.e.inserir(
            `INSERT INTO local_atendimento_encaminhamento (local_atendimento_id, destino_local_atendimento_id, criado_em,
                    criado_por) VALUES (?, ?, ?, ?)`,
            [id, destino, t.agora, t.usuario],
          );
      }
      await t.e.executar(
        `UPDATE local_atendimento SET alterado_em = ?, alterado_por = ?, versao = versao + 1 WHERE id = ?`,
        [t.agora, t.usuario, id],
      );
      await t.trilha(
        'alteracao',
        TABELA_DESTINO,
        id,
        { destinos: vigentes },
        { destinos: d.destinos, entram, saem },
      );
    });
  }

  situacao(c: ContextoRecepcao, a: AutorEstrutura, id: number, s: SituacaoEstrutura): Promise<void> {
    return this.gravar(c, a, async (t) => {
      const atual = await this.localTravado(t, id);
      if (num(atual['versao']) !== s.versao) throw versaoAntiga();
      if (!s.ativo) {
        const hoje = horaCivil(t.agora, t.est.fuso).slice(0, 10);
        const abertos = await t.e.uma(
          'SELECT COUNT(*) AS n FROM ocupacao_guiche WHERE fim_em IS NULL AND local_atendimento_id = ?',
          [id],
        );
        const senhas = await t.e.uma(
          `SELECT COUNT(*) AS n FROM senha_emitida
            WHERE data_referencia = ? AND situacao IN ${EM_ABERTO} AND local_atendimento_id = ?`,
          [hoje, id],
        );
        exigirSemRecusa([
          bloqueioDesativarLocal({
            guichesAbertos: num(abertos?.['n'] ?? 0),
            senhasEmAberto: num(senhas?.['n'] ?? 0),
          }),
        ]);
      }
      const n = await t.e.executar(
        `UPDATE local_atendimento SET ativo = ?, alterado_em = ?, alterado_por = ?, versao = versao + 1
          WHERE id = ? AND versao = ?`,
        [s.ativo, t.agora, t.usuario, id, s.versao],
      );
      if (n === 0) throw versaoAntiga();
      await t.trilha('alteracao', TABELA, id, { ativo: bool(atual['ativo']) }, { ativo: s.ativo }, s.motivo);
    });
  }
}
