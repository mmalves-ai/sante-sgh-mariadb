// Chamado de ambulância (remoção) com trajeto e cobrança por quilômetro, e maqueiro do transporte interno (C2-068,
// 04-INT linha 83), no banco do cliente. As regras são as puras de @sgh/dominio-internacao (chamado-ambulancia.ts); a
// cobrança usa a regra de cobrança de ambulância do faturamento (lancarRemocaoNaConta). Contrato de efeito:
//   - solicitar: `chamado_ambulancia` com número de negócio, paciente e atendimento (fonte pagadora, setor de origem),
//     categoria, destino (estabelecimento, trajeto padrão ou endereço), posição, previsão e contato; situação
//     'solicitado'; pedido de transporte informado ganha o chamado (solicitacao_transporte_paciente.chamado_ambulancia_id);
//   - aprovar: veículo e equipe (`chamado_ambulancia_equipe`, a equipe mínima da categoria), quem aprovou e quando;
//   - reprovar: o motivo, quem reprovou e quando; cancelar: motivo do cadastro antes da saída;
//   - sair: hora e hodômetro da saída (atraso opcional), situação 'em_transito';
//   - concluir: fim do trajeto e hodômetro final; o veículo fica com o hodômetro novo (ambulancia.quilometragem_atual);
//     com a conta aberta do atendimento e a regra de cobrança, a remoção entra na conta na mesma transação
//     (conta_hospitalar_item por trajeto ou pelos quilômetros rodados, com a memória) e o chamado guarda o item; sem
//     conta ou sem regra, conclui e devolve a cobrança pendente, lançada depois por 'cobrar' (nunca duas vezes);
//   - maqueiro: solicitacao_transporte_paciente.maqueiro_profissional_id no pedido interno antes da saída.
// Nada se apaga; cada ação confere a versão lida e grava a trilha pelo executor.
import {
  conferirAcaoChamado,
  conferirChamadoAmbulancia,
  conferirMaqueiro,
  FUNCOES_EQUIPE_AMBULANCIA,
  ordenarFilaChamados,
  POSICOES_CHAMADO_AMBULANCIA,
  quilometrosRodados,
  SITUACOES_CHAMADO_AMBULANCIA,
  TIPOS_CHAMADO_AMBULANCIA,
  type AcaoChamadoAmbulancia,
} from '@sgh/dominio-internacao';
import { SITUACOES_CONTA_EDITAVEL } from '@sgh/dominio-faturamento';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';
import { lancarRemocaoNaConta, TABELAS_LANCAR_REMOCAO } from '../faturamento/regras-comerciais-propria.js';

export const PORTA_CHAMADO_AMBULANCIA = Symbol('PORTA_CHAMADO_AMBULANCIA');

const T_CHAMADO = 'chamado_ambulancia';
const T_EQUIPE = 'chamado_ambulancia_equipe';
const T_TRANSPORTE = 'solicitacao_transporte_paciente';
const T_VEICULO = 'ambulancia';
const T_SEQUENCIA = 'sequencia_negocio';
const TABELAS = [T_CHAMADO, T_EQUIPE, T_TRANSPORTE, T_VEICULO, T_SEQUENCIA, ...TABELAS_LANCAR_REMOCAO];
const TIPO_NUMERO = 'chamado_ambulancia';

const OPERACAO: Record<AcaoChamadoAmbulancia, string> = {
  aprovar: 'internacao.ambulancia.aprovar',
  reprovar: 'internacao.ambulancia.reprovar',
  sair: 'internacao.ambulancia.sair',
  concluir: 'internacao.ambulancia.concluir',
  cancelar: 'internacao.ambulancia.cancelar',
};

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : (v instanceof Date ? v : new Date(String(v))).toISOString();
const quando = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));
const id = z.number().int().positive();
const idOuNull = id.nullable().default(null);
const versao = z.number().int().positive();
const texto = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((s) => (s ? s : null));
const km = z.number().int().min(0).max(9_999_999);

const esquemaSolicitar = z
  .object({
    atendimento: id,
    transporte: idOuNull,
    tipo: z.enum(TIPOS_CHAMADO_AMBULANCIA),
    categoria: id,
    rota: idOuNull,
    destinoExterno: idOuNull,
    destinoLogradouro: texto(150),
    destinoNumero: texto(10),
    destinoBairro: texto(100),
    destinoCep: texto(8),
    posicao: z.enum(POSICOES_CHAMADO_AMBULANCIA).nullable().default(null),
    previsto: quando.nullable().default(null),
    contato: texto(20),
    observacao: texto(2000),
  })
  .strict();

const esquemaFiltro = z
  .object({
    situacao: z.enum([...SITUACOES_CHAMADO_AMBULANCIA, 'abertos']).optional(),
    paciente: z.coerce.number().int().positive().optional(),
    atendimento: z.coerce.number().int().positive().optional(),
  })
  .strict();

export interface ChamadoAmbulanciaLido {
  readonly id: number;
  readonly versao: number;
  readonly numero: string;
  readonly tipo: string;
  readonly situacao: string;
  readonly paciente: number;
  readonly pacienteNome: string | null;
  readonly atendimento: number | null;
  readonly categoria: number;
  readonly categoriaNome: string | null;
  readonly ambulancia: number | null;
  readonly ambulanciaPlaca: string | null;
  readonly rota: number | null;
  readonly rotaNome: string | null;
  readonly destino: string | null;
  readonly posicao: string | null;
  readonly solicitado: string;
  readonly previsto: string | null;
  readonly saida: string | null;
  readonly fim: string | null;
  readonly kmInicial: number | null;
  readonly kmFinal: number | null;
  readonly kmRodados: number | null;
  readonly itemConta: number | null;
  readonly motivoReprovacao: string | null;
  readonly equipe: { profissional: number; nome: string | null; funcao: string }[];
}

const SELECT_CHAMADO = `
  SELECT c.*, COALESCE(p.nome_social, pf.nome) AS paciente_nome, ca.descricao AS categoria_nome, a.placa,
         r.descricao AS rota_nome, ee.nome AS externo_nome
    FROM chamado_ambulancia c
    JOIN paciente p ON p.id = c.paciente_id
    LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN categoria_ambulancia ca ON ca.id = c.categoria_ambulancia_id
    LEFT JOIN ambulancia a ON a.id = c.ambulancia_id
    LEFT JOIN rota_ambulancia r ON r.id = c.rota_ambulancia_id
    LEFT JOIN estabelecimento_externo ee ON ee.id = c.destino_estabelecimento_externo_id`;

function lido(x: Record<string, unknown>, equipe: ChamadoAmbulanciaLido['equipe']): ChamadoAmbulanciaLido {
  const ini = numOuNull(x['quilometragem_inicial']);
  const fin = numOuNull(x['quilometragem_final']);
  const endereco = [x['destino_logradouro'], x['destino_numero'], x['destino_bairro']]
    .filter(Boolean)
    .join(', ');
  return {
    id: num(x['id']),
    versao: num(x['versao']),
    numero: String(x['numero']),
    tipo: String(x['tipo_solicitacao']),
    situacao: String(x['situacao']),
    paciente: num(x['paciente_id']),
    pacienteNome: txtOuNull(x['paciente_nome']),
    atendimento: numOuNull(x['atendimento_id']),
    categoria: num(x['categoria_ambulancia_id']),
    categoriaNome: txtOuNull(x['categoria_nome']),
    ambulancia: numOuNull(x['ambulancia_id']),
    ambulanciaPlaca: txtOuNull(x['placa']),
    rota: numOuNull(x['rota_ambulancia_id']),
    rotaNome: txtOuNull(x['rota_nome']),
    destino: txtOuNull(x['externo_nome']) ?? txtOuNull(x['rota_nome']) ?? (endereco || null),
    posicao: txtOuNull(x['posicao_paciente']),
    solicitado: iso(x['solicitado_em'])!,
    previsto: iso(x['previsto_para']),
    saida: iso(x['saida_em']),
    fim: iso(x['fim_trajeto_em']),
    kmInicial: ini,
    kmFinal: fin,
    kmRodados: quilometrosRodados(ini, fin),
    itemConta: numOuNull(x['conta_hospitalar_item_id']),
    motivoReprovacao: txtOuNull(x['motivo_reprovacao']),
    equipe,
  };
}

async function exigir(l: Leitor, sql: string, p: unknown[], oQue: string): Promise<Record<string, unknown>> {
  const r = await l.uma(sql, p);
  if (!r) throw naoEncontrado(oQue);
  return r;
}

/** Resultado da cobrança no fim do chamado. */
export type CobrancaChamado =
  | { situacao: 'lancada'; contaId: number; itemId: number; quantidade: number }
  | { situacao: 'pendente'; motivo: string };

export class PortaChamadoAmbulanciaPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'internacao.ambulancia');
  }

  /** Cadastros para as escolhas da tela (só os ativos do estabelecimento). */
  opcoes(c: ContextoPortaPropria) {
    return this.ler(c, 'opcoes', async (l, est) => {
      const lista = async (sql: string, p: unknown[] = []) =>
        (await l.consultar(sql, p)).map((x) => ({ id: num(x['id']), nome: String(x['nome']) }));
      return {
        categorias: (
          await l.consultar(
            'SELECT id, descricao, classificacao_nacional FROM categoria_ambulancia WHERE ativo = TRUE ORDER BY descricao LIMIT 100',
          )
        ).map((x) => ({
          id: num(x['id']),
          nome: String(x['descricao']),
          classificacao: txtOuNull(x['classificacao_nacional']),
        })),
        ambulancias: (
          await l.consultar(
            `SELECT id, placa, descricao, categoria_ambulancia_id, quilometragem_atual FROM ambulancia
              WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY placa LIMIT 200`,
            [est.id],
          )
        ).map((x) => ({
          id: num(x['id']),
          nome: `${String(x['placa'])}${x['descricao'] ? ` · ${String(x['descricao'])}` : ''}`,
          categoria: num(x['categoria_ambulancia_id']),
          quilometragem: numOuNull(x['quilometragem_atual']),
        })),
        rotas: await lista(
          `SELECT id, CONCAT(descricao, ' (', distancia_km, ' km)') AS nome FROM rota_ambulancia
            WHERE estabelecimento_id = ? AND ativo = TRUE ORDER BY descricao LIMIT 200`,
          [est.id],
        ),
        destinos: await lista(
          'SELECT id, nome FROM estabelecimento_externo WHERE excluido_em IS NULL ORDER BY nome LIMIT 500',
        ),
        motivosCancelamento: await lista(
          `SELECT id, descricao AS nome FROM motivo_cancelamento_transporte
            WHERE ativo = TRUE AND tipo_uso IN ('cancelamento', 'ambos') ORDER BY descricao LIMIT 100`,
        ),
        motivosAtraso: await lista(
          `SELECT id, descricao AS nome FROM motivo_atraso_transporte
            WHERE ativo = TRUE AND aplica_a IN ('ambulancia', 'ambos') ORDER BY descricao LIMIT 100`,
        ),
        profissionais: (
          await l.consultar(
            `SELECT t.profissional_id, t.funcao_transporte, t.tipo_transporte,
                    COALESCE(pr.nome_exibicao, pf.nome) AS nome
               FROM profissional_transporte t
               JOIN profissional pr ON pr.id = t.profissional_id
               LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
              WHERE t.estabelecimento_id = ? AND t.ativo = TRUE AND t.excluido_em IS NULL
              ORDER BY nome LIMIT 500`,
            [est.id],
          )
        ).map((x) => ({
          id: num(x['profissional_id']),
          nome: String(x['nome'] ?? ''),
          funcao: String(x['funcao_transporte']),
          tipo: String(x['tipo_transporte']),
        })),
        funcoes: FUNCOES_EQUIPE_AMBULANCIA,
      };
    });
  }

  /** Fila (abertos) ou histórico do paciente ou do atendimento. */
  async listar(c: ContextoPortaPropria, filtro: unknown): Promise<ChamadoAmbulanciaLido[]> {
    const f = entradaValida(esquemaFiltro, filtro ?? {});
    return this.ler(c, 'listar', async (l, est) => {
      const abertos = f.situacao === 'abertos' || (!f.situacao && !f.paciente && !f.atendimento) ? 1 : 0;
      const exata = f.situacao && f.situacao !== 'abertos' ? f.situacao : null;
      const rs = await l.consultar(
        `${SELECT_CHAMADO}
          WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL
            AND (? = 0 OR c.situacao IN ('solicitado', 'aprovado', 'em_transito'))
            AND (? IS NULL OR c.situacao = ?)
            AND (? IS NULL OR c.paciente_id = ?) AND (? IS NULL OR c.atendimento_id = ?)
          ORDER BY c.solicitado_em DESC, c.id DESC LIMIT 1000`,
        [
          est.id,
          abertos,
          exata,
          exata,
          f.paciente ?? null,
          f.paciente ?? null,
          f.atendimento ?? null,
          f.atendimento ?? null,
        ],
      );
      const ids = rs.map((x) => num(x['id']));
      const eq = ids.length
        ? await l.consultar(
            `SELECT q.chamado_ambulancia_id, q.profissional_id, q.funcao, COALESCE(pr.nome_exibicao, pf.nome) AS nome
               FROM chamado_ambulancia_equipe q
               JOIN profissional pr ON pr.id = q.profissional_id
               LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
              WHERE q.excluido_em IS NULL AND q.chamado_ambulancia_id IN (${ids.map(() => '?').join(',')})
              ORDER BY q.sequencia`,
            ids,
          )
        : [];
      const itens = rs.map((x) =>
        lido(
          x,
          eq
            .filter((q) => num(q['chamado_ambulancia_id']) === num(x['id']))
            .map((q) => ({
              profissional: num(q['profissional_id']),
              nome: txtOuNull(q['nome']),
              funcao: String(q['funcao']),
            })),
        ),
      );
      return abertos ? ordenarFilaChamados(itens) : itens;
    });
  }

  async solicitar(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number; numero: string }> {
    const e = entradaValida(esquemaSolicitar, entrada);
    return this.gravar(c, 'internacao.ambulancia.solicitar', TABELAS, async (tx, est) => {
      const agora = new Date();
      const atd = await exigir(
        tx,
        `SELECT a.id, a.paciente_id, a.fonte_pagadora_id,
                (SELECT i.unidade_internacao_id FROM internacao i WHERE i.atendimento_id = a.id AND i.excluido_em IS NULL
                  ORDER BY i.id DESC LIMIT 1) AS unidade
           FROM atendimento a WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
        [e.atendimento, est.id],
        'Atendimento',
      );
      const setor = atd['unidade']
        ? numOuNull(
            (
              await tx.uma('SELECT setor_funcional_id FROM unidade_internacao WHERE id = ?', [atd['unidade']])
            )?.['setor_funcional_id'],
          )
        : null;
      await exigir(
        tx,
        'SELECT id FROM categoria_ambulancia WHERE id = ? AND ativo = TRUE',
        [e.categoria],
        'Categoria',
      );
      if (e.rota !== null)
        await exigir(
          tx,
          'SELECT id FROM rota_ambulancia WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE',
          [e.rota, est.id],
          'Trajeto',
        );
      if (e.destinoExterno !== null)
        await exigir(
          tx,
          'SELECT id FROM estabelecimento_externo WHERE id = ? AND excluido_em IS NULL',
          [e.destinoExterno],
          'Destino',
        );
      const aberto = await tx.uma(
        `SELECT id FROM chamado_ambulancia WHERE atendimento_id = ? AND excluido_em IS NULL
            AND situacao IN ('solicitado', 'aprovado', 'em_transito') LIMIT 1`,
        [e.atendimento],
      );
      const problemas = conferirChamadoAmbulancia({
        tipo: e.tipo,
        categoria: e.categoria,
        destinoExterno: e.destinoExterno,
        rota: e.rota,
        destinoLogradouro: e.destinoLogradouro,
        destinoCep: e.destinoCep,
        previsto: e.previsto,
        agora,
        abertoNoAtendimento: !!aberto,
      });
      if (problemas.length) throw recusaRegra('Chamado de ambulância recusado', problemas);
      let pedido: Record<string, unknown> | null = null;
      if (e.transporte !== null) {
        pedido = await exigir(
          tx,
          `SELECT id, versao, paciente_id, chamado_ambulancia_id, situacao FROM solicitacao_transporte_paciente
            WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [e.transporte, est.id],
          'Pedido de transporte',
        );
        if (num(pedido['paciente_id']) !== num(atd['paciente_id']))
          throw recusaRegra('Chamado de ambulância recusado', [
            { campo: 'transporte', mensagem: 'O pedido de transporte é de outro paciente.' },
          ]);
        if (pedido['chamado_ambulancia_id'] !== null)
          throw recusaRegra('Chamado de ambulância recusado', [
            { campo: 'transporte', mensagem: 'O pedido de transporte já tem chamado de ambulância.' },
          ]);
      }
      const numero = await this.numero(tx, est.id);
      const novo = await tx.incluir(T_CHAMADO, {
        estabelecimento_id: est.id,
        numero,
        tipo_solicitacao: e.tipo,
        solicitado_em: agora,
        previsto_para: e.previsto,
        paciente_id: atd['paciente_id'],
        atendimento_id: e.atendimento,
        setor_funcional_id: setor,
        fonte_pagadora_id: atd['fonte_pagadora_id'],
        categoria_ambulancia_id: e.categoria,
        rota_ambulancia_id: e.rota,
        posicao_paciente: e.posicao,
        destino_estabelecimento_externo_id: e.destinoExterno,
        destino_cep: e.destinoCep,
        destino_logradouro: e.destinoLogradouro,
        destino_numero: e.destinoNumero,
        destino_bairro: e.destinoBairro,
        contato_telefone: e.contato,
        situacao: 'solicitado',
        observacao: e.observacao,
      });
      if (pedido)
        await tx.alterar(T_TRANSPORTE, num(pedido['id']), num(pedido['versao']), {
          chamado_ambulancia_id: novo,
        });
      return { tabela: T_CHAMADO, id: novo, numero };
    });
  }

  private async numero(tx: TxOperacao, est: number): Promise<string> {
    const seq = await tx.uma('SELECT id FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id = ?', [
      TIPO_NUMERO,
      est,
    ]);
    if (!seq)
      await tx.incluir(T_SEQUENCIA, {
        estabelecimento_id: est,
        tipo: TIPO_NUMERO,
        prefixo: 'AMB-',
        proximo_valor: 1,
        incremento: 1,
        ativo: true,
      });
    return (await tx.proximoNumero(TIPO_NUMERO)).formatado;
  }

  /** Lê o chamado travado, confere a ação no domínio e grava a situação nova com os campos da ação. */
  private agir<X extends Record<string, unknown>>(
    c: ContextoPortaPropria,
    alvo: number,
    acao: AcaoChamadoAmbulancia,
    versaoLida: number,
    montar: (
      ch: Record<string, unknown>,
      tx: TxOperacao,
      agora: Date,
      usuario: number,
    ) => Promise<{
      campos: Record<string, unknown>;
      conferir: Partial<Parameters<typeof conferirAcaoChamado>[0]>;
    }>,
    depois?: (ch: Record<string, unknown>, tx: TxOperacao, est: number) => Promise<X>,
  ): Promise<{ id: number; situacao: string } & Partial<X>> {
    return this.gravar(c, OPERACAO[acao], TABELAS, async (tx, est, usuario) => {
      const [ch] = await tx.consultarParaAtualizar(
        `SELECT c.*, ca.classificacao_nacional FROM chamado_ambulancia c
           JOIN categoria_ambulancia ca ON ca.id = c.categoria_ambulancia_id
          WHERE c.id = ? AND c.estabelecimento_id = ? AND c.excluido_em IS NULL`,
        [alvo, est.id],
        { teto: 1 },
      );
      if (!ch) throw naoEncontrado('Chamado de ambulância');
      const agora = new Date();
      const m = await montar(ch, tx, agora, usuario);
      const veiculoId = numOuNull(m.campos['ambulancia_id'] ?? ch['ambulancia_id']);
      const v = veiculoId
        ? await tx.uma(
            'SELECT categoria_ambulancia_id, ativo, quilometragem_atual FROM ambulancia WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [veiculoId, est.id],
          )
        : null;
      if (veiculoId && !v) throw naoEncontrado('Ambulância');
      const r = conferirAcaoChamado({
        acao,
        situacao: String(ch['situacao']),
        categoriaPedida: num(ch['categoria_ambulancia_id']),
        classificacao: txtOuNull(ch['classificacao_nacional']),
        veiculo: v
          ? {
              categoria: num(v['categoria_ambulancia_id']),
              ativo: bool(v['ativo']),
              quilometragemAtual: numOuNull(v['quilometragem_atual']),
            }
          : null,
        agora,
        ...m.conferir,
      });
      if (!r.situacao) throw recusaRegra('Chamado de ambulância recusado', r.problemas);
      await tx.alterar(T_CHAMADO, alvo, versaoLida, { ...m.campos, situacao: r.situacao });
      const extra = depois ? await depois({ ...ch, ...m.campos }, tx, est.id) : ({} as X);
      return { tabela: T_CHAMADO, id: alvo, situacao: r.situacao, ...extra };
    });
  }

  aprovar(c: ContextoPortaPropria, alvo: number, entrada: unknown) {
    const x = entradaValida(
      z
        .object({
          ambulancia: id,
          equipe: z
            .array(z.object({ profissional: id, funcao: z.enum(FUNCOES_EQUIPE_AMBULANCIA) }).strict())
            .max(10),
          versao,
        })
        .strict(),
      entrada,
    );
    return this.agir(
      c,
      alvo,
      'aprovar',
      x.versao,
      async (_ch, tx, agora, usuario) => {
        for (const m of x.equipe)
          await exigir(
            tx,
            'SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL',
            [m.profissional],
            'Profissional',
          );
        return {
          campos: { ambulancia_id: x.ambulancia, aprovado_em: agora, aprovado_por_usuario_id: usuario },
          conferir: { equipe: x.equipe },
        };
      },
      async (_ch, tx) => {
        let s = 0;
        for (const m of x.equipe)
          await tx.incluir(T_EQUIPE, {
            chamado_ambulancia_id: alvo,
            sequencia: ++s,
            profissional_id: m.profissional,
            funcao: m.funcao,
          });
        return {};
      },
    );
  }

  reprovar(c: ContextoPortaPropria, alvo: number, entrada: unknown) {
    const x = entradaValida(z.object({ motivo: texto(1000), versao }).strict(), entrada);
    return this.agir(c, alvo, 'reprovar', x.versao, async (_ch, _tx, agora, usuario) => ({
      campos: { motivo_reprovacao: x.motivo, reprovado_em: agora, reprovado_por_usuario_id: usuario },
      conferir: { motivoReprovacao: x.motivo },
    }));
  }

  cancelar(c: ContextoPortaPropria, alvo: number, entrada: unknown) {
    const x = entradaValida(
      z.object({ motivo: id.nullable().default(null), justificativa: texto(1000), versao }).strict(),
      entrada,
    );
    return this.agir(c, alvo, 'cancelar', x.versao, async (_ch, tx, agora) => {
      if (x.motivo !== null)
        await exigir(
          tx,
          `SELECT id FROM motivo_cancelamento_transporte
            WHERE id = ? AND ativo = TRUE AND tipo_uso IN ('cancelamento', 'ambos')`,
          [x.motivo],
          'Motivo do cancelamento',
        );
      return {
        campos: {
          cancelado_em: agora,
          motivo_cancelamento_transporte_id: x.motivo,
          justificativa_cancelamento: x.justificativa,
        },
        conferir: { motivoCancelamento: x.motivo },
      };
    });
  }

  sair(c: ContextoPortaPropria, alvo: number, entrada: unknown) {
    const x = entradaValida(
      z
        .object({
          kmInicial: km.nullable().default(null),
          saida: quando.optional(),
          motivoAtraso: idOuNull,
          versao,
        })
        .strict(),
      entrada,
    );
    return this.agir(c, alvo, 'sair', x.versao, async (_ch, tx, agora) => {
      if (x.motivoAtraso !== null)
        await exigir(
          tx,
          'SELECT id FROM motivo_atraso_transporte WHERE id = ? AND ativo = TRUE',
          [x.motivoAtraso],
          'Motivo do atraso',
        );
      const saida = x.saida ?? agora;
      return {
        campos: {
          saida_em: saida,
          quilometragem_inicial: x.kmInicial,
          saida_motivo_atraso_transporte_id: x.motivoAtraso,
        },
        conferir: { saida, kmInicial: x.kmInicial },
      };
    });
  }

  concluir(c: ContextoPortaPropria, alvo: number, entrada: unknown) {
    const x = entradaValida(
      z
        .object({
          kmFinal: km.nullable().default(null),
          fim: quando.optional(),
          motivoAtraso: idOuNull,
          versao,
        })
        .strict(),
      entrada,
    );
    return this.agir(
      c,
      alvo,
      'concluir',
      x.versao,
      async (ch, tx, agora) => {
        if (x.motivoAtraso !== null)
          await exigir(
            tx,
            'SELECT id FROM motivo_atraso_transporte WHERE id = ? AND ativo = TRUE',
            [x.motivoAtraso],
            'Motivo do atraso',
          );
        const fim = x.fim ?? agora;
        return {
          campos: {
            fim_trajeto_em: fim,
            quilometragem_final: x.kmFinal,
            fim_motivo_atraso_transporte_id: x.motivoAtraso,
          },
          conferir: {
            fim,
            kmFinal: x.kmFinal,
            kmInicial: numOuNull(ch['quilometragem_inicial']),
            saida: ch['saida_em'] ? new Date(iso(ch['saida_em'])!) : null,
          },
        };
      },
      async (ch, tx, est) => {
        // O veículo fica com o hodômetro novo; depois, a cobrança (ou a pendência).
        const v = await tx.uma('SELECT id, versao, quilometragem_atual FROM ambulancia WHERE id = ?', [
          ch['ambulancia_id'],
        ]);
        if (v && x.kmFinal !== null && (numOuNull(v['quilometragem_atual']) ?? -1) < x.kmFinal)
          await tx.alterar(T_VEICULO, num(v['id']), num(v['versao']), { quilometragem_atual: x.kmFinal });
        return { cobranca: await this.cobrarNaTransacao(tx, est, alvo, ch, false) };
      },
    );
  }

  /** Lança na conta a remoção de um chamado concluído que ficou com a cobrança pendente. */
  async cobrar(c: ContextoPortaPropria, alvo: number, entrada: unknown) {
    const x = entradaValida(z.object({ versao }).strict(), entrada);
    return this.gravar(c, 'internacao.ambulancia.cobrar', TABELAS, async (tx, est) => {
      const [ch] = await tx.consultarParaAtualizar(
        'SELECT * FROM chamado_ambulancia WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [alvo, est.id],
        { teto: 1 },
      );
      if (!ch) throw naoEncontrado('Chamado de ambulância');
      if (num(ch['versao']) !== x.versao)
        throw new ErroOperacao(
          409,
          'versao-divergente',
          'Chamado alterado',
          'O chamado mudou: recarregue e tente de novo.',
        );
      if (String(ch['situacao']) !== 'concluido')
        throw recusaRegra('Cobrança recusada', [
          { campo: 'situacao', mensagem: 'Só o chamado concluído é cobrado.' },
        ]);
      if (ch['conta_hospitalar_item_id'] !== null)
        throw recusaRegra('Cobrança recusada', [
          { campo: 'situacao', mensagem: 'A remoção deste chamado já está na conta.' },
        ]);
      const cobranca = await this.cobrarNaTransacao(tx, est.id, alvo, ch, true);
      return { tabela: T_CHAMADO, id: alvo, cobranca };
    });
  }

  /**
   * Lança a remoção na conta aberta do atendimento (trajeto ou quilômetros rodados) e guarda o item no chamado. Sem
   * conta aberta ou com recusa do faturamento: pendente (ou a recusa, quando `exigir`). Toda recusa vem antes de gravar.
   */
  private async cobrarNaTransacao(
    tx: TxOperacao,
    est: number,
    alvo: number,
    ch: Record<string, unknown>,
    exigirLancamento: boolean,
  ): Promise<CobrancaChamado> {
    const pendente = (motivo: string): CobrancaChamado => {
      if (exigirLancamento) throw recusaRegra('Cobrança recusada', [{ campo: 'conta', mensagem: motivo }]);
      return { situacao: 'pendente', motivo };
    };
    const conta = ch['atendimento_id']
      ? await tx.uma(
          `SELECT id FROM conta_hospitalar WHERE atendimento_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
              AND situacao IN (${SITUACOES_CONTA_EDITAVEL.map(() => '?').join(', ')}) ORDER BY id DESC LIMIT 1`,
          [ch['atendimento_id'], est, ...SITUACOES_CONTA_EDITAVEL],
        )
      : null;
    if (!conta)
      return pendente('O atendimento não tem conta aberta: abra a conta e lance a remoção pelo chamado.');
    const rodados = quilometrosRodados(
      numOuNull(ch['quilometragem_inicial']),
      numOuNull(ch['quilometragem_final']),
    );
    let l: { itemId: number; quantidade: number };
    try {
      l = await lancarRemocaoNaConta(
        tx,
        est,
        {
          contaId: num(conta['id']),
          categoriaAmbulanciaId: num(ch['categoria_ambulancia_id']),
          rotaId: numOuNull(ch['rota_ambulancia_id']),
          km: rodados && rodados > 0 ? rodados : null,
          comVolta: false,
          data: iso(ch['fim_trajeto_em'])?.slice(0, 10),
        },
        { chamado: alvo },
      );
    } catch (e) {
      if (e instanceof ErroOperacao && (e.problema.status ?? 500) < 500 && !exigirLancamento)
        return { situacao: 'pendente', motivo: String(e.problema.detail ?? e.message) };
      throw e;
    }
    const atual = await tx.uma('SELECT versao FROM chamado_ambulancia WHERE id = ?', [alvo]);
    await tx.alterar(T_CHAMADO, alvo, num(atual?.['versao']), { conta_hospitalar_item_id: l.itemId });
    return { situacao: 'lancada', contaId: num(conta['id']), itemId: l.itemId, quantidade: l.quantidade };
  }

  // ── Maqueiro do transporte interno ─────────────────────────────────────────────────────────────────────────────

  /** Pedidos internos e de retorno em aberto, com o maqueiro designado. */
  internos(c: ContextoPortaPropria) {
    return this.ler(c, 'internos', async (l, est) =>
      (
        await l.consultar(
          `SELECT t.id, t.versao, t.tipo, t.prioridade, t.situacao, t.previsto_em, t.solicitado_em, t.paciente_id,
                  COALESCE(p.nome_social, pf.nome) AS paciente_nome, so.nome AS origem, sd.nome AS destino,
                  t.maqueiro_profissional_id, COALESCE(pr.nome_exibicao, pm.nome) AS maqueiro_nome
             FROM solicitacao_transporte_paciente t
             JOIN paciente p ON p.id = t.paciente_id
             LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
             LEFT JOIN setor_funcional so ON so.id = t.origem_setor_funcional_id
             LEFT JOIN setor_funcional sd ON sd.id = t.destino_setor_funcional_id
             LEFT JOIN profissional pr ON pr.id = t.maqueiro_profissional_id
             LEFT JOIN pessoa_fisica pm ON pm.id = pr.pessoa_fisica_id
            WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.tipo IN ('interno', 'retorno')
              AND t.situacao IN ('solicitado', 'agendado', 'em_andamento')
            ORDER BY FIELD(t.prioridade, 'emergencia', 'urgente', 'rotina'), COALESCE(t.previsto_em, t.solicitado_em), t.id
            LIMIT 500`,
          [est.id],
        )
      ).map((x) => ({
        id: num(x['id']),
        versao: num(x['versao']),
        tipo: String(x['tipo']),
        prioridade: String(x['prioridade']),
        situacao: String(x['situacao']),
        previsto: iso(x['previsto_em']),
        solicitado: iso(x['solicitado_em']),
        paciente: num(x['paciente_id']),
        pacienteNome: txtOuNull(x['paciente_nome']),
        origem: txtOuNull(x['origem']),
        destino: txtOuNull(x['destino']),
        maqueiro: numOuNull(x['maqueiro_profissional_id']),
        maqueiroNome: txtOuNull(x['maqueiro_nome']),
      })),
    );
  }

  designarMaqueiro(c: ContextoPortaPropria, alvo: number, entrada: unknown) {
    const x = entradaValida(z.object({ maqueiro: id, versao }).strict(), entrada);
    return this.gravar(c, 'internacao.transporte.maqueiro', TABELAS, async (tx, est) => {
      const t = await exigir(
        tx,
        `SELECT tipo, situacao FROM solicitacao_transporte_paciente
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [alvo, est.id],
        'Pedido de transporte',
      );
      const h = await tx.uma(
        `SELECT funcao_transporte, tipo_transporte, ativo FROM profissional_transporte
          WHERE estabelecimento_id = ? AND profissional_id = ? AND funcao_transporte = 'maqueiro' AND excluido_em IS NULL`,
        [est.id, x.maqueiro],
      );
      const ocupado = await tx.uma(
        `SELECT COUNT(*) AS n FROM solicitacao_transporte_paciente
          WHERE maqueiro_profissional_id = ? AND situacao = 'em_andamento' AND id <> ? AND excluido_em IS NULL`,
        [x.maqueiro, alvo],
      );
      const problemas = conferirMaqueiro({
        tipoPedido: String(t['tipo']),
        situacaoPedido: String(t['situacao']),
        habilitacao: h
          ? {
              funcao: String(h['funcao_transporte']),
              tipo: String(h['tipo_transporte']),
              ativo: bool(h['ativo']),
            }
          : null,
        emAndamento: num(ocupado?.['n']),
      });
      if (problemas.length) throw recusaRegra('Maqueiro recusado', problemas);
      await tx.alterar(T_TRANSPORTE, alvo, x.versao, { maqueiro_profissional_id: x.maqueiro });
      return { tabela: T_TRANSPORTE, id: alvo, maqueiro: x.maqueiro };
    });
  }
}
