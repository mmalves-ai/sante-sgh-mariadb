// Interface com os equipamentos do laboratório no banco do cliente (F3.5, 05-SADT linha 13): o cadastro da interface
// com o equipamento na mesma gravação, o de-para de exames e de analitos por equipamento, o pedido que vai ao
// equipamento e o resultado que volta, pela fila de integração (integracao_mensagem). A regra mora em @sgh/dominio-sadt
// (equipamento/interface.ts); aqui fica a leitura e a gravação do que ela decide, pelo Executor, com a trilha na mesma
// transação. Desenho próprio:
//   - a mensagem ao equipamento leva só a identificação da amostra e os códigos dos testes (nenhum dado da pessoa);
//   - o resultado recebido entra pela mesma regra da digitação (faixa congelada, valor absurdo recusado, aviso de
//     crítico, fórmulas), marcado como vindo da interface e do equipamento, e espera a conferência e a liberação;
//   - a mensagem recebida é guardada antes de processar e nunca se perde: a que falha fica em erro com o motivo (códigos,
//     nunca valores) e é reprocessada depois de corrigido o de-para; a mesma mensagem enviada duas vezes não duplica;
//   - nada se apaga: interface e de-para saem de uso por inativação; a credencial fica no cofre (aqui nem é lida).
import {
  codigoEquipamentoValido,
  conferirDeParaAnalito,
  conferirDeParaExame,
  conferirInterface,
  type DeParaAnalitoEquipamento,
  type ExameNoEquipamento,
  interpretarLeituras,
  type LeituraEquipamento,
  lerAstmResultado,
  montarAstmPedido,
  montarPedidoEquipamento,
  type PadraoMensagemModelo,
  type ProblemaInterface,
  PROTOCOLOS_INTERFACE,
  type SentidoInterface,
} from '@sgh/dominio-sadt';
import {
  type ContextoNucleo,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { NucleoSadt } from '../porta-propria.js';
import type { ContextoSadt } from '../porta.js';
import { ServicoResultadoSadt } from './resultado-propria.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const tn = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const sim = (v: unknown) => n(v) === 1 || v === true;
const instante = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : v ? String(v).replace(' ', 'T') : null;
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');

/** Pontos da fila de integração: o pedido que sai para o equipamento e o resultado que entra dele. */
export const PONTO_PEDIDO_EQUIPAMENTO = 'sadt.equipamento.pedido';
export const PONTO_RESULTADO_EQUIPAMENTO = 'sadt.equipamento.resultado';
const ENTIDADE = 'interface_equipamento';

const id = z.number().int().positive();
const curto = (max: number) => z.string().trim().max(max);
const opcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null));

export const esquemaInterfaceEquipamento = z
  .object({
    id: id.nullable().default(null),
    versao: z.number().int().min(1).nullable().default(null),
    codigo: curto(30),
    descricao: curto(150),
    modelo: id,
    protocolo: z.enum(PROTOCOLOS_INTERFACE as [string, ...string[]]),
    sentido: z.enum(['unidirecional', 'bidirecional']),
    host: opcional(255),
    porta: z.number().int().nullable().default(null),
    caminhoEnvio: opcional(255),
    caminhoRetorno: opcional(255),
    enviaListaTrabalho: z.boolean().default(true),
    recebeResultado: z.boolean().default(true),
    importaComoLiberado: z.boolean().default(false),
    revisaAutomaticamente: z.boolean().default(false),
    assinaAutomaticamente: z.boolean().default(false),
    bloqueiaLaudo: z.boolean().default(false),
    ativo: z.boolean().default(true),
    /** O equipamento da interface: o id de um já cadastrado ou os dados do novo (gravado junto). */
    equipamento: z
      .object({
        id: id.nullable().default(null),
        codigo: curto(30).default(''),
        descricao: curto(150).default(''),
        modelo: opcional(60),
        numeroSerie: opcional(60),
        setor: id.nullable().default(null),
      })
      .strict(),
  })
  .strict();

export const esquemaDeParaExame = z
  .object({
    id: id.nullable().default(null),
    versao: z.number().int().min(1).nullable().default(null),
    exame: id,
    material: id.nullable().default(null),
    codigo: curto(30),
    enviaAnalitos: z.boolean().default(false),
    ativo: z.boolean().default(true),
  })
  .strict();

export const esquemaDeParaAnalito = z
  .object({
    id: id.nullable().default(null),
    versao: z.number().int().min(1).nullable().default(null),
    analito: id,
    exame: id.nullable().default(null),
    codigo: curto(30),
    fator: z.number().default(1),
    casas: z.number().int().nullable().default(null),
    recebe: z.boolean().default(true),
    ativo: z.boolean().default(true),
  })
  .strict();

export const esquemaPedidoEquipamento = z.object({ itens: z.array(id).min(1).max(200) }).strict();

export const esquemaResultadoEquipamento = z
  .object({
    /** Identificação da mensagem no remetente: a mesma mensagem enviada duas vezes não duplica. */
    chaveMensagem: z.string().trim().min(1).max(120),
    amostra: z.string().trim().max(60).optional(),
    leituras: z
      .array(z.object({ codigo: z.string().trim().min(1).max(30), valor: z.string().max(2000) }).strict())
      .max(500)
      .optional(),
    /** A mensagem ASTM inteira, como o equipamento mandou. */
    astm: z.string().max(200_000).optional(),
  })
  .strict();

export interface InterfaceLida {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly modelo: number;
  readonly modeloNome: string;
  readonly protocolo: string;
  readonly sentido: string;
  readonly host: string | null;
  readonly porta: number | null;
  readonly caminhoEnvio: string | null;
  readonly caminhoRetorno: string | null;
  readonly enviaListaTrabalho: boolean;
  readonly recebeResultado: boolean;
  readonly importaComoLiberado: boolean;
  readonly revisaAutomaticamente: boolean;
  readonly assinaAutomaticamente: boolean;
  readonly bloqueiaLaudo: boolean;
  readonly ativo: boolean;
  /** Há credencial no cofre (o valor nunca é lido aqui). */
  readonly temCredencial: boolean;
  readonly equipamento: {
    readonly id: number;
    readonly codigo: string;
    readonly descricao: string;
    readonly modelo: string | null;
    readonly numeroSerie: string | null;
    readonly setor: number;
    readonly setorNome: string;
  } | null;
  readonly examesComCodigo: number;
  readonly analitosComCodigo: number;
  readonly pedidosNaFila: number;
  readonly resultadosComErro: number;
  readonly ultimoResultadoEm: string | null;
}

export interface MensagemEquipamento {
  readonly id: number;
  readonly direcao: 'entrada' | 'saida';
  readonly situacao: string;
  readonly referencia: string;
  readonly tentativas: number;
  readonly erro: string | null;
  readonly criadaEm: string | null;
  readonly processadaEm: string | null;
}

export interface RecebimentoEquipamento {
  readonly mensagem: number;
  readonly situacao: 'processada' | 'erro';
  readonly duplicada: boolean;
  /** Exames pedidos que receberam resultado. */
  readonly gravados: readonly number[];
  /** O que ficou pendente, por código (nunca o valor). */
  readonly pendencias: readonly string[];
}

const TABELAS_CADASTRO = ['interface_equipamento', 'equipamento_analitico'] as const;
const TABELAS_DE_PARA = ['de_para_exame_equipamento', 'de_para_analito_equipamento'] as const;
const TABELAS_TRAFEGO = ['integracao_mensagem', 'resultado_exame', 'resultado_analito'] as const;

const recusaDaRegra = (codigo: string, problemas: readonly ProblemaInterface[]) =>
  recusa(codigo, problemas.map((p) => p.mensagem).join(' '), {
    campos: [...new Set(problemas.map((p) => p.campo))],
  });

const SQL_INTERFACE = `
  SELECT i.*, e.codigo AS eq_codigo, e.descricao AS eq_descricao, e.modelo AS eq_modelo, e.numero_serie,
         e.setor_diagnostico_id, sd.nome AS setor_nome, m.descricao AS modelo_nome,
         (SELECT COUNT(*) FROM de_para_exame_equipamento d
           WHERE d.equipamento_analitico_id = i.equipamento_analitico_id AND d.excluido_em IS NULL AND d.ativo = TRUE) AS q_exames,
         (SELECT COUNT(*) FROM de_para_analito_equipamento d
           WHERE d.equipamento_analitico_id = i.equipamento_analitico_id AND d.excluido_em IS NULL AND d.ativo = TRUE) AS q_analitos,
         (SELECT COUNT(*) FROM integracao_mensagem g
           WHERE g.entidade = '${ENTIDADE}' AND g.entidade_id = i.id AND g.direcao = 'saida' AND g.situacao = 'pendente') AS q_fila,
         (SELECT COUNT(*) FROM integracao_mensagem g
           WHERE g.entidade = '${ENTIDADE}' AND g.entidade_id = i.id AND g.direcao = 'entrada' AND g.situacao = 'erro') AS q_erro,
         (SELECT MAX(g.processada_em) FROM integracao_mensagem g
           WHERE g.entidade = '${ENTIDADE}' AND g.entidade_id = i.id AND g.direcao = 'entrada' AND g.situacao = 'processada') AS ultimo
    FROM interface_equipamento i
    JOIN modelo_comunicacao m ON m.id = i.modelo_comunicacao_id
    LEFT JOIN equipamento_analitico e ON e.id = i.equipamento_analitico_id
    LEFT JOIN setor_diagnostico sd ON sd.id = e.setor_diagnostico_id
   WHERE i.estabelecimento_id = ? AND i.laboratorio_apoio_id IS NULL`;

function interfaceDe(r: Linha): InterfaceLida {
  return {
    id: n(r['id']),
    versao: n(r['versao']),
    codigo: texto(r['codigo']),
    descricao: texto(r['descricao']),
    modelo: n(r['modelo_comunicacao_id']),
    modeloNome: texto(r['modelo_nome']),
    protocolo: texto(r['protocolo']),
    sentido: texto(r['sentido']),
    host: tn(r['endereco_host']),
    porta: nn(r['porta']),
    caminhoEnvio: tn(r['caminho_envio']),
    caminhoRetorno: tn(r['caminho_retorno']),
    enviaListaTrabalho: sim(r['envia_lista_trabalho']),
    recebeResultado: sim(r['recebe_resultado']),
    importaComoLiberado: sim(r['importa_como_liberado']),
    revisaAutomaticamente: sim(r['revisa_automaticamente']),
    assinaAutomaticamente: sim(r['assina_automaticamente']),
    bloqueiaLaudo: sim(r['bloqueia_laudo']),
    ativo: sim(r['ativo']),
    temCredencial: tn(r['chave_cofre_credencial']) !== null,
    equipamento:
      r['equipamento_analitico_id'] === null || r['equipamento_analitico_id'] === undefined
        ? null
        : {
            id: n(r['equipamento_analitico_id']),
            codigo: texto(r['eq_codigo']),
            descricao: texto(r['eq_descricao']),
            modelo: tn(r['eq_modelo']),
            numeroSerie: tn(r['numero_serie']),
            setor: n(r['setor_diagnostico_id']),
            setorNome: texto(r['setor_nome']),
          },
    examesComCodigo: n(r['q_exames']),
    analitosComCodigo: n(r['q_analitos']),
    pedidosNaFila: n(r['q_fila']),
    resultadosComErro: n(r['q_erro']),
    ultimoResultadoEm: instante(r['ultimo']),
  };
}

interface AmostraRecebida {
  readonly amostra: string;
  readonly leituras: readonly LeituraEquipamento[];
}

export class ServicoInterfaceEquipamento {
  private readonly executor: Executor;
  private readonly resultados: ServicoResultadoSadt;

  constructor(
    private readonly nucleo: NucleoSadt,
    resultados?: ServicoResultadoSadt,
  ) {
    this.executor = nucleo.criarExecutor();
    this.resultados = resultados ?? new ServicoResultadoSadt(nucleo);
  }

  private ctxNucleo(c: ContextoSadt): ContextoNucleo {
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: (c.correlacao || 'sadt').slice(0, 64),
    };
  }

  private est(c: ContextoSadt): number {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return c.estabelecimento;
  }

  private ler<T>(c: ContextoSadt, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), (l) => fn(l, est));
  }

  private async gravar<T>(
    c: ContextoSadt,
    nome: string,
    tabelas: readonly string[],
    alvo: string,
    fn: (tx: TxOperacao, est: number) => Promise<{ id: number; saida: T }>,
  ): Promise<T> {
    const est = this.est(c);
    let feito: { id: number; saida: T } | null = null;
    const op = definirOperacao({
      nome,
      tabelas,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        feito = await fn(tx, est);
        return { id: feito.id };
      },
      alvo: () => ({ tabela: alvo, id: feito?.id ?? null }),
      trilha: () => ({ dados: { evento: nome }, motivo: null }),
    });
    const chave = `sadt-equip:${c.chaveIdempotencia ?? randomUUID()}`;
    await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...this.ctxNucleo(c), chaveIdempotencia: chave },
    );
    if (!feito) throw recusa('repetida', 'Esta gravação já foi feita. Atualize a tela.');
    return (feito as { id: number; saida: T }).saida;
  }

  /** As interfaces de equipamento do estabelecimento, com o que trafega e o que está pendente em cada uma. */
  listar(c: ContextoSadt): Promise<InterfaceLida[]> {
    return this.ler(c, async (l, est) =>
      (await l.consultar(`${SQL_INTERFACE} ORDER BY i.ativo DESC, i.descricao, i.id`, [est])).map(
        interfaceDe,
      ),
    );
  }

  /** O que a tela precisa para cadastrar: os modelos de comunicação e os setores do diagnóstico. */
  apoio(c: ContextoSadt) {
    return this.ler(c, async (l, est) => ({
      modelos: (
        await l.consultar(
          'SELECT id, descricao, padrao_mensagem, sentido FROM modelo_comunicacao WHERE ativo = TRUE ORDER BY descricao',
        )
      ).map((r) => ({
        id: n(r['id']),
        nome: texto(r['descricao']),
        padrao: texto(r['padrao_mensagem']),
        sentido: texto(r['sentido']),
      })),
      setores: (
        await l.consultar(
          'SELECT id, nome FROM setor_diagnostico WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome',
          [est],
        )
      ).map((r) => ({ id: n(r['id']), nome: texto(r['nome']) })),
      protocolos: [...PROTOCOLOS_INTERFACE],
    }));
  }

  /** Inclui ou altera a interface; o equipamento novo é gravado junto (um passo só). */
  async salvar(c: ContextoSadt, entrada: unknown): Promise<{ id: number }> {
    const e = esquemaInterfaceEquipamento.parse(entrada);
    return this.gravar(
      c,
      'sadt.equipamento.interface.salvar',
      TABELAS_CADASTRO,
      'interface_equipamento',
      async (tx, est) => {
        const modelo = await tx.uma(
          'SELECT padrao_mensagem, sentido FROM modelo_comunicacao WHERE id = ? AND ativo = TRUE',
          [e.modelo],
        );
        const problemas = [
          ...conferirInterface({
            ...e,
            protocolo: e.protocolo as (typeof PROTOCOLOS_INTERFACE)[number],
            padraoDoModelo: modelo ? (texto(modelo['padrao_mensagem']) as PadraoMensagemModelo) : null,
            sentidoDoModelo: modelo ? (texto(modelo['sentido']) as SentidoInterface) : null,
          }),
        ];
        const eq = e.equipamento;
        if (eq.id === null) {
          if (!codigoEquipamentoValido(eq.codigo))
            problemas.push({
              campo: 'equipamento.codigo',
              mensagem: 'Informe o código do equipamento, sem espaço.',
            });
          if (eq.descricao.length < 3)
            problemas.push({ campo: 'equipamento.descricao', mensagem: 'Descreva o equipamento.' });
          if (eq.setor === null)
            problemas.push({ campo: 'equipamento.setor', mensagem: 'Escolha o setor do equipamento.' });
        }
        if (problemas.length) throw recusaDaRegra('interface-invalida', problemas);

        const repetida = await tx.uma(
          'SELECT id FROM interface_equipamento WHERE estabelecimento_id = ? AND codigo = ? AND id <> ?',
          [est, e.codigo, e.id ?? 0],
        );
        if (repetida)
          throw recusa('codigo-repetido', 'Já existe interface com este código.', { campos: ['codigo'] });

        let equipamento: number;
        if (eq.id !== null) {
          const ja = await tx.uma(
            'SELECT id FROM equipamento_analitico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [eq.id, est],
          );
          if (!ja)
            throw recusa('equipamento-inexistente', 'O equipamento não existe neste estabelecimento.', {
              campos: ['equipamento'],
            });
          equipamento = eq.id;
        } else {
          const setor = await tx.uma(
            'SELECT id FROM setor_diagnostico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [eq.setor, est],
          );
          if (!setor)
            throw recusa('setor-inexistente', 'O setor do diagnóstico não existe neste estabelecimento.', {
              campos: ['equipamento.setor'],
            });
          const mesmo = await tx.uma(
            'SELECT id FROM equipamento_analitico WHERE estabelecimento_id = ? AND codigo = ?',
            [est, eq.codigo],
          );
          if (mesmo)
            throw recusa(
              'equipamento-repetido',
              'Já existe equipamento com este código: escolha-o na lista.',
              {
                campos: ['equipamento.codigo'],
              },
            );
          equipamento = await tx.incluir('equipamento_analitico', {
            estabelecimento_id: est,
            codigo: eq.codigo,
            descricao: eq.descricao,
            modelo: eq.modelo,
            numero_serie: eq.numeroSerie,
            setor_diagnostico_id: eq.setor,
            situacao: 'ativo',
          });
        }

        const valores = {
          codigo: e.codigo,
          descricao: e.descricao,
          equipamento_analitico_id: equipamento,
          modelo_comunicacao_id: e.modelo,
          protocolo: e.protocolo,
          sentido: e.sentido,
          endereco_host: e.host,
          porta: e.porta,
          caminho_envio: e.caminhoEnvio,
          caminho_retorno: e.caminhoRetorno,
          envia_lista_trabalho: e.enviaListaTrabalho,
          recebe_resultado: e.recebeResultado,
          importa_como_liberado: e.importaComoLiberado,
          revisa_automaticamente: e.revisaAutomaticamente,
          assina_automaticamente: e.assinaAutomaticamente,
          bloqueia_laudo: e.bloqueiaLaudo,
          ativo: e.ativo,
        };
        if (e.id === null) {
          const novo = await tx.incluir('interface_equipamento', { estabelecimento_id: est, ...valores });
          return { id: novo, saida: { id: novo } };
        }
        const atual = await this.interfaceDoEst(tx, est, e.id);
        if (e.versao === null || e.versao !== n(atual['versao']))
          throw recusa('versao-mudou', 'A interface foi alterada por outra pessoa. Atualize a tela.');
        await tx.alterar('interface_equipamento', e.id, e.versao, valores);
        return { id: e.id, saida: { id: e.id } };
      },
    );
  }

  private async interfaceDoEst(l: Leitor, est: number, interfaceId: number): Promise<Linha> {
    const r = await l.uma(
      'SELECT * FROM interface_equipamento WHERE id = ? AND estabelecimento_id = ? AND laboratorio_apoio_id IS NULL',
      [interfaceId, est],
    );
    if (!r) throw recusa('interface-inexistente', 'A interface não existe neste estabelecimento.');
    return r;
  }

  private async equipamentoDa(l: Leitor, est: number, interfaceId: number): Promise<number> {
    const i = await this.interfaceDoEst(l, est, interfaceId);
    if (i['equipamento_analitico_id'] === null)
      throw recusa('sem-equipamento', 'A interface ainda não tem equipamento: complete o cadastro.');
    return n(i['equipamento_analitico_id']);
  }

  private async deParaExames(l: Leitor, equipamento: number, interfaceId: number, soAtivos: boolean) {
    const linhas = await l.consultar(
      `SELECT d.id, d.versao, d.exame_id, x.nome AS exame_nome, d.material_biologico_id, d.codigo_equipamento,
              d.envia_analitos_no_pedido, d.ativo
         FROM de_para_exame_equipamento d JOIN exame x ON x.id = d.exame_id
        WHERE d.equipamento_analitico_id = ? AND d.excluido_em IS NULL ${soAtivos ? 'AND d.ativo = TRUE' : ''}
        ORDER BY x.nome, d.id`,
      [equipamento],
    );
    const proprios = linhas.map((r) => ({
      id: n(r['id']),
      versao: n(r['versao']),
      exame: n(r['exame_id']),
      exameNome: texto(r['exame_nome']),
      material: nn(r['material_biologico_id']),
      codigo: texto(r['codigo_equipamento']),
      enviaAnalitos: sim(r['envia_analitos_no_pedido']),
      ativo: sim(r['ativo']),
      editavel: true,
    }));
    // A equivalência cadastrada na interface (a que veio da carga) vale onde o equipamento ainda não tem código próprio.
    const daInterface = (
      await l.consultar(
        `SELECT q.id, q.versao, q.exame_id, x.nome AS exame_nome, q.material_biologico_id, q.codigo_exame_equipamento
           FROM equivalencia_exame_equipamento q JOIN exame x ON x.id = q.exame_id
          WHERE q.interface_equipamento_id = ? AND q.excluido_em IS NULL AND q.direcao IN ('envio', 'ambos')
          ORDER BY x.nome, q.id`,
        [interfaceId],
      )
    )
      .map((r) => ({
        id: n(r['id']),
        versao: n(r['versao']),
        exame: n(r['exame_id']),
        exameNome: texto(r['exame_nome']),
        material: nn(r['material_biologico_id']),
        codigo: texto(r['codigo_exame_equipamento']),
        enviaAnalitos: false,
        ativo: true,
        editavel: false,
      }))
      .filter((q) => !proprios.some((p) => p.exame === q.exame && p.material === q.material));
    return [...proprios, ...daInterface];
  }

  private async deParaAnalitos(l: Leitor, equipamento: number, soAtivos: boolean) {
    return (
      await l.consultar(
        `SELECT d.id, d.versao, d.analito_id, a.nome AS analito_nome, d.exame_id, d.codigo_equipamento,
                d.fator_conversao, d.casas_decimais, d.recebe_resultado, d.ativo
           FROM de_para_analito_equipamento d JOIN analito a ON a.id = d.analito_id
          WHERE d.equipamento_analitico_id = ? AND d.excluido_em IS NULL ${soAtivos ? 'AND d.ativo = TRUE' : ''}
          ORDER BY a.nome, d.id`,
        [equipamento],
      )
    ).map((r) => ({
      id: n(r['id']),
      versao: n(r['versao']),
      analito: n(r['analito_id']),
      analitoNome: texto(r['analito_nome']),
      exame: nn(r['exame_id']),
      codigo: texto(r['codigo_equipamento']),
      fator: n(r['fator_conversao']),
      casas: nn(r['casas_decimais']),
      recebe: sim(r['recebe_resultado']),
      ativo: sim(r['ativo']),
    }));
  }

  /** O de-para do equipamento da interface: exames e analitos, ativos e inativos. */
  dePara(c: ContextoSadt, interfaceId: number) {
    return this.ler(c, async (l, est) => {
      const equipamento = await this.equipamentoDa(l, est, interfaceId);
      return {
        exames: await this.deParaExames(l, equipamento, interfaceId, false),
        analitos: await this.deParaAnalitos(l, equipamento, false),
      };
    });
  }

  /** Inclui ou altera o código de um exame no equipamento (inativar tira de uso; nada se apaga). */
  async salvarDeParaExame(c: ContextoSadt, interfaceId: number, entrada: unknown): Promise<{ id: number }> {
    const e = esquemaDeParaExame.parse(entrada);
    return this.gravar(
      c,
      'sadt.equipamento.depara.exame',
      TABELAS_DE_PARA,
      'de_para_exame_equipamento',
      async (tx, est) => {
        const equipamento = await this.equipamentoDa(tx, est, interfaceId);
        const outros = (await this.deParaExames(tx, equipamento, 0, false)).filter((o) => o.id !== e.id);
        const problemas = conferirDeParaExame(e, outros);
        if (!(await tx.uma('SELECT id FROM exame WHERE id = ? AND excluido_em IS NULL', [e.exame])))
          problemas.push({ campo: 'exame', mensagem: 'O exame não existe no catálogo.' });
        if (
          e.material !== null &&
          !(await tx.uma('SELECT id FROM material_biologico WHERE id = ?', [e.material]))
        )
          problemas.push({ campo: 'material', mensagem: 'O material não existe no catálogo.' });
        if (problemas.length) throw recusaDaRegra('de-para-invalido', problemas);
        const valores = {
          exame_id: e.exame,
          material_biologico_id: e.material,
          codigo_equipamento: e.codigo,
          envia_analitos_no_pedido: e.enviaAnalitos,
          ativo: e.ativo,
        };
        if (e.id === null) {
          const novo = await tx.incluir('de_para_exame_equipamento', {
            equipamento_analitico_id: equipamento,
            ...valores,
          });
          return { id: novo, saida: { id: novo } };
        }
        const atual = await tx.uma(
          'SELECT versao FROM de_para_exame_equipamento WHERE id = ? AND equipamento_analitico_id = ? AND excluido_em IS NULL',
          [e.id, equipamento],
        );
        if (!atual) throw recusa('de-para-inexistente', 'O de-para não existe neste equipamento.');
        if (e.versao !== n(atual['versao']))
          throw recusa('versao-mudou', 'O de-para foi alterado por outra pessoa. Atualize a tela.');
        await tx.alterar('de_para_exame_equipamento', e.id, n(atual['versao']), valores);
        return { id: e.id, saida: { id: e.id } };
      },
    );
  }

  /** Inclui ou altera o código de um analito no equipamento, com o fator de conversão e as casas decimais. */
  async salvarDeParaAnalito(c: ContextoSadt, interfaceId: number, entrada: unknown): Promise<{ id: number }> {
    const e = esquemaDeParaAnalito.parse(entrada);
    return this.gravar(
      c,
      'sadt.equipamento.depara.analito',
      TABELAS_DE_PARA,
      'de_para_analito_equipamento',
      async (tx, est) => {
        const equipamento = await this.equipamentoDa(tx, est, interfaceId);
        const outros = (await this.deParaAnalitos(tx, equipamento, false)).filter((o) => o.id !== e.id);
        const problemas = conferirDeParaAnalito(e, outros);
        if (!(await tx.uma('SELECT id FROM analito WHERE id = ? AND excluido_em IS NULL', [e.analito])))
          problemas.push({ campo: 'analito', mensagem: 'O analito não existe no catálogo.' });
        if (
          e.exame !== null &&
          !(await tx.uma(
            'SELECT id FROM exame_analito WHERE exame_id = ? AND analito_id = ? AND excluido_em IS NULL',
            [e.exame, e.analito],
          ))
        )
          problemas.push({ campo: 'exame', mensagem: 'O analito não faz parte do exame escolhido.' });
        if (problemas.length) throw recusaDaRegra('de-para-invalido', problemas);
        const valores = {
          analito_id: e.analito,
          exame_id: e.exame,
          codigo_equipamento: e.codigo,
          fator_conversao: e.fator,
          casas_decimais: e.casas,
          recebe_resultado: e.recebe,
          ativo: e.ativo,
        };
        if (e.id === null) {
          const novo = await tx.incluir('de_para_analito_equipamento', {
            equipamento_analitico_id: equipamento,
            ...valores,
          });
          return { id: novo, saida: { id: novo } };
        }
        const atual = await tx.uma(
          'SELECT versao FROM de_para_analito_equipamento WHERE id = ? AND equipamento_analitico_id = ? AND excluido_em IS NULL',
          [e.id, equipamento],
        );
        if (!atual) throw recusa('de-para-inexistente', 'O de-para não existe neste equipamento.');
        if (e.versao !== n(atual['versao']))
          throw recusa('versao-mudou', 'O de-para foi alterado por outra pessoa. Atualize a tela.');
        await tx.alterar('de_para_analito_equipamento', e.id, n(atual['versao']), valores);
        return { id: e.id, saida: { id: e.id } };
      },
    );
  }

  /** Os exames pedidos com a amostra de cada um: a etiqueta da amostra, ou o número da requisição e a sequência. */
  private async examesPedidos(l: Leitor, est: number, filtro: string, parametros: readonly unknown[]) {
    const linhas = await l.consultar(
      `SELECT ei.id, ei.exame_id, ei.material_biologico_id, ei.urgente, r.numero, ei.sequencia,
              (SELECT a.codigo_barras FROM amostra_biologica_exame ae
                 JOIN amostra_biologica a ON a.id = ae.amostra_biologica_id AND a.excluido_em IS NULL
                                         AND a.situacao NOT IN ('rejeitada', 'descartada', 'cancelada')
                WHERE ae.exame_item_id = ei.id AND ae.excluido_em IS NULL ORDER BY a.id DESC LIMIT 1) AS etiqueta
         FROM exame_item ei
         JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id AND r.excluido_em IS NULL
        WHERE r.estabelecimento_id = ? AND ei.excluido_em IS NULL AND ei.situacao NOT IN ('cancelado', 'recusado')
          AND ${filtro}
        ORDER BY ei.id`,
      [est, ...parametros],
    );
    if (linhas.length === 0) return [];
    const exames = [...new Set(linhas.map((r) => n(r['exame_id'])))];
    const analitos = await l.consultar(
      `SELECT exame_id, analito_id FROM exame_analito
        WHERE exame_id IN (${lista(exames.length)}) AND excluido_em IS NULL AND titulo = FALSE ORDER BY ordem, id`,
      exames,
    );
    return linhas.map((r) => ({
      item: n(r['id']),
      exame: n(r['exame_id']),
      material: nn(r['material_biologico_id']),
      urgente: sim(r['urgente']),
      amostra: tn(r['etiqueta']) ?? `${texto(r['numero'])}-${n(r['sequencia'])}`,
      analitos: analitos.filter((a) => n(a['exame_id']) === n(r['exame_id'])).map((a) => n(a['analito_id'])),
    }));
  }

  /**
   * Envia exames pedidos ao equipamento: uma mensagem por amostra na fila de saída, com os códigos do de-para. O exame
   * sem código fica fora e é devolvido para a tela avisar; sem nenhum código, nada é enviado.
   */
  async enviarPedido(c: ContextoSadt, interfaceId: number, entrada: unknown) {
    const e = esquemaPedidoEquipamento.parse(entrada);
    const itens = [...new Set(e.itens)];
    return this.gravar(
      c,
      'sadt.equipamento.pedido.enviar',
      TABELAS_TRAFEGO,
      'integracao_mensagem',
      async (tx, est) => {
        const i = await this.interfaceDoEst(tx, est, interfaceId);
        if (!sim(i['ativo'])) throw recusa('interface-inativa', 'A interface está inativa.');
        if (!sim(i['envia_lista_trabalho']))
          throw recusa('interface-so-recebe', 'Esta interface não envia lista de trabalho ao equipamento.');
        const equipamento = await this.equipamentoDa(tx, est, interfaceId);
        const pedidos = await this.examesPedidos(tx, est, `ei.id IN (${lista(itens.length)})`, itens);
        if (pedidos.length !== itens.length)
          throw recusa(
            'exame-inexistente',
            'Há exame que não existe neste estabelecimento ou já foi cancelado.',
            {
              campos: ['itens'],
            },
          );
        const dpExames = await this.deParaExames(tx, equipamento, interfaceId, true);
        const dpAnalitos = await this.deParaAnalitos(tx, equipamento, true);
        const mensagens: number[] = [];
        const semDePara: number[] = [];
        let enviados = 0;
        const protocolo = texto(i['protocolo']);
        for (const amostra of [...new Set(pedidos.map((p) => p.amostra))]) {
          const daAmostra = pedidos.filter((p) => p.amostra === amostra);
          const pedido = montarPedidoEquipamento(amostra, daAmostra, dpExames, dpAnalitos);
          semDePara.push(...pedido.semDePara);
          if (pedido.testes.length === 0) continue;
          const urgente = daAmostra.some((p) => p.urgente);
          const conteudo = {
            interface: texto(i['codigo']),
            protocolo,
            amostra,
            urgente,
            testes: pedido.testes,
            itens: daAmostra.filter((p) => !pedido.semDePara.includes(p.item)).map((p) => p.item),
            astm:
              protocolo === 'astm' || protocolo === 'serial'
                ? montarAstmPedido({ amostra, testes: pedido.testes.map((t) => t.codigo), urgente })
                : null,
          };
          enviados += conteudo.itens.length;
          mensagens.push(
            await tx.incluir('integracao_mensagem', {
              estabelecimento_id: est,
              ponto: PONTO_PEDIDO_EQUIPAMENTO,
              direcao: 'saida',
              situacao: 'pendente',
              tentativas: 0,
              entidade: ENTIDADE,
              entidade_id: interfaceId,
              referencia_externa: amostra.slice(0, 120),
              conteudo: JSON.stringify(conteudo),
            }),
          );
        }
        if (mensagens.length === 0)
          throw recusa('sem-de-para', 'Nenhum dos exames tem código neste equipamento: cadastre o de-para.', {
            campos: ['itens'],
          });
        return { id: mensagens[0]!, saida: { mensagens, enviados, semDePara } };
      },
    );
  }

  /**
   * Recebe o resultado do equipamento (as leituras de uma amostra ou a mensagem ASTM inteira). A mensagem é guardada na
   * fila antes de processar; o processamento leva cada leitura ao exame pedido pela regra da digitação e fecha a
   * mensagem como processada ou em erro (com as pendências por código).
   */
  async receberResultado(
    c: ContextoSadt,
    interfaceId: number,
    entrada: unknown,
  ): Promise<RecebimentoEquipamento> {
    const e = esquemaResultadoEquipamento.parse(entrada);
    const amostras: AmostraRecebida[] = e.astm
      ? [...lerAstmResultado(e.astm).amostras]
      : e.amostra && e.leituras?.length
        ? [{ amostra: e.amostra, leituras: e.leituras }]
        : [];
    if (amostras.length === 0 || amostras.every((a) => a.leituras.length === 0))
      throw recusa('mensagem-vazia', 'A mensagem não traz amostra com resultado.', { campos: ['leituras'] });

    // A repetição é barrada pela chave da mensagem do remetente (sob a trava da interface), não pela chave da requisição.
    const guardada = await this.gravar(
      { ...c, chaveIdempotencia: randomUUID() },
      'sadt.equipamento.resultado.receber',
      TABELAS_TRAFEGO,
      'integracao_mensagem',
      async (tx, est) => {
        const [i] = await tx.consultarParaAtualizar(
          'SELECT id, ativo, recebe_resultado FROM interface_equipamento WHERE id = ? AND estabelecimento_id = ? AND laboratorio_apoio_id IS NULL',
          [interfaceId, est],
        );
        if (!i) throw recusa('interface-inexistente', 'A interface não existe neste estabelecimento.');
        if (!sim(i['ativo'])) throw recusa('interface-inativa', 'A interface está inativa.');
        if (!sim(i['recebe_resultado']))
          throw recusa('interface-so-envia', 'Esta interface não recebe resultado do equipamento.');
        const ja = await tx.uma(
          `SELECT id, situacao FROM integracao_mensagem
            WHERE entidade = '${ENTIDADE}' AND entidade_id = ? AND direcao = 'entrada' AND ponto = ? AND referencia_externa = ?`,
          [interfaceId, PONTO_RESULTADO_EQUIPAMENTO, e.chaveMensagem],
        );
        if (ja)
          return {
            id: n(ja['id']),
            saida: { id: n(ja['id']), situacao: texto(ja['situacao']), nova: false },
          };
        const novo = await tx.incluir('integracao_mensagem', {
          estabelecimento_id: est,
          ponto: PONTO_RESULTADO_EQUIPAMENTO,
          direcao: 'entrada',
          situacao: 'pendente',
          tentativas: 0,
          entidade: ENTIDADE,
          entidade_id: interfaceId,
          referencia_externa: e.chaveMensagem,
          conteudo: JSON.stringify({ amostras }),
        });
        return { id: novo, saida: { id: novo, situacao: 'pendente', nova: true } };
      },
    );
    if (!guardada.nova)
      return {
        mensagem: guardada.id,
        situacao: guardada.situacao === 'erro' ? 'erro' : 'processada',
        duplicada: true,
        gravados: [],
        pendencias: [],
      };
    return this.processar(c, interfaceId, guardada.id, amostras, 1);
  }

  /** Reprocessa a mensagem que ficou em erro (depois de corrigido o de-para ou a situação do exame). */
  async reprocessar(c: ContextoSadt, interfaceId: number, mensagem: number): Promise<RecebimentoEquipamento> {
    const m = await this.ler(c, async (l, est) => {
      await this.interfaceDoEst(l, est, interfaceId);
      return l.uma(
        `SELECT situacao, tentativas, conteudo FROM integracao_mensagem
          WHERE id = ? AND entidade = '${ENTIDADE}' AND entidade_id = ? AND direcao = 'entrada'`,
        [mensagem, interfaceId],
      );
    });
    if (!m) throw recusa('mensagem-inexistente', 'A mensagem não existe nesta interface.');
    if (texto(m['situacao']) !== 'erro' && texto(m['situacao']) !== 'pendente')
      throw recusa('mensagem-fechada', 'Só a mensagem com erro é reprocessada.');
    const amostras = z
      .object({
        amostras: z.array(
          z.object({
            amostra: z.string(),
            leituras: z.array(z.object({ codigo: z.string(), valor: z.string() })),
          }),
        ),
      })
      .parse(JSON.parse(texto(m['conteudo']))).amostras;
    return this.processar(c, interfaceId, mensagem, amostras, n(m['tentativas']) + 1);
  }

  /** Os exames pedidos de uma amostra: pela etiqueta, pelo pedido enviado a esta interface ou pelo número e sequência. */
  private async examesDaAmostra(l: Leitor, est: number, interfaceId: number, amostra: string) {
    const porEtiqueta = await this.examesPedidos(
      l,
      est,
      `ei.id IN (SELECT ae.exame_item_id FROM amostra_biologica_exame ae
                   JOIN amostra_biologica a ON a.id = ae.amostra_biologica_id
                  WHERE a.estabelecimento_id = ? AND a.codigo_barras = ? AND a.excluido_em IS NULL AND ae.excluido_em IS NULL)`,
      [est, amostra],
    );
    if (porEtiqueta.length) return porEtiqueta;
    const enviado = await l.uma(
      `SELECT conteudo FROM integracao_mensagem
        WHERE entidade = '${ENTIDADE}' AND entidade_id = ? AND direcao = 'saida' AND ponto = ? AND referencia_externa = ?
        ORDER BY id DESC LIMIT 1`,
      [interfaceId, PONTO_PEDIDO_EQUIPAMENTO, amostra],
    );
    if (enviado) {
      const itens = z
        .object({ itens: z.array(z.number().int().positive()).min(1) })
        .safeParse(JSON.parse(texto(enviado['conteudo'])));
      if (itens.success)
        return this.examesPedidos(l, est, `ei.id IN (${lista(itens.data.itens.length)})`, itens.data.itens);
    }
    const partes = /^(.+)-(\d+)$/.exec(amostra);
    if (!partes) return [];
    return this.examesPedidos(l, est, 'r.numero = ? AND ei.sequencia = ?', [partes[1], Number(partes[2])]);
  }

  private async processar(
    c: ContextoSadt,
    interfaceId: number,
    mensagem: number,
    amostras: readonly AmostraRecebida[],
    tentativa: number,
  ): Promise<RecebimentoEquipamento> {
    const preparado = await this.ler(c, async (l, est) => {
      const equipamento = await this.equipamentoDa(l, est, interfaceId);
      const dpAnalitos: DeParaAnalitoEquipamento[] = await this.deParaAnalitos(l, equipamento, true);
      const porAmostra: { exames: ExameNoEquipamento[]; leituras: readonly LeituraEquipamento[] }[] = [];
      for (const a of amostras)
        porAmostra.push({
          exames: await this.examesDaAmostra(l, est, interfaceId, a.amostra),
          leituras: a.leituras,
        });
      return { equipamento, dpAnalitos, porAmostra };
    });

    const gravados: number[] = [];
    const pendencias: string[] = [];
    for (const a of preparado.porAmostra) {
      if (a.exames.length === 0) {
        pendencias.push('amostra-desconhecida');
        continue;
      }
      const lido = interpretarLeituras(a.leituras, preparado.dpAnalitos, a.exames);
      pendencias.push(...lido.semDePara.map((k) => `codigo-sem-de-para:${k}`));
      pendencias.push(...lido.semExame.map((k) => `codigo-fora-do-pedido:${k}`));
      for (const [item, valores] of lido.porItem) {
        try {
          // A mesma regra da digitação: faixa congelada, valor absurdo recusado, crítico avisado, fórmulas calculadas.
          await this.resultados.registrar(
            { ...c, chaveIdempotencia: `equip:${mensagem}:${item}:${tentativa}` },
            item,
            { valores },
          );
          gravados.push(item);
        } catch (x) {
          if (!(x instanceof ErroOperacao)) throw x;
          pendencias.push(`exame-${item}:${texto(x.problema['codigo'])}`);
        }
      }
    }

    const situacao = pendencias.length === 0 ? ('processada' as const) : ('erro' as const);
    await this.gravar(
      { ...c, chaveIdempotencia: randomUUID() },
      'sadt.equipamento.resultado.concluir',
      TABELAS_TRAFEGO,
      'integracao_mensagem',
      async (tx) => {
        const agora = new Date();
        for (const item of gravados) {
          const [r] = await tx.consultarParaAtualizar(
            'SELECT id, versao FROM resultado_exame WHERE exame_item_id = ? AND excluido_em IS NULL',
            [item],
          );
          if (!r) continue;
          await tx.alterar('resultado_exame', n(r['id']), n(r['versao']), {
            forma_entrada: 'interface',
            equipamento_analitico_id: preparado.equipamento,
          });
          await tx.executar(
            'UPDATE resultado_analito SET equipamento_analitico_id = ? WHERE resultado_exame_id = ? AND excluido_em IS NULL',
            [preparado.equipamento, n(r['id'])],
          );
        }
        const [m] = await tx.consultarParaAtualizar('SELECT versao FROM integracao_mensagem WHERE id = ?', [
          mensagem,
        ]);
        await tx.alterar('integracao_mensagem', mensagem, n(m?.['versao']), {
          situacao,
          tentativas: tentativa,
          erro: pendencias.length ? [...new Set(pendencias)].join('; ').slice(0, 2000) : null,
          processada_em: agora,
        });
        return { id: mensagem, saida: null };
      },
    );
    return { mensagem, situacao, duplicada: false, gravados, pendencias: [...new Set(pendencias)] };
  }

  /** As últimas mensagens trafegadas com o equipamento (sem o conteúdo: só a situação e a pendência). */
  mensagens(c: ContextoSadt, interfaceId: number): Promise<MensagemEquipamento[]> {
    return this.ler(c, async (l, est) => {
      await this.interfaceDoEst(l, est, interfaceId);
      return (
        await l.consultar(
          `SELECT id, direcao, situacao, referencia_externa, tentativas, erro, criado_em, processada_em
             FROM integracao_mensagem
            WHERE entidade = '${ENTIDADE}' AND entidade_id = ? AND ponto IN (?, ?)
            ORDER BY id DESC LIMIT 100`,
          [interfaceId, PONTO_PEDIDO_EQUIPAMENTO, PONTO_RESULTADO_EQUIPAMENTO],
        )
      ).map((r) => ({
        id: n(r['id']),
        direcao: texto(r['direcao']) === 'saida' ? ('saida' as const) : ('entrada' as const),
        situacao: texto(r['situacao']),
        referencia: texto(r['referencia_externa']),
        tentativas: n(r['tentativas']),
        erro: tn(r['erro']),
        criadaEm: instante(r['criado_em']),
        processadaEm: instante(r['processada_em']),
      }));
    });
  }
}
