// C1-112 (09-AREA linha 74), no banco do cliente: destino do corpo após o óbito. As regras são as puras de
// @sgh/dominio-internacao (destino-corpo.ts); aqui ficam a leitura e a gravação pelo executor (trilha na mesma
// transação). Contrato de efeito:
//   - funerárias do estabelecimento em `servico_funerario` (nome único no estabelecimento, telefones só com dígitos);
//     alterar exige a versão; sair de uso e voltar mudam `ativo` (nada se apaga);
//   - a escolha na declaração de óbito: `declaracao_obito.servico_funerario_id` e `cartorio_registro_civil_id`, com a
//     versão da declaração; cancelada recusa; o que entra de novo tem de estar em uso. A guarda ainda aberta do mesmo
//     paciente acompanha a funerária escolhida;
//   - a guarda do corpo em `liberacao_corpo` ('em_guarda'), uma por atendimento, ligada à declaração, com o instante do
//     óbito da declaração, a internação do atendimento e a funerária da declaração; a liberação grava quem retira
//     (funerária, nome, CPF só com dígitos ou documento, parentesco), as conferências, o instante e o usuário que
//     liberou; a retirada grava o instante; o encaminhamento marca `encaminhado_iml`; o cancelamento acrescenta o motivo
//     à observação. Nada é apagado.
import {
  type AcaoLiberacaoCorpo,
  ACOES_LIBERACAO_CORPO,
  conferirAberturaGuarda,
  decidirAcaoLiberacao,
  decidirDestinoDeclaracao,
  pendenciasDestinoCorpo,
  type ProblemaDestinoCorpo,
  type SituacaoLiberacaoCorpo,
  validarFuneraria,
} from '@sgh/dominio-internacao';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  type NucleoPortaPropria,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_DESTINO_CORPO = Symbol('PORTA_DESTINO_CORPO');

const TABELAS = ['servico_funerario', 'declaracao_obito', 'liberacao_corpo'];

const id = z.number().int().positive();
const idOuNull = id.nullable().default(null);
const versao = z.number().int().positive();
const texto = (max: number) => z.string().max(max).nullable().default(null);
const instante = z.string().datetime({ offset: true }).nullable().default(null);

const esquemaFuneraria = z
  .object({
    nome: z.string().max(200),
    telefone: texto(30),
    telefonePlantao: texto(30),
    email: texto(254),
    documentosExigidos: texto(1000),
    observacao: texto(1000),
  })
  .strict();
const esquemaAlterarFuneraria = esquemaFuneraria.extend({ versao }).strict();
const esquemaUso = z.object({ ativo: z.boolean(), versao }).strict();
const esquemaDestino = z.object({ funeraria: idOuNull, cartorio: idOuNull, versao }).strict();
const esquemaGuarda = z
  .object({ declaracao: id, entradaNecroterio: instante, localGuarda: texto(60), observacao: texto(2000) })
  .strict();
const esquemaAcao = z
  .object({
    acao: z.enum(ACOES_LIBERACAO_CORPO),
    versao,
    funeraria: idOuNull,
    retiranteNome: texto(150),
    retiranteCpf: texto(14),
    retiranteDocumento: texto(30),
    parentesco: idOuNull,
    documentosConferidos: z.boolean().default(false),
    declaracaoEntregue: z.boolean().default(false),
    pertencesEntregues: z.boolean().default(false),
    retiradaEm: instante,
    motivo: texto(500),
  })
  .strict();

export interface FunerariaLida {
  readonly id: number;
  readonly nome: string;
  readonly telefone: string | null;
  readonly telefonePlantao: string | null;
  readonly email: string | null;
  readonly documentosExigidos: string | null;
  readonly observacao: string | null;
  readonly ativo: boolean;
  readonly versao: number;
}

export interface GuardaLida {
  readonly id: number;
  readonly situacao: SituacaoLiberacaoCorpo;
  readonly entradaNecroterio: string | null;
  readonly localGuarda: string | null;
  readonly encaminhadoIml: boolean;
  readonly funeraria: number | null;
  readonly retiranteNome: string | null;
  readonly documentosConferidos: boolean;
  readonly declaracaoEntregue: boolean;
  readonly pertencesEntregues: boolean;
  readonly liberadoEm: string | null;
  readonly retiradoEm: string | null;
  readonly versao: number;
}

export interface ObitoDestinoLido {
  readonly declaracao: number;
  readonly versao: number;
  readonly paciente: number;
  readonly pacienteNome: string | null;
  readonly atendimento: number;
  readonly numero: string | null;
  readonly situacao: 'rascunho' | 'emitida' | 'cancelada';
  readonly obitoEm: string;
  readonly encaminhadoServicoVerificacao: boolean;
  readonly funeraria: { id: number; nome: string; telefonePlantao: string | null } | null;
  readonly cartorio: { id: number; descricao: string } | null;
  readonly guarda: GuardaLida | null;
  readonly pendencias: string[];
}

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

function recusou(titulo: string, problemas: readonly ProblemaDestinoCorpo[]): never {
  throw recusaRegra(titulo, problemas);
}

async function travada(tx: TxOperacao, sql: string, p: unknown[]): Promise<Record<string, unknown> | null> {
  return (await tx.consultarParaAtualizar(sql, p))[0] ?? null;
}

const SQL_OBITOS = `SELECT d.id, d.versao, d.paciente_id, d.atendimento_id, d.numero, d.situacao, d.obito_em,
       d.encaminhado_servico_verificacao, d.servico_funerario_id, d.cartorio_registro_civil_id,
       pf.nome AS paciente_nome, sf.nome AS funeraria_nome, sf.telefone_plantao AS funeraria_plantao,
       cr.descricao AS cartorio_descricao,
       g.id AS g_id, g.situacao AS g_situacao, g.data_hora_entrada_necroterio AS g_entrada, g.local_guarda AS g_local,
       g.encaminhado_iml AS g_iml, g.servico_funerario_id AS g_funeraria, g.retirante_nome AS g_retirante,
       g.documentos_conferidos AS g_docs, g.declaracao_obito_entregue AS g_entregue,
       g.pertences_entregues AS g_pertences, g.data_hora_liberacao AS g_liberado, g.data_hora_retirada AS g_retirado,
       g.versao AS g_versao
  FROM declaracao_obito d
  JOIN paciente p ON p.id = d.paciente_id
  LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
  LEFT JOIN servico_funerario sf ON sf.id = d.servico_funerario_id
  LEFT JOIN cartorio_registro_civil cr ON cr.id = d.cartorio_registro_civil_id
  LEFT JOIN liberacao_corpo g ON g.atendimento_id = d.atendimento_id AND g.excluido_em IS NULL
 WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL`;
const VIGENTE = " AND d.situacao <> 'cancelada'";

function obitoDaLinha(r: Record<string, unknown>): ObitoDestinoLido {
  const situacao = String(r['situacao']) as ObitoDestinoLido['situacao'];
  const guarda: GuardaLida | null = r['g_id']
    ? {
        id: num(r['g_id']),
        situacao: String(r['g_situacao']) as SituacaoLiberacaoCorpo,
        entradaNecroterio: iso(r['g_entrada']),
        localGuarda: txtOuNull(r['g_local']),
        encaminhadoIml: bool(r['g_iml']),
        funeraria: numOuNull(r['g_funeraria']),
        retiranteNome: txtOuNull(r['g_retirante']),
        documentosConferidos: bool(r['g_docs']),
        declaracaoEntregue: bool(r['g_entregue']),
        pertencesEntregues: bool(r['g_pertences']),
        liberadoEm: iso(r['g_liberado']),
        retiradoEm: iso(r['g_retirado']),
        versao: num(r['g_versao']),
      }
    : null;
  return {
    declaracao: num(r['id']),
    versao: num(r['versao']),
    paciente: num(r['paciente_id']),
    pacienteNome: txtOuNull(r['paciente_nome']),
    atendimento: num(r['atendimento_id']),
    numero: txtOuNull(r['numero']),
    situacao,
    obitoEm: iso(r['obito_em']) ?? '',
    encaminhadoServicoVerificacao: bool(r['encaminhado_servico_verificacao']),
    funeraria: r['servico_funerario_id']
      ? {
          id: num(r['servico_funerario_id']),
          nome: String(r['funeraria_nome']),
          telefonePlantao: txtOuNull(r['funeraria_plantao']),
        }
      : null,
    cartorio: r['cartorio_registro_civil_id']
      ? { id: num(r['cartorio_registro_civil_id']), descricao: String(r['cartorio_descricao']) }
      : null,
    guarda,
    pendencias: pendenciasDestinoCorpo({
      declaracao: situacao,
      funerariaEscolhida: r['servico_funerario_id'] != null,
      cartorioEscolhido: r['cartorio_registro_civil_id'] != null,
      guarda: guarda?.situacao ?? null,
    }),
  };
}

function funerariaDaLinha(r: Record<string, unknown>): FunerariaLida {
  return {
    id: num(r['id']),
    nome: String(r['nome']),
    telefone: txtOuNull(r['telefone']),
    telefonePlantao: txtOuNull(r['telefone_plantao']),
    email: txtOuNull(r['email']),
    documentosExigidos: txtOuNull(r['documentos_exigidos']),
    observacao: txtOuNull(r['observacao']),
    ativo: bool(r['ativo']),
    versao: num(r['versao']),
  };
}

const nomeRepetido = () =>
  new ErroOperacao(
    409,
    'nome-repetido',
    'Funerária não gravada',
    'Já existe funerária com este nome no estabelecimento.',
  );

export class PortaDestinoCorpoPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: NucleoPortaPropria, cliente: string) {
    super(nucleo, cliente, TABELAS, 'internacao.destino-corpo');
  }

  // ── Funerárias ──

  funerarias(c: ContextoPortaPropria, todas = false): Promise<FunerariaLida[]> {
    return this.ler(c, 'funerarias', async (l, est) =>
      (
        await l.consultar(
          `SELECT id, nome, telefone, telefone_plantao, email, documentos_exigidos, observacao, ativo, versao
             FROM servico_funerario WHERE estabelecimento_id = ? AND excluido_em IS NULL ${todas ? '' : 'AND ativo'}
            ORDER BY ativo DESC, nome`,
          [est.id],
        )
      ).map(funerariaDaLinha),
    );
  }

  /** Apoio dos combos: funerárias e cartórios em uso (o cartório padrão primeiro) e os tipos de parentesco. */
  apoio(c: ContextoPortaPropria) {
    return this.ler(c, 'apoio', async (l, est) => ({
      funerarias: (
        await l.consultar(
          `SELECT id, nome, telefone, telefone_plantao, email, documentos_exigidos, observacao, ativo, versao
             FROM servico_funerario WHERE estabelecimento_id = ? AND excluido_em IS NULL AND ativo ORDER BY nome`,
          [est.id],
        )
      ).map(funerariaDaLinha),
      cartorios: (
        await l.consultar(
          'SELECT id, descricao, padrao FROM cartorio_registro_civil WHERE ativo ORDER BY padrao DESC, descricao',
        )
      ).map((r) => ({ id: num(r['id']), descricao: String(r['descricao']), padrao: bool(r['padrao']) })),
      parentescos: (
        await l.consultar(
          'SELECT id, descricao FROM tipo_parentesco WHERE ativo AND NOT proprio_paciente ORDER BY descricao',
        )
      ).map((r) => ({ id: num(r['id']), descricao: String(r['descricao']) })),
    }));
  }

  async incluirFuneraria(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaFuneraria, entrada);
    const v = validarFuneraria(e);
    if (!v.ok) recusou('Funerária não gravada', v.problemas);
    const f = v.valor;
    return this.gravar(c, 'internacao.funeraria.incluir', ['servico_funerario'], async (tx, est) => {
      if (
        await tx.uma('SELECT id FROM servico_funerario WHERE estabelecimento_id = ? AND nome = ?', [
          est.id,
          f.nome,
        ])
      )
        throw nomeRepetido();
      const novo = await tx.incluir('servico_funerario', {
        estabelecimento_id: est.id,
        nome: f.nome,
        telefone: f.telefone,
        telefone_plantao: f.telefonePlantao,
        email: f.email,
        documentos_exigidos: f.documentosExigidos,
        observacao: f.observacao,
        ativo: true,
        origem: 'sistema',
      });
      return { tabela: 'servico_funerario', id: novo };
    });
  }

  private async funerariaDoEstabelecimento(tx: TxOperacao, est: number, funeraria: number) {
    const f = await travada(
      tx,
      'SELECT id, nome, ativo, versao FROM servico_funerario WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [funeraria, est],
    );
    if (!f) throw naoEncontrado('Funerária');
    return f;
  }

  async alterarFuneraria(
    c: ContextoPortaPropria,
    funeraria: number,
    entrada: unknown,
  ): Promise<{ id: number }> {
    const e = entradaValida(esquemaAlterarFuneraria, entrada);
    const v = validarFuneraria(e);
    if (!v.ok) recusou('Funerária não gravada', v.problemas);
    const f = v.valor;
    return this.gravar(c, 'internacao.funeraria.alterar', ['servico_funerario'], async (tx, est) => {
      await this.funerariaDoEstabelecimento(tx, est.id, funeraria);
      if (
        await tx.uma(
          'SELECT id FROM servico_funerario WHERE estabelecimento_id = ? AND nome = ? AND id <> ?',
          [est.id, f.nome, funeraria],
        )
      )
        throw nomeRepetido();
      await tx.alterar('servico_funerario', funeraria, e.versao, {
        nome: f.nome,
        telefone: f.telefone,
        telefone_plantao: f.telefonePlantao,
        email: f.email,
        documentos_exigidos: f.documentosExigidos,
        observacao: f.observacao,
      });
      return { tabela: 'servico_funerario', id: funeraria };
    });
  }

  async usoFuneraria(
    c: ContextoPortaPropria,
    funeraria: number,
    entrada: unknown,
  ): Promise<{ id: number; ativo: boolean }> {
    const e = entradaValida(esquemaUso, entrada);
    return this.gravar(
      c,
      e.ativo ? 'internacao.funeraria.voltar' : 'internacao.funeraria.tirar-de-uso',
      ['servico_funerario'],
      async (tx, est) => {
        await this.funerariaDoEstabelecimento(tx, est.id, funeraria);
        await tx.alterar('servico_funerario', funeraria, e.versao, { ativo: e.ativo });
        return { tabela: 'servico_funerario', id: funeraria, ativo: e.ativo };
      },
    );
  }

  // ── Óbitos e destino do corpo ──

  /** Painel: óbitos do estabelecimento com destino ainda em aberto (ou todos, com `todos`), do mais recente. */
  obitos(c: ContextoPortaPropria, todos = false): Promise<ObitoDestinoLido[]> {
    return this.ler(c, 'obitos', async (l, est) => {
      const linhas = await l.consultar(
        `${SQL_OBITOS}${VIGENTE} ORDER BY d.obito_em DESC, d.id DESC LIMIT 200`,
        [est.id],
      );
      const itens = linhas.map(obitoDaLinha);
      return todos ? itens : itens.filter((i) => i.pendencias.length > 0);
    });
  }

  /** Visão por paciente: a declaração vigente com o destino do corpo. */
  obitoDoPaciente(c: ContextoPortaPropria, paciente: number): Promise<ObitoDestinoLido | null> {
    return this.ler(c, 'obito-paciente', async (l, est) => {
      const r = await l.uma(
        `${SQL_OBITOS}${VIGENTE} AND d.paciente_id = ? ORDER BY d.obito_em DESC, d.id DESC LIMIT 1`,
        [est.id, paciente],
      );
      return r ? obitoDaLinha(r) : null;
    });
  }

  private async lerDestino(l: Leitor, est: number, declaracao: number): Promise<ObitoDestinoLido> {
    const r = await l.uma(`${SQL_OBITOS} AND d.id = ?`, [est, declaracao]);
    if (!r) throw naoEncontrado('Declaração de óbito');
    return obitoDaLinha(r);
  }

  /** A funerária e o cartório escolhidos na declaração; a guarda aberta acompanha a funerária. */
  async definirDestino(
    c: ContextoPortaPropria,
    declaracao: number,
    entrada: unknown,
  ): Promise<{ id: number }> {
    const e = entradaValida(esquemaDestino, entrada);
    return this.gravar(
      c,
      'internacao.destino-corpo.definir',
      ['declaracao_obito', 'liberacao_corpo'],
      async (tx, est) => {
        const d = await travada(
          tx,
          `SELECT id, situacao, versao, atendimento_id, servico_funerario_id, cartorio_registro_civil_id
             FROM declaracao_obito WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [declaracao, est.id],
        );
        if (!d) throw naoEncontrado('Declaração de óbito');
        const f = e.funeraria
          ? await tx.uma(
              'SELECT ativo FROM servico_funerario WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
              [e.funeraria, est.id],
            )
          : null;
        if (e.funeraria && !f) throw naoEncontrado('Funerária');
        const cart = e.cartorio
          ? await tx.uma('SELECT ativo FROM cartorio_registro_civil WHERE id = ?', [e.cartorio])
          : null;
        if (e.cartorio && !cart) throw naoEncontrado('Cartório de registro civil');
        const v = decidirDestinoDeclaracao({
          situacaoDeclaracao: String(d['situacao']) as 'rascunho' | 'emitida' | 'cancelada',
          funeraria: f ? { ativo: bool(f['ativo']) } : null,
          funerariaMudou: numOuNull(d['servico_funerario_id']) !== e.funeraria,
          cartorio: cart ? { ativo: bool(cart['ativo']) } : null,
          cartorioMudou: numOuNull(d['cartorio_registro_civil_id']) !== e.cartorio,
        });
        if (!v.ok) recusou('Destino não gravado', v.problemas);
        await tx.alterar('declaracao_obito', declaracao, e.versao, {
          servico_funerario_id: e.funeraria,
          cartorio_registro_civil_id: e.cartorio,
        });
        const g = await travada(
          tx,
          `SELECT id, versao, servico_funerario_id FROM liberacao_corpo
            WHERE atendimento_id = ? AND situacao = 'em_guarda' AND excluido_em IS NULL`,
          [num(d['atendimento_id'])],
        );
        if (g && numOuNull(g['servico_funerario_id']) !== e.funeraria)
          await tx.alterar('liberacao_corpo', num(g['id']), num(g['versao']), {
            servico_funerario_id: e.funeraria,
          });
        return { tabela: 'declaracao_obito', id: declaracao };
      },
    );
  }

  /** Abre a guarda do corpo no necrotério a partir da declaração. */
  async abrirGuarda(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaGuarda, entrada);
    return this.gravar(c, 'internacao.corpo.guardar', ['liberacao_corpo'], async (tx, est) => {
      const d = await tx.uma(
        `SELECT id, paciente_id, atendimento_id, obito_em, servico_funerario_id FROM declaracao_obito
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelada'`,
        [e.declaracao, est.id],
      );
      if (!d) throw naoEncontrado('Declaração de óbito');
      const ja = await tx.consultarParaAtualizar('SELECT id FROM liberacao_corpo WHERE atendimento_id = ?', [
        num(d['atendimento_id']),
      ]);
      const entrada = e.entradaNecroterio ? new Date(e.entradaNecroterio) : null;
      const v = conferirAberturaGuarda({
        obitoEm: new Date(d['obito_em'] as string),
        entradaNecroterioEm: entrada,
        agora: new Date(),
        jaHaGuardaDoAtendimento: ja.length > 0,
      });
      if (!v.ok) recusou('Guarda não registrada', v.problemas);
      const int = await tx.uma(
        'SELECT id FROM internacao WHERE atendimento_id = ? AND excluido_em IS NULL ORDER BY id DESC LIMIT 1',
        [num(d['atendimento_id'])],
      );
      const novo = await tx.incluir('liberacao_corpo', {
        estabelecimento_id: est.id,
        paciente_id: num(d['paciente_id']),
        atendimento_id: num(d['atendimento_id']),
        internacao_id: int ? num(int['id']) : null,
        declaracao_obito_id: e.declaracao,
        data_hora_obito: d['obito_em'],
        data_hora_entrada_necroterio: entrada,
        local_guarda: txtOuNull(e.localGuarda?.trim() || null),
        servico_funerario_id: numOuNull(d['servico_funerario_id']),
        situacao: 'em_guarda',
        observacao: txtOuNull(e.observacao?.trim() || null),
        origem: 'sistema',
      });
      return { tabela: 'liberacao_corpo', id: novo };
    });
  }

  /** Liberar, registrar a retirada, encaminhar ao serviço de verificação ou cancelar a guarda. */
  async acaoGuarda(
    c: ContextoPortaPropria,
    guarda: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: SituacaoLiberacaoCorpo }> {
    const e = entradaValida(esquemaAcao, entrada);
    const acao: AcaoLiberacaoCorpo = e.acao;
    return this.gravar(
      c,
      `internacao.corpo.${acao.replace('_', '-')}`,
      ['liberacao_corpo'],
      async (tx, est, usuario) => {
        const g = await travada(
          tx,
          'SELECT * FROM liberacao_corpo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [guarda, est.id],
        );
        if (!g) throw naoEncontrado('Guarda do corpo');
        const d = g['declaracao_obito_id']
          ? await tx.uma('SELECT situacao FROM declaracao_obito WHERE id = ?', [
              num(g['declaracao_obito_id']),
            ])
          : null;
        const funerariaId = acao === 'liberar' ? (e.funeraria ?? numOuNull(g['servico_funerario_id'])) : null;
        const f = funerariaId ? await this.funerariaDoEstabelecimento(tx, est.id, funerariaId) : null;
        const agora = new Date();
        const v = decidirAcaoLiberacao(String(g['situacao']) as SituacaoLiberacaoCorpo, acao, {
          agora,
          obitoEm: new Date(g['data_hora_obito'] as string),
          liberadoEm: g['data_hora_liberacao'] ? new Date(g['data_hora_liberacao'] as string) : null,
          declaracao: d ? (String(d['situacao']) as 'rascunho' | 'emitida' | 'cancelada') : null,
          funeraria: f ? { ativo: bool(f['ativo']) } : null,
          retiranteNome: e.retiranteNome,
          retiranteCpf: e.retiranteCpf,
          retiranteDocumento: e.retiranteDocumento,
          documentosConferidos: e.documentosConferidos,
          declaracaoEntregue: e.declaracaoEntregue,
          retiradaEm: e.retiradaEm ? new Date(e.retiradaEm) : null,
          motivo: e.motivo,
        });
        if (!v.ok) recusou('Guarda não alterada', v.problemas);
        const campos: Record<string, unknown> = { situacao: v.nova };
        if (acao === 'liberar')
          Object.assign(campos, {
            servico_funerario_id: funerariaId,
            retirante_nome: e.retiranteNome?.trim() ?? null,
            retirante_cpf: v.retiranteCpf,
            retirante_documento: e.retiranteDocumento?.trim() || null,
            retirante_tipo_parentesco_id: e.parentesco,
            documentos_conferidos: true,
            declaracao_obito_entregue: true,
            pertences_entregues: e.pertencesEntregues,
            data_hora_liberacao: agora,
            liberacao_usuario_id: usuario,
          });
        if (acao === 'retirar') campos['data_hora_retirada'] = new Date(e.retiradaEm!);
        if (acao === 'encaminhar_iml') campos['encaminhado_iml'] = true;
        if (acao === 'cancelar') {
          const antes = txtOuNull(g['observacao']);
          campos['observacao'] = `${antes ? `${antes}\n` : ''}Cancelada: ${e.motivo!.trim()}`;
        }
        await tx.alterar('liberacao_corpo', guarda, e.versao, campos);
        return { tabela: 'liberacao_corpo', id: guarda, situacao: v.nova };
      },
    );
  }

  /** Releitura do destino de uma declaração (para a tela, depois de gravar). */
  destino(c: ContextoPortaPropria, declaracao: number): Promise<ObitoDestinoLido> {
    return this.ler(c, 'destino', (l, est) => this.lerDestino(l, est.id, declaracao));
  }
}
