// Porta PRÓPRIA do atendimento externo (F2.2) sobre o MariaDB do cliente, pelo @sgh/nucleo: atendimento,
// atendimento_situacao_historico, atendimento_procedimento, cobertura_atendimento, atendimento_senha, cancelamento,
// ocupação do leito de observação, e as leituras de apoio (fonte pagadora, unidade, especialidade, profissional, centro
// de custo, CID-10, item faturável, solicitante externo, local de atendimento).
// Leituras somente leitura; gravações pelo Executor (trilha, outbox e idempotência na mesma transação). Toda leitura
// de atendimento filtra o estabelecimento da sessão e `excluido_em IS NULL`.
// Melhoria: o número do atendimento vem da sequencia_negocio do estabelecimento (nunca o id); a situação segue o
// histórico (atendimento_situacao_historico) na mesma transação; o desfecho fecha a saída e a ocupação do leito.
// Melhoria: a exclusão do atendimento é lógica (situação "cancelado" + cancelamento_atendimento com motivo e
// justificativa), nunca apagar o registro clínico.
// Melhoria: o leito de observação não aceita duas ocupações vigentes (a coluna gerada com UNIQUE do banco vira recusa
// de negócio).
// Melhoria: abertura confere no domínio a senha (do dia, na fila, sem outro atendimento) e a marcação (do dia, do mesmo
// paciente, sem atendimento), dá a marcação como atendida e liga a teleconsulta na mesma transação; grava o responsável;
// local, senha e marcação só do estabelecimento da sessão.
// Melhoria: consultório com chamada registrada (chamada_painel, com ou sem senha), atender só depois de chamar, e fila
// pela prioridade legal da senha; exclusão só do atendimento aberto por engano (fecha a observação, devolve a senha do
// dia à fila e desfaz o vínculo da marcação); ato médico só por médico (CBO 225 ou CRM ativo), relido na operação.
// Melhoria: observação sem dois leitos para o mesmo atendimento; na transferência a contagem das horas continua a da
// primeira entrada; justificativa e horas pelo domínio; a saída devolve o atendimento a "em atendimento".
// Herança do atendimento anterior: porta-propria-heranca.ts (regra_heranca_campo por escopo).
// Correção da ficha (segurado, alteração, correção e estorno do extra): porta-propria-correcao.ts.
// Indicadores do período (contagens e marcas de tempo): porta-propria-indicadores.ts.
// Pendente (pedido ao orquestrador): impressos, paciente
// não identificado, escore do PA, sinais e marcação respondem 501 (ou vazio no quadro) até a regra e o
// modelo chegarem.
import { randomUUID } from 'node:crypto';
import {
  type AtendimentoDetalhe,
  type AtendimentoResumo,
  CARATERES,
  type CancelarAtendimentoEntrada,
  CODIGOS_TIPO_ATENDIMENTO,
  type ConduzirNoConsultorioEntrada,
  DESFECHOS,
  esquemaCancelarAtendimento,
  esquemaConduzirNoConsultorio,
  esquemaEncerrarAtendimento,
  esquemaLancarItem,
  esquemaLancarProcedimentoExtra,
  rotuloConta,
  TIPOS_ATENDIMENTO,
  type TipoAtendimento,
} from '@sgh/contratos';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  type Operacao,
  type ResultadoOperacao,
  recusa,
  restricaoUnicaViolada,
  type TxOperacao,
} from '@sgh/nucleo';
import {
  ehMedico,
  horasDeObservacao,
  ordenarFilaConsultorio,
  prioridadeDaSenha,
  type Recusa,
  recusaCancelamento,
  recusaConducao,
  recusaMarcacaoNaAbertura,
  recusaSaidaObservacao,
  recusaSenhaNaAbertura,
  senhaVoltaAFila,
  situacaoNoConsultorio,
} from '@sgh/dominio-atendimento';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import { conferirCadastroNaAbertura } from '../cadastro/campos-abertura.js';
import { nomeNoNucleo } from '../cadastro/porta-propria.js';
import {
  alertasRepresentacaoDoPaciente,
  MENSAGEM_ALERTA_REPRESENTACAO,
} from '../cadastro/representacao-paciente-propria.js';
import type { LiberacaoOperacao, RegistroTrilhaTela } from '../cadastro/tipos.js';
import type { GravacaoFeita } from '../exames/public-api.js';
import {
  abrirContaDaEntrada,
  apurarConta,
  cancelarContasDaEntrada,
  TABELAS_CONTA_ENTRADA,
} from '../faturamento/conta-entrada.js';
import { lancarItem } from '../faturamento/operacoes.js';
import { conferirCredenciamentoNoFluxo } from '../precos/credenciamento-fluxo.js';
import { ENTRADAS_OPERACOES_ATENDIMENTO } from './operacoes.js';
import { gravarImpressoEmitido, lerFichasDoAtendimento } from './regras-impressao.js';
import { OPERACOES_CORRECAO_FICHA } from './porta-propria-correcao.js';
import { gravarEtapaPa, gravarEtapasSePa, lerEtapasPa } from './porta-propria-etapas.js';
import { diaDeslocado, lerIndicadoresProprios } from './porta-propria-indicadores.js';
import {
  lerEscoposHeranca,
  lerMarcasHeranca,
  OPERACAO_ALTERAR_HERANCA,
  valoresHerdaveisDoAnterior,
} from './porta-propria-heranca.js';
import {
  lerPadraoAbertura,
  OPERACAO_DEFINIR_MEU_PADRAO_ABERTURA,
  OPERACAO_DEFINIR_PADRAO_ABERTURA,
} from './porta-propria-padrao.js';
import { solicitanteQueRespondeHoje } from '../cadastro/solicitante-vigente.js';
import type {
  ContextoAtendimento,
  DadosImpresso,
  FichasConfiguradas,
  GravadorSghAtendimento,
  PortaAtendimento,
  ProfissionalDaSessao,
} from './porta.js';
import type {
  ApoioAtendimentoDados,
  AtendimentoPa,
  EscorePaRegistrado,
  IndicadoresDados,
  ItemFila,
  LeitoObservacao,
  MarcacaoParaAbertura,
  PreviaCancelamentoDados,
  SinaisRecentes,
} from './tipos.js';

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoAtendimento {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

const FUSO_PADRAO = 'America/Sao_Paulo';
const TETO_DIA = 500;

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};
const inteiro = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const booleano = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 1n;
const instante = (v: unknown): Date | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' && v) {
    const d = new Date(`${v.replace(' ', 'T')}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

/** "AAAA-MM-DDTHH:MM:SS" do instante no fuso do estabelecimento. */
export function localNoFuso(d: Date, fuso: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .format(d)
    .replace(' ', 'T');
}

/** O instante UTC da meia-noite do dia (AAAA-MM-DD) no fuso. */
export function inicioDoDia(data: string, fuso: string): Date {
  const g = new Date(`${data}T00:00:00Z`);
  const local = new Date(`${localNoFuso(g, fuso)}Z`);
  return new Date(g.getTime() - (local.getTime() - g.getTime()));
}

const pendenteLeitura = (recurso: string): Promise<never> =>
  Promise.reject(
    new ErroProblema(
      'indisponivel',
      501,
      'Recurso em construção',
      `${recurso}: ainda não disponível sobre o banco do cliente. Nada foi lido nem gravado.`,
    ),
  );
const pendenteGravacao = (recurso: string) =>
  new ErroOperacao(
    501,
    'recurso-em-construcao',
    'Recurso em construção',
    `${recurso}: ainda não disponível sobre o banco do cliente. Nada foi gravado.`,
  );

/** Lê e trava uma linha (SELECT ... FOR UPDATE pelo Escritor); null se não houver. */
async function travarUma<T extends Linha = Linha>(
  tx: TxOperacao,
  sql: string,
  p: readonly unknown[],
): Promise<T | null> {
  const [x] = await tx.consultarParaAtualizar<T>(sql, p, { teto: 1 });
  return x ?? null;
}

/** A recusa do domínio vira a recusa da operação (com o campo, quando houver). */
function recusar(x: Recusa | null, campos?: string[]): void {
  if (x) throw recusa(x.codigo, x.mensagem, campos ? { campos } : undefined);
}

/** O dia de hoje (AAAA-MM-DD) no fuso do estabelecimento, dentro da transação. */
async function hojeDoEstabelecimento(tx: TxOperacao, estabelecimento: number): Promise<string> {
  const x = await tx.uma<{ f: unknown }>('SELECT fuso_horario AS f FROM estabelecimento WHERE id = ?', [
    estabelecimento,
  ]);
  return localNoFuso(new Date(), texto(x?.f) ?? FUSO_PADRAO).slice(0, 10);
}

const caraterDoCodigoTiss = (c: unknown): AtendimentoResumo['carater'] =>
  CARATERES.find((x) => String(x.tiss) === String(c ?? ''))?.codigo ?? null;
const tipoDoCodigo = (c: unknown): TipoAtendimento | null =>
  (CODIGOS_TIPO_ATENDIMENTO as readonly string[]).includes(String(c)) ? (String(c) as TipoAtendimento) : null;

const SELECT_ATENDIMENTO = `
  SELECT a.id, a.numero, a.entrada_em, a.saida_em, a.situacao, a.desfecho, a.retorno, a.versao, a.observacao,
         a.marcacao_horario_id,
         a.unidade_assistencial_id, a.local_atendimento_id, a.data_requisicao,
         ca.codigo AS tipo, ca.descricao AS tipo_rotulo, ca.laboratorio,
         p.id AS paciente_id, p.numero_prontuario, pf.nome AS paciente_nome, pf.nome_social, pf.data_nascimento,
         fp.id AS convenio_id, fp.nome AS convenio_nome,
         pr.id AS profissional_id, ppf.nome AS profissional_nome,
         (SELECT ic.numero_inscricao FROM inscricao_conselho ic WHERE ic.profissional_id = pr.id AND ic.excluido_em IS NULL
           ORDER BY ic.principal DESC, ic.sequencia LIMIT 1) AS crm,
         em.id AS especialidade_id, em.descricao AS especialidade_nome,
         ct.codigo_tiss AS carater,
         se.id AS senha_id, se.codigo_exibicao AS senha_texto
    FROM atendimento a
    JOIN categoria_atendimento ca ON ca.id = a.categoria_atendimento_id
    JOIN paciente p ON p.id = a.paciente_id
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    JOIN fonte_pagadora fp ON fp.id = a.fonte_pagadora_id
    JOIN profissional pr ON pr.id = a.profissional_id
    JOIN pessoa_fisica ppf ON ppf.id = pr.pessoa_fisica_id
    LEFT JOIN especialidade_medica em ON em.id = a.especialidade_medica_id
    LEFT JOIN carater_atendimento_tiss ct ON ct.id = a.carater_atendimento_tiss_id
    LEFT JOIN atendimento_senha ats ON ats.id = (
      SELECT s2.id FROM atendimento_senha s2 WHERE s2.atendimento_id = a.id AND s2.excluido_em IS NULL ORDER BY s2.id LIMIT 1)
    LEFT JOIN senha_emitida se ON se.id = ats.senha_emitida_id
   WHERE a.excluido_em IS NULL AND a.estabelecimento_id = ?`;

function resumoDaLinha(l: Linha, fuso: string): AtendimentoResumo {
  const entrada = instante(l['entrada_em']) ?? new Date(0);
  const local = localNoFuso(entrada, fuso);
  const tipo = tipoDoCodigo(l['tipo']);
  const desfecho = DESFECHOS.find((d) => d.codigo === texto(l['desfecho']));
  const saida = instante(l['saida_em']);
  const crm = texto(l['crm']);
  return {
    reg: Number(l['id']),
    cabecalho: String(l['numero']),
    data: local.slice(0, 10),
    hora: local.slice(11, 16),
    tipo,
    tipoLegado: 0,
    tipoRotulo: TIPOS_ATENDIMENTO.find((t) => t.codigo === tipo)?.rotulo ?? texto(l['tipo_rotulo']) ?? '',
    requisicao: tipo === 'requisicaoLab' || booleano(l['laboratorio']),
    paciente: {
      id: Number(l['paciente_id']),
      prontuario: Number(l['numero_prontuario']),
      nome: texto(l['paciente_nome']) ?? '',
    },
    convenio: { codigo: Number(l['convenio_id']), nome: texto(l['convenio_nome']) ?? '' },
    profissional: {
      crm: crm && /^\d{1,9}$/.test(crm) ? Number(crm) : 0,
      nome: texto(l['profissional_nome']) ?? '',
    },
    especialidade: {
      codigo: inteiro(l['especialidade_id']) ?? 0,
      nome: texto(l['especialidade_nome']) ?? '',
    },
    unidade: inteiro(l['unidade_assistencial_id']) ?? 0,
    carater: caraterDoCodigoTiss(l['carater']),
    senha: l['senha_id'] ? { id: Number(l['senha_id']), texto: String(l['senha_texto'] ?? '') } : null,
    desfecho: desfecho
      ? { codigo: desfecho.codigo, rotulo: desfecho.rotulo, em: saida ? localNoFuso(saida, fuso) : '' }
      : null,
    abertoNoNovo: true,
  };
}

/** O gravador das gravações diretas sobre a transação da operação. */
function gravadorSobre(tx: TxOperacao, estabelecimento: number): GravadorSghAtendimento {
  const atendimentoPorNumero = async (numero: string) => {
    // Trava a linha do atendimento: duas alocações simultâneas do mesmo paciente se enfileiram aqui.
    const [x] = await tx.consultarParaAtualizar<{ id: unknown; versao: unknown; situacao: unknown }>(
      'SELECT id, versao, situacao FROM atendimento WHERE estabelecimento_id = ? AND numero = ? AND excluido_em IS NULL',
      [estabelecimento, numero],
      { teto: 1 },
    );
    if (!x) throw recusa('registro-inexistente', 'O atendimento não existe mais.');
    return { id: Number(x.id), versao: Number(x.versao), situacao: String(x.situacao) };
  };
  const ocupacaoAtiva = (atendimento: number) =>
    tx.uma<{ id: unknown; versao: unknown; data_hora_entrada: unknown }>(
      "SELECT id, versao, data_hora_entrada FROM ocupacao_leito_observacao WHERE atendimento_id = ? AND situacao = 'ativa' AND data_hora_saida IS NULL AND excluido_em IS NULL",
      [atendimento],
    );
  return {
    // A etapa "observação" do PA é a própria ocupação do leito (devolve o id dela); as demais etapas são fatos só de
    // acréscimo em atendimento_etapa_pa (porta-propria-etapas.ts).
    async registrarEtapa(r) {
      const a = await atendimentoPorNumero(r.cabecalho);
      if (r.etapa !== 'observacao') return gravarEtapaPa(tx, a.id, r.etapa);
      const o = await ocupacaoAtiva(a.id);
      if (!o) throw recusa('fora-de-observacao', 'O paciente não está em observação.');
      // A marca de tempo da observação também entra na linha do tempo do PA; o id devolvido segue o da ocupação.
      await gravarEtapaPa(tx, a.id, 'observacao');
      return Number(o.id);
    },
    async alocarObservacao(r) {
      const a = await atendimentoPorNumero(r.cabecalho);
      if (a.situacao === 'encerrado' || a.situacao === 'cancelado')
        throw recusa('atendimento-encerrado', 'O atendimento já foi encerrado.');
      if (await ocupacaoAtiva(a.id))
        throw recusa('ja-em-observacao', 'O paciente já está em observação: tire do leito antes de trocar.');
      const leito = await tx.uma(
        'SELECT id FROM leito_observacao WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
        [r.leito, estabelecimento],
      );
      if (!leito)
        throw recusa('leito-inexistente', 'Leito de observação não encontrado neste estabelecimento.');
      // Na transferência, a entrada continua a da primeira alocação (a contagem das horas é do paciente).
      let entrada = new Date();
      if (r.anterior) {
        const ant = await tx.uma<{ e: unknown }>(
          'SELECT data_hora_entrada AS e FROM ocupacao_leito_observacao WHERE id = ? AND atendimento_id = ? AND excluido_em IS NULL',
          [r.anterior, a.id],
        );
        if (!ant)
          throw recusa('ocupacao-anterior-desconhecida', 'A ocupação anterior não é deste atendimento.');
        entrada = instante(ant.e) ?? entrada;
      }
      const id = await tx
        .incluir('ocupacao_leito_observacao', {
          estabelecimento_id: estabelecimento,
          atendimento_id: a.id,
          leito_observacao_id: r.leito,
          finalidade: 'observacao',
          data_hora_entrada: entrada,
          registro_usuario_id: tx.contexto.usuario,
          situacao: 'ativa',
          justificativa: r.motivoTransferencia ?? null,
        })
        .catch((e: unknown) => {
          if (restricaoUnicaViolada(e)) throw recusa('leito-ocupado', 'O leito já está ocupado.');
          throw e;
        });
      if (a.situacao !== 'em_observacao') await mudarSituacao(tx, a, 'em_observacao');
      return id;
    },
    async liberarObservacao(r) {
      const a = await atendimentoPorNumero(r.cabecalho);
      const o = await ocupacaoAtiva(a.id);
      if (!o) throw recusa('fora-de-observacao', 'O paciente não está em observação.');
      const agora = new Date();
      const entrada = instante(o.data_hora_entrada) ?? agora;
      const horas = horasDeObservacao(entrada.toISOString(), agora.toISOString());
      recusar(
        recusaSaidaObservacao({
          horas,
          limiteHoras: r.limiteHoras,
          justificativa: r.justificativa,
          transferencia: r.transferencia === true,
        }),
        ['justificativa'],
      );
      await tx.alterar('ocupacao_leito_observacao', Number(o.id), Number(o.versao), {
        data_hora_saida: agora,
        situacao: 'encerrada',
        destino: r.transferencia ? 'outro_leito' : null,
        justificativa: texto(r.justificativa),
      });
      // Saiu da observação (não é troca de leito): o atendimento volta a "em atendimento" e reaparece na fila.
      if (!r.transferencia && a.situacao === 'em_observacao') await mudarSituacao(tx, a, 'em_atendimento');
      return { horas, id: Number(o.id) };
    },
    // 02-REC linha 35: cada emissão fica numerada por impresso do atendimento (a segunda em diante é reimpressão).
    registrarImpresso: (r) => gravarImpressoEmitido(tx, estabelecimento, r),
    marcarNaoIdentificado: () => Promise.reject(pendenteGravacao('Paciente não identificado')),
    identificarPaciente: () => Promise.reject(pendenteGravacao('Identificação do paciente')),
    registrarEscorePa: () => Promise.reject(pendenteGravacao('Escore do pronto atendimento')),
    estornarEscorePa: () => Promise.reject(pendenteGravacao('Estorno do escore do pronto atendimento')),
  };
}

const TABELAS_GRAVACAO_DIRETA = [
  'atendimento',
  'atendimento_etapa_pa',
  'atendimento_situacao_historico',
  'ocupacao_leito_observacao',
  'atendimento_impresso_emitido',
];

export class PortaAtendimentoPropria implements PortaAtendimento {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;
  private readonly fusos = new Map<number, string>();

  constructor(
    private readonly nucleo: NucleoAtendimento,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoAtendimento, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'atendimento' }, fn);
  }

  /** O estabelecimento da sessão (pelo id, ou pelo código quando o mapa ainda não o tinha); sem ele, recusa. */
  private async estabelecimento(c: ContextoAtendimento, l: Leitor): Promise<number> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const x = await l.uma<{ id: unknown }>(
      'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
      [c.hospital],
    );
    if (!x)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Estabelecimento desconhecido',
        'O estabelecimento da sessão não existe.',
      );
    return Number(x.id);
  }

  private async fuso(l: Leitor, estabelecimento: number): Promise<string> {
    const ja = this.fusos.get(estabelecimento);
    if (ja) return ja;
    const x = await l.uma<{ f: unknown }>('SELECT fuso_horario AS f FROM estabelecimento WHERE id = ?', [
      estabelecimento,
    ]);
    const f = texto(x?.f) ?? FUSO_PADRAO;
    this.fusos.set(estabelecimento, f);
    return f;
  }

  private async contextoNucleo(c: ContextoAtendimento, ctx: ContextoOperacao): Promise<ContextoOperacao> {
    const est = ctx.estabelecimento ?? (await this.ler(c, (l) => this.estabelecimento(c, l)));
    return {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: ctx.usuario,
      correlacao: ctx.correlacao,
      chaveIdempotencia: ctx.chaveIdempotencia,
      ...(ctx.reautenticadoEm !== undefined ? { reautenticadoEm: ctx.reautenticadoEm } : {}),
    };
  }

  async podeGravar(c: ContextoAtendimento, operacao: string): Promise<LiberacaoOperacao> {
    const r = await this.executor.liberacao(
      definirOperacao({
        nome: nomeNoNucleo(operacao),
        tabelas: ['atendimento'],
        entrada: z.unknown(),
        gravar: async () => ({}),
        alvo: () => ({ tabela: 'atendimento', id: null }),
      }),
      {
        cliente: this.cliente,
        estabelecimento: c.estabelecimento,
        usuario: c.usuario,
        correlacao: c.correlacao || 'liberacao',
        chaveIdempotencia: 'consulta-liberacao',
      },
    );
    return { pode: r.pode, codigo: r.codigo, motivo: r.motivo };
  }

  async executar(
    c: ContextoAtendimento,
    op: string,
    entrada: unknown,
    ctx: ContextoOperacao,
  ): Promise<GravacaoFeita> {
    const operacao = OPERACOES_PROPRIAS[op];
    if (!operacao) {
      if (ENTRADAS_OPERACOES_ATENDIMENTO[op]) throw pendenteGravacao(`A operação ${op}`);
      throw new ErroOperacao(
        400,
        'operacao-desconhecida',
        'Operação desconhecida',
        `A operação ${op} não existe.`,
      );
    }
    const r = await this.executor.executar(
      operacao,
      this.cliente,
      entrada,
      await this.contextoNucleo(c, ctx),
    );
    return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
  }

  async gravarSgh<T>(
    c: ContextoAtendimento,
    trilha: RegistroTrilhaTela | ((r: T) => RegistroTrilhaTela),
    fn: (g: GravadorSghAtendimento) => Promise<T>,
  ): Promise<T> {
    let saida: { valor: T } | null = null;
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const est = await this.ler(c, (l) => this.estabelecimento(c, l));
    const op = definirOperacao({
      nome: 'atendimento.gravacao-direta',
      tabelas: TABELAS_GRAVACAO_DIRETA,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = { valor: await fn(gravadorSobre(tx, est)) };
        return {} as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'atendimento', id: l?.entidadeId ?? null };
      },
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = `direta:${randomUUID()}`;
    await this.executor.executar(
      op,
      this.cliente,
      { chave },
      {
        cliente: this.cliente,
        estabelecimento: est,
        usuario: c.usuario,
        correlacao: c.correlacao || 'atendimento',
        chaveIdempotencia: chave,
      },
    );
    if (!saida) throw new Error('Gravação direta sem resultado.');
    return (saida as { valor: T }).valor;
  }

  // ---- leituras ----

  relogio(c: ContextoAtendimento): Promise<{ hoje: string; agora: string }> {
    return this.ler(c, async (l) => {
      const agora = localNoFuso(new Date(), await this.fuso(l, await this.estabelecimento(c, l)));
      return { hoje: agora.slice(0, 10), agora };
    });
  }

  atendimentosDoDia(
    c: ContextoAtendimento,
    f: { data: string; unidade?: number; requisicoes?: boolean; local?: number; termo?: string },
  ) {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const fuso = await this.fuso(l, est);
      const inicio = inicioDoDia(f.data, fuso);
      const fim = new Date(inicio.getTime() + 86_400_000);
      let sql = `${SELECT_ATENDIMENTO} AND a.situacao <> 'cancelado' AND a.entrada_em >= ? AND a.entrada_em < ?`;
      const p: unknown[] = [est, inicio, fim];
      if (f.unidade) {
        sql += ' AND a.unidade_assistencial_id = ?';
        p.push(f.unidade);
      }
      if (f.local) {
        sql += ' AND a.local_atendimento_id = ?';
        p.push(f.local);
      }
      const t = (f.termo ?? '').trim();
      if (/^\d{1,20}$/.test(t)) {
        sql += ' AND (a.numero = ? OR p.numero_prontuario = ?)';
        p.push(t, Number(t));
      } else if (t.length >= 2 && !/[%_\\]/.test(t)) {
        sql += " AND CONCAT(' ', pf.nome, ' ') LIKE CONCAT('% ', ?, '%')";
        p.push(t);
      }
      sql += ` ORDER BY a.entrada_em, a.id LIMIT ${TETO_DIA + 1}`;
      const linhas = await l.consultar(sql, p, { teto: TETO_DIA + 1 });
      const todos = linhas.slice(0, TETO_DIA).map((x) => resumoDaLinha(x, fuso));
      const requisicoes = todos.filter((x) => x.requisicao).length;
      const itens = f.requisicoes ? todos.filter((x) => x.requisicao) : todos.filter((x) => !x.requisicao);
      return { itens, cortada: linhas.length > TETO_DIA, requisicoes };
    });
  }

  /** Pendente: a marcação da agenda é do módulo da agenda (a abertura pela marcação segue sem preenchimento). */
  async marcacao(): Promise<MarcacaoParaAbertura | null> {
    return null;
  }

  detalhe(c: ContextoAtendimento, reg: number): Promise<AtendimentoDetalhe | null> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const fuso = await this.fuso(l, est);
      const x = await l.uma(`${SELECT_ATENDIMENTO} AND a.id = ?`, [est, reg]);
      if (!x) return null;
      const r = resumoDaLinha(x, fuso);
      const cob = await l.uma(
        `SELECT ca.numero_carteira, ca.validade_carteira, ca.numero_guia, ca.senha_autorizacao, ca.validade_senha,
                pl.descricao AS plano
           FROM cobertura_atendimento ca LEFT JOIN plano_fonte_pagadora pl ON pl.id = ca.plano_fonte_pagadora_id
          WHERE ca.atendimento_id = ? AND ca.excluido_em IS NULL ORDER BY ca.ordem LIMIT 1`,
        [reg],
      );
      const procs = await l.consultar(
        `SELECT ap.sequencia, ap.principal, ap.quantidade, i.id AS item, i.descricao, ci.valor_total
           FROM atendimento_procedimento ap
           JOIN item_faturavel i ON i.id = ap.item_faturavel_id
           LEFT JOIN conta_hospitalar_item ci ON ci.id = ap.conta_hospitalar_item_id
          WHERE ap.atendimento_id = ? AND ap.excluido_em IS NULL ORDER BY ap.sequencia`,
        [reg],
        { teto: 500 },
      );
      const principal = procs.find((p) => booleano(p['principal']));
      const conta = await l.uma(
        'SELECT id FROM atendimento_conta WHERE atendimento_id = ? AND excluido_em IS NULL LIMIT 1',
        [reg],
      );
      const situacaoConta = conta ? 'aberta' : 'semConta';
      const termo = async (id: unknown) => {
        if (!id) return null;
        const t = await l.uma('SELECT id, codigo_termo, descricao FROM termo_terminologia WHERE id = ?', [
          id,
        ]);
        return t
          ? { id: Number(t['id']), codigo: String(t['codigo_termo']), nome: texto(t['descricao']) ?? '' }
          : null;
      };
      const ids = await l.uma(
        'SELECT cid_principal_termo_terminologia_id AS c1, cid_secundario_termo_terminologia_id AS c2, solicitante_externo_id AS s FROM atendimento WHERE id = ?',
        [reg],
      );
      const sol = ids?.['s']
        ? await l.uma(
            `SELECT s.id, s.nome, CONCAT(cc.sigla, ' ', s.numero_conselho, '/', uf.sigla) AS registro FROM solicitante_externo s
               JOIN conselho_classe cc ON cc.id = s.conselho_classe_id JOIN unidade_federativa uf ON uf.id = s.conselho_unidade_federativa_id
              WHERE s.id = ?`,
            [ids['s']],
          )
        : null;
      const obs = await l.uma(
        `SELECT o.data_hora_entrada, o.data_hora_saida, lo.codigo AS leito, lc.nome AS local FROM ocupacao_leito_observacao o
           JOIN leito_observacao lo ON lo.id = o.leito_observacao_id JOIN local_observacao lc ON lc.id = lo.local_observacao_id
          WHERE o.atendimento_id = ? AND o.excluido_em IS NULL ORDER BY o.data_hora_entrada DESC LIMIT 1`,
        [reg],
      );
      const entradaObs = instante(obs?.['data_hora_entrada']);
      const saidaObs = instante(obs?.['data_hora_saida']);
      const horasObs = entradaObs
        ? Math.floor(((saidaObs ?? new Date()).getTime() - entradaObs.getTime()) / 3_600_000)
        : 0;
      const data = (v: unknown) => (instante(v) ? localNoFuso(instante(v)!, 'UTC').slice(0, 10) : null);
      return {
        ...r,
        matricula: texto(cob?.['numero_carteira']) ?? '',
        validadeCarteira: data(cob?.['validade_carteira']),
        guia: texto(cob?.['numero_guia']) ?? '',
        senhaConvenio: texto(cob?.['senha_autorizacao']) ?? '',
        validadeSenha: data(cob?.['validade_senha']),
        plano: texto(cob?.['plano']) ?? '',
        responsavel: null,
        procedimento: principal
          ? { codigo: Number(principal['item']), nome: texto(principal['descricao']) ?? '', valor: 0 }
          : { codigo: 0, nome: '', valor: 0 },
        extras: procs
          .filter((p) => !booleano(p['principal']))
          .map((p) => ({
            procedimento: Number(p['item']),
            nome: texto(p['descricao']) ?? '',
            quantidade: Number(p['quantidade']),
            valor: Number(p['valor_total'] ?? 0),
            profissional: r.profissional.nome,
            seq: Number(p['sequencia']),
          })),
        conta: {
          situacao: situacaoConta,
          rotulo: rotuloConta(situacaoConta),
          permiteLancar: situacaoConta === 'aberta',
        } as AtendimentoDetalhe['conta'],
        versao: `v${inteiro(x['versao']) ?? 0}`,
        observacao: obs
          ? {
              leito: String(obs['leito']),
              local: String(obs['local']),
              entrada: entradaObs ? localNoFuso(entradaObs, fuso) : '',
              saida: saidaObs ? localNoFuso(saidaObs, fuso) : null,
              horas: horasObs,
              alerta: horasObs >= 24,
            }
          : null,
        etapas: await lerEtapasPa(l, reg, (d) => localNoFuso(d, fuso)),
        cidPrincipal: await termo(ids?.['c1']),
        cidSecundario: await termo(ids?.['c2']),
        solicitante: sol
          ? { id: Number(sol['id']), nome: texto(sol['nome']) ?? '', registro: texto(sol['registro']) ?? '' }
          : null,
        observacaoFicha: texto(x['observacao']),
      };
    });
  }

  fila(
    c: ContextoAtendimento,
    o: { local: number; hoje: string; crm?: number },
  ): Promise<{ itens: ItemFila[]; cortada: boolean }> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const fuso = await this.fuso(l, est);
      const inicio = inicioDoDia(o.hoje, fuso);
      const linhas = await l.consultar(
        `SELECT x.*,
                se.prioritaria, gp.idade_minima,
                (SELECT COUNT(*) FROM chamada_painel cp WHERE cp.atendimento_id = x.id AND cp.excluido_em IS NULL) AS chamadas,
                (SELECT ha.inicio_em FROM marcacao_horario mh JOIN horario_agenda ha ON ha.id = mh.horario_agenda_id
                  WHERE mh.id = x.marcacao_horario_id) AS agendado_para
           FROM (${SELECT_ATENDIMENTO} AND a.local_atendimento_id = ?
                   AND a.situacao IN ('aberto', 'em_atendimento', 'em_observacao', 'encerrado')
                   AND a.entrada_em >= ? AND a.entrada_em < ? ORDER BY a.entrada_em, a.id LIMIT ${TETO_DIA + 1}) x
           LEFT JOIN senha_emitida se ON se.id = x.senha_id
           LEFT JOIN grupo_prioridade_legal gp ON gp.id = se.grupo_prioridade_legal_id`,
        [est, o.local, inicio, new Date(inicio.getTime() + 86_400_000)],
        { teto: TETO_DIA + 1 },
      );
      // Ordem de chamada do domínio: em atendimento, chamados, aguardando pela prioridade legal e pela hora.
      const itens = ordenarFilaConsultorio(
        linhas.slice(0, TETO_DIA).map((x) => {
          const r = resumoDaLinha(x, fuso);
          const sit = texto(x['situacao']) ?? '';
          const chamadas = inteiro(x['chamadas']) ?? 0;
          const agendado = instante(x['agendado_para']);
          const situacao = situacaoNoConsultorio({ situacao: sit, chamado: chamadas > 0 });
          const item: ItemFila = {
            reg: r.reg,
            cabecalho: r.cabecalho,
            idPaciente: r.paciente.id,
            paciente: texto(x['nome_social']) ?? r.paciente.nome,
            prontuario: r.paciente.prontuario,
            senha: r.senha?.texto ?? null,
            prioridade: prioridadeDaSenha({
              prioritaria: booleano(x['prioritaria']),
              idadeMinimaDoGrupo: inteiro(x['idade_minima']),
            }),
            agendadoPara: agendado ? localNoFuso(agendado, fuso) : null,
            chegada: `${r.data}T${r.hora}:00`,
            letraNoLocal: null,
            situacaoNovo: situacao,
            chamadas,
            tipo: r.tipo,
            convenio: r.convenio.nome,
            crm: r.profissional.crm,
            encerrado: sit === 'encerrado',
          };
          return { ...item, situacao, item };
        }),
      ).map((x) => x.item);
      return {
        itens: o.crm ? itens.filter((i) => i.crm === o.crm) : itens,
        cortada: linhas.length > TETO_DIA,
      };
    });
  }

  locais(c: ContextoAtendimento) {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      return (
        await l.consultar(
          'SELECT id, descricao, ponto_recepcao_id FROM local_atendimento WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL ORDER BY descricao',
          [est],
          { teto: 1000 },
        )
      ).map((x) => ({
        id: Number(x['id']),
        descricao: texto(x['descricao']) ?? '',
        recepcao: Number(x['ponto_recepcao_id']),
      }));
    });
  }

  paAbertos(
    c: ContextoAtendimento,
    o: { hoje: string; unidade?: number },
  ): Promise<{ itens: AtendimentoPa[]; cortada: boolean }> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const fuso = await this.fuso(l, est);
      const linhas = await l.consultar(
        `${SELECT_ATENDIMENTO} AND ca.codigo = 'pa' AND a.situacao IN ('aberto', 'em_atendimento', 'em_observacao')
          ${o.unidade ? 'AND a.unidade_assistencial_id = ?' : ''} ORDER BY a.entrada_em, a.id LIMIT ${TETO_DIA + 1}`,
        o.unidade ? [est, o.unidade] : [est],
        { teto: TETO_DIA + 1 },
      );
      const itens: AtendimentoPa[] = [];
      for (const x of linhas.slice(0, TETO_DIA)) {
        const r = resumoDaLinha(x, fuso);
        const obs = await l.uma(
          `SELECT lo.codigo, o.data_hora_entrada FROM ocupacao_leito_observacao o JOIN leito_observacao lo ON lo.id = o.leito_observacao_id
            WHERE o.atendimento_id = ? AND o.situacao = 'ativa' AND o.excluido_em IS NULL LIMIT 1`,
          [r.reg],
        );
        const desde = instante(obs?.['data_hora_entrada']);
        itens.push({
          reg: r.reg,
          cabecalho: r.cabecalho,
          paciente: r.paciente.nome,
          nascimento: x['data_nascimento']
            ? localNoFuso(instante(x['data_nascimento'])!, 'UTC').slice(0, 10)
            : null,
          senha: r.senha?.texto ?? null,
          prioridade: '0',
          chegada: `${r.data}T${r.hora}:00`,
          profissional: r.profissional.nome,
          marcas: [],
          leito: texto(obs?.['codigo']),
          observacaoDesde: desde ? localNoFuso(desde, fuso) : null,
          comMarcas: false,
          saida: null,
          prontuario: r.paciente.prontuario,
          nomeSocial: texto(x['nome_social']),
        });
      }
      return { itens, cortada: linhas.length > TETO_DIA };
    });
  }

  observacao(c: ContextoAtendimento): Promise<{ leitos: LeitoObservacao[]; historico: number }> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const fuso = await this.fuso(l, est);
      const linhas = await l.consultar(
        `SELECT lo.id, lo.codigo, lc.nome AS local, tl.descricao AS tipo, lo.ativo,
                a.id AS reg, a.numero, pf.nome AS paciente, o.data_hora_entrada
           FROM leito_observacao lo
           JOIN local_observacao lc ON lc.id = lo.local_observacao_id
           LEFT JOIN tipo_leito_observacao tl ON tl.id = lo.tipo_leito_observacao_id
           LEFT JOIN ocupacao_leito_observacao o ON o.leito_vigente_id = lo.id AND o.excluido_em IS NULL
           LEFT JOIN atendimento a ON a.id = o.atendimento_id
           LEFT JOIN paciente p ON p.id = a.paciente_id
           LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE lo.estabelecimento_id = ? AND lo.excluido_em IS NULL
          ORDER BY lc.nome, lo.ordem_exibicao, lo.codigo`,
        [est],
        { teto: 2000 },
      );
      const historico = Number(
        (
          await l.uma<{ n: unknown }>(
            "SELECT COUNT(*) AS n FROM ocupacao_leito_observacao WHERE estabelecimento_id = ? AND situacao = 'encerrada' AND excluido_em IS NULL",
            [est],
          )
        )?.n ?? 0,
      );
      return {
        leitos: linhas.map((x) => {
          const entrada = instante(x['data_hora_entrada']);
          return {
            id: Number(x['id']),
            codigo: String(x['codigo']),
            local: texto(x['local']) ?? '',
            tipo: texto(x['tipo']) ?? '',
            ativo: booleano(x['ativo']),
            ocupacao:
              x['reg'] && entrada
                ? {
                    reg: Number(x['reg']),
                    cabecalho: String(x['numero']),
                    paciente: texto(x['paciente']) ?? '',
                    entrada: localNoFuso(entrada, fuso),
                    minutos: Math.max(0, Math.floor((Date.now() - entrada.getTime()) / 60_000)),
                  }
                : null,
          };
        }),
        historico,
      };
    });
  }

  /** Os agregados dos indicadores no período (porta-propria-indicadores.ts): só do estabelecimento da sessão. */
  indicadores(
    c: ContextoAtendimento,
    o: { inicio: string; fim: string; unidade?: number },
  ): Promise<IndicadoresDados> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const fuso = await this.fuso(l, est);
      return lerIndicadoresProprios(l, {
        estabelecimento: est,
        de: inicioDoDia(o.inicio, fuso),
        ate: inicioDoDia(diaDeslocado(o.fim, 1), fuso),
        deVisitas: inicioDoDia(diaDeslocado(o.inicio, -3), fuso),
        ...(o.unidade ? { unidade: o.unidade } : {}),
        civil: (d) => localNoFuso(d, fuso),
        agora: new Date(),
      });
    });
  }

  apoio(c: ContextoAtendimento): Promise<ApoioAtendimentoDados> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const lista = (sql: string, p: readonly unknown[] = []) => l.consultar(sql, p, { teto: 10_000 });
      const profissionais = await lista(
        `SELECT pr.id, pf.nome, pr.situacao,
                (SELECT ic.numero_inscricao FROM inscricao_conselho ic WHERE ic.profissional_id = pr.id AND ic.excluido_em IS NULL
                  ORDER BY ic.principal DESC, ic.sequencia LIMIT 1) AS crm,
                (SELECT cbo.codigo_cbo FROM inscricao_conselho ic JOIN ocupacao_cbo cbo ON cbo.id = ic.ocupacao_cbo_id
                  WHERE ic.profissional_id = pr.id AND ic.excluido_em IS NULL ORDER BY ic.principal DESC, ic.sequencia LIMIT 1) AS cbo,
                (SELECT GROUP_CONCAT(pe.especialidade_medica_id) FROM profissional_especialidade pe
                  WHERE pe.profissional_id = pr.id AND pe.ativo AND pe.excluido_em IS NULL) AS especialidades
           FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
          WHERE pr.excluido_em IS NULL ORDER BY pf.nome`,
      );
      return {
        convenios: (
          await lista('SELECT id, nome, situacao FROM fonte_pagadora WHERE excluido_em IS NULL ORDER BY nome')
        ).map((x) => ({
          codigo: Number(x['id']),
          nome: texto(x['nome']) ?? '',
          ativo: x['situacao'] === 'ativa',
        })),
        unidades: (
          await lista(
            'SELECT id, nome FROM unidade_assistencial WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL ORDER BY nome',
            [est],
          )
        ).map((x) => ({ codigo: Number(x['id']), nome: texto(x['nome']) ?? '' })),
        especialidades: (
          await lista('SELECT id, descricao FROM especialidade_medica WHERE ativo ORDER BY descricao')
        ).map((x) => ({
          codigo: Number(x['id']),
          nome: texto(x['descricao']) ?? '',
        })),
        profissionais: profissionais.map((x) => {
          const crm = texto(x['crm']);
          return {
            id: Number(x['id']),
            crm: crm && /^\d{1,9}$/.test(crm) ? Number(crm) : 0,
            nome: texto(x['nome']) ?? '',
            especialidades: (texto(x['especialidades']) ?? '').split(',').filter(Boolean).map(Number),
            ativo: x['situacao'] === 'ativo',
            cbo: texto(x['cbo']) ?? '',
          };
        }),
        centrosCusto: (
          await lista(
            'SELECT id, nome FROM centro_custo WHERE estabelecimento_id = ? AND analitico AND ativo AND excluido_em IS NULL ORDER BY nome',
            [est],
          )
        ).map((x) => ({ codigo: Number(x['id']), nome: texto(x['nome']) ?? '' })),
        motivosExclusao: (
          await lista('SELECT id, descricao FROM motivo_cancelamento_operacao WHERE ativo ORDER BY descricao')
        ).map((x) => ({ codigo: Number(x['id']), nome: texto(x['descricao']) ?? '' })),
        ...(await (async () => {
          const h = await lerEscoposHeranca(l, est, c.usuario);
          return {
            heranca: h.marcas,
            herancaEscopo: { estabelecimento: h.estabelecimento, pessoal: h.pessoal },
            padraoAbertura: await lerPadraoAbertura(l, est, c.usuario),
          };
        })()),
      };
    });
  }

  cid(c: ContextoAtendimento, termo: string) {
    const t = termo.trim();
    if (t.length < 2 || /[%_\\]/.test(t)) return Promise.resolve([]);
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT tt.id, tt.codigo_termo, tt.descricao FROM termo_terminologia tt JOIN terminologia te ON te.id = tt.terminologia_id
            WHERE te.codigo = 'cid10' AND tt.ativo AND (tt.codigo_termo LIKE CONCAT(?, '%') OR tt.descricao LIKE CONCAT('%', ?, '%'))
            ORDER BY tt.codigo_termo LIMIT 50`,
          [t.replace('.', '').toUpperCase(), t],
          { teto: 50 },
        )
      ).map((x) => ({
        id: Number(x['id']),
        codigo: String(x['codigo_termo']),
        nome: texto(x['descricao']) ?? '',
      })),
    );
  }

  solicitantes(c: ContextoAtendimento, termo: string) {
    const t = termo.trim();
    if (t.length < 2 || /[%_\\]/.test(t)) return Promise.resolve([]);
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT s.id, s.nome, CONCAT(cc.sigla, ' ', s.numero_conselho, '/', uf.sigla) AS registro FROM solicitante_externo s
             JOIN conselho_classe cc ON cc.id = s.conselho_classe_id JOIN unidade_federativa uf ON uf.id = s.conselho_unidade_federativa_id
            WHERE s.ativo AND s.excluido_em IS NULL AND (s.numero_conselho = ? OR CONCAT(' ', s.nome, ' ') LIKE CONCAT('% ', ?, '%'))
            ORDER BY s.nome LIMIT 50`,
          [t, t],
          { teto: 50 },
        )
      ).map((x) => ({
        id: Number(x['id']),
        nome: texto(x['nome']) ?? '',
        registro: texto(x['registro']) ?? '',
      })),
    );
  }

  /** Procedimentos faturáveis ativos pelo código ou pela descrição (a cobertura por convênio é do faturamento). */
  procedimentos(c: ContextoAtendimento, _convenio: number, termo: string) {
    const t = termo.trim();
    if (t.length < 2 || /[%_\\]/.test(t)) return Promise.resolve([]);
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT id, descricao FROM item_faturavel WHERE tipo_item = 'procedimento' AND situacao = 'ativo' AND excluido_em IS NULL
             AND (codigo LIKE CONCAT(?, '%') OR descricao LIKE CONCAT('%', ?, '%')) ORDER BY descricao LIMIT 50`,
          [t, t],
          { teto: 50 },
        )
      ).map((x) => ({ codigo: Number(x['id']), nome: texto(x['descricao']) ?? '' })),
    );
  }

  historico(c: ContextoAtendimento, paciente: number) {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const fuso = await this.fuso(l, est);
      const linhas = await l.consultar(
        `${SELECT_ATENDIMENTO} AND a.paciente_id = ? AND a.situacao <> 'cancelado' ORDER BY a.entrada_em DESC LIMIT 50`,
        [est, paciente],
        { teto: 50 },
      );
      const lista = linhas.map((x) => resumoDaLinha(x, fuso));
      const ult = lista[0];
      return {
        heranca: await lerMarcasHeranca(l, est, c.usuario),
        padrao: await lerPadraoAbertura(l, est, c.usuario),
        anterior: ult
          ? {
              reg: ult.reg,
              data: ult.data,
              valores: {
                convenio: ult.convenio.codigo,
                // O id do profissional (o que a abertura recebe), nunca o número do conselho.
                profissional: inteiro(linhas[0]?.['profissional_id']),
                especialidade: ult.especialidade.codigo,
                unidade: ult.unidade,
                ...(await valoresHerdaveisDoAnterior(l, ult.reg)),
              } as Record<string, string | number | null>,
            }
          : null,
        historico: lista.map((x) => ({
          reg: x.reg,
          data: x.data,
          tipo: x.tipoRotulo,
          convenio: x.convenio.nome,
          profissional: x.profissional.nome,
        })),
      };
    });
  }

  previaCancelamento(c: ContextoAtendimento, reg: number): Promise<PreviaCancelamentoDados | null> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const a = await l.uma(
        'SELECT id, situacao, desfecho FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [reg, est],
      );
      if (!a) return null;
      const recusaSituacao = recusaCancelamento({
        situacao: String(a['situacao']),
        temDesfecho: texto(a['desfecho']) !== null,
      });
      const extras = Number(
        (
          await l.uma<{ n: unknown }>(
            'SELECT COUNT(*) AS n FROM atendimento_procedimento WHERE atendimento_id = ? AND NOT principal AND excluido_em IS NULL',
            [reg],
          )
        )?.n ?? 0,
      );
      const conta = await l.uma(
        'SELECT id FROM atendimento_conta WHERE atendimento_id = ? AND excluido_em IS NULL LIMIT 1',
        [reg],
      );
      const sen = await l.uma(
        'SELECT senha_emitida_id AS s FROM atendimento_senha WHERE atendimento_id = ? AND excluido_em IS NULL ORDER BY id LIMIT 1',
        [reg],
      );
      const motivo = recusaSituacao
        ? recusaSituacao.mensagem
        : extras > 0
          ? 'O atendimento tem procedimento extra lançado: estorne antes de excluir.'
          : conta
            ? 'O atendimento tem conta: a exclusão passa pelo faturamento.'
            : null;
      return {
        pode: motivo === null,
        motivo,
        situacaoConta: conta ? 'aberta' : 'semConta',
        itensConta: 0,
        procedimentosExtras: extras,
        senha: inteiro(sen?.['s']),
        desfecho: texto(a['desfecho']) !== null,
      };
    });
  }

  dadosImpresso(c: ContextoAtendimento, reg: number): Promise<DadosImpresso | null> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const fuso = await this.fuso(l, est);
      const x = await l.uma(`${SELECT_ATENDIMENTO} AND a.id = ?`, [est, reg]);
      if (!x) return null;
      const r = resumoDaLinha(x, fuso);
      const alergia = await l.uma('SELECT alergia_texto_legado AS a FROM paciente WHERE id = ?', [
        r.paciente.id,
      ]);
      return {
        reg: r.reg,
        idPaciente: r.paciente.id ?? 0,
        prontuario: r.paciente.prontuario,
        nome: r.paciente.nome,
        nomeSocial: texto(x['nome_social']),
        nascimento: x['data_nascimento']
          ? localNoFuso(instante(x['data_nascimento'])!, 'UTC').slice(0, 10)
          : null,
        convenio: r.convenio.nome,
        data: r.data,
        hora: r.hora,
        profissional: r.profissional.nome,
        especialidade: r.especialidade.nome,
        tipo: r.tipoRotulo,
        leito: null,
        alergia: texto(alergia?.['a']) !== null,
        codigoConvenio: r.convenio.codigo,
        codigoEspecialidade: r.especialidade.codigo,
        unidade: r.unidade,
        clinica: 'M',
        retorno: booleano(x['retorno']),
        pa: r.tipo === 'pa',
      };
    });
  }

  /** O profissional da sessão: o vínculo vigente da conta com o profissional no estabelecimento e o registro principal. */
  profissional(c: ContextoAtendimento, login: string): Promise<ProfissionalDaSessao | null> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const x = await l.uma(
        `SELECT pr.id, pf.nome, ic.numero_inscricao, ic.situacao AS situacao_inscricao, cbo.codigo_cbo
           FROM usuario u
           JOIN usuario_vinculo_profissional v ON v.usuario_id = u.id AND v.estabelecimento_id = ? AND v.excluido_em IS NULL
                AND v.vigencia_inicio <= CURRENT_DATE AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
           JOIN profissional pr ON pr.id = v.profissional_id AND pr.excluido_em IS NULL
           JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
           LEFT JOIN inscricao_conselho ic ON ic.id = (
             SELECT i2.id FROM inscricao_conselho i2 WHERE i2.profissional_id = pr.id AND i2.excluido_em IS NULL
              ORDER BY i2.principal DESC, i2.sequencia LIMIT 1)
           LEFT JOIN ocupacao_cbo cbo ON cbo.id = ic.ocupacao_cbo_id
          WHERE u.login = ? AND u.excluido_em IS NULL
          ORDER BY v.vigencia_inicio DESC LIMIT 1`,
        [est, login],
      );
      if (!x) return null;
      const n = texto(x['numero_inscricao']);
      return {
        vinculo: Number(x['id']),
        crm: n && /^\d{1,9}$/.test(n) ? Number(n) : 0,
        nome: texto(x['nome']) ?? '',
        codigoCbo: texto(x['codigo_cbo']) ?? '',
        conselhoAtivo: ['ativa', 'provisoria'].includes(texto(x['situacao_inscricao']) ?? ''),
      };
    });
  }

  /** Pendente: o escore do PA não tem tabela no modelo (o quadro segue sem o chip de escore registrado). */
  async escoresPa(): Promise<EscorePaRegistrado[]> {
    return [];
  }

  /** Pendente: os sinais vitais vêm da aferição da enfermagem (o quadro segue sem os sinais recentes). */
  async sinaisPa(): Promise<Map<string, SinaisRecentes>> {
    return new Map();
  }

  /**
   * As fichas que a regra de impressão manda para o atendimento (02-REC linha 35): por fonte pagadora, especialidade,
   * grupo de faturamento, unidade e tipo de atendimento. Sem o atendimento, não há o que decidir (vale a padrão).
   */
  async fichasConfiguradas(c: ContextoAtendimento, reg?: number): Promise<FichasConfiguradas | null> {
    if (reg === undefined) return null;
    const prontas = await this.ler(c, async (l) =>
      lerFichasDoAtendimento(l, await this.estabelecimento(c, l), reg),
    );
    return prontas ? { modelos: [], selecoes: [], prontas } : null;
  }

  naoIdentificados(): Promise<
    {
      paciente: number;
      prontuario: number;
      caracteristicas: string;
      marcadoEm: string;
      identificadoEm: string | null;
    }[]
  > {
    return pendenteLeitura('Pacientes não identificados');
  }
}

// ---- operações (Executor) ----

const TABELAS_ATENDIMENTO = [
  // F3.0: a conta aberta na entrada (consulta, PA e exame que gerem cobrança) e as taxas de abertura.
  ...TABELAS_CONTA_ENTRADA,
  'atendimento',
  'atendimento_etapa_pa',
  'atendimento_situacao_historico',
  'atendimento_procedimento',
  'cobertura_atendimento',
  'atendimento_senha',
  'senha_emitida',
  'cancelamento_atendimento',
  'ocupacao_leito_observacao',
  'chamada_painel',
  'marcacao_horario',
  'teleconsulta',
];

/** O local de atendimento tem de ser do estabelecimento da sessão (a chave estrangeira sozinha aceitaria outro). */
async function exigirLocal(tx: TxOperacao, local: number | null | undefined): Promise<number | null> {
  if (local === null || local === undefined) return null;
  const x = await tx.uma(
    'SELECT id FROM local_atendimento WHERE id = ? AND estabelecimento_id <=> ? AND ativo AND excluido_em IS NULL',
    [local, tx.contexto.estabelecimento],
  );
  if (!x)
    throw recusa('local-inexistente', 'Local de atendimento não encontrado neste estabelecimento.', {
      campos: ['local'],
    });
  return local;
}

/** A marcação volta a ficar sem atendimento (exclusão do atendimento aberto por engano). */
async function desfazerMarcacao(tx: TxOperacao, atendimento: number): Promise<void> {
  const m = await travarUma<{ id: unknown; versao: unknown }>(
    tx,
    'SELECT id, versao FROM marcacao_horario WHERE atendimento_id = ? AND excluido_em IS NULL',
    [atendimento],
  );
  if (!m) return;
  const chegou = await tx.uma<{ id: unknown }>(
    "SELECT id FROM situacao_marcacao WHERE significado = 'chegou' AND ativo ORDER BY ordem, id LIMIT 1",
    [],
  );
  await tx.alterar('marcacao_horario', Number(m.id), Number(m.versao), {
    atendimento_id: null,
    atendido_em: null,
    ...(chegou ? { situacao_marcacao_id: Number(chegou.id) } : {}),
  });
}

async function travarAtendimento(tx: TxOperacao, id: number) {
  const [a] = await tx.consultarParaAtualizar(
    'SELECT id, numero, situacao, versao, desfecho FROM atendimento WHERE id = ? AND estabelecimento_id <=> ? AND excluido_em IS NULL',
    [id, tx.contexto.estabelecimento],
    { teto: 1 },
  );
  if (!a) throw recusa('registro-inexistente', 'O atendimento não existe neste estabelecimento.');
  return {
    id,
    numero: String(a['numero']),
    situacao: String(a['situacao']),
    versao: Number(a['versao']),
    desfecho: texto(a['desfecho']),
  };
}

async function senhaDoAtendimento(tx: TxOperacao, id: number): Promise<number> {
  const s = await tx.uma(
    'SELECT senha_emitida_id AS s FROM atendimento_senha WHERE atendimento_id = ? AND excluido_em IS NULL ORDER BY id LIMIT 1',
    [id],
  );
  return inteiro(s?.['s']) ?? 0;
}

async function mudarSituacao(
  tx: TxOperacao,
  a: { id: number; versao: number; situacao: string },
  nova: string,
  valores: Record<string, unknown> = {},
  extras: Record<string, unknown> = {},
) {
  const versao = await tx.alterar('atendimento', a.id, a.versao, { situacao: nova, ...valores });
  await tx.incluir('atendimento_situacao_historico', {
    atendimento_id: a.id,
    operacao: 'alteracao',
    ocorrido_em: new Date(),
    usuario_id: tx.contexto.usuario,
    situacao_anterior: a.situacao,
    situacao_nova: nova,
    ...extras,
  });
  return versao;
}

const OPERACAO_CONDUZIR = definirOperacao({
  nome: 'atendimento.conduzir-no-consultorio',
  tabelas: TABELAS_ATENDIMENTO,
  entrada: esquemaConduzirNoConsultorio,
  acao: 'alteracao',
  async gravar(tx, e: ConduzirNoConsultorioEntrada) {
    if (tx.contexto.usuario === null)
      throw recusa('usuario-obrigatorio', 'A chamada exige o usuário do cliente.');
    const a = await travarAtendimento(tx, e.atendimento);
    const local = (await exigirLocal(tx, e.local)) as number;
    const chamadas = Number(
      (
        await tx.uma<{ n: unknown }>(
          'SELECT COUNT(*) AS n FROM chamada_painel WHERE atendimento_id = ? AND excluido_em IS NULL',
          [a.id],
        )
      )?.n ?? 0,
    );
    recusar(recusaConducao(e.evento, situacaoNoConsultorio({ situacao: a.situacao, chamado: chamadas > 0 })));
    const senha = await senhaDoAtendimento(tx, a.id);
    if (e.evento === 'chamar') {
      // A chamada fica registrada (com ou sem senha): é ela que diz "chamado" na fila e libera o atender.
      const nome = await tx.uma<{ t: unknown }>(
        `SELECT COALESCE(se.codigo_exibicao, pf.nome_social, pf.nome) AS t
           FROM atendimento at JOIN paciente p ON p.id = at.paciente_id JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           LEFT JOIN senha_emitida se ON se.id = ?
          WHERE at.id = ?`,
        [senha || null, a.id],
      );
      await tx.incluir('chamada_painel', {
        estabelecimento_id: tx.contexto.estabelecimento,
        local_atendimento_id: local,
        senha_emitida_id: senha || null,
        atendimento_id: a.id,
        texto_exibido: String(nome?.t ?? a.numero).slice(0, 150),
        chamado_em: new Date(),
        usuario_id: tx.contexto.usuario,
        repeticao: chamadas,
      });
      if (senha) {
        const s = await tx.uma<{ versao: unknown; chamadas: unknown }>(
          'SELECT versao, chamadas FROM senha_emitida WHERE id = ?',
          [senha],
        );
        if (s)
          await tx.alterar('senha_emitida', senha, Number(s.versao), {
            chamadas: Number(s.chamadas) + 1,
            local_atendimento_id: local,
          });
      }
    } else await mudarSituacao(tx, a, 'em_atendimento', {}, { local_atendimento_id: local });
    await gravarEtapasSePa(tx, a.id, [e.evento === 'chamar' ? 'chamada' : 'atendimentoMedico']);
    return { reg: a.id, cabecalho: a.numero, senha, evento: e.evento };
  },
  alvo: (e) => ({ tabela: 'atendimento', id: e.atendimento }),
});

const OPERACAO_ENCERRAR = definirOperacao({
  nome: 'atendimento.encerrar-atendimento',
  tabelas: TABELAS_ATENDIMENTO,
  entrada: esquemaEncerrarAtendimento,
  acao: 'alteracao',
  async gravar(tx, e) {
    const a = await travarAtendimento(tx, e.atendimento);
    if (a.desfecho || a.situacao === 'encerrado')
      throw recusa('atendimento-encerrado', 'O atendimento já tem desfecho registrado.');
    if (a.situacao === 'cancelado') throw recusa('atendimento-cancelado', 'O atendimento foi excluído.');
    const d = DESFECHOS.find((x) => x.codigo === e.desfecho);
    if (!d) throw recusa('desfecho-desconhecido', 'Desfecho desconhecido.');
    if (d.atoMedico) {
      // Ato médico (Lei 12.842/2013): o profissional é relido aqui, com a inscrição principal e o CBO.
      const p = await tx.uma<{ cbo: unknown; sigla: unknown; sit: unknown }>(
        `SELECT cbo.codigo_cbo AS cbo, cc.sigla, ic.situacao AS sit
           FROM profissional pr
           LEFT JOIN inscricao_conselho ic ON ic.id = (
             SELECT i2.id FROM inscricao_conselho i2 WHERE i2.profissional_id = pr.id AND i2.excluido_em IS NULL
              ORDER BY i2.principal DESC, i2.sequencia LIMIT 1)
           LEFT JOIN conselho_classe cc ON cc.id = ic.conselho_classe_id
           LEFT JOIN ocupacao_cbo cbo ON cbo.id = ic.ocupacao_cbo_id
          WHERE pr.id = ? AND pr.situacao = 'ativo' AND pr.excluido_em IS NULL`,
        [e.profissional ?? 0],
      );
      if (!p)
        throw recusa(
          'profissional-sem-cbo',
          'Só o profissional ativo no cadastro registra o desfecho clínico.',
          {
            campos: ['profissional'],
          },
        );
      if (
        !ehMedico({
          codigoCbo: texto(p.cbo),
          siglaConselho: texto(p.sigla),
          inscricaoAtiva: ['ativa', 'provisoria'].includes(texto(p.sit) ?? ''),
        })
      )
        throw recusa(
          'categoria-nao-permitida',
          `Só médico pode registrar ${d.rotulo.toLowerCase()} (Lei 12.842/2013).`,
          {
            campos: ['profissional'],
          },
        );
    }
    const agora = new Date();
    await mudarSituacao(
      tx,
      a,
      'encerrado',
      {
        desfecho: d.codigo,
        saida_em: agora,
        alta_medica_em: d.atoMedico ? agora : null,
        alta_profissional_id: e.profissional ?? null,
      },
      { profissional_id: e.profissional ?? null, observacao: e.destino ?? null },
    );
    // A observação em curso termina junto (o leito fica livre).
    await tx.executar(
      "UPDATE ocupacao_leito_observacao SET data_hora_saida = ?, situacao = 'encerrada', versao = versao + 1 WHERE atendimento_id = ? AND situacao = 'ativa'",
      [agora, a.id],
    );
    const senha = await senhaDoAtendimento(tx, a.id);
    if (senha)
      await tx.executar(
        "UPDATE senha_emitida SET situacao = 'atendida', encerrada_em = ?, versao = versao + 1 WHERE id = ? AND situacao NOT IN ('atendida', 'cancelada')",
        [agora, senha],
      );
    await gravarEtapasSePa(tx, a.id, ['decisao', 'saida']);
    return { reg: a.id, cabecalho: a.numero, senha, desfecho: d.codigo };
  },
  eventos: (e) => [
    { tipo: 'atendimento.encerrado', carga: { atendimento: e.atendimento, desfecho: e.desfecho } },
  ],
  alvo: (e) => ({ tabela: 'atendimento', id: e.atendimento }),
});

const OPERACAO_CANCELAR = definirOperacao({
  nome: 'atendimento.cancelar-atendimento',
  tabelas: TABELAS_ATENDIMENTO,
  entrada: esquemaCancelarAtendimento,
  acao: 'alteracao',
  critica: true,
  async gravar(tx, e: CancelarAtendimentoEntrada) {
    if (tx.contexto.usuario === null)
      throw recusa('usuario-obrigatorio', 'A exclusão exige o usuário do cliente.');
    const a = await travarAtendimento(tx, e.atendimento);
    recusar(recusaCancelamento({ situacao: a.situacao, temDesfecho: a.desfecho !== null }));
    const motivo = await tx.uma('SELECT id FROM motivo_cancelamento_operacao WHERE id = ? AND ativo', [
      e.motivo,
    ]);
    if (!motivo)
      throw recusa('motivo-inexistente', 'Motivo de exclusão não encontrado.', { campos: ['motivo'] });
    const extras = Number(
      (
        await tx.uma<{ n: unknown }>(
          'SELECT COUNT(*) AS n FROM atendimento_procedimento WHERE atendimento_id = ? AND NOT principal AND excluido_em IS NULL',
          [a.id],
        )
      )?.n ?? 0,
    );
    if (extras > 0)
      throw recusa(
        'exclusao-recusada',
        'O atendimento tem procedimento extra lançado: estorne antes de excluir.',
        {
          dependentes: [
            { rotulo: 'Procedimentos extras', quantidade: extras, amostra: [], origem: 'logica' },
          ],
        },
      );
    // F3.0: a conta aberta na entrada é cancelada junto (os automáticos estornados com o motivo "cancelamento"); conta
    // com lançamento manual ou já em faturamento recusa: a exclusão passa pelo faturamento.
    await cancelarContasDaEntrada(tx, Number(tx.contexto.estabelecimento), a.id);
    await tx.incluir('cancelamento_atendimento', {
      atendimento_id: a.id,
      motivo_cancelamento_operacao_id: e.motivo,
      justificativa: e.justificativa,
      cancelado_em: new Date(),
      usuario_id: tx.contexto.usuario,
      efeito_conta: 'nenhum',
    });
    await mudarSituacao(tx, a, 'cancelado', {}, { observacao: e.justificativa });
    const agora = new Date();
    // A observação em curso termina (o leito não fica preso a um atendimento excluído).
    const obs = await tx.uma<{ id: unknown; versao: unknown }>(
      "SELECT id, versao FROM ocupacao_leito_observacao WHERE atendimento_id = ? AND situacao = 'ativa' AND excluido_em IS NULL",
      [a.id],
    );
    if (obs)
      await tx.alterar('ocupacao_leito_observacao', Number(obs.id), Number(obs.versao), {
        data_hora_saida: agora,
        situacao: 'cancelada',
      });
    await desfazerMarcacao(tx, a.id);
    const senha = await senhaDoAtendimento(tx, a.id);
    // A senha só volta à fila se estava em atendimento e é do dia (a recepção pode abrir o atendimento de novo).
    if (senha) {
      const s = await travarUma<{ situacao: unknown; dia: unknown; versao: unknown }>(
        tx,
        "SELECT situacao, DATE_FORMAT(data_referencia, '%Y-%m-%d') AS dia, versao FROM senha_emitida WHERE id = ?",
        [senha],
      );
      const hoje = await hojeDoEstabelecimento(tx, Number(tx.contexto.estabelecimento));
      if (s && senhaVoltaAFila({ situacao: String(s.situacao), doDia: s.dia === hoje }))
        await tx.alterar('senha_emitida', senha, Number(s.versao), {
          situacao: 'aguardando',
          encerrada_em: null,
        });
    }
    return { reg: a.id, cabecalho: a.numero, senha, motivo: e.motivo };
  },
  eventos: (e) => [{ tipo: 'atendimento.cancelado', carga: { atendimento: e.atendimento } }],
  alvo: (e) => ({ tabela: 'atendimento', id: e.atendimento }),
});

/** A abertura (consulta, PA, exame e requisição de laboratório) pelas chaves do cadastro do cliente. */
const OPERACAO_ABRIR = definirOperacao({
  nome: 'atendimento.abrir-atendimento',
  tabelas: TABELAS_ATENDIMENTO,
  entrada: ENTRADAS_OPERACOES_ATENDIMENTO['atendimento.abrirAtendimento'] as z.ZodType<
    Record<string, unknown>
  >,
  acao: 'inclusao',
  async gravar(tx, e) {
    const est = tx.contexto.estabelecimento;
    if (est === null)
      throw recusa('estabelecimento-obrigatorio', 'Escolha o estabelecimento para abrir o atendimento.');
    const num = (k: string) => (typeof e[k] === 'number' ? (e[k] as number) : null);
    const exigir = async (sql: string, p: readonly unknown[], codigo: string, msg: string, campo: string) => {
      const x = await tx.uma(sql, p);
      if (!x) throw recusa(codigo, msg, { campos: [campo] });
      return x;
    };
    const pac = await exigir(
      'SELECT id, situacao FROM paciente WHERE id = ? AND excluido_em IS NULL',
      [num('paciente')],
      'paciente-inexistente',
      'Paciente não encontrado.',
      'paciente',
    );
    if (!['ativo', 'provisorio'].includes(String(pac['situacao'])))
      throw recusa('paciente-inativo', 'Cadastro inativo ou unificado: abra pelo cadastro que ficou ativo.', {
        campos: ['paciente'],
      });
    const conv = await exigir(
      'SELECT id, situacao FROM fonte_pagadora WHERE id = ? AND excluido_em IS NULL',
      [num('convenio')],
      'convenio-inexistente',
      'Convênio não encontrado.',
      'convenio',
    );
    if (conv['situacao'] !== 'ativa')
      throw recusa('convenio-inativo', 'Convênio inativo.', { campos: ['convenio'] });
    // Regra de campo do cadastro (02-CAD linha 2): o atendimento só abre com o cadastro completo no escopo da
    // recepção (módulo, tipo de atendimento e convênio); o cadastro provisório do não identificado não é barrado.
    await conferirCadastroNaAbertura(tx, {
      estabelecimento: est,
      paciente: Number(pac['id']),
      tipo: String(e['tipo']),
      fontePagadora: Number(conv['id']),
      local: num('local'),
      modulo: num('moduloRecepcao'),
      marcacao: num('marcacao'),
      senha: num('senha'),
      usuario: typeof tx.contexto.usuario === 'number' ? tx.contexto.usuario : null,
      provisorio: String(pac['situacao']) === 'provisorio',
    });
    const prof = await exigir(
      "SELECT id FROM profissional WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
      [num('profissional')],
      'profissional-inexistente',
      'Profissional não encontrado ou inativo.',
      'profissional',
    );
    const cat = await exigir(
      'SELECT id FROM categoria_atendimento WHERE codigo = ? AND ativo',
      [String(e['tipo'])],
      'tipo-nao-configurado',
      'Tipo de atendimento não configurado no cliente.',
      'tipo',
    );
    const tiss = CARATERES.find((x) => x.codigo === e['carater'])?.tiss;
    const car = await exigir(
      'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
      [String(tiss ?? '')],
      'carater-nao-configurado',
      'Caráter do atendimento não configurado no cliente.',
      'carater',
    );
    const unidade = await exigir(
      'SELECT id FROM unidade_assistencial WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
      [num('unidade'), est],
      'unidade-inexistente',
      'Unidade não encontrada neste estabelecimento.',
      'unidade',
    );
    const cc = await exigir(
      'SELECT id FROM centro_custo WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
      [num('centroCusto'), est],
      'centro-custo-inexistente',
      'Centro de custo não encontrado neste estabelecimento.',
      'centroCusto',
    );
    const esp = num('especialidade') ? num('especialidade') : null;
    if (esp !== null)
      await exigir(
        'SELECT id FROM especialidade_medica WHERE id = ? AND ativo',
        [esp],
        'especialidade-inexistente',
        'Especialidade não encontrada.',
        'especialidade',
      );
    const local = await exigirLocal(tx, num('local'));
    const hoje = await hojeDoEstabelecimento(tx, est);
    // Senha da recepção: do estabelecimento, do dia, na fila e sem outro atendimento ativo (regra no domínio).
    const senha = num('senha');
    let senhaVersao = 0;
    if (senha) {
      const sx = await travarUma<{ situacao: unknown; dia: unknown; versao: unknown; outro: unknown }>(
        tx,
        `SELECT se.situacao, DATE_FORMAT(se.data_referencia, '%Y-%m-%d') AS dia, se.versao,
                (SELECT COUNT(*) FROM atendimento_senha ats JOIN atendimento ao ON ao.id = ats.atendimento_id
                  WHERE ats.senha_emitida_id = se.id AND ats.excluido_em IS NULL AND ao.excluido_em IS NULL
                    AND ao.situacao <> 'cancelado') AS outro
           FROM senha_emitida se WHERE se.id = ? AND se.estabelecimento_id = ? AND se.excluido_em IS NULL`,
        [senha, est],
      );
      recusar(
        recusaSenhaNaAbertura({
          existe: sx !== null && sx !== undefined,
          doDia: sx?.dia === hoje,
          situacao: String(sx?.situacao ?? ''),
          outroAtendimentoAtivo: Number(sx?.outro ?? 0) > 0,
        }),
        ['senha'],
      );
      senhaVersao = Number(sx!.versao);
    }
    // Marcação da agenda: do estabelecimento, do dia, do mesmo paciente e ainda sem atendimento.
    const marcacao = num('marcacao');
    let marcacaoVersao = 0;
    if (marcacao) {
      const mx = await travarUma<{
        paciente_id: unknown;
        atendimento_id: unknown;
        dia: unknown;
        versao: unknown;
      }>(
        tx,
        `SELECT mh.paciente_id, mh.atendimento_id, DATE_FORMAT(ha.data_referencia, '%Y-%m-%d') AS dia, mh.versao
           FROM marcacao_horario mh JOIN horario_agenda ha ON ha.id = mh.horario_agenda_id
          WHERE mh.id = ? AND mh.estabelecimento_id = ? AND mh.excluido_em IS NULL`,
        [marcacao, est],
      );
      recusar(
        recusaMarcacaoNaAbertura({
          existe: mx !== null && mx !== undefined,
          doDia: mx?.dia === hoje,
          jaAtendida: inteiro(mx?.atendimento_id) !== null,
          mesmoPaciente: inteiro(mx?.paciente_id) === Number(pac['id']),
        }),
        ['marcacao'],
      );
      marcacaoVersao = Number(mx!.versao);
    }
    // Teleconsulta: a da própria marcação, do mesmo paciente e ainda sem atendimento.
    const tele = (e['teleconsulta'] as { id: number } | undefined)?.id ?? null;
    let teleVersao = 0;
    if (tele !== null) {
      const tx1 = await travarUma<{ versao: unknown }>(
        tx,
        `SELECT versao FROM teleconsulta WHERE id = ? AND estabelecimento_id = ? AND marcacao_horario_id <=> ? AND paciente_id = ?
            AND atendimento_id IS NULL AND situacao NOT IN ('encerrada', 'cancelada') AND excluido_em IS NULL`,
        [tele, est, marcacao, Number(pac['id'])],
      );
      if (!tx1)
        throw recusa(
          'teleconsulta-indisponivel',
          'A teleconsulta não é desta marcação, deste paciente ou já tem atendimento.',
          {
            campos: ['teleconsulta'],
          },
        );
      teleVersao = Number(tx1.versao);
    }
    // Responsável declarado na recepção: o parentesco pelo código do domínio do cliente (sem ele, só nome e telefone).
    const resp = e['responsavel'] as { nome: string; parentesco: number; telefone?: string } | undefined;
    const parentesco = resp
      ? inteiro(
          (
            await tx.uma<{ id: unknown }>(
              'SELECT id FROM grau_parentesco_dependente WHERE codigo = ? AND ativo',
              [String(resp.parentesco)],
            )
          )?.id,
        )
      : null;
    // Plano da fonte pagadora, pelo nome (o contrato ainda manda o nome; pedido ao orquestrador para mandar o id).
    const planoNome = texto(e['plano']);
    const plano = planoNome
      ? inteiro(
          (
            await tx.uma<{ id: unknown }>(
              'SELECT id FROM plano_fonte_pagadora WHERE fonte_pagadora_id = ? AND (codigo = ? OR UPPER(descricao) = UPPER(?)) AND excluido_em IS NULL LIMIT 1',
              [Number(conv['id']), planoNome, planoNome],
            )
          )?.id,
        )
      : null;
    // ADR 0009, decisão 25: o médico sem credenciamento no convênio (ou no plano) alerta ou, se o convênio pede, bloqueia.
    const credenciamento = await conferirCredenciamentoNoFluxo(tx, {
      profissionalId: Number(prof['id']),
      fontePagadoraId: Number(conv['id']),
      planoId: plano ?? null,
      estabelecimentoId: est,
      data: hoje,
      campo: 'profissional',
    });
    const numero = await tx.proximoNumero('atendimento');
    const agora = new Date();
    const id = await tx.incluir('atendimento', {
      estabelecimento_id: est,
      numero: numero.formatado,
      paciente_id: Number(pac['id']),
      categoria_atendimento_id: Number(cat['id']),
      carater_atendimento_tiss_id: Number(car['id']),
      fonte_pagadora_id: Number(conv['id']),
      profissional_id: Number(prof['id']),
      especialidade_medica_id: esp,
      unidade_assistencial_id: Number(unidade['id']),
      centro_custo_id: Number(cc['id']),
      local_atendimento_id: local,
      // O atendimento novo nasce no cadastro que responde hoje (o unificado em outro não recebe pedido novo).
      solicitante_externo_id: await solicitanteQueRespondeHoje(tx, num('solicitante')),
      data_requisicao: (e['dataRequisicao'] as string | undefined) ?? null,
      marcacao_horario_id: marcacao,
      teleconsulta_id: tele,
      responsavel_nome: resp?.nome ?? null,
      responsavel_grau_parentesco_dependente_id: parentesco,
      responsavel_telefone: resp?.telefone ?? null,
      cid_principal_termo_terminologia_id: num('cidPrincipal'),
      cid_secundario_termo_terminologia_id: num('cidSecundario'),
      situacao: 'aberto',
      entrada_em: agora,
      retorno: e['retorno'] === true,
      horario_especial: e['horarioEspecial'] === true,
      observacao: (e['observacao'] as string | undefined) ?? null,
    });
    await tx.incluir('atendimento_situacao_historico', {
      atendimento_id: id,
      operacao: 'inclusao',
      ocorrido_em: agora,
      usuario_id: tx.contexto.usuario,
      situacao_nova: 'aberto',
      profissional_id: Number(prof['id']),
      local_atendimento_id: local,
    });
    await tx.incluir('cobertura_atendimento', {
      atendimento_id: id,
      ordem: 1,
      fonte_pagadora_id: Number(conv['id']),
      plano_fonte_pagadora_id: plano,
      numero_carteira: (e['matricula'] as string | undefined) ?? null,
      validade_carteira: (e['validadeCarteira'] as string | undefined) ?? null,
      numero_guia: (e['guia'] as string | undefined) ?? null,
      senha_autorizacao: (e['senhaConvenio'] as string | undefined) ?? null,
      validade_senha: (e['validadeSenha'] as string | undefined) ?? null,
      empresa_segurado: (e['empresa'] as string | undefined) ?? null,
    });
    const proc = num('procedimento');
    if (proc) {
      await exigir(
        "SELECT id FROM item_faturavel WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
        [proc],
        'procedimento-inexistente',
        'Procedimento não encontrado.',
        'procedimento',
      );
      await tx.incluir('atendimento_procedimento', {
        atendimento_id: id,
        sequencia: 1,
        item_faturavel_id: proc,
        quantidade: 1,
        principal: true,
      });
    }
    if (senha) {
      await tx
        .incluir('atendimento_senha', { atendimento_id: id, senha_emitida_id: senha })
        .catch((x: unknown) => {
          if (restricaoUnicaViolada(x))
            throw recusa('senha-ja-atendida', 'A senha já tem atendimento aberto.', { campos: ['senha'] });
          throw x;
        });
      await tx.alterar('senha_emitida', senha, senhaVersao, {
        situacao: 'em_atendimento',
        paciente_id: Number(pac['id']),
      });
    }
    if (marcacao) {
      // A marcação é dada como atendida na mesma transação (o paciente chegou e o atendimento foi aberto).
      const sit = await tx.uma<{ id: unknown }>(
        "SELECT id FROM situacao_marcacao WHERE significado = 'em_atendimento' AND ativo ORDER BY ordem, id LIMIT 1",
        [],
      );
      await tx.alterar('marcacao_horario', marcacao, marcacaoVersao, {
        atendimento_id: id,
        atendido_em: agora,
        ...(sit ? { situacao_marcacao_id: Number(sit.id) } : {}),
      });
    }
    if (tele !== null) await tx.alterar('teleconsulta', tele, teleVersao, { atendimento_id: id });
    await gravarEtapasSePa(tx, id, ['abertura']);
    // F3.0: a conta do atendimento nasce na abertura (mesma transação), com as taxas de abertura da regra.
    // Sem tipo de conta da natureza, o atendimento abre e a pendência volta para o faturista (alertaConta).
    const { conta, pendencia } = await abrirContaDaEntrada(tx, est, id);
    if (conta !== null) await apurarConta(tx, est, conta, agora);
    // F3.1 (02-CAD linha 4): menor sem representante ou incapaz sem curador no cadastro. O atendimento abre (a
    // urgência não espera o cadastro) e o aviso volta para a recepção regularizar a ficha.
    const representacao = await alertasRepresentacaoDoPaciente(tx, Number(pac['id']));
    const aberto = {
      ...(pendencia !== null ? { alertaConta: pendencia.codigo, alertaContaMotivo: pendencia.mensagem } : {}),
      ...(representacao.length > 0
        ? {
            alertaRepresentacao: representacao.join(','),
            alertaRepresentacaoMotivo: representacao.map((a) => MENSAGEM_ALERTA_REPRESENTACAO[a]).join(' '),
          }
        : {}),
      reg: id,
      cabecalho: numero.formatado,
      tipo: String(e['tipo']),
      senha: senha ?? 0,
      marcacao: marcacao ?? 0,
    };
    return credenciamento
      ? { ...aberto, alerta: 'profissional-nao-credenciado', alertaMotivo: credenciamento.motivo ?? '' }
      : aberto;
  },
  eventos: (_e, r) => [{ tipo: 'atendimento.aberto', carga: { atendimento: r.reg } }],
  alvo: (_e, r) => ({ tabela: 'atendimento', id: r.reg }),
});

/** Grupo do lançamento do faturamento pelo tipo do item faturável (honorário 2; procedimento e serviço 3). */
const GRUPO_DO_EXTRA: Readonly<Record<string, 2 | 3>> = { honorario: 2, procedimento: 3, servico: 3 };

/**
 * O procedimento extra da recepção na conta do atendimento (ADR 0009): pelo lançamento do faturamento, na mesma
 * transação, com o preço da regra particular do médico ou da agenda (antes da tabela) ou da tabela do convênio, o
 * credenciamento (alerta ou bloqueio) e o total da conta.
 */
const OPERACAO_LANCAR_EXTRA = definirOperacao({
  nome: 'atendimento.lancar-procedimento-extra',
  tabelas: [...lancarItem.tabelas, 'atendimento_procedimento'],
  entrada: esquemaLancarProcedimentoExtra,
  acao: 'inclusao',
  async gravar(tx, e, ctx) {
    const est = tx.contexto.estabelecimento;
    if (est === null)
      throw recusa('estabelecimento-obrigatorio', 'Escolha o estabelecimento do atendimento.');
    const a = await tx.uma(
      `SELECT a.id, a.situacao, ca.codigo AS tipo, ca.laboratorio FROM atendimento a
         JOIN categoria_atendimento ca ON ca.id = a.categoria_atendimento_id
        WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
      [Number(e.atendimento), est],
    );
    if (!a)
      throw recusa('atendimento-inexistente', 'Atendimento não encontrado.', { campos: ['atendimento'] });
    if (String(a['situacao']) === 'cancelado')
      throw recusa('atendimento-cancelado', 'O atendimento foi cancelado.', { campos: ['atendimento'] });
    // Como a porta em memória: a requisição de laboratório não recebe procedimento extra pela recepção.
    if (String(a['tipo']) === 'requisicaoLab' || booleano(a['laboratorio']))
      throw recusa(
        'requisicao-sem-extra',
        'A requisição de laboratório não recebe procedimento extra pela recepção.',
        {
          campos: ['atendimento'],
        },
      );
    const vinculo = await tx.uma(
      `SELECT ac.conta_hospitalar_id FROM atendimento_conta ac
         JOIN conta_hospitalar c ON c.id = ac.conta_hospitalar_id AND c.situacao <> 'cancelada' AND c.excluido_em IS NULL
        WHERE ac.atendimento_id = ? AND ac.excluido_em IS NULL ORDER BY ac.id LIMIT 1`,
      [Number(a['id'])],
    );
    if (!vinculo)
      throw recusa('atendimento-sem-conta', 'O atendimento não tem conta: abra a conta antes de lançar.');
    const conta = Number(vinculo['conta_hospitalar_id']);
    await tx.consultarParaAtualizar('SELECT id FROM conta_hospitalar WHERE id = ?', [conta], { teto: 1 });
    const item = await tx.uma(
      `SELECT tipo_item FROM item_faturavel WHERE codigo = ? AND situacao = 'ativo' AND excluido_em IS NULL
        AND tipo_item IN ('honorario','procedimento','servico') LIMIT 1`,
      [String(e.procedimento)],
    );
    const grupo = item ? GRUPO_DO_EXTRA[String(item['tipo_item'])] : undefined;
    if (!grupo)
      throw recusa(
        'procedimento-fora-da-tabela',
        'O procedimento não está no catálogo de itens faturáveis.',
        {
          campos: ['procedimento'],
        },
      );
    const f = await tx.uma<{ f: unknown }>('SELECT fuso_horario AS f FROM estabelecimento WHERE id = ?', [
      est,
    ]);
    const agora = localNoFuso(new Date(), texto(f?.f) ?? FUSO_PADRAO);
    const r = await lancarItem.gravar(
      tx,
      esquemaLancarItem.parse({
        conta,
        tipo: grupo,
        codigo: e.procedimento,
        quantidade: e.quantidade,
        data: agora.slice(0, 10),
        hora: agora.slice(11, 16),
        local: 0,
        ato: 0,
        executante: e.profissional ?? null,
      }),
      ctx,
    );
    // O extra fica na ficha com a sua sequência (estável) e o item que gerou na conta: a correção e o estorno
    // mudam os dois juntos (porta-propria-correcao.ts).
    const proxima = await tx.uma(
      'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM atendimento_procedimento WHERE atendimento_id = ?',
      [Number(a['id'])],
    );
    const seq = Number(proxima?.['s'] ?? 1);
    const doCatalogo = await tx.uma(
      'SELECT id FROM item_faturavel WHERE codigo = ? AND excluido_em IS NULL LIMIT 1',
      [String(e.procedimento)],
    );
    await tx.incluir('atendimento_procedimento', {
      atendimento_id: Number(a['id']),
      sequencia: seq,
      item_faturavel_id: Number(doCatalogo?.['id']),
      quantidade: e.quantidade,
      principal: false,
      conta_hospitalar_item_id: Number(r['id']),
    });
    return {
      reg: Number(a['id']),
      seq,
      procedimento: e.procedimento,
      quantidade: e.quantidade,
      conta,
      valor: Number(r['valor'] ?? 0),
      ...(r['alerta'] ? { alerta: String(r['alerta']), alertaMotivo: String(r['alertaMotivo'] ?? '') } : {}),
    };
  },
  eventos: (_e, r) => [
    { tipo: 'faturamento.item.lancado', carga: { conta: Number(r['conta']), atendimento: Number(r['reg']) } },
  ],
  alvo: (_e, r) => ({ tabela: 'conta_hospitalar', id: Number(r['conta']) }),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cada operação valida a própria entrada (Zod)
const OPERACOES_PROPRIAS: Readonly<Record<string, Operacao<any, ResultadoOperacao>>> = {
  'atendimento.abrirAtendimento': OPERACAO_ABRIR,
  'atendimento.cancelarAtendimento': OPERACAO_CANCELAR,
  'atendimento.encerrarAtendimento': OPERACAO_ENCERRAR,
  'atendimento.conduzirNoConsultorio': OPERACAO_CONDUZIR,
  'atendimento.lancarProcedimentoExtra': OPERACAO_LANCAR_EXTRA,
  'atendimento.alterarHeranca': OPERACAO_ALTERAR_HERANCA,
  'atendimento.definirPadraoAbertura': OPERACAO_DEFINIR_PADRAO_ABERTURA,
  'atendimento.definirMeuPadraoAbertura': OPERACAO_DEFINIR_MEU_PADRAO_ABERTURA,
  ...OPERACOES_CORRECAO_FICHA,
};
