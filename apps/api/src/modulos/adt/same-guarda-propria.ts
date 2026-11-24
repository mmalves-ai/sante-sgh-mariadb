// SAME pelo volume (F3.9, 04-HOT L126), no banco do cliente. As regras são as puras de @sgh/dominio-hotelaria
// (same-guarda.ts), que decidem pelo tipo e pelo sentido da operação do cadastro; aqui ficam a leitura e a gravação.
// Contrato de efeito:
//   - local: `local_arquivo` na árvore (sala, armário, prateleira, caixa), com o caminho completo e a capacidade;
//   - abrir o volume: `volume_prontuario` (número seguinte do paciente para o tipo de documento, matrícula da etiqueta,
//     local e posição, situação 'arquivado', no local) e, na mesma transação, o `movimento_prontuario` de registro com o
//     local de destino. O local cheio recusa;
//   - movimentar: o `movimento_prontuario` (operação, setores, locais, responsável, previsão de retorno) e o efeito no
//     volume (situação, no local, local de guarda) com a versão lida; a ocupação do local conta o volume uma vez só;
//   - descartar (rota e nível de acesso próprios, o de excluir): só com o prazo de guarda do tipo de documento cumprido
//     e a deliberação da comissão de revisão de prontuários em reunião realizada; grava a ocorrência 'descarte' ligada à
//     deliberação (deliberacao_reuniao_id) com o aval, e o volume fica 'eliminado';
//   - desfazer o último movimento: exclusão lógica (nunca apagado) com a ocorrência 'exclusao' e o motivo; o estado do
//     volume é refeito pelos movimentos que restam; desfeita a entrada, a saída que ela fechou volta a aberta
//     (devolvido_em nulo) e, se o volume estava extraviado antes dela, o extravio volta com o instante e quem registrou;
//   - extravio: `volume_prontuario` 'extraviado' com o instante e quem registrou, e a ocorrência 'extravio' com o motivo.
import {
  conferirExtravio,
  conferirMovimentoGuarda,
  type DadosDescarte,
  efeitoNoVolume,
  lerMatriculaVolume,
  matriculaVolume,
  type OperacaoGuarda,
  type PedidoGuarda,
  proximoNumeroVolume,
  retornoAtrasado,
  type SentidoGuarda,
  type SituacaoVolume,
  type TipoOperacaoGuarda,
  type VolumeGuarda,
} from '@sgh/dominio-hotelaria';
import type { Leitor, TxOperacao } from '@sgh/nucleo';
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
import { instanteCivil } from '../exames/relogio.js';

export const PORTA_SAME_GUARDA = Symbol('PORTA_SAME_GUARDA');

const TABELAS = [
  'local_arquivo',
  'volume_prontuario',
  'movimento_prontuario',
  'ocorrencia_arquivo_prontuario',
];

const id = z.number().int().positive();
const texto = (max: number) => z.string().trim().min(1).max(max);
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const esquemaLocal = z
  .object({
    nivel: z.enum(['arquivo', 'sala', 'armario', 'estante', 'prateleira', 'gaveta', 'caixa']),
    codigo: texto(30),
    descricao: texto(150),
    pai: id.nullable().default(null),
    setor: id.nullable().default(null),
    capacidade: z.number().int().positive().max(1_000_000).nullable().default(null),
  })
  .strict()
  .refine((l) => l.pai !== null || l.nivel === 'arquivo' || l.nivel === 'sala', {
    message: 'O local do topo da árvore é o arquivo ou uma sala.',
    path: ['pai'],
  });

const esquemaAbrir = z
  .object({
    paciente: id,
    tipoDocumento: id,
    atendimento: id.nullable().default(null),
    localArquivo: id,
    posicaoLinha: z.string().trim().max(10).nullable().default(null),
    posicaoColuna: z.string().trim().max(10).nullable().default(null),
    setor: id.nullable().default(null),
    observacao: z.string().trim().max(500).nullable().default(null),
  })
  .strict();

const esquemaMovimentar = z
  .object({
    operacao: texto(30),
    setorOrigem: id.nullable().default(null),
    setorDestino: id.nullable().default(null),
    localDestino: id.nullable().default(null),
    previsaoRetorno: dataIso.nullable().default(null),
    responsavel: z.string().trim().max(150).nullable().default(null),
    avalComissao: z.string().trim().max(200).nullable().default(null),
    deliberacao: id.nullable().default(null),
    finalidadeCientifica: z.boolean().default(false),
    observacao: z.string().trim().max(2000).nullable().default(null),
    versao: z.number().int().positive(),
  })
  .strict();

const esquemaMotivo = z
  .object({ motivo: z.string().trim().max(500), versao: z.number().int().positive() })
  .strict();

export interface MovimentoGuardaLido {
  readonly id: number;
  readonly em: string;
  readonly operacao: { codigo: string; descricao: string; tipo: string; sentido: string };
  readonly setorOrigem: string | null;
  readonly setorDestino: string | null;
  readonly localDestino: string | null;
  readonly responsavel: string | null;
  readonly previsaoRetorno: string | null;
  readonly por: string | null;
  readonly excluido: boolean;
}

export interface VolumeLido {
  readonly id: number;
  readonly numero: number;
  readonly matricula: string | null;
  readonly tipoDocumento: { id: number; descricao: string };
  readonly atendimento: number | null;
  readonly situacao: string;
  readonly noLocal: boolean;
  readonly local: { id: number; caminho: string } | null;
  readonly posicao: { linha: string | null; coluna: string | null };
  readonly ondeEsta: string;
  readonly previsaoRetorno: string | null;
  readonly retornoAtrasado: boolean;
  readonly extraviadoEm: string | null;
  /** Desde quando corre o prazo de guarda (último documento ou abertura) e o prazo do tipo, em anos (null: permanente). */
  readonly guardaDesde: string | null;
  readonly prazoGuardaAnos: number | null;
  readonly versao: number;
  readonly movimentos: MovimentoGuardaLido[];
}

const iso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString()
      : new Date(String(v)).toISOString();

function operacaoLida(x: Record<string, unknown>): OperacaoGuarda {
  return {
    codigo: String(x['codigo']),
    descricao: String(x['descricao']),
    tipo: String(x['tipo']) as TipoOperacaoGuarda,
    sentido: String(x['sentido']) as SentidoGuarda,
    exigeDestino: bool(x['exige_destino']),
    exigePrevisaoRetorno: bool(x['exige_previsao_retorno']),
    encerraGuarda: bool(x['encerra_guarda']),
  };
}

const SQL_ULTIMO = `
  SELECT m.id, m.versao, m.destino_setor_funcional_id, m.saida_setor_funcional_id, m.previsao_retorno, m.devolvido_em, op.tipo
    FROM movimento_prontuario m JOIN operacao_movimento_prontuario op ON op.id = m.operacao_movimento_prontuario_id
   WHERE m.volume_prontuario_id = ? AND m.excluido_em IS NULL
   ORDER BY m.movimentado_em DESC, m.id DESC LIMIT 1`;

/** O estado do volume que a regra lê (a linha do volume e o último movimento válido). */
async function estadoDoVolume(l: Pick<Leitor, 'uma'>, v: Record<string, unknown>): Promise<VolumeGuarda> {
  const u = await l.uma(SQL_ULTIMO, [v['id']]);
  return {
    situacao: String(v['situacao']) as SituacaoVolume,
    noLocal: bool(v['no_local']),
    localArquivo: numOuNull(v['local_arquivo_id']),
    setorAtual: u ? numOuNull(u['destino_setor_funcional_id'] ?? u['saida_setor_funcional_id']) : null,
    temMovimento: !!u,
    ultimoTipo: u ? (String(u['tipo']) as TipoOperacaoGuarda) : null,
  };
}

const SQL_DELIBERACAO = `
  SELECT d.id, d.sequencia, d.situacao, d.descricao, r.situacao AS reuniao_situacao, r.realizada_em,
         c.estabelecimento_id, c.nome AS comissao_nome, tc.codigo AS tipo_codigo
    FROM deliberacao_reuniao d JOIN reuniao_comissao r ON r.id = d.reuniao_comissao_id
    JOIN comissao_hospitalar c ON c.id = r.comissao_hospitalar_id JOIN tipo_comissao tc ON tc.id = c.tipo_comissao_id`;

/** O aval gravado na ocorrência: a comissão, a reunião e a deliberação. */
function textoDeliberacao(d: Record<string, unknown>): string {
  const em = iso(d['realizada_em'])?.slice(0, 10) ?? 'sem data';
  return `${String(d['comissao_nome'])}, reunião de ${em}, deliberação ${num(d['sequencia'])}: ${String(
    d['descricao'],
  )}`.slice(0, 200);
}

async function ocupacao(l: Pick<Leitor, 'uma'>, local: number) {
  const r = await l.uma(
    `SELECT la.capacidade_volumes,
            (SELECT COUNT(*) FROM volume_prontuario v WHERE v.local_arquivo_id = la.id AND v.excluido_em IS NULL
                AND v.situacao NOT IN ('eliminado','extraviado')) AS volumes
       FROM local_arquivo la WHERE la.id = ?`,
    [local],
  );
  return r ? { volumes: num(r['volumes']), capacidade: numOuNull(r['capacidade_volumes']) } : null;
}

export class PortaSameGuardaPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'same.guarda');
  }

  /** As operações ativas do cadastro, com tipo, sentido e exigências (a tela monta o formulário por elas). */
  operacoes(c: ContextoPortaPropria): Promise<OperacaoGuarda[]> {
    return this.ler(c, 'operacoes', async (l) =>
      (
        await l.consultar(
          `SELECT codigo, descricao, tipo, sentido, exige_destino, exige_previsao_retorno, encerra_guarda
             FROM operacao_movimento_prontuario WHERE ativo = TRUE ORDER BY FIELD(tipo,'registro','saida','emprestimo',
             'recebimento','transferencia','devolucao','descarte'), codigo`,
        )
      ).map(operacaoLida),
    );
  }

  /** Locais de guarda do estabelecimento, com o caminho, a capacidade e a ocupação; e os setores e tipos de documento. */
  apoio(c: ContextoPortaPropria) {
    return this.ler(c, 'apoio', async (l, est) => ({
      locais: (
        await l.consultar(
          `SELECT la.id, la.nivel, la.codigo, la.descricao, la.caminho, la.local_arquivo_pai_id, la.capacidade_volumes,
                  (SELECT COUNT(*) FROM volume_prontuario v WHERE v.local_arquivo_id = la.id AND v.excluido_em IS NULL
                      AND v.situacao NOT IN ('eliminado','extraviado')) AS volumes
             FROM local_arquivo la WHERE la.estabelecimento_id = ? AND la.ativo AND la.excluido_em IS NULL
            ORDER BY la.caminho, la.id LIMIT 2000`,
          [est.id],
        )
      ).map((x) => ({
        id: num(x['id']),
        nivel: String(x['nivel']),
        codigo: String(x['codigo']),
        caminho: String(x['caminho'] ?? x['descricao']),
        pai: numOuNull(x['local_arquivo_pai_id']),
        capacidade: numOuNull(x['capacidade_volumes']),
        volumes: num(x['volumes']),
      })),
      setores: (
        await l.consultar(
          'SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome LIMIT 1000',
          [est.id],
        )
      ).map((x) => ({ id: num(x['id']), nome: String(x['nome']) })),
      tiposDocumento: (
        await l.consultar(
          'SELECT id, descricao FROM tipo_documento_arquivo WHERE ativo AND guardado_no_arquivo ORDER BY descricao',
        )
      ).map((x) => ({ id: num(x['id']), descricao: String(x['descricao']) })),
    }));
  }

  incluirLocal(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaLocal, entrada);
    return this.gravar(c, 'same.guarda.incluir-local', ['local_arquivo'], async (tx, est) => {
      let caminho = e.descricao;
      if (e.pai !== null) {
        const p = await tx.uma(
          'SELECT caminho, descricao FROM local_arquivo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.pai, est.id],
        );
        if (!p) throw naoEncontrado('Local de guarda');
        caminho = `${String(p['caminho'] ?? p['descricao'])} > ${e.descricao}`;
      }
      if (
        await tx.uma('SELECT id FROM local_arquivo WHERE estabelecimento_id = ? AND codigo = ?', [
          est.id,
          e.codigo,
        ])
      )
        throw recusaRegra('Local recusado', [
          { campo: 'codigo', mensagem: 'Já existe um local com este código.' },
        ]);
      const novo = await tx.incluir('local_arquivo', {
        estabelecimento_id: est.id,
        local_arquivo_pai_id: e.pai,
        nivel: e.nivel,
        codigo: e.codigo,
        descricao: e.descricao,
        caminho: caminho.slice(0, 500),
        setor_funcional_id: e.setor,
        capacidade_volumes: e.capacidade,
        ativo: true,
      });
      return { tabela: 'local_arquivo', id: novo };
    });
  }

  /** O paciente pelo número do prontuário (a busca da tela). */
  pacientePorProntuario(c: ContextoPortaPropria, prontuario: number): Promise<number | null> {
    return this.ler(c, 'paciente', async (l) => {
      const p = await l.uma('SELECT id FROM paciente WHERE numero_prontuario = ? AND excluido_em IS NULL', [
        prontuario,
      ]);
      return p ? num(p['id']) : null;
    });
  }

  /** O volume pela etiqueta (matrícula lida pelo leitor de código de barras): o paciente e o volume. */
  volumePorEtiqueta(
    c: ContextoPortaPropria,
    lido: string,
  ): Promise<{ paciente: number; volume: number } | null> {
    const m = lerMatriculaVolume(lido);
    if (!m) return Promise.resolve(null);
    return this.ler(c, 'etiqueta', async (l, est) => {
      const v = await l.uma(
        'SELECT id, paciente_id FROM volume_prontuario WHERE estabelecimento_id = ? AND numero_matricula = ? AND excluido_em IS NULL',
        [est.id, m],
      );
      return v ? { paciente: num(v['paciente_id']), volume: num(v['id']) } : null;
    });
  }

  /** A visão por paciente: todos os volumes, onde está cada um e a linha do tempo dos movimentos (com os desfeitos). */
  volumesDoPaciente(c: ContextoPortaPropria, paciente: number): Promise<VolumeLido[]> {
    return this.ler(c, 'volumes', async (l, est) => {
      const vs = await l.consultar(
        `SELECT v.*, t.descricao AS tipo_descricao, t.prazo_guarda_anos, la.caminho, la.descricao AS local_descricao
           FROM volume_prontuario v JOIN tipo_documento_arquivo t ON t.id = v.tipo_documento_arquivo_id
           LEFT JOIN local_arquivo la ON la.id = v.local_arquivo_id
          WHERE v.estabelecimento_id = ? AND v.paciente_id = ? AND v.excluido_em IS NULL
          ORDER BY t.descricao, v.numero_volume DESC LIMIT 200`,
        [est.id, paciente],
      );
      const agora = new Date();
      const saida: VolumeLido[] = [];
      for (const v of vs) {
        const movs = await l.consultar(
          `SELECT m.id, m.movimentado_em, m.responsavel_nome, m.previsao_retorno, m.excluido_em,
                  op.codigo, op.descricao, op.tipo, op.sentido, so.nome AS so_nome, sd.nome AS sd_nome,
                  ld.caminho AS ld_caminho, u.login
             FROM movimento_prontuario m
             JOIN operacao_movimento_prontuario op ON op.id = m.operacao_movimento_prontuario_id
             LEFT JOIN setor_funcional so ON so.id = m.saida_setor_funcional_id
             LEFT JOIN setor_funcional sd ON sd.id = m.destino_setor_funcional_id
             LEFT JOIN local_arquivo ld ON ld.id = m.destino_local_arquivo_id
             LEFT JOIN usuario u ON u.id = m.movimentado_por_usuario_id
            WHERE m.volume_prontuario_id = ? ORDER BY m.movimentado_em DESC, m.id DESC LIMIT 100`,
          [v['id']],
        );
        const ultimo = movs.find((m) => m['excluido_em'] === null) ?? null;
        const noLocal = bool(v['no_local']);
        const caminho = txtOuNull(v['caminho'] ?? v['local_descricao']);
        const previsao = ultimo && ultimo['previsao_retorno'] ? (ultimo['previsao_retorno'] as Date) : null;
        const situacao = String(v['situacao']);
        saida.push({
          id: num(v['id']),
          numero: num(v['numero_volume']),
          matricula: txtOuNull(v['numero_matricula']),
          tipoDocumento: { id: num(v['tipo_documento_arquivo_id']), descricao: String(v['tipo_descricao']) },
          atendimento: numOuNull(v['atendimento_id']),
          situacao,
          noLocal,
          local: v['local_arquivo_id'] ? { id: num(v['local_arquivo_id']), caminho: caminho ?? '' } : null,
          posicao: { linha: txtOuNull(v['posicao_linha']), coluna: txtOuNull(v['posicao_coluna']) },
          ondeEsta:
            situacao === 'eliminado'
              ? 'Eliminado'
              : situacao === 'extraviado'
                ? 'Extraviado'
                : noLocal
                  ? (caminho ?? 'No arquivo')
                  : String(ultimo?.['sd_nome'] ?? ultimo?.['so_nome'] ?? 'Fora do arquivo'),
          previsaoRetorno: iso(previsao),
          retornoAtrasado: retornoAtrasado(
            { noLocal, situacao: situacao as SituacaoVolume },
            previsao ? new Date(previsao) : null,
            agora,
          ),
          extraviadoEm: iso(v['extraviado_em']),
          guardaDesde: iso(v['periodo_fim'] ?? v['aberto_em']),
          prazoGuardaAnos: numOuNull(v['prazo_guarda_anos']),
          versao: num(v['versao']),
          movimentos: movs.map((m) => ({
            id: num(m['id']),
            em: iso(m['movimentado_em'])!,
            operacao: {
              codigo: String(m['codigo']),
              descricao: String(m['descricao']),
              tipo: String(m['tipo']),
              sentido: String(m['sentido']),
            },
            setorOrigem: txtOuNull(m['so_nome']),
            setorDestino: txtOuNull(m['sd_nome']),
            localDestino: txtOuNull(m['ld_caminho']),
            responsavel: txtOuNull(m['responsavel_nome']),
            previsaoRetorno: iso(m['previsao_retorno']),
            por: txtOuNull(m['login']),
            excluido: m['excluido_em'] !== null,
          })),
        });
      }
      return saida;
    });
  }

  abrirVolume(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{ id: number; matricula: string; movimento: number }> {
    const e = entradaValida(esquemaAbrir, entrada);
    return this.gravar(
      c,
      'same.guarda.abrir-volume',
      ['volume_prontuario', 'movimento_prontuario'],
      async (tx, est, usuario) => {
        const p = await tx.uma(
          'SELECT id, numero_prontuario FROM paciente WHERE id = ? AND excluido_em IS NULL',
          [e.paciente],
        );
        if (!p) throw naoEncontrado('Paciente');
        if (
          !(await tx.uma('SELECT id FROM tipo_documento_arquivo WHERE id = ? AND ativo', [e.tipoDocumento]))
        )
          throw naoEncontrado('Tipo de documento');
        if (
          e.atendimento !== null &&
          !(await tx.uma(
            'SELECT id FROM atendimento WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ?',
            [e.atendimento, e.paciente, est.id],
          ))
        )
          throw recusaRegra('Volume recusado', [
            { campo: 'atendimento', mensagem: 'O atendimento não é deste paciente neste estabelecimento.' },
          ]);
        await this.conferirSetor(tx, est.id, e.setor);
        const local = await this.localDoEstabelecimento(tx, est.id, e.localArquivo);
        const operacao = await this.operacaoDoTipo(tx, 'registro');
        const numeros = await tx.consultarParaAtualizar<Record<string, unknown>>(
          `SELECT numero_volume FROM volume_prontuario
            WHERE estabelecimento_id = ? AND paciente_id = ? AND tipo_documento_arquivo_id = ?`,
          [est.id, e.paciente, e.tipoDocumento],
        );
        const numero = proximoNumeroVolume(numeros.map((x) => num(x['numero_volume'])));
        const agora = new Date();
        const inicial: VolumeGuarda = {
          situacao: 'aberto',
          noLocal: false,
          localArquivo: null,
          setorAtual: null,
          temMovimento: false,
          ultimoTipo: null,
        };
        const pedido: PedidoGuarda = {
          operacao,
          setorDestino: e.setor,
          localDestino: local,
          previsaoRetorno: null,
          avalComissao: null,
          responsavel: null,
          agora,
          ocupacaoDestino: await ocupacao(tx, local),
        };
        const problemas = conferirMovimentoGuarda(inicial, pedido);
        if (problemas.length) throw recusaRegra('Volume recusado', problemas);
        const efeito = efeitoNoVolume(inicial, pedido);
        const matricula = matriculaVolume(num(p['numero_prontuario'] ?? p['id']), e.tipoDocumento, numero);
        const volume = await tx.incluir('volume_prontuario', {
          estabelecimento_id: est.id,
          paciente_id: e.paciente,
          tipo_documento_arquivo_id: e.tipoDocumento,
          numero_volume: numero,
          numero_matricula: matricula,
          atendimento_id: e.atendimento,
          local_arquivo_id: efeito.localArquivo,
          posicao_linha: e.posicaoLinha || null,
          posicao_coluna: e.posicaoColuna || null,
          aberto_em: agora,
          abertura_usuario_id: usuario,
          no_local: efeito.noLocal,
          situacao: efeito.situacao,
          observacao: e.observacao,
        });
        const movimento = await tx.incluir('movimento_prontuario', {
          estabelecimento_id: est.id,
          volume_prontuario_id: volume,
          paciente_id: e.paciente,
          atendimento_id: e.atendimento,
          operacao_movimento_prontuario_id: await this.idDaOperacao(tx, operacao.codigo),
          movimentado_em: agora,
          movimentado_por_usuario_id: usuario,
          destino_setor_funcional_id: e.setor,
          destino_local_arquivo_id: local,
        });
        return { tabela: 'volume_prontuario', id: volume, matricula, movimento };
      },
    );
  }

  /** Movimenta pela operação do cadastro; a operação que encerra a guarda (descarte) só pela rota do descarte. */
  movimentar(
    c: ContextoPortaPropria,
    volume: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: string }> {
    return this.movimentarCom(c, volume, entrada, false);
  }

  /** O descarte (eliminação irreversível): prazo de guarda cumprido e deliberação da comissão. */
  descartar(
    c: ContextoPortaPropria,
    volume: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: string }> {
    return this.movimentarCom(c, volume, entrada, true);
  }

  /** As deliberações que podem autorizar o descarte: da comissão de revisão de prontuários, em reunião realizada. */
  deliberacoesDescarte(c: ContextoPortaPropria) {
    return this.ler(c, 'deliberacoes', async (l, est) =>
      (
        await l.consultar(
          `${SQL_DELIBERACAO} WHERE c.estabelecimento_id = ? AND tc.codigo = 'prontuario' AND r.situacao = 'realizada'
              AND d.situacao <> 'cancelada' AND d.excluido_em IS NULL AND r.excluido_em IS NULL
            ORDER BY r.realizada_em DESC, d.sequencia LIMIT 200`,
          [est.id],
        )
      ).map((d) => ({ id: num(d['id']), texto: textoDeliberacao(d) })),
    );
  }

  private movimentarCom(
    c: ContextoPortaPropria,
    volume: number,
    entrada: unknown,
    descarte: boolean,
  ): Promise<{ id: number; situacao: string }> {
    const e = entradaValida(esquemaMovimentar, entrada);
    return this.gravar(
      c,
      descarte ? 'same.guarda.descartar' : 'same.guarda.movimentar',
      ['movimento_prontuario', 'volume_prontuario', 'ocorrencia_arquivo_prontuario'],
      async (tx, est, usuario) => {
        const v = await this.volumeTravado(tx, est.id, volume);
        const o = await tx.uma(
          `SELECT id, codigo, descricao, tipo, sentido, exige_destino, exige_previsao_retorno, encerra_guarda
             FROM operacao_movimento_prontuario WHERE codigo = ? AND ativo = TRUE`,
          [e.operacao],
        );
        if (!o) throw naoEncontrado('Operação do arquivo');
        const operacao = operacaoLida(o);
        if (operacao.encerraGuarda !== descarte)
          throw recusaRegra('Movimento recusado', [
            {
              campo: 'operacao',
              mensagem: descarte
                ? 'A operação não é de descarte.'
                : 'O descarte tem rota e nível de acesso próprios.',
            },
          ]);
        await this.conferirSetor(tx, est.id, e.setorOrigem);
        await this.conferirSetor(tx, est.id, e.setorDestino);
        const local =
          e.localDestino === null ? null : await this.localDoEstabelecimento(tx, est.id, e.localDestino);
        const estado = await estadoDoVolume(tx, v);
        const agora = new Date();
        const alvoLocal = local ?? estado.localArquivo;
        const del = descarte ? await this.dadosDescarte(tx, est.id, v, e.deliberacao) : null;
        const pedido: PedidoGuarda = {
          operacao,
          setorDestino: e.setorDestino,
          localDestino: local,
          previsaoRetorno: e.previsaoRetorno ? instanteCivil(e.previsaoRetorno, '2359', est.fuso) : null,
          avalComissao: e.avalComissao || (del?.texto ?? null),
          responsavel: e.responsavel || null,
          agora,
          ocupacaoDestino: alvoLocal === null ? null : await ocupacao(tx, alvoLocal),
          descarte: del?.dados ?? null,
        };
        const problemas = conferirMovimentoGuarda(estado, pedido);
        if (num(v['versao']) !== e.versao)
          problemas.push({ campo: 'versao', mensagem: 'O volume mudou desde a leitura: recarregue.' });
        if (problemas.length) throw recusaRegra('Movimento recusado', problemas);
        const efeito = efeitoNoVolume(estado, pedido);
        const origem = e.setorOrigem ?? (estado.noLocal ? null : estado.setorAtual);
        const movimento = await tx.incluir('movimento_prontuario', {
          estabelecimento_id: est.id,
          volume_prontuario_id: volume,
          paciente_id: num(v['paciente_id']),
          atendimento_id: numOuNull(v['atendimento_id']),
          operacao_movimento_prontuario_id: num(o['id']),
          movimentado_em: agora,
          movimentado_por_usuario_id: usuario,
          saida_setor_funcional_id: origem,
          destino_setor_funcional_id: origem !== null && origem === e.setorDestino ? null : e.setorDestino,
          saida_local_arquivo_id: estado.noLocal ? estado.localArquivo : null,
          destino_local_arquivo_id: efeito.noLocal ? efeito.localArquivo : null,
          responsavel_nome: pedido.responsavel,
          previsao_retorno: pedido.previsaoRetorno,
          finalidade_cientifica: e.finalidadeCientifica,
          observacao: e.observacao,
        });
        if (operacao.sentido === 'entrada' && !estado.noLocal) {
          const saiu = await tx.uma(
            `SELECT m.id, m.versao FROM movimento_prontuario m
               JOIN operacao_movimento_prontuario op ON op.id = m.operacao_movimento_prontuario_id
              WHERE m.volume_prontuario_id = ? AND m.excluido_em IS NULL AND m.devolvido_em IS NULL AND op.sentido = 'saida'
                AND op.encerra_guarda = FALSE ORDER BY m.movimentado_em DESC, m.id DESC LIMIT 1`,
            [volume],
          );
          if (saiu)
            await tx.alterar('movimento_prontuario', num(saiu['id']), num(saiu['versao']), {
              devolvido_em: agora,
            });
        }
        if (operacao.encerraGuarda)
          await tx.incluir('ocorrencia_arquivo_prontuario', {
            estabelecimento_id: est.id,
            atendimento_id: numOuNull(v['atendimento_id']),
            volume_prontuario_id: volume,
            movimento_prontuario_id: movimento,
            deliberacao_reuniao_id: e.deliberacao,
            tipo: 'descarte',
            motivo: e.observacao || operacao.descricao,
            aval_comissao: (pedido.avalComissao ?? '').slice(0, 200),
            registrado_em: agora,
            usuario_id: usuario,
          });
        await tx.alterar('volume_prontuario', volume, num(v['versao']), {
          situacao: efeito.situacao,
          no_local: efeito.noLocal,
          local_arquivo_id: efeito.localArquivo,
          ...(operacao.encerraGuarda ? { encerrado_em: agora, encerramento_usuario_id: usuario } : {}),
          ...(estado.situacao === 'extraviado' ? { extraviado_em: null, extravio_usuario_id: null } : {}),
        });
        return { tabela: 'movimento_prontuario', id: movimento, situacao: efeito.situacao };
      },
    );
  }

  /** Desfaz o último movimento válido (exclusão lógica com motivo) e refaz o estado do volume pelos que restam. */
  desfazerUltimo(c: ContextoPortaPropria, volume: number, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaMotivo, entrada);
    return this.gravar(
      c,
      'same.guarda.desfazer',
      ['movimento_prontuario', 'volume_prontuario', 'ocorrencia_arquivo_prontuario'],
      async (tx, est, usuario) => {
        const v = await this.volumeTravado(tx, est.id, volume);
        if (e.motivo.length < 10)
          throw recusaRegra('Desfazer recusado', [
            { campo: 'motivo', mensagem: 'Justifique com pelo menos 10 caracteres.' },
          ]);
        if (num(v['versao']) !== e.versao)
          throw recusaRegra('Desfazer recusado', [
            { campo: 'versao', mensagem: 'O volume mudou desde a leitura: recarregue.' },
          ]);
        if (['eliminado', 'extraviado'].includes(String(v['situacao'])))
          throw recusaRegra('Desfazer recusado', [
            { campo: 'volume', mensagem: 'O volume eliminado ou extraviado não se desfaz.' },
          ]);
        const movs = await tx.consultarParaAtualizar<Record<string, unknown>>(
          `SELECT m.id, m.versao, m.movimentado_em, m.destino_local_arquivo_id, m.destino_setor_funcional_id, m.saida_setor_funcional_id,
                  op.codigo, op.descricao, op.tipo, op.sentido, op.exige_destino, op.exige_previsao_retorno, op.encerra_guarda
             FROM movimento_prontuario m JOIN operacao_movimento_prontuario op ON op.id = m.operacao_movimento_prontuario_id
            WHERE m.volume_prontuario_id = ? AND m.excluido_em IS NULL ORDER BY m.movimentado_em, m.id`,
          [volume],
        );
        const ultimo = movs.at(-1);
        if (!ultimo)
          throw recusaRegra('Desfazer recusado', [
            { campo: 'volume', mensagem: 'O volume não tem movimento.' },
          ]);
        const anterior = movs.at(-2) ?? null;
        const desfeitaEntrada = String(ultimo['sentido']) === 'entrada';
        // A saída que a entrada desfeita fechou (devolvido_em gravado no mesmo instante) e o extravio que ela encerrou.
        const fechada = desfeitaEntrada
          ? await tx.uma(
              `SELECT s.id, s.versao FROM movimento_prontuario s
                 JOIN operacao_movimento_prontuario op ON op.id = s.operacao_movimento_prontuario_id
                 JOIN movimento_prontuario d ON d.id = ?
                WHERE s.volume_prontuario_id = ? AND s.excluido_em IS NULL AND op.sentido = 'saida'
                  AND s.devolvido_em = d.movimentado_em ORDER BY s.movimentado_em DESC, s.id DESC LIMIT 1`,
              [ultimo['id'], volume],
            )
          : null;
        const extravio = desfeitaEntrada
          ? await tx.uma(
              `SELECT o.registrado_em, o.usuario_id FROM ocorrencia_arquivo_prontuario o
                 JOIN movimento_prontuario d ON d.id = ?
                 LEFT JOIN movimento_prontuario a ON a.id = ?
                WHERE o.volume_prontuario_id = ? AND o.tipo = 'extravio' AND o.registrado_em <= d.movimentado_em
                  AND (a.id IS NULL OR o.registrado_em >= a.movimentado_em)
                ORDER BY o.registrado_em DESC, o.id DESC LIMIT 1`,
              [ultimo['id'], anterior?.['id'] ?? null, volume],
            )
          : null;
        await tx.excluir('movimento_prontuario', num(ultimo['id']), num(ultimo['versao']));
        if (fechada)
          await tx.alterar('movimento_prontuario', num(fechada['id']), num(fechada['versao']), {
            devolvido_em: null,
          });
        await tx.incluir('ocorrencia_arquivo_prontuario', {
          estabelecimento_id: est.id,
          atendimento_id: numOuNull(v['atendimento_id']),
          volume_prontuario_id: volume,
          movimento_prontuario_id: num(ultimo['id']),
          tipo: 'exclusao',
          motivo: e.motivo,
          registrado_em: new Date(),
          usuario_id: usuario,
        });
        let estado: VolumeGuarda = {
          situacao: 'aberto',
          noLocal: false,
          localArquivo: null,
          setorAtual: null,
          temMovimento: false,
          ultimoTipo: null,
        };
        for (const m of movs.slice(0, -1)) {
          const ef = efeitoNoVolume(estado, {
            operacao: operacaoLida(m),
            setorDestino: numOuNull(m['destino_setor_funcional_id']),
            localDestino: numOuNull(m['destino_local_arquivo_id']),
            previsaoRetorno: null,
            avalComissao: null,
            responsavel: null,
            agora: new Date(),
          });
          estado = {
            ...ef,
            setorAtual: numOuNull(m['destino_setor_funcional_id'] ?? m['saida_setor_funcional_id']),
            temMovimento: true,
            ultimoTipo: String(m['tipo']) as TipoOperacaoGuarda,
          };
        }
        await tx.alterar('volume_prontuario', volume, num(v['versao']), {
          situacao: extravio ? 'extraviado' : estado.situacao,
          no_local: extravio ? false : estado.noLocal,
          local_arquivo_id: estado.localArquivo ?? numOuNull(v['local_arquivo_id']),
          ...(extravio
            ? {
                extraviado_em: extravio['registrado_em'],
                extravio_usuario_id: numOuNull(extravio['usuario_id']),
              }
            : {}),
        });
        return { tabela: 'movimento_prontuario', id: num(ultimo['id']) };
      },
    );
  }

  /** O extravio do volume: situação, instante e quem registrou, com a ocorrência e o motivo (nada apagado). */
  registrarExtravio(c: ContextoPortaPropria, volume: number, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaMotivo, entrada);
    return this.gravar(
      c,
      'same.guarda.extravio',
      ['volume_prontuario', 'ocorrencia_arquivo_prontuario'],
      async (tx, est, usuario) => {
        const v = await this.volumeTravado(tx, est.id, volume);
        const p = conferirExtravio({ situacao: String(v['situacao']) as SituacaoVolume }, e.motivo);
        if (num(v['versao']) !== e.versao)
          p.push({ campo: 'versao', mensagem: 'O volume mudou desde a leitura: recarregue.' });
        if (p.length) throw recusaRegra('Extravio recusado', p);
        const agora = new Date();
        const oc = await tx.incluir('ocorrencia_arquivo_prontuario', {
          estabelecimento_id: est.id,
          atendimento_id: numOuNull(v['atendimento_id']),
          volume_prontuario_id: volume,
          tipo: 'extravio',
          motivo: e.motivo,
          registrado_em: agora,
          usuario_id: usuario,
        });
        await tx.alterar('volume_prontuario', volume, num(v['versao']), {
          situacao: 'extraviado',
          no_local: false,
          extraviado_em: agora,
          extravio_usuario_id: usuario,
        });
        return { tabela: 'ocorrencia_arquivo_prontuario', id: oc };
      },
    );
  }

  /** O prazo de guarda do tipo de documento do volume e a deliberação que autoriza o descarte. */
  private async dadosDescarte(
    tx: TxOperacao,
    est: number,
    v: Record<string, unknown>,
    deliberacao: number | null,
  ): Promise<{ dados: DadosDescarte; texto: string | null }> {
    const t = await tx.uma('SELECT prazo_guarda_anos FROM tipo_documento_arquivo WHERE id = ?', [
      v['tipo_documento_arquivo_id'],
    ]);
    const desde = v['periodo_fim'] ?? v['aberto_em'];
    let d: Record<string, unknown> | null = null;
    if (deliberacao !== null) {
      d = await tx.uma(
        `${SQL_DELIBERACAO} WHERE d.id = ? AND d.excluido_em IS NULL AND r.excluido_em IS NULL`,
        [deliberacao],
      );
      if (!d) throw naoEncontrado('Deliberação da comissão');
    }
    return {
      dados: {
        guardaDesde: desde === null || desde === undefined ? null : new Date(desde as string | Date),
        prazoAnos: numOuNull(t?.['prazo_guarda_anos']),
        deliberacao: d
          ? {
              comissaoDeProntuario:
                String(d['tipo_codigo']) === 'prontuario' && num(d['estabelecimento_id']) === est,
              reuniaoRealizada: String(d['reuniao_situacao']) === 'realizada',
              cancelada: String(d['situacao']) === 'cancelada',
            }
          : null,
      },
      texto: d ? textoDeliberacao(d) : null,
    };
  }

  private async volumeTravado(tx: TxOperacao, est: number, volume: number) {
    const [v] = await tx.consultarParaAtualizar<Record<string, unknown>>(
      'SELECT * FROM volume_prontuario WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [volume, est],
    );
    if (!v) throw naoEncontrado('Volume do prontuário');
    return v;
  }

  private async conferirSetor(tx: TxOperacao, est: number, setor: number | null) {
    if (setor === null) return;
    if (
      !(await tx.uma(
        'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [setor, est],
      ))
    )
      throw recusaRegra('Setor recusado', [
        { campo: 'setorDestino', mensagem: 'O setor não existe neste estabelecimento.' },
      ]);
  }

  private async localDoEstabelecimento(tx: TxOperacao, est: number, local: number): Promise<number> {
    if (
      !(await tx.uma(
        'SELECT id FROM local_arquivo WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
        [local, est],
      ))
    )
      throw recusaRegra('Local recusado', [
        { campo: 'localDestino', mensagem: 'O local de guarda não existe neste estabelecimento.' },
      ]);
    return local;
  }

  private async operacaoDoTipo(tx: TxOperacao, tipo: TipoOperacaoGuarda): Promise<OperacaoGuarda> {
    const o = await tx.uma(
      `SELECT codigo, descricao, tipo, sentido, exige_destino, exige_previsao_retorno, encerra_guarda
         FROM operacao_movimento_prontuario WHERE tipo = ? AND ativo = TRUE ORDER BY codigo = ? DESC, id LIMIT 1`,
      [tipo, tipo],
    );
    if (!o) throw naoEncontrado(`Operação do arquivo do tipo ${tipo}`);
    return operacaoLida(o);
  }

  private async idDaOperacao(tx: TxOperacao, codigo: string): Promise<number> {
    const o = await tx.uma('SELECT id FROM operacao_movimento_prontuario WHERE codigo = ?', [codigo]);
    return num(o?.['id']);
  }
}
