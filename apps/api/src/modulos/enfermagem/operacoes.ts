// Operações da checagem de enfermagem sobre o banco do cliente, pelo Executor do @sgh/nucleo (trilha, outbox e
// idempotência na mesma transação): checar a administração (com a dupla checagem e a glicemia medida), aprazar o
// horário e estornar a checagem. Cada uma trava o horário (horario_administracao) e confere, na transação, que a
// situação ainda é a que a tela leu; o histórico vai a horario_administracao_evento (só inclusão).
// Melhoria: o vínculo do profissional vem da conta da sessão no estabelecimento (usuario_vinculo_profissional) e a
// ocupação informada tem de ser dele e de enfermagem (CBO 2235 ou 3222); situação pela categoria do cadastro
// (situacao_checagem), sem letras gravadas; a hora real do ato vira o instante do evento; o estorno de dose que já
// baixou estoque é recusado com a contagem, salvo com a devolução registrada como pendente.
import {
  definirOperacao,
  type Escritor,
  type Operacao,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import {
  type AprazamentoHorario,
  type ChecagemAdministracao,
  esquemaAprazamentoHorario,
  esquemaChecagemAdministracao,
  esquemaEstornoChecagem,
  type EstornoChecagem,
  justificativaDoEstorno,
  OPERACAO_APRAZAR,
  OPERACAO_CHECAR,
  OPERACAO_ESTORNAR,
  recusaEstoqueBaixado,
} from './checagem.js';
import { exigirProfissional, fusoDe, instanteDe, profissionalDoLogin } from './banco-apoio.js';
import { gravarLoteLido } from './lote-lido-propria.js';
import { iniciarAtoTransfusional, TABELAS_INICIO_ATO } from './transfusao-porta-propria.js';

/** Categoria do cadastro de situações → código do contrato das telas. */
export const LETRA_DA_CATEGORIA: Readonly<Record<string, string>> = {
  pendente: 'P',
  atrasado: 'P',
  adiado: 'P',
  administrado: 'A',
  administrado_parcial: 'p',
  nao_administrado: 'N',
  recusado_paciente: 'N',
  suspenso: 'S',
};

/** A letra do contrato pela categoria e pela marca de suspenso do horário. */
export function letraDaSituacao(categoria: unknown, suspenso: unknown): string {
  if (suspenso === true || suspenso === 1 || suspenso === '1') return 'S';
  return LETRA_DA_CATEGORIA[String(categoria ?? '')] ?? 'P';
}

/** O CBO de enfermagem: enfermeiro (2235) ou técnico e auxiliar (3222). */
export const cboDeEnfermagem = (codigo: string): boolean => /^(2235|3222)/.test(codigo);

interface HorarioTravado {
  readonly id: number;
  readonly versao: number;
  readonly atendimento: number;
  readonly prescricao: number;
  readonly item: number;
  readonly paciente: number;
  readonly letra: string;
  readonly dispensacao: number | null;
}

const ATIVO = 'h.excluido_em IS NULL';

async function travarHorario(tx: Escritor, est: number, id: number): Promise<HorarioTravado | null> {
  const [h] = await tx.consultarParaAtualizar<Record<string, unknown>>(
    `SELECT h.id, h.versao, h.atendimento_id, h.prescricao_id, h.prescricao_item_id, h.suspenso, h.dispensacao_id,
            sc.categoria, p.paciente_id, f.situacao AS fechamento
       FROM horario_administracao h
       JOIN situacao_checagem sc ON sc.id = h.situacao_checagem_id
       JOIN prescricao p ON p.id = h.prescricao_id
       LEFT JOIN fechamento_horario_checagem f ON f.id = h.fechamento_horario_checagem_id
      WHERE h.id = ? AND h.estabelecimento_id = ? AND ${ATIVO}`,
    [id, est],
  );
  if (!h) return null;
  // 03-PEP L113: o horário do turno fechado não muda (checar, estornar, aprazar) até a reabertura com motivo.
  if (h['fechamento'] === 'fechado')
    throw recusa(
      'horario-fechado',
      'O turno deste horário está fechado: reabra o fechamento com o motivo para corrigir.',
    );
  return {
    id: Number(h['id']),
    versao: Number(h['versao']),
    atendimento: Number(h['atendimento_id']),
    prescricao: Number(h['prescricao_id']),
    item: Number(h['prescricao_item_id']),
    paciente: Number(h['paciente_id']),
    letra: letraDaSituacao(h['categoria'], h['suspenso']),
    dispensacao:
      h['dispensacao_id'] === null || h['dispensacao_id'] === undefined ? null : Number(h['dispensacao_id']),
  };
}

async function situacaoDaCategoria(tx: Escritor, categoria: string): Promise<number> {
  const r = await tx.uma<{ id: number }>(
    `SELECT id FROM situacao_checagem WHERE categoria = ? AND ativo AND processo_enfermagem = 'administracao'
      ORDER BY ordem IS NULL, ordem, id LIMIT 1`,
    [categoria],
  );
  if (!r)
    throw recusa(
      'cadastro-incompleto',
      `O cadastro das situações da checagem não tem a categoria "${categoria}": peça a carga ao administrador.`,
    );
  return Number(r.id);
}

/** O profissional da sessão e a ocupação de enfermagem informada (tem de ser dele). */
async function profissionalEnfermagem(tx: TxOperacao, est: number, ocupacao: number): Promise<number> {
  const profissional = await exigirProfissional(tx, tx.contexto, est);
  const o = await tx.uma<{ codigo_cbo: string }>(
    `SELECT oc.codigo_cbo FROM profissional_ocupacao po JOIN ocupacao_cbo oc ON oc.id = po.ocupacao_cbo_id
      WHERE po.id = ? AND po.profissional_id = ? AND po.ativo AND po.excluido_em IS NULL`,
    [ocupacao, profissional],
  );
  if (!o) throw recusa('cbo-invalido', 'O CBO informado não é do profissional da sessão ou não está ativo.');
  if (!cboDeEnfermagem(String(o.codigo_cbo)))
    throw recusa('categoria-nao-checa', 'A checagem, o aprazamento e o estorno são da enfermagem.');
  return profissional;
}

function estabelecimento(tx: TxOperacao): number {
  const est = tx.contexto.estabelecimento;
  if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return est;
}

async function evento(
  tx: TxOperacao,
  v: {
    horario: number;
    evento: string;
    ocorridoEm: Date;
    situacao?: number | null;
    aprazamento?: number | null;
    previstoAnterior?: Date | null;
    previstoNovo?: Date | null;
    quantidade?: number | null;
    profissional?: number | null;
    motivo?: string | null;
    canal?: string;
    dados?: unknown;
  },
): Promise<number> {
  return tx.incluir('horario_administracao_evento', {
    horario_administracao_id: v.horario,
    operacao: 'alteracao',
    dados: v.dados === undefined ? null : JSON.stringify(v.dados),
    ocorrido_em: v.ocorridoEm,
    usuario_id: tx.contexto.usuario,
    evento: v.evento,
    situacao_checagem_id: v.situacao ?? null,
    situacao_aprazamento_id: v.aprazamento ?? null,
    previsto_anterior_em: v.previstoAnterior ?? null,
    previsto_novo_em: v.previstoNovo ?? null,
    quantidade_administrada: v.quantidade ?? null,
    profissional_id: v.profissional ?? null,
    motivo: v.motivo ?? null,
    canal_registro: v.canal ?? 'estacao',
  });
}

const TABELAS_CHECAR = [
  ...new Set([
    'horario_administracao',
    'horario_administracao_evento',
    'administracao_dupla_checagem',
    'administracao_lote_lido',
    'afericao',
    'afericao_valor',
    ...TABELAS_INICIO_ATO,
  ]),
];

interface SaidaChecagem extends ResultadoOperacao {
  readonly horario: number;
  readonly situacao: string;
  readonly evento: number;
}

/** Checar a administração (na tela, enfermagem.checarAdministracao): as marcações (a principal e as faixas da glicemia), a dupla checagem e a glicemia. */
export const checarAdministracao = definirOperacao<ChecagemAdministracao, SaidaChecagem>({
  nome: 'enfermagem.checar-administracao',
  tabelas: TABELAS_CHECAR,
  entrada: esquemaChecagemAdministracao as unknown as import('zod').ZodType<ChecagemAdministracao>,
  async gravar(tx, e) {
    const est = estabelecimento(tx);
    const profissional = await profissionalEnfermagem(tx, est, e.cbo);
    const principal = e.marcacoes.find((m) => m.papel === 'principal')!;
    if (e.hemocomponente) {
      // A checagem do horário do hemocomponente é o início do ato transfusional, na mesma transação.
      const h = await travarHorario(tx, est, principal.horario);
      if (!h || h.item !== principal.item || h.prescricao !== e.prescricao || h.atendimento !== e.atendimento)
        throw recusa('horario-inexistente', 'O horário não é deste item da prescrição.');
      if (h.paciente !== e.paciente) throw recusa('horario-inexistente', 'O horário não é deste paciente.');
      const { chave: _chave, ...hemo } = e.hemocomponente;
      void _chave;
      const ato = await iniciarAtoTransfusional(
        tx,
        est,
        await fusoDe(tx, est),
        { ...hemo, horario: h.id },
        e.sgh.dispositivo ?? null,
      );
      return { horario: principal.horario, situacao: principal.situacao, evento: ato.evento ?? 0 };
    }
    if (principal.situacao === 'N' && !(e.sgh.motivo ?? '').trim())
      throw recusa('motivo-obrigatorio', 'O não administrado exige o motivo da lista.');
    const fuso = await fusoDe(tx, est);
    const ocorrido = instanteDe(e.sgh.horaReal, fuso);
    const canal = e.sgh.dispositivo ? 'beira_leito' : 'estacao';
    const situacoes = {
      A: await situacaoDaCategoria(tx, 'administrado'),
      N: await situacaoDaCategoria(tx, 'nao_administrado'),
    };
    let eventoPrincipal = 0;
    for (const m of e.marcacoes) {
      const h = await travarHorario(tx, est, m.horario);
      if (!h || h.item !== m.item || h.prescricao !== e.prescricao || h.atendimento !== e.atendimento)
        throw recusa('horario-inexistente', 'O horário não é deste item da prescrição.');
      if (h.paciente !== e.paciente) throw recusa('horario-inexistente', 'O horário não é deste paciente.');
      if (h.letra !== m.situacaoLida) {
        if (h.letra === 'S')
          throw recusa('horario-suspenso', 'A prescrição está suspensa: nada foi gravado.');
        if (h.letra === 'A' || h.letra === 'N')
          throw recusa('horario-ja-checado', 'O horário já foi checado em outro terminal: nada foi gravado.');
        throw recusa(
          'horario-mudou',
          'A situação do horário mudou depois que a tela foi aberta: nada foi gravado.',
        );
      }
      if (h.letra !== 'P') throw recusa('horario-ja-checado', 'O horário já foi checado: nada foi gravado.');
      const motivo =
        m.papel === 'principal' ? (e.sgh.motivo ?? m.justificativa) : 'Fora da faixa da glicemia medida';
      await tx.alterar('horario_administracao', h.id, h.versao, {
        situacao_checagem_id: situacoes[m.situacao],
        situacao_checagem_em: ocorrido,
        quantidade_administrada: m.situacao === 'A' ? m.quantidade : null,
        administrado_por_profissional_id: m.situacao === 'A' ? profissional : null,
        administrado_em: m.situacao === 'A' ? ocorrido : null,
        justificativa: m.justificativa ?? (m.situacao === 'N' ? motivo : null),
        canal_registro: canal,
      });
      const id = await evento(tx, {
        horario: h.id,
        evento: m.situacao === 'A' ? 'checagem' : 'nao_administrado',
        ocorridoEm: ocorrido,
        situacao: situacoes[m.situacao],
        quantidade: m.situacao === 'A' ? m.quantidade : null,
        profissional,
        motivo: m.situacao === 'N' ? (motivo ?? 'Não administrado') : (m.justificativa ?? null),
        canal,
        dados: {
          ato: m.papel,
          pulseiraLida: e.sgh.pulseiraLida,
          motivoSemPulseira: e.sgh.motivoSemPulseira,
          gtin: m.papel === 'principal' ? e.sgh.gtin : null,
          lote: m.papel === 'principal' ? e.sgh.lote : null,
          validade: m.papel === 'principal' ? e.sgh.validade : null,
          conferente: e.sgh.conferente,
          dispositivo: e.sgh.dispositivo?.trim() || null,
          origemOffline: e.sgh.origemOffline,
          avisos: e.sgh.avisos,
          observacao: m.papel === 'principal' ? e.sgh.observacao : null,
          motivo: m.papel === 'principal' ? e.sgh.motivo : null,
        },
      });
      if (m.papel === 'principal') eventoPrincipal = id;
      // 03-PEP L113: o produto e o lote lidos ligam a dose ao estoque, com o resultado da conferência.
      if (m.papel === 'principal' && m.situacao === 'A')
        await gravarLoteLido(tx, est, {
          horario: h.id,
          gtin: e.sgh.gtin,
          lote: e.sgh.lote,
          validade: e.sgh.validade,
          quantidade: m.quantidade,
          observacao: e.sgh.observacao ?? m.justificativa,
          ocorrido,
          fuso,
        });
      if (e.sgh.conferente && m.papel === 'principal') {
        const conf = await tx.uma<{ id: number }>(
          'SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL',
          [e.sgh.conferente.trim().toLowerCase()],
        );
        if (!conf)
          throw recusa('conferente-invalido', 'O segundo profissional da dupla checagem não foi encontrado.');
        if (conf.id !== null && Number(conf.id) === tx.contexto.usuario)
          throw recusa('conferente-invalido', 'A dupla checagem é de outro profissional.');
        const profConf = await profissionalDoLogin(tx, e.sgh.conferente, est);
        const seq = await tx.uma<{ n: number }>(
          'SELECT COALESCE(MAX(sequencia), 0) + 1 AS n FROM administracao_dupla_checagem WHERE horario_administracao_id = ?',
          [h.id],
        );
        await tx.incluir('administracao_dupla_checagem', {
          horario_administracao_id: h.id,
          sequencia: Number(seq?.n ?? 1),
          conferente_usuario_id: Number(conf.id),
          conferente_profissional_id: profConf,
          conferido_em: ocorrido,
          resultado: 'conforme',
        });
      }
    }
    if (e.glicemia !== null) {
      const pv = await tx.uma<{ id: number }>(
        "SELECT id FROM parametro_vital WHERE codigo = 'glicemia' AND ativo",
        [],
      );
      if (!pv)
        throw recusa(
          'cadastro-incompleto',
          'O cadastro dos parâmetros vitais não tem a glicemia: peça a carga ao administrador.',
        );
      const afericao = await tx.incluir('afericao', {
        estabelecimento_id: est,
        paciente_id: e.paciente,
        atendimento_id: e.atendimento,
        profissional_id: profissional,
        aferido_em: ocorrido,
        fonte: e.sgh.dispositivo ? 'dispositivo' : 'manual',
        finalizada: true,
      });
      await tx.incluir('afericao_valor', {
        afericao_id: afericao,
        sequencia: 1,
        parametro_vital_id: Number(pv.id),
        valor_numerico: e.glicemia,
      });
    }
    return { horario: principal.horario, situacao: principal.situacao, evento: eventoPrincipal };
  },
  eventos: (e, r) => [
    {
      tipo: 'enfermagem.checagem.registrada',
      carga: { horario: r.horario, situacao: r.situacao, marcacoes: e.marcacoes.length },
    },
  ],
  alvo: (_e, r) => ({ tabela: 'horario_administracao', id: r.horario }),
});

interface SaidaAprazamento extends ResultadoOperacao {
  readonly horario: number;
  readonly evento: number;
}

/** Aprazar, reaprazar ou suprimir um horário ainda não checado. */
export const aprazarHorario = definirOperacao<AprazamentoHorario, SaidaAprazamento>({
  nome: 'enfermagem.aprazar-horario',
  tabelas: ['horario_administracao', 'horario_administracao_evento'],
  entrada: esquemaAprazamentoHorario as unknown as import('zod').ZodType<AprazamentoHorario>,
  async gravar(tx, e) {
    const est = estabelecimento(tx);
    const profissional = await profissionalEnfermagem(tx, est, e.cbo);
    if (e.acao !== 'aprazar' && !(e.motivo ?? '').trim())
      throw recusa('motivo-obrigatorio', 'Reaprazar e suprimir exigem o motivo.');
    const h = await travarHorario(tx, est, e.horario);
    if (!h || h.item !== e.item || h.prescricao !== e.prescricao)
      throw recusa('horario-inexistente', 'O horário não é deste item da prescrição.');
    if (h.paciente !== e.paciente) throw recusa('horario-inexistente', 'O horário não é deste paciente.');
    if (h.letra === 'S') throw recusa('horario-suspenso', 'O horário está suspenso: nada foi gravado.');
    if (h.letra !== 'P') throw recusa('horario-ja-checado', 'O horário já foi checado: nada foi gravado.');
    const fuso = await fusoDe(tx, est);
    const atual = await tx.uma<{ previsto_em: Date }>(
      'SELECT previsto_em FROM horario_administracao WHERE id = ?',
      [h.id],
    );
    const anterior = atual ? new Date(atual.previsto_em) : null;
    const categoria = e.acao === 'aprazar' ? 'aprazado' : e.acao === 'reaprazar' ? 'reaprazado' : 'suspenso';
    const sa = await tx.uma<{ id: number }>(
      'SELECT id FROM situacao_aprazamento WHERE categoria = ? AND ativo ORDER BY ordem IS NULL, ordem, id LIMIT 1',
      [categoria],
    );
    if (!sa)
      throw recusa(
        'cadastro-incompleto',
        `O cadastro das situações do aprazamento não tem a categoria "${categoria}": peça a carga ao administrador.`,
      );
    const agora = new Date();
    const novo = e.confirmado ? instanteDe(e.confirmado, fuso) : null;
    await tx.alterar('horario_administracao', h.id, h.versao, {
      situacao_aprazamento_id: Number(sa.id),
      aprazado_por_profissional_id: profissional,
      aprazado_em: agora,
      observacao_aprazamento: e.motivo,
      ...(novo ? { previsto_em: novo } : {}),
      ...(e.acao === 'suprimir' ? { suspenso: true, suspenso_em: agora } : {}),
    });
    const id = await evento(tx, {
      horario: h.id,
      evento: e.acao === 'aprazar' ? 'aprazamento' : e.acao === 'reaprazar' ? 'reaprazamento' : 'suspensao',
      ocorridoEm: agora,
      aprazamento: Number(sa.id),
      previstoAnterior: anterior,
      previstoNovo: novo,
      profissional,
      motivo: e.motivo,
      dados: { acao: e.acao },
    });
    return { horario: h.id, evento: id };
  },
  eventos: (e, r) => [{ tipo: 'enfermagem.horario.aprazado', carga: { horario: r.horario, acao: e.acao } }],
  alvo: (_e, r) => ({ tabela: 'horario_administracao', id: r.horario }),
});

interface SaidaEstorno extends ResultadoOperacao {
  readonly horario: number;
  readonly item: number;
  readonly prescricao: number;
  readonly atendimento: number;
  readonly situacaoAnterior: string;
  readonly evento: number;
  readonly devolucaoPendente: boolean;
}

/** Estornar a checagem: o horário volta a pendente; o estorno é fato novo no histórico, com o motivo. */
export const estornarChecagem = definirOperacao<EstornoChecagem, SaidaEstorno>({
  nome: 'enfermagem.estornar-checagem',
  tabelas: ['horario_administracao', 'horario_administracao_evento'],
  entrada: esquemaEstornoChecagem as unknown as import('zod').ZodType<EstornoChecagem>,
  async gravar(tx, e) {
    const est = estabelecimento(tx);
    const profissional = await profissionalEnfermagem(tx, est, e.cbo);
    const h = await travarHorario(tx, est, e.horario);
    if (!h) throw recusa('horario-inexistente', 'O horário não foi encontrado.');
    if (h.paciente !== e.paciente) throw recusa('horario-inexistente', 'O horário não é deste paciente.');
    if (h.letra !== 'A' && h.letra !== 'N')
      throw recusa('horario-nao-checado', 'O horário não está checado: nada a estornar.');
    const baixa = { integracoes: 0, dispensacoes: h.dispensacao === null ? 0 : 1 };
    const temBaixa = baixa.dispensacoes > 0;
    if (temBaixa && !e.devolucaoPendente) throw recusaEstoqueBaixado(baixa);
    const pendente = await situacaoDaCategoria(tx, 'pendente');
    const agora = new Date();
    await tx.alterar('horario_administracao', h.id, h.versao, {
      situacao_checagem_id: pendente,
      situacao_checagem_em: agora,
      quantidade_administrada: null,
      administrado_por_profissional_id: null,
      administrado_em: null,
      conferido_por_profissional_id: null,
      conferido_em: null,
      justificativa: null,
    });
    const id = await evento(tx, {
      horario: h.id,
      evento: 'estorno',
      ocorridoEm: agora,
      situacao: pendente,
      profissional,
      motivo: justificativaDoEstorno(e),
      dados: { motivo: e.motivo, situacaoAnterior: h.letra, devolucaoPendente: temBaixa },
    });
    return {
      horario: h.id,
      item: h.item,
      prescricao: h.prescricao,
      atendimento: h.atendimento,
      situacaoAnterior: h.letra,
      evento: id,
      devolucaoPendente: temBaixa,
    };
  },
  eventos: (e, r) => [
    {
      tipo: 'enfermagem.checagem.estornada',
      carga: {
        horario: e.horario,
        motivo: e.motivo,
        situacaoAnterior: r.situacaoAnterior,
        devolucaoPendente: r.devolucaoPendente,
      },
    },
  ],
  alvo: (_e, r) => ({ tabela: 'horario_administracao', id: r.horario }),
  trilha: (e) => ({ motivo: justificativaDoEstorno(e) }),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- as três operações têm entradas e saídas diferentes
export const OPERACOES_ENFERMAGEM: Readonly<Record<string, Operacao<any, ResultadoOperacao>>> = {
  [OPERACAO_CHECAR]: checarAdministracao,
  [OPERACAO_APRAZAR]: aprazarHorario,
  [OPERACAO_ESTORNAR]: estornarChecagem,
};
