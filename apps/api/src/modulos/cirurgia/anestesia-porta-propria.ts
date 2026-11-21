// Porta da anestesia no bloco (M46.1: APA, ficha anestésica e SRPA) sobre o banco do cliente, pelo @sgh/nucleo: leituras
// somente leitura em avaliacao_pre_anestesica, ficha_anestesica (+ lancamento_ficha_anestesica, marco_ficha_anestesica,
// passagem, lacuna e adendo da ficha), registro_recuperacao_anestesica (+ avaliacao_recuperacao_anestesica) e nos
// cadastros da ficha; gravações diretas pelo Executor (gravarSgh), com a trilha, a idempotência e as conferências sob a
// mesma transação. Toda leitura filtra o estabelecimento da sessão (pelo agendamento) e os registros excluídos; os
// cadastros são da rede inteira.
// Melhoria: a ficha é aberta pelo agendamento antes do ato (ficha_anestesica.agendamento_cirurgico_id) e liga-se ao ato
// quando ele existe, sem chave natural em texto; os marcos são linhas próprias (marco_ficha_anestesica), não colunas por
// marco; a APA é uma linha por versão (a versão é a ordem das avaliações do agendamento) e a SRPA é um registro com a
// série de avaliações. O reenvio da mesma chave do pedido devolve o que foi gravado (idempotencia_operacao), sem gravar
// de novo.
import { createHash, randomUUID } from 'node:crypto';
import {
  definirOperacao,
  ErroOperacao,
  type Executor,
  gravarIdempotencia,
  type Leitor,
  lerIdempotencia,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import type { DestinoAltaSrpa, MarcoFicha, MomentoSrpa } from '@sgh/contratos';
import { estadoDaSituacao } from '@sgh/dominio-cirurgia';
import { z } from 'zod';
import {
  type ContextoPortaM18,
  type LiberacaoGravacao,
  portaIndisponivel,
  type TrilhaDaGravacao,
} from '../exames/public-api.js';
import {
  type GravadorAnestesia,
  METODOS_PORTA_ANESTESIA,
  type PortaAnestesia,
  type ProfissionalDaSessao,
} from './anestesia-porta.js';
import { civil, FUSO_PADRAO, instante, lista, n, nn, texto, textoOuNulo, verdadeiro } from './banco-apoio.js';
import { contextoDe, type NucleoCirurgia } from './porta-propria.js';
import type { ContextoGravacaoCirurgia } from './porta.js';
import { MARCO_FICHA, MARCOS_SEM_CONTRATO, PARTE_FICHA, SITUACAO_FICHA } from './vocabulario-banco.js';
import type {
  AvaliacaoPreAnestesica,
  AvaliacaoRecuperacao,
  ContextoAnestesia,
  DominiosFicha,
  FichaAnestesica,
  LancamentoDaFicha,
  LancamentoFicha,
} from './tipos.js';

type Linha = Record<string, unknown>;

// ── Apoio da gravação direta do bloco (anestesia e cirurgia segura) ──────────────────────────────────────────

/** A última tabela e o id que a gravação escreveu (a trilha usa a tabela real, nunca o nome vindo da tela). */
export interface EscritaDoBloco {
  ultima: { tabela: string; id: number } | null;
}

/**
 * Gravação direta pelo Executor: uma operação com as tabelas declaradas, a trilha junto e a chave de idempotência da
 * requisição (quando chega no contexto; sem ela, uma chave única da chamada). O gravador nasce dentro da transação.
 */
export async function gravarDiretoNoBloco<G, T>(
  executor: Executor,
  c: ContextoGravacaoCirurgia,
  o: {
    readonly nome: string;
    readonly tabelas: readonly string[];
    readonly tabelaPadrao: string;
    readonly trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao) | null;
    readonly gravador: (tx: TxOperacao, est: number, fuso: string, escrita: EscritaDoBloco) => G;
  },
  fn: (g: G) => Promise<T>,
): Promise<T> {
  const est = c.estabelecimento;
  if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  let saida: { valor: T } | null = null;
  const escrita: EscritaDoBloco = { ultima: null };
  const linha = () => (typeof o.trilha === 'function' ? (saida ? o.trilha(saida.valor) : null) : o.trilha);
  const op = definirOperacao({
    nome: o.nome,
    tabelas: [...o.tabelas, 'idempotencia_operacao'],
    entrada: z.object({ chave: z.string() }),
    async gravar(tx) {
      const f = await tx.uma<{ fuso_horario: string | null }>(
        'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
        [est],
      );
      saida = { valor: await fn(o.gravador(tx, est, f?.fuso_horario || FUSO_PADRAO, escrita)) };
      return { valor: saida.valor === undefined ? null : saida.valor } as unknown as ResultadoOperacao;
    },
    alvo: () => ({
      tabela: escrita.ultima?.tabela ?? o.tabelaPadrao,
      id: escrita.ultima?.id ?? linha()?.entidadeId ?? null,
    }),
    trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
  });
  const chave = `${o.nome}:${c.chaveIdempotencia || randomUUID()}`.slice(0, 80);
  const r = await executor.executar(
    op,
    c.cliente,
    { chave },
    {
      cliente: c.cliente,
      estabelecimento: est,
      usuario: c.usuario,
      correlacao: c.correlacao || 'cirurgia',
      chaveIdempotencia: chave,
    },
  );
  if (r.repetida) return ((r.resultado as Record<string, unknown>)['valor'] ?? undefined) as T;
  if (!saida) throw new Error('Gravação direta sem resultado.');
  return (saida as { valor: T }).valor;
}

/** O que a chave do pedido já gravou nesta ação (o reenvio), ou null. */
export async function jaGravadoPelaChave<R>(
  tx: TxOperacao,
  acao: string,
  chave: string | null,
): Promise<R | null> {
  if (!chave) return null;
  const r = await lerIdempotencia(tx, acao, chave.slice(0, 80));
  return r ? (r.resultado as unknown as R) : null;
}

/** Anota o que a chave do pedido gravou nesta ação (na mesma transação). */
export async function anotarChave(tx: TxOperacao, acao: string, chave: string | null, resultado: object) {
  if (!chave) return;
  await gravarIdempotencia(tx, {
    operacao: acao,
    chave: chave.slice(0, 80),
    estabelecimento: tx.contexto.estabelecimento,
    usuario: tx.contexto.usuario,
    hashEntrada: createHash('sha256').update(`${acao}:${chave}`).digest('hex'),
    resultado: resultado as ResultadoOperacao,
    trilha: null,
    agora: new Date(),
  });
}

/** O id do cadastro pelo código (ou pela sigla); recusa com o rótulo quando não existe. */
export async function idDoCadastro(
  l: Leitor,
  tabela: string,
  valor: string,
  rotulo: string,
  colunas: readonly string[] = ['codigo'],
): Promise<number> {
  const r = await l.uma<{ id: number }>(
    `SELECT id FROM ${tabela} WHERE ${colunas.map((c) => `${c} = ?`).join(' OR ')} ORDER BY id LIMIT 1`,
    colunas.map(() => valor),
  );
  if (!r) throw recusa('cadastro-inexistente', `${rotulo} "${valor}" não está cadastrado.`);
  return n(r.id);
}

/** O agendamento do estabelecimento relido na transação: existe? e o estado do domínio. */
export async function agendamentoRelido(tx: TxOperacao, est: number, agendamento: number) {
  const a = await tx.uma(
    'SELECT situacao FROM agendamento_cirurgico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [agendamento, est],
  );
  return { existe: a !== null, estado: a ? (estadoDaSituacao(texto(a['situacao'])) ?? null) : null };
}

const proximaSequencia = async (tx: TxOperacao, tabela: string, coluna: string, id: number) =>
  n(
    (
      await tx.uma<{ s: number | null }>(`SELECT MAX(sequencia) AS s FROM ${tabela} WHERE ${coluna} = ?`, [
        id,
      ])
    )?.s,
  ) + 1;

const fichaNaoExiste = () =>
  recusa('ficha-sem-ficha', 'A ficha anestésica não existe neste estabelecimento.');
const ficaMudou = () => recusa('ficha-mudou', 'A ficha mudou em outro aparelho depois que você a abriu.');

/** Gases do contrato → vocabulário do modelo. */
const GAS_BANCO: Readonly<Record<string, string>> = {
  o2: 'oxigenio',
  ar: 'ar_comprimido',
  n2o: 'oxido_nitroso',
  sevoflurano: 'sevoflurano',
  isoflurano: 'isoflurano',
  desflurano: 'desflurano',
};
const GAS_CONTRATO = Object.fromEntries(Object.entries(GAS_BANCO).map(([c, b]) => [b, c]));
const snake = (v: string) => v.replace(/-/g, '_');
const camel = (v: string) => v.replace(/_([a-z])/g, (_m, l: string) => l.toUpperCase());
/** Tipos de ingestão do jejum (contrato) → CHECK do modelo. */
const INGESTOES = ['liquidosClaros', 'leiteMaterno', 'refeicaoLeve', 'refeicaoGordurosa'] as const;
const snakeDeCamel = (v: string) => v.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const json = (v: unknown) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as unknown;
    } catch {
      return null;
    }
  }
  return v;
};

/** O balanço hídrico aberto do atendimento cuja janela contém o instante, ou null. */
async function balancoAberto(tx: TxOperacao, atendimento: number, momento: Date): Promise<number | null> {
  const b = await tx.uma<{ id: number }>(
    `SELECT id FROM balanco_hidrico_paciente WHERE atendimento_id = ? AND situacao = 'aberto' AND excluido_em IS NULL
        AND inicio_janela_em <= ? AND fim_janela_em > ? ORDER BY id DESC LIMIT 1`,
    [atendimento, momento, momento],
  );
  return b ? n(b.id) : null;
}

export const TABELAS_ANESTESIA = [
  'avaliacao_pre_anestesica',
  'ficha_anestesica',
  'lancamento_ficha_anestesica',
  'marco_ficha_anestesica',
  'passagem_ficha_anestesica',
  'lacuna_ficha_anestesica',
  'adendo_ficha_anestesica',
  'registro_recuperacao_anestesica',
  'avaliacao_recuperacao_anestesica',
  'pendencia_agendamento_cirurgico',
  'balanco_lancamento',
] as const;

/** O gravador da anestesia sobre a transação do Executor. */
function gravadorAnestesia(
  tx: TxOperacao,
  est: number,
  fuso: string,
  escrita: EscritaDoBloco,
  ler: (l: Leitor, est: number, fuso: string, agendamento: number) => Promise<FichaAnestesica | null>,
): GravadorAnestesia {
  const anotar = (tabela: string, id: number) => {
    escrita.ultima = { tabela, id };
    return id;
  };
  const quando = (v: string) => instante(v, fuso);
  /** A ficha do estabelecimento travada até o fim da transação. */
  const fichaTravada = async (id: number) => {
    const f =
      (
        await tx.consultarParaAtualizar(
          `SELECT f.* FROM ficha_anestesica f
         LEFT JOIN ato_cirurgico t ON t.id = f.ato_cirurgico_id
         JOIN agendamento_cirurgico a ON a.id = COALESCE(f.agendamento_cirurgico_id, t.agendamento_cirurgico_id)
        WHERE f.id = ? AND a.estabelecimento_id = ? AND f.excluido_em IS NULL`,
          [id, est],
        )
      )[0] ?? null;
    if (!f) throw fichaNaoExiste();
    return f;
  };
  const agendamentoTravado = async (agendamento: number) => {
    const a =
      (
        await tx.consultarParaAtualizar(
          `SELECT id, versao, atendimento_id, paciente_id, sala_cirurgica_id, tipo_anestesia_id FROM agendamento_cirurgico
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [agendamento, est],
        )
      )[0] ?? null;
    if (!a)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Agendamento inexistente',
        'O agendamento não existe neste estabelecimento.',
      );
    return a;
  };
  /** As pendências do agendamento pelo tipo (código): resolvidas ou reabertas por esta APA. */
  const pendencias = async (
    agendamento: number,
    codigos: readonly string[],
    situacao: 'resolvida' | 'aberta',
  ) => {
    for (const codigo of codigos) {
      const p = await tx.uma(
        `SELECT p.id, p.versao, p.situacao FROM pendencia_agendamento_cirurgico p
           JOIN tipo_pendencia_cirurgica t ON t.id = p.tipo_pendencia_cirurgica_id
          WHERE p.agendamento_cirurgico_id = ? AND t.codigo = ? AND p.excluido_em IS NULL ORDER BY p.id DESC LIMIT 1`,
        [agendamento, codigo],
      );
      if (!p || texto(p['situacao']) === situacao) continue;
      const resolvida = situacao === 'resolvida';
      await tx.alterar('pendencia_agendamento_cirurgico', n(p['id']), n(p['versao']), {
        situacao,
        resolvida_em: resolvida ? new Date() : null,
        resolvida_por_usuario_id: resolvida ? tx.contexto.usuario : null,
      });
    }
  };
  /** Linha de lançamento da ficha a partir do contrato (os cadastros pelo código, conferidos). */
  const lancamento = async (x: LancamentoFicha): Promise<Record<string, unknown>> => {
    const base = { parte: PARTE_FICHA.paraBanco(x.parte), momento_inicio: quando(x.momento) };
    const fim = 'fim' in x && x.fim ? { momento_fim: quando(x.fim) } : {};
    const unidade = async (u: string) =>
      idDoCadastro(tx, 'unidade_medida', u, 'A unidade', ['sigla', 'codigo']);
    switch (x.parte) {
      case 'sinal':
        return {
          ...base,
          tipo_sinal_monitorado_id: await idDoCadastro(tx, 'tipo_sinal_monitorado', x.tipo, 'O sinal', [
            'codigo',
            'sigla',
          ]),
          valor_numerico: x.valor,
        };
      case 'medicamento':
        return {
          ...base,
          ...fim,
          insumo_id: x.item,
          descricao: x.descricao,
          dose: x.dose,
          unidade_medida_id: await unidade(x.unidade),
          via_de_uso_id: await idDoCadastro(tx, 'via_de_uso', x.via, 'A via', ['codigo', 'sigla']),
          infusao_continua: x.continua,
          observacao: x.observacao,
        };
      case 'gas': {
        const gas = GAS_BANCO[x.gas];
        if (!gas) throw recusa('entrada-invalida', `O gás "${x.gas}" não é do vocabulário da ficha.`);
        return { ...base, ...fim, gas, valor_numerico: x.valor };
      }
      case 'fluido':
        return {
          ...base,
          ...fim,
          fluido: snake(x.fluido),
          insumo_id: x.item,
          volume_ml: x.volumeMl,
          observacao: x.observacao,
        };
      case 'perda':
        return { ...base, perda: snake(x.perda), volume_ml: x.volumeMl, observacao: x.observacao };
      case 'evento':
        return { ...base, ...fim, evento: x.evento, descricao: x.descricao };
      case 'modoRespiratorio':
        return { ...base, modo_ventilatorio_id: x.modo, observacao: x.observacao };
      case 'posicao':
        return { ...base, posicao_cirurgica_id: x.posicao, observacao: x.observacao };
      case 'equipe':
        return { ...base, profissional_id: x.profissional, funcao_equipe_cirurgica_id: x.funcao };
      case 'procedimento':
        return { ...base, ...fim, descricao: x.descricao, observacao: x.observacao };
      case 'exame':
        return { ...base, descricao: x.exame, resultado: x.resultado };
      case 'avulso':
        return { ...base, descricao: x.descricao, quantidade: x.quantidade };
      case 'bi':
        return {
          ...base,
          ...fim,
          insumo_id: x.item,
          descricao: x.descricao,
          vazao: x.vazao,
          unidade_medida_id: await unidade(x.unidade),
          infusao_continua: true,
          observacao: x.observacao,
        };
    }
  };

  return {
    agendamentoNaTransacao: (agendamento) => agendamentoRelido(tx, est, agendamento),

    async registrarApa(a) {
      const ja = await jaGravadoPelaChave<{ id: number; versao: number; agendamento: number }>(
        tx,
        'anestesia.apa',
        a.chave,
      );
      if (ja) {
        if (ja.agendamento !== a.agendamento)
          throw recusa('chave-reutilizada', 'A chave do pedido já foi usada em outro agendamento.');
        return { id: ja.id, versao: ja.versao, repetida: true, pendencias: [] };
      }
      const ag = await agendamentoTravado(a.agendamento);
      const vigente = n(
        (
          await tx.uma<{ q: number }>(
            'SELECT COUNT(*) AS q FROM avaliacao_pre_anestesica WHERE agendamento_cirurgico_id = ? AND excluido_em IS NULL',
            [a.agendamento],
          )
        )?.q,
      );
      if (vigente !== a.versaoVista)
        throw recusa('apa-mudou', 'Outra avaliação pré-anestésica foi registrada depois que a tela abriu.');
      const paciente = a.paciente ?? nn(ag['paciente_id']);
      if (paciente === null) throw recusa('paciente-obrigatorio', 'O agendamento não tem o paciente.');
      const asa = await tx.uma<{ id: number }>('SELECT id FROM classificacao_asa WHERE classe = ?', [a.asa]);
      if (!asa) throw recusa('cadastro-inexistente', `A classe ASA ${a.asa} não está cadastrada.`);
      const via = obj(a.viaAerea);
      const jejum = obj(a.jejum);
      // O modelo guarda a última ingestão e o tipo dela (a que decide o jejum mais recente).
      const ultima = INGESTOES.map((t) => ({ t, em: textoOuNulo(jejum[t]) }))
        .filter((x) => x.em !== null)
        .sort((x, y) => String(y.em).localeCompare(String(x.em)))[0];
      const id = await tx.incluir('avaliacao_pre_anestesica', {
        estabelecimento_id: est,
        paciente_id: paciente,
        atendimento_id: a.reg > 0 ? a.reg : nn(ag['atendimento_id']),
        agendamento_cirurgico_id: a.agendamento,
        anestesista_profissional_id: a.profissional,
        avaliado_em: quando(a.avaliadoEm),
        classificacao_asa_id: n(asa.id),
        asa_emergencia: a.emergencia,
        peso_kg: a.pesoKg,
        altura_cm: a.alturaCm,
        mallampati: nn(via['mallampati']),
        abertura_bucal_cm: nn(via['aberturaBucalCm']),
        distancia_tireomentoniana_cm: nn(via['distanciaTireomentonianaCm']),
        mobilidade_cervical_reduzida: via['mobilidadeCervicalReduzida'] === true,
        historico_via_aerea_dificil: via['historicoViaAereaDificil'] === true,
        proteses_ou_dentes_soltos: via['protesesOuDentesSoltos'] === true,
        alergias_conferidas: a.alergiasConferidas,
        ultima_ingestao_em: ultima?.em ? quando(ultima.em) : null,
        tipo_ultima_ingestao: ultima ? snakeDeCamel(ultima.t) : null,
        indice_lee: a.leePontos,
        criterios_lee: JSON.stringify(a.criteriosLee),
        comorbidades: a.comorbidades,
        medicacoes_em_uso: a.medicacoes,
        exames_avaliados: a.exames,
        anestesias_anteriores: a.anestesiasAnteriores,
        tipo_anestesia_id: a.tipoAnestesia > 0 ? a.tipoAnestesia : null,
        plano_anestesico: textoOuNulo(obj(a.plano)['texto']),
        plano_estruturado: JSON.stringify(a.plano ?? {}),
        conclusao: snake(a.conclusao),
        observacao: a.ressalvas,
        situacao: 'concluida',
      });
      anotar('avaliacao_pre_anestesica', id);
      await pendencias(a.agendamento, a.pendencias, 'resolvida');
      await pendencias(a.agendamento, a.pendenciasAbertas ?? [], 'aberta');
      await anotarChave(tx, 'anestesia.apa', a.chave, {
        id,
        versao: vigente + 1,
        agendamento: a.agendamento,
      });
      return { id, versao: vigente + 1, repetida: false, pendencias: [...a.pendencias] };
    },

    async ficha(agendamento) {
      await tx.consultarParaAtualizar(
        `SELECT f.id FROM ficha_anestesica f LEFT JOIN ato_cirurgico t ON t.id = f.ato_cirurgico_id
          WHERE COALESCE(f.agendamento_cirurgico_id, t.agendamento_cirurgico_id) = ? AND f.excluido_em IS NULL`,
        [agendamento],
      );
      return ler(tx, est, fuso, agendamento);
    },

    async abrirFicha(f) {
      const ja = await ler(tx, est, fuso, f.agendamento);
      if (ja) return { id: ja.id, versao: ja.versao, nova: false };
      const ag = await agendamentoTravado(f.agendamento);
      const ato = await tx.uma<{ id: number; tipo_anestesia_id: number | null }>(
        `SELECT id, tipo_anestesia_id FROM ato_cirurgico WHERE agendamento_cirurgico_id = ? AND estabelecimento_id = ?
            AND excluido_em IS NULL AND situacao <> 'cancelado' ORDER BY id DESC LIMIT 1`,
        [f.agendamento, est],
      );
      const tipo = nn(ato?.tipo_anestesia_id) ?? nn(ag['tipo_anestesia_id']);
      if (tipo === null)
        throw recusa(
          'ficha-sem-tipo-anestesia',
          'Informe o tipo de anestesia no agendamento antes de abrir a ficha.',
        );
      const apa = await tx.uma<{ id: number; peso_kg: number | null }>(
        `SELECT id, peso_kg FROM avaliacao_pre_anestesica WHERE agendamento_cirurgico_id = ? AND excluido_em IS NULL
          ORDER BY avaliado_em DESC, id DESC LIMIT 1`,
        [f.agendamento],
      );
      const id = await tx.incluir('ficha_anestesica', {
        agendamento_cirurgico_id: f.agendamento,
        ato_cirurgico_id: ato ? n(ato.id) : null,
        avaliacao_pre_anestesica_id: apa ? n(apa.id) : null,
        anestesista_profissional_id: f.abertura,
        tipo_anestesia_id: tipo,
        peso_kg: nn(apa?.peso_kg),
        situacao: 'aberta',
      });
      anotar('ficha_anestesica', id);
      return { id, versao: 1, nova: true };
    },

    async subirVersao(v) {
      const f = await fichaTravada(v.ficha);
      if (n(f['versao']) !== v.versaoVista || texto(f['situacao']) === 'assinada') throw ficaMudou();
      const valores: Record<string, unknown> = {};
      if (v.marco) {
        const marco = MARCO_FICHA.paraBanco(v.marco.marco);
        const momento = quando(v.marco.momento);
        const antigo = await tx.uma(
          'SELECT id, versao FROM marco_ficha_anestesica WHERE ficha_anestesica_id = ? AND marco_vigente = ?',
          [v.ficha, marco],
        );
        if (antigo) await tx.excluir('marco_ficha_anestesica', n(antigo['id']), n(antigo['versao']));
        await tx.incluir('marco_ficha_anestesica', {
          ficha_anestesica_id: v.ficha,
          sequencia: await proximaSequencia(tx, 'marco_ficha_anestesica', 'ficha_anestesica_id', v.ficha),
          marco,
          momento,
          profissional_id: nn(f['anestesista_profissional_id']),
        });
        if (marco === 'inicio_anestesia') valores['inicio_anestesia_em'] = momento;
        if (marco === 'fim_anestesia') valores['fim_anestesia_em'] = momento;
      }
      if (v.situacao && v.situacao !== texto(f['situacao'])) {
        if (v.situacao === 'assinada') throw ficaMudou();
        valores['situacao'] = v.situacao;
        if (v.situacao === 'encerrada') {
          valores['encerrada_em'] = new Date();
          // Sem o marco do fim da anestesia, o fim é o encerramento (nunca antes do início registrado).
          if (!valores['fim_anestesia_em'] && !f['fim_anestesia_em']) {
            const inicio = (valores['inicio_anestesia_em'] ?? f['inicio_anestesia_em']) as Date | null;
            const agora = new Date();
            valores['fim_anestesia_em'] = inicio && inicio.getTime() > agora.getTime() ? inicio : agora;
          }
        } else valores['encerrada_em'] = null;
      }
      anotar('ficha_anestesica', v.ficha);
      return tx.alterar('ficha_anestesica', v.ficha, n(f['versao']), valores);
    },

    async lancar(l) {
      const f = await fichaTravada(l.ficha);
      if (texto(f['situacao']) !== 'aberta') throw ficaMudou();
      const ja = await jaGravadoPelaChave<{ ids: number[]; ficha: number; noBalanco: number }>(
        tx,
        'anestesia.lancamento',
        l.chave,
      );
      if (ja) {
        if (ja.ficha !== l.ficha)
          throw recusa('chave-reutilizada', 'A chave do pedido já foi usada em outra ficha.');
        return { ids: ja.ids, repetida: true, noBalanco: ja.noBalanco };
      }
      const ids: number[] = [];
      let noBalanco = 0;
      let seq = await proximaSequencia(tx, 'lancamento_ficha_anestesica', 'ficha_anestesica_id', l.ficha);
      for (const x of l.lancamentos) {
        const id = await tx.incluir('lancamento_ficha_anestesica', {
          ficha_anestesica_id: l.ficha,
          sequencia: seq++,
          ...(await lancamento(x)),
          profissional_id: x.parte === 'equipe' ? x.profissional : l.profissional,
        });
        ids.push(id);
        // Fluido e perda com o de-para do balanço: entram no balanço hídrico aberto do atendimento na janela do
        // momento (sem balanço aberto, ou sem o profissional, não entram e não contam).
        if ((x.parte === 'fluido' || x.parte === 'perda') && x.balanco && l.profissional !== null) {
          const momento = quando(x.momento);
          const b = await balancoAberto(tx, x.balanco.atendimento, momento);
          if (b !== null) {
            await tx.incluir('balanco_lancamento', {
              balanco_hidrico_paciente_id: b,
              sentido: x.parte === 'fluido' ? 'ganho' : 'perda',
              grupo_balanco_hidrico_id: x.balanco.grupo,
              volume_ml: x.volumeMl,
              descricao: x.balanco.descricao.slice(0, 120),
              ocorrido_em: momento,
              registrado_em: new Date(),
              profissional_id: l.profissional,
              chave_ato: `ficha-anestesica:${id}`,
            });
            noBalanco++;
          }
        }
      }
      anotar('lancamento_ficha_anestesica', ids[ids.length - 1] ?? 0);
      await anotarChave(tx, 'anestesia.lancamento', l.chave, { ids, ficha: l.ficha, noBalanco });
      return { ids, repetida: false, noBalanco };
    },

    async encerrar(x) {
      await fichaTravada(x.ficha);
      const l = await tx.uma(
        'SELECT id, versao, parte, momento_inicio, momento_fim, infusao_continua FROM lancamento_ficha_anestesica WHERE id = ? AND ficha_anestesica_id = ? AND excluido_em IS NULL',
        [x.lancamento, x.ficha],
      );
      const fim = quando(x.fim);
      const parte = texto(l?.['parte']);
      const pode =
        l &&
        !l['momento_fim'] &&
        (l['momento_inicio'] as Date).getTime() <= fim.getTime() &&
        (['gas', 'fluido', 'evento', 'bomba_infusao', 'procedimento'].includes(parte) ||
          (parte === 'medicamento' && verdadeiro(l['infusao_continua'])));
      if (!pode)
        throw recusa(
          'ficha-lancamento-sem-fim',
          'O lançamento não existe nesta ficha, já tem o fim, ou o fim é anterior.',
        );
      await tx.alterar('lancamento_ficha_anestesica', x.lancamento, n(l['versao']), { momento_fim: fim });
      anotar('lancamento_ficha_anestesica', x.lancamento);
      return { tabela: 'lancamento_ficha_anestesica' };
    },

    async passar(p) {
      await fichaTravada(p.ficha);
      const ja = await jaGravadoPelaChave<{ id: number }>(tx, 'anestesia.passagem', p.chave);
      if (ja) return { id: ja.id, repetida: true };
      const id = await tx.incluir('passagem_ficha_anestesica', {
        ficha_anestesica_id: p.ficha,
        sequencia: await proximaSequencia(tx, 'passagem_ficha_anestesica', 'ficha_anestesica_id', p.ficha),
        momento: quando(p.momento),
        de_profissional_id: p.de,
        para_profissional_id: p.para,
        resumo: p.resumo,
      });
      anotar('passagem_ficha_anestesica', id);
      await anotarChave(tx, 'anestesia.passagem', p.chave, { id });
      return { id, repetida: false };
    },

    async justificar(j) {
      await fichaTravada(j.ficha);
      const ja = await jaGravadoPelaChave<{ id: number }>(tx, 'anestesia.lacuna', j.chave);
      if (ja) return { id: ja.id, repetida: true };
      const id = await tx.incluir('lacuna_ficha_anestesica', {
        ficha_anestesica_id: j.ficha,
        inicio: quando(j.inicio),
        fim: quando(j.fim),
        motivo: j.motivo,
        profissional_id: j.profissional,
      });
      anotar('lacuna_ficha_anestesica', id);
      await anotarChave(tx, 'anestesia.lacuna', j.chave, { id });
      return { id, repetida: false };
    },

    async assinar(a) {
      const f = await fichaTravada(a.ficha);
      if (n(f['versao']) !== a.versaoVista || texto(f['situacao']) !== 'encerrada')
        throw recusa(
          'ficha-mudou',
          'A ficha mudou (ou não está aguardando assinatura) depois que você a conferiu.',
        );
      anotar('ficha_anestesica', a.ficha);
      const versao = await tx.alterar('ficha_anestesica', a.ficha, n(f['versao']), {
        situacao: 'assinada',
        assinada_em: new Date(),
        assinada_por_profissional_id: a.profissional,
        hash_assinatura: a.hash,
      });
      return { versao };
    },

    async adendo(a) {
      const f = await fichaTravada(a.ficha);
      if (texto(f['situacao']) !== 'assinada')
        throw recusa('ficha-nao-assinada', 'O adendo vale só para a ficha já assinada.');
      const ja = await jaGravadoPelaChave<{ id: number }>(tx, 'anestesia.adendo', a.chave);
      if (ja) return { id: ja.id, repetida: true };
      const id = await tx.incluir('adendo_ficha_anestesica', {
        ficha_anestesica_id: a.ficha,
        sequencia: await proximaSequencia(tx, 'adendo_ficha_anestesica', 'ficha_anestesica_id', a.ficha),
        texto: a.texto,
        profissional_id: a.profissional,
      });
      anotar('adendo_ficha_anestesica', id);
      await anotarChave(tx, 'anestesia.adendo', a.chave, { id });
      return { id, repetida: false };
    },

    srpa: async (agendamento) => (await seriesDe(tx, est, fuso, agendamento))[0] ?? [],

    async registrarSrpa(x) {
      const ja = await jaGravadoPelaChave<{ id: number; agendamento: number }>(tx, 'anestesia.srpa', x.chave);
      if (ja) {
        if (ja.agendamento !== x.agendamento)
          throw recusa('chave-reutilizada', 'A chave do pedido já foi usada.');
        return { id: ja.id, repetida: true };
      }
      const ag = await agendamentoTravado(x.agendamento);
      let r =
        (
          await tx.consultarParaAtualizar(
            `SELECT * FROM registro_recuperacao_anestesica WHERE agendamento_cirurgico_id = ? AND estabelecimento_id = ?
            AND excluido_em IS NULL AND situacao <> 'cancelado' ORDER BY id DESC LIMIT 1`,
            [x.agendamento, est],
          )
        )[0] ?? null;
      const ultima = r
        ? n(
            (
              await tx.uma<{ m: number | null }>(
                'SELECT MAX(id) AS m FROM avaliacao_recuperacao_anestesica WHERE registro_recuperacao_anestesica_id = ? AND excluido_em IS NULL',
                [r['id']],
              )
            )?.m,
          )
        : 0;
      if (ultima !== x.ultimaVista)
        throw recusa('srpa-mudou', 'Outra avaliação foi registrada depois que a tela abriu.');
      if (r && texto(r['situacao']) === 'alta')
        throw recusa('srpa-ja-com-alta', 'A recuperação já teve a alta.');
      if (r && x.momento === 'admissao')
        throw recusa('srpa-fora-de-ordem', 'A admissão na recuperação já foi registrada.');
      if (x.profissional === null)
        throw recusa(
          'sem-registro-profissional',
          'A avaliação da recuperação é do profissional com registro ativo.',
        );
      const em = quando(x.em);
      if (!r) {
        const atendimento = x.reg > 0 ? x.reg : nn(ag['atendimento_id']);
        const paciente = x.paciente ?? nn(ag['paciente_id']);
        if (atendimento === null || paciente === null)
          throw recusa(
            'srpa-sem-atendimento',
            'O agendamento não tem o atendimento e o paciente da recuperação.',
          );
        const sala = await tx.uma<{ setor_funcional_id: number | null }>(
          'SELECT setor_funcional_id FROM sala_cirurgica WHERE id = ?',
          [x.sala > 0 ? x.sala : ag['sala_cirurgica_id']],
        );
        if (!sala || sala.setor_funcional_id === null)
          throw recusa('srpa-sem-setor', 'A sala não tem o setor configurado: a recuperação fica sem setor.');
        const ficha = await ler(tx, est, fuso, x.agendamento);
        const id = await tx.incluir('registro_recuperacao_anestesica', {
          estabelecimento_id: est,
          paciente_id: paciente,
          atendimento_id: atendimento,
          agendamento_cirurgico_id: x.agendamento,
          ato_cirurgico_id: x.cirurgia,
          ficha_anestesica_id: ficha?.id ?? null,
          setor_funcional_id: n(sala.setor_funcional_id),
          entrada_em: em,
          responsavel_profissional_id: x.profissional,
          situacao: 'em_recuperacao',
        });
        r = await tx.uma('SELECT * FROM registro_recuperacao_anestesica WHERE id = ?', [id]);
      }
      const registro = r as Linha;
      const rid = n(registro['id']);
      const a = x.aldrete;
      const total = a.atividade + a.respiracao + a.circulacao + a.consciencia + a.saturacao;
      const id = await tx.incluir('avaliacao_recuperacao_anestesica', {
        registro_recuperacao_anestesica_id: rid,
        sequencia: await proximaSequencia(
          tx,
          'avaliacao_recuperacao_anestesica',
          'registro_recuperacao_anestesica_id',
          rid,
        ),
        momento: x.momento,
        avaliado_em: em,
        aldrete_atividade: a.atividade,
        aldrete_respiracao: a.respiracao,
        aldrete_circulacao: a.circulacao,
        aldrete_consciencia: a.consciencia,
        aldrete_saturacao: a.saturacao,
        dor: x.dor,
        nausea_vomito: x.nvpo,
        temperatura: x.temperatura,
        profissional_id: x.profissional,
        observacao: x.observacao,
      });
      if (x.momento === 'admissao')
        await tx.alterar('registro_recuperacao_anestesica', rid, n(registro['versao']), {
          aldrete_admissao: total,
        });
      if (x.momento === 'alta') {
        if (x.destino === null) throw recusa('srpa-sem-destino', 'Informe o destino da alta da recuperação.');
        const criterios = total >= 9;
        if ((x.destino === 'uti' || !criterios) && !x.motivoDestino)
          throw recusa('srpa-motivo-destino', 'Diga o motivo do destino (UTI ou alta sem os critérios).');
        await tx.alterar('registro_recuperacao_anestesica', rid, n(registro['versao']), {
          situacao: 'alta',
          alta_em: em,
          alta_profissional_id: x.profissional,
          aldrete_alta: total,
          dor_alta: x.dor,
          nausea_vomito_alta: x.nvpo <= 2 ? x.nvpo : null,
          criterios_alta_atingidos: criterios,
          destino: x.destino,
          motivo_destino: x.motivoDestino,
        });
      }
      anotar('avaliacao_recuperacao_anestesica', id);
      await anotarChave(tx, 'anestesia.srpa', x.chave, { id, agendamento: x.agendamento });
      return { id, repetida: false };
    },
  };
}

const SQL_SRPA = `SELECT r.id, r.agendamento_cirurgico_id, r.destino, a.sala_cirurgica_id FROM registro_recuperacao_anestesica r
    LEFT JOIN agendamento_cirurgico a ON a.id = r.agendamento_cirurgico_id
   WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND r.situacao <> 'cancelado'`;

async function series(l: Leitor, fuso: string, registros: Linha[]): Promise<AvaliacaoRecuperacao[][]> {
  if (registros.length === 0) return [];
  const ids = registros.map((r) => n(r['id']));
  const av = await l.consultar(
    `SELECT v.*, u.login FROM avaliacao_recuperacao_anestesica v LEFT JOIN usuario u ON u.id = v.criado_por
      WHERE v.registro_recuperacao_anestesica_id IN (${lista(ids.length)}) AND v.excluido_em IS NULL ORDER BY v.sequencia`,
    ids,
  );
  return registros.map((r) =>
    av
      .filter((v) => n(v['registro_recuperacao_anestesica_id']) === n(r['id']))
      .map((v) => ({
        id: n(v['id']),
        agendamento: n(r['agendamento_cirurgico_id']),
        sala: n(r['sala_cirurgica_id']),
        momento: texto(v['momento']) as MomentoSrpa,
        em: civil(v['avaliado_em'], fuso) ?? '',
        aldrete: {
          atividade: n(v['aldrete_atividade']),
          respiracao: n(v['aldrete_respiracao']),
          circulacao: n(v['aldrete_circulacao']),
          consciencia: n(v['aldrete_consciencia']),
          saturacao: n(v['aldrete_saturacao']),
        },
        total: n(v['escore_aldrete']),
        dor: n(v['dor']),
        nvpo: n(v['nausea_vomito']),
        destino:
          v['momento'] === 'alta' ? ((textoOuNulo(r['destino']) as DestinoAltaSrpa | null) ?? null) : null,
        regraVersao: null,
        profissional: nn(v['profissional_id']),
        usuario: texto(v['login']),
      })),
  );
}

/** A série da SRPA do agendamento (o registro mais recente não cancelado). */
async function seriesDe(l: Leitor, est: number, fuso: string, agendamento: number) {
  const r = await l.consultar(`${SQL_SRPA} AND r.agendamento_cirurgico_id = ? ORDER BY r.id DESC LIMIT 1`, [
    est,
    agendamento,
  ]);
  return series(l, fuso, r);
}

/** A ficha do agendamento (aberta pelo agendamento ou pelo ato dele), com marcos, lançamentos e os registros dela. */
async function fichaDe(
  l: Leitor,
  est: number,
  fuso: string,
  agendamento: number,
): Promise<FichaAnestesica | null> {
  const f = await l.uma(
    `SELECT f.*, COALESCE(t.sala_cirurgica_id, a.sala_cirurgica_id) AS sala_cirurgica_id,
            COALESCE(t.atendimento_id, a.atendimento_id) AS atendimento_id, COALESCE(t.paciente_id, a.paciente_id) AS paciente_id,
            t.entrada_sala_em, a.inicio_previsto_em, ua.login AS assinante
       FROM ficha_anestesica f LEFT JOIN ato_cirurgico t ON t.id = f.ato_cirurgico_id AND t.excluido_em IS NULL
       JOIN agendamento_cirurgico a ON a.id = COALESCE(f.agendamento_cirurgico_id, t.agendamento_cirurgico_id)
       LEFT JOIN usuario ua ON ua.id = f.alterado_por
      WHERE a.id = ? AND a.estabelecimento_id = ? AND f.excluido_em IS NULL
      ORDER BY f.id DESC LIMIT 1`,
    [agendamento, est],
  );
  if (!f) return null;
  const id = n(f['id']);
  const marcos: Partial<Record<MarcoFicha, string>> = {};
  for (const m of await l.consultar(
    'SELECT marco, momento FROM marco_ficha_anestesica WHERE ficha_anestesica_id = ? AND marco_vigente IS NOT NULL AND excluido_em IS NULL ORDER BY sequencia',
    [id],
  )) {
    const codigo = texto(m['marco']);
    if (MARCOS_SEM_CONTRATO.includes(codigo)) continue;
    marcos[MARCO_FICHA.doBanco(codigo)] = civil(m['momento'], fuso) ?? '';
  }
  const lancs = await l.consultar(
    `SELECT x.*, u.login FROM lancamento_ficha_anestesica x LEFT JOIN usuario u ON u.id = x.criado_por
      WHERE x.ficha_anestesica_id = ? AND x.excluido_em IS NULL ORDER BY x.momento_inicio, x.sequencia LIMIT 2001`,
    [id],
  );
  const lancamentos: LancamentoDaFicha[] = lancs.slice(0, 2000).map((x) => ({
    id: n(x['id']),
    parte: PARTE_FICHA.doBanco(texto(x['parte'])),
    momento: civil(x['momento_inicio'], fuso) ?? '',
    fim: civil(x['momento_fim'], fuso),
    dados: {
      tipo: nn(x['tipo_sinal_monitorado_id']),
      valor: nn(x['valor_numerico']),
      item: nn(x['insumo_id']),
      dose: nn(x['dose']),
      unidade: nn(x['unidade_medida_id']),
      via: nn(x['via_de_uso_id']),
      continua: verdadeiro(x['infusao_continua']) ? 1 : 0,
      vazao: nn(x['vazao']),
      gas: x['gas'] ? (GAS_CONTRATO[texto(x['gas'])] ?? texto(x['gas'])) : null,
      fluido: x['fluido'] ? texto(x['fluido']).replace(/_/g, '-') : null,
      volumeMl: nn(x['volume_ml']),
      perda: textoOuNulo(x['perda']),
      evento: textoOuNulo(x['evento']),
      modo: nn(x['modo_ventilatorio_id']),
      posicao: nn(x['posicao_cirurgica_id']),
      funcao: nn(x['funcao_equipe_cirurgica_id']),
      descricao: textoOuNulo(x['descricao']),
      resultado: textoOuNulo(x['resultado']),
      quantidade: nn(x['quantidade']),
      observacao: textoOuNulo(x['observacao']),
    },
    profissional: nn(x['profissional_id']),
    usuario: texto(x['login']),
    registradoEm: civil(x['criado_em'], fuso) ?? '',
    balanco: null,
  }));
  const comLogin = (tabela: string, ordem: string) =>
    l.consultar(
      `SELECT x.*, u.login FROM ${tabela} x LEFT JOIN usuario u ON u.id = x.criado_por
        WHERE x.ficha_anestesica_id = ? AND x.excluido_em IS NULL ORDER BY ${ordem}`,
      [id],
    );
  const assinada = f['assinada_em'] !== null && f['assinada_em'] !== undefined;
  return {
    id,
    agendamento,
    sala: n(f['sala_cirurgica_id']),
    dataHora: (civil(f['inicio_previsto_em'] ?? f['entrada_sala_em'], fuso) ?? '').replace(' ', 'T'),
    reg: n(f['atendimento_id']),
    paciente: nn(f['paciente_id']),
    situacao: SITUACAO_FICHA.doBanco(texto(f['situacao'])),
    versao: n(f['versao']),
    abertura: n(f['anestesista_profissional_id']),
    abertaEm: civil(f['criado_em'], fuso) ?? '',
    marcos,
    assinadaPor: assinada
      ? (nn(f['assinada_por_profissional_id']) ?? n(f['anestesista_profissional_id']))
      : null,
    assinadaUsuario: assinada ? textoOuNulo(f['assinante']) : null,
    assinadaEm: civil(f['assinada_em'], fuso),
    hash: textoOuNulo(f['hash_assinatura']),
    registroProntuario: null,
    lancamentos,
    passagens: (await comLogin('passagem_ficha_anestesica', 'x.sequencia')).map((x) => ({
      id: n(x['id']),
      momento: civil(x['momento'], fuso) ?? '',
      de: n(x['de_profissional_id']),
      para: n(x['para_profissional_id']),
      resumo: texto(x['resumo']),
      usuario: texto(x['login']),
    })),
    lacunas: (await comLogin('lacuna_ficha_anestesica', 'x.inicio, x.id')).map((x) => ({
      id: n(x['id']),
      inicio: civil(x['inicio'], fuso) ?? '',
      fim: civil(x['fim'], fuso) ?? '',
      motivo: texto(x['motivo']),
      usuario: texto(x['login']),
    })),
    adendos: (await comLogin('adendo_ficha_anestesica', 'x.sequencia')).map((x) => ({
      id: n(x['id']),
      texto: texto(x['texto']),
      profissional: n(x['profissional_id']),
      usuario: texto(x['login']),
      em: civil(x['criado_em'], fuso) ?? '',
    })),
    truncado: lancs.length > 2000,
  };
}

export class PortaAnestesiaPropria implements PortaAnestesia {
  readonly destino = 'banco' as const;
  private executorCriado: Executor | null;

  constructor(
    private readonly nucleo: Pick<NucleoCirurgia, 'lerSomente'> &
      Partial<Pick<NucleoCirurgia, 'criarExecutor'>>,
    executorPronto?: Executor,
  ) {
    this.executorCriado = executorPronto ?? null;
  }

  /** O Executor nasce na primeira gravação (a porta só de leitura não precisa dele). */
  private get executor(): Executor {
    if (!this.executorCriado) {
      if (!this.nucleo.criarExecutor) throw new Error('Porta sem o núcleo de gravação.');
      this.executorCriado = this.nucleo.criarExecutor();
    }
    return this.executorCriado;
  }

  private ler<T>(c: ContextoPortaM18, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), async (l) => {
      const f = await l.uma<{ fuso_horario: string | null }>(
        'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
        [est],
      );
      return fn(l, est, f?.fuso_horario || FUSO_PADRAO);
    });
  }

  async podeGravar(c: ContextoPortaM18): Promise<LiberacaoGravacao> {
    if (c.estabelecimento === null)
      return { pode: false, codigo: 'sem-estabelecimento', motivo: 'Escolha o estabelecimento da sessão.' };
    return { pode: true, codigo: null, motivo: null };
  }
  executar(_c: ContextoPortaM18, op: string): Promise<never> {
    return Promise.reject(
      recusa('operacao-desconhecida', `Operação ${op} sem gravação pelo Executor na anestesia.`),
    );
  }

  /** Gravação direta da APA, da ficha e da SRPA, pelo Executor, com a trilha e a idempotência na mesma transação. */
  gravarSgh<T>(
    c: ContextoGravacaoCirurgia,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao) | null,
    fn: (g: GravadorAnestesia) => Promise<T>,
  ): Promise<T> {
    return gravarDiretoNoBloco(
      this.executor,
      c,
      {
        nome: 'anestesia.gravacao-direta',
        tabelas: TABELAS_ANESTESIA,
        tabelaPadrao: 'ficha_anestesica',
        trilha,
        gravador: (tx, est, fuso, escrita) => gravadorAnestesia(tx, est, fuso, escrita, fichaDe),
      },
      fn,
    );
  }

  dominios(c: ContextoPortaM18): Promise<DominiosFicha> {
    // Cadastros da rede inteira (sem estabelecimento).
    return this.ler(c, async (l) => {
      const item = async (sql: string) =>
        (await l.consultar(sql)).map((x) => ({
          id: n(x['id']),
          rotulo: texto(x['descricao']),
          sigla: textoOuNulo(x['sigla']),
          ativo: verdadeiro(x['ativo']),
        }));
      return {
        tiposAnestesia: await item(
          'SELECT id, descricao, codigo AS sigla, ativo FROM tipo_anestesia ORDER BY descricao',
        ),
        posicoes: await item(
          'SELECT id, descricao, NULL AS sigla, ativo FROM posicao_cirurgica ORDER BY descricao',
        ),
        modosRespiratorios: await item(
          'SELECT id, descricao, sigla, ativo FROM modo_ventilatorio ORDER BY descricao',
        ),
        funcoesEquipe: await item(
          'SELECT id, descricao, codigo AS sigla, ativo FROM funcao_equipe_cirurgica ORDER BY ordem, descricao',
        ),
        tiposSinal: await item(
          'SELECT id, descricao, sigla, ativo FROM tipo_sinal_monitorado ORDER BY ordem_exibicao, descricao',
        ),
        // Utilização de material na ficha: o cadastro não existe no modelo (pedido do lote 03-01).
        utilizacoes: [],
      };
    });
  }

  contexto(c: ContextoPortaM18, agendamento: number): Promise<ContextoAnestesia | null> {
    return this.ler(c, async (l, est, fuso) => {
      const a = await l.uma(
        `SELECT a.id, a.atendimento_id, a.paciente_id, a.sala_cirurgica_id, a.inicio_previsto_em, a.tipo_anestesia_id,
                (SELECT ap.procedimento_cirurgico_id FROM agendamento_cirurgico_procedimento ap
                  WHERE ap.agendamento_cirurgico_id = a.id AND ap.principal = TRUE AND ap.excluido_em IS NULL LIMIT 1) AS procedimento,
                (SELECT e.profissional_id FROM agendamento_cirurgico_equipe e JOIN funcao_equipe_cirurgica f ON f.id = e.funcao_equipe_cirurgica_id
                  WHERE e.agendamento_cirurgico_id = a.id AND e.excluido_em IS NULL AND f.codigo = 'anestesista' LIMIT 1) AS anestesista,
                (SELECT v.peso_kg FROM avaliacao_pre_anestesica v WHERE v.agendamento_cirurgico_id = a.id AND v.excluido_em IS NULL ORDER BY v.avaliado_em DESC LIMIT 1) AS peso,
                (SELECT v.altura_cm FROM avaliacao_pre_anestesica v WHERE v.agendamento_cirurgico_id = a.id AND v.excluido_em IS NULL ORDER BY v.avaliado_em DESC LIMIT 1) AS altura
           FROM agendamento_cirurgico a WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
        [agendamento, est],
      );
      if (!a) return null;
      // Alergias, exames recentes e medicações vêm do prontuário (outra unidade): ficam vazios aqui, com pedido de porta.
      return {
        agendamento,
        reg: n(a['atendimento_id']),
        atendimento: nn(a['atendimento_id']),
        paciente: nn(a['paciente_id']),
        sala: n(a['sala_cirurgica_id']),
        inicio: civil(a['inicio_previsto_em'], fuso) ?? '',
        procedimento: n(a['procedimento']),
        tipoAnestesiaAgendado: nn(a['tipo_anestesia_id']),
        anestesistaAgendado: nn(a['anestesista']),
        alergias: [],
        pesoKg: nn(a['peso']),
        alturaCm: nn(a['altura']),
        creatinina: null,
        exames: [],
        examesTruncado: false,
        medicacoes: [],
        medicacoesTruncado: false,
      };
    });
  }

  profissional(c: ContextoPortaM18, login: string): Promise<ProfissionalDaSessao | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar(
        `SELECT v.profissional_id, COALESCE(pr.nome_exibicao, pf.nome) AS nome FROM usuario_vinculo_profissional v
           JOIN usuario u ON u.id = v.usuario_id
           JOIN profissional pr ON pr.id = v.profissional_id
           JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
          WHERE u.login = ? AND v.estabelecimento_id = ? AND v.excluido_em IS NULL AND pr.situacao = 'ativo'
            AND v.vigencia_inicio <= CURRENT_DATE AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)`,
        [login, est],
      );
      if (r.length === 0) return null;
      return { nome: textoOuNulo(r[0]?.['nome']), registros: r.map((x) => n(x['profissional_id'])) };
    });
  }

  apas(c: ContextoPortaM18, agendamento: number): Promise<AvaliacaoPreAnestesica[]> {
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          // A versão da APA é a ordem dela entre as avaliações do agendamento (uma linha por versão).
          `SELECT v.*, ca.classe, u.login,
                  (SELECT COUNT(*) FROM avaliacao_pre_anestesica v2 WHERE v2.agendamento_cirurgico_id = v.agendamento_cirurgico_id
                      AND v2.excluido_em IS NULL AND v2.id <= v.id) AS ordem
             FROM avaliacao_pre_anestesica v
             LEFT JOIN classificacao_asa ca ON ca.id = v.classificacao_asa_id
             LEFT JOIN usuario u ON u.id = v.criado_por
            WHERE v.agendamento_cirurgico_id = ? AND v.estabelecimento_id = ? AND v.excluido_em IS NULL
            ORDER BY v.avaliado_em DESC, v.id DESC`,
          [agendamento, est],
        )
      ).map((x) => {
        const tipo = textoOuNulo(x['tipo_ultima_ingestao']);
        const jejum: Record<string, string | null> = Object.fromEntries(INGESTOES.map((t) => [t, null]));
        if (tipo) jejum[camel(tipo)] = (civil(x['ultima_ingestao_em'], fuso) ?? '').replace(' ', 'T') || null;
        const criterios = json(x['criterios_lee']);
        return {
          id: n(x['id']),
          agendamento,
          versao: n(x['ordem']),
          avaliadoEm: civil(x['avaliado_em'], fuso) ?? '',
          profissional: n(x['anestesista_profissional_id']),
          asa: n(x['classe']),
          emergencia: verdadeiro(x['asa_emergencia']),
          pesoKg: nn(x['peso_kg']),
          alturaCm: nn(x['altura_cm']),
          viaAerea: {
            mallampati: nn(x['mallampati']),
            aberturaBucalCm: nn(x['abertura_bucal_cm']),
            distanciaTireomentonianaCm: nn(x['distancia_tireomentoniana_cm']),
            mobilidadeCervicalReduzida: verdadeiro(x['mobilidade_cervical_reduzida']),
            historicoViaAereaDificil: verdadeiro(x['historico_via_aerea_dificil']),
            protesesOuDentesSoltos: verdadeiro(x['proteses_ou_dentes_soltos']),
          },
          jejum,
          criteriosLee: Array.isArray(criterios) ? criterios.map(String) : [],
          leePontos: n(x['indice_lee']),
          alergiasConferidas: verdadeiro(x['alergias_conferidas']),
          comorbidades: textoOuNulo(x['comorbidades']),
          medicacoes: textoOuNulo(x['medicacoes_em_uso']),
          exames: textoOuNulo(x['exames_avaliados']),
          anestesiasAnteriores: textoOuNulo(x['anestesias_anteriores']),
          plano: obj(json(x['plano_estruturado']) ?? { texto: textoOuNulo(x['plano_anestesico']) }),
          tipoAnestesia: n(x['tipo_anestesia_id']),
          conclusao: texto(x['conclusao']).replace(/_/g, '-'),
          ressalvas: textoOuNulo(x['observacao']),
          registroProntuario: null,
          usuario: texto(x['login']),
          criadoEm: civil(x['criado_em'], fuso) ?? '',
        };
      }),
    );
  }

  ficha(c: ContextoPortaM18, agendamento: number): Promise<FichaAnestesica | null> {
    return this.ler(c, (l, est, fuso) => fichaDe(l, est, fuso, agendamento));
  }

  srpa(c: ContextoPortaM18, agendamento: number): Promise<AvaliacaoRecuperacao[]> {
    return this.ler(c, async (l, est, fuso) => (await seriesDe(l, est, fuso, agendamento))[0] ?? []);
  }

  quadroSrpa(c: ContextoPortaM18, desde: string) {
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.consultar(
        `${SQL_SRPA} AND (r.situacao = 'em_recuperacao' OR r.entrada_em >= ?) ORDER BY r.entrada_em LIMIT 201`,
        [est, instante(desde, fuso)],
      );
      return { series: await series(l, fuso, r.slice(0, 200)), truncado: r.length > 200 };
    });
  }

  async situacoes(c: ContextoPortaM18, agendamentos: readonly number[]) {
    const m = new Map<number, { apa: string | null; ficha: string | null; srpa: string | null }>();
    if (agendamentos.length === 0) return m;
    const r = await this.ler(c, (l, est) =>
      l.consultar(
        `SELECT a.id,
                (SELECT v.situacao FROM avaliacao_pre_anestesica v WHERE v.agendamento_cirurgico_id = a.id AND v.excluido_em IS NULL ORDER BY v.avaliado_em DESC LIMIT 1) AS apa,
                (SELECT f.situacao FROM ficha_anestesica f LEFT JOIN ato_cirurgico t ON t.id = f.ato_cirurgico_id
                  WHERE COALESCE(f.agendamento_cirurgico_id, t.agendamento_cirurgico_id) = a.id AND f.excluido_em IS NULL
                  ORDER BY f.id DESC LIMIT 1) AS ficha,
                (SELECT s.situacao FROM registro_recuperacao_anestesica s WHERE s.agendamento_cirurgico_id = a.id AND s.excluido_em IS NULL ORDER BY s.id DESC LIMIT 1) AS srpa
           FROM agendamento_cirurgico a WHERE a.estabelecimento_id = ? AND a.id IN (${lista(agendamentos.length)})`,
        [est, ...agendamentos],
      ),
    );
    for (const x of r)
      m.set(n(x['id']), {
        apa: textoOuNulo(x['apa']),
        ficha: textoOuNulo(x['ficha']),
        srpa: textoOuNulo(x['srpa']),
      });
    return m;
  }
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaAnestesiaIndisponivel(): PortaAnestesia {
  return portaIndisponivel<PortaAnestesia>(METODOS_PORTA_ANESTESIA);
}
