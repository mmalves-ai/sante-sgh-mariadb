// Gravações da farmácia clínica sobre o banco do cliente (M29), dentro da operação do Executor da porta própria (trilha,
// outbox e idempotência na mesma transação): a triagem, a decisão por item prescrito, a intervenção ao prescritor e a
// resposta dele, nas tabelas avaliacao_farmaceutica (cabeçalho por prescrição), avaliacao_farmaceutica_item (parecer
// por item) e intervencao_farmaceutica (proposta e aceite). As regras da tela ficam no domínio
// (conferirDecisaoAvaliacao e conferirRespostaIntervencao); aqui ficam as conferências sob a trava (item do
// estabelecimento, item ainda não avaliado, intervenção ainda aberta, só o prescritor responde).
// Melhoria: a decisão vira o parecer do item (aprovado, recusado) com a justificativa e o farmacêutico que liberou; o
// cabeçalho da avaliação passa de pendente a em avaliação e conclui (aprovada, com intervenção ou reprovada) quando
// todos os itens vigentes da prescrição têm parecer, com o farmacêutico e o tempo de resposta; a intervenção guarda o
// farmacêutico e o prescritor pelo vínculo profissional (não por login em texto) e a recusa exige a justificativa
// também no banco (CHECK); a linha do cabeçalho e a da intervenção são relidas com trava (FOR UPDATE) e alteradas pela
// versão relida (trava otimista).
// Melhoria: a "pendência de revisão médica" é o parecer `revisao_medica` (com justificativa, CHECK do banco). Ela não
// conta como decisão: o item volta a ser decidido depois da revisão do médico (a decisão altera a linha da pendência,
// porque o par avaliação + item é único), e a avaliação só conclui quando todo item vigente tem um parecer final
// (aprovado, com ressalva, recusado ou substituído).
import {
  conferirDecisaoAvaliacao,
  conferirRespostaIntervencao,
  type DecisaoAvaliacao,
  type RecusaSuprimentos,
  type TipoIntervencao,
} from '@sgh/contratos/regras-suprimentos';
import { type EventoOperacao, recusa, type TxOperacao } from '@sgh/nucleo';
import { liberarDosesPorEvento, TABELA_INTEGRACAO_DOSE } from './integracao-prescricao.js';
import type { GravadorSghFarmacia } from './porta.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

/** As tabelas que a gravação da farmácia clínica declara ao Executor. */
export const TABELAS_AVALIACAO = [
  'avaliacao_farmaceutica',
  'avaliacao_farmaceutica_item',
  'intervencao_farmaceutica',
  // O parecer que aprova libera as doses da regra "na liberação farmacêutica" (integracao-prescricao.ts).
  TABELA_INTEGRACAO_DOSE,
] as const;

/** O que a gravação deixa para a trilha e o outbox da operação (alvo, eventos com só ids e códigos). */
export interface ExtrasGravacaoFarmacia {
  alvo: { tabela: string; id: number | null } | null;
  readonly eventos: EventoOperacao[];
}

function recusar(r: RecusaSuprimentos | null | undefined): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
}

/** Decisão da tela → parecer do item no modelo. */
const PARECER_DA_DECISAO: Readonly<Record<DecisaoAvaliacao, string>> = {
  valido: 'aprovado',
  'nao-aprovado': 'recusado',
  'pendencia-revisao-medica': 'revisao_medica',
};

/** Tipo da intervenção da tela → categoria do cadastro (tipo_intervencao_farmaceutica), quando o código não bate. */
const CATEGORIA_DO_TIPO: Readonly<Record<TipoIntervencao, string>> = {
  'ajuste-dose': 'dose',
  'troca-via': 'via',
  suspensao: 'outra',
  substituicao: 'troca_padronizado',
  alergia: 'alergia',
  duplicidade: 'duplicidade',
  outra: 'outra',
};

interface ItemPrescrito {
  readonly id: number;
  readonly prescricao: number;
  readonly atendimento: number;
  readonly paciente: number;
  readonly prescritor: number | null;
}

interface Cabecalho {
  readonly id: number;
  situacao: string;
  versao: number;
}

/** A gravação da farmácia clínica numa transação do Executor (estabelecimento e usuário da sessão). */
export function gravadorAvaliacao(
  tx: TxOperacao,
  est: number,
  usuario: number,
  extras: ExtrasGravacaoFarmacia,
): Pick<GravadorSghFarmacia, 'triar' | 'decidir' | 'intervir' | 'responder'> {
  const agora = () => new Date();

  /** O profissional vinculado ao usuário no estabelecimento (vínculo vigente mais recente). */
  const profissionalDe = async (u: number): Promise<number | null> => {
    const r = await tx.uma<Linha>(
      `SELECT profissional_id FROM usuario_vinculo_profissional
        WHERE usuario_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND profissional_id IS NOT NULL
          AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
        ORDER BY vigencia_inicio DESC LIMIT 1`,
      [u, est],
    );
    return r ? n(r['profissional_id']) : null;
  };

  /** O login vinculado ao profissional no estabelecimento (o prescritor que responde). */
  const loginDoProfissional = async (p: number | null): Promise<string | null> => {
    if (p === null) return null;
    const r = await tx.uma<Linha>(
      `SELECT u.login FROM usuario_vinculo_profissional uv JOIN usuario u ON u.id = uv.usuario_id
        WHERE uv.profissional_id = ? AND uv.estabelecimento_id = ? AND uv.excluido_em IS NULL
        ORDER BY uv.vigencia_inicio DESC LIMIT 1`,
      [p, est],
    );
    return r ? String(r['login']) : null;
  };

  /** O item prescrito do estabelecimento da sessão (a prescrição travada: as gravações dela se enfileiram aqui). */
  const itemPrescrito = async (item: number): Promise<ItemPrescrito> => {
    const [r] = await tx.consultarParaAtualizar<Linha>(
      `SELECT pi.id, pi.prescricao_id, p.atendimento_id, p.paciente_id, p.prescritor_profissional_id
         FROM prescricao_item pi JOIN prescricao p ON p.id = pi.prescricao_id
        WHERE pi.id = ? AND p.estabelecimento_id = ? AND pi.excluido_em IS NULL AND p.excluido_em IS NULL`,
      [item, est],
    );
    if (!r)
      throw recusa('item-inexistente', 'O item da prescrição não existe neste estabelecimento.', {
        campos: ['item'],
      });
    return {
      id: n(r['id']),
      prescricao: n(r['prescricao_id']),
      atendimento: n(r['atendimento_id']),
      paciente: n(r['paciente_id']),
      prescritor: r['prescritor_profissional_id'] === null ? null : n(r['prescritor_profissional_id']),
    };
  };

  const jaAvaliado = async (item: number): Promise<boolean> =>
    !!(await tx.uma(
      `SELECT ai.id FROM avaliacao_farmaceutica_item ai
         JOIN avaliacao_farmaceutica a ON a.id = ai.avaliacao_farmaceutica_id
        WHERE ai.prescricao_item_id = ? AND a.estabelecimento_id = ? AND ai.excluido_em IS NULL AND a.excluido_em IS NULL
          AND ai.parecer <> 'revisao_medica'
        LIMIT 1`,
      [item, est],
    ));

  /** O cabeçalho mais recente da prescrição, travado; `aberto` só aceita pendente ou em avaliação. */
  const cabecalhoDa = async (prescricao: number, aberto: boolean): Promise<Cabecalho | null> => {
    const [r] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, situacao, versao FROM avaliacao_farmaceutica
        WHERE prescricao_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
          ${aberto ? "AND situacao IN ('pendente','em_avaliacao')" : ''}
        ORDER BY id DESC LIMIT 1`,
      [prescricao, est],
    );
    return r ? { id: n(r['id']), situacao: String(r['situacao']), versao: n(r['versao']) } : null;
  };

  /** O cabeçalho aberto da prescrição, criado pendente se faltar (a chegada à fila da farmácia). */
  const garantirCabecalho = async (i: ItemPrescrito): Promise<{ c: Cabecalho; novo: boolean }> => {
    const c = await cabecalhoDa(i.prescricao, true);
    if (c) return { c, novo: false };
    const id = await tx.incluir('avaliacao_farmaceutica', {
      estabelecimento_id: est,
      prescricao_id: i.prescricao,
      atendimento_id: i.atendimento,
      paciente_id: i.paciente,
      situacao: 'pendente',
      recebida_em: agora(),
    });
    return { c: { id, situacao: 'pendente', versao: 1 }, novo: true };
  };

  const proximaSequencia = async (
    tabela: 'avaliacao_farmaceutica_item' | 'intervencao_farmaceutica',
    cab: number,
  ) => {
    const r = await tx.uma<Linha>(
      tabela === 'avaliacao_farmaceutica_item'
        ? 'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM avaliacao_farmaceutica_item WHERE avaliacao_farmaceutica_id = ?'
        : 'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM intervencao_farmaceutica WHERE avaliacao_farmaceutica_id = ?',
      [cab],
    );
    return n(r?.['s']);
  };

  /** Grava o parecer do item e anda com o cabeçalho (em avaliação; concluída quando todos os itens têm parecer). */
  const registrarParecer = async (
    i: ItemPrescrito,
    c: Cabecalho,
    parecer: string,
    justificativa: string | null,
    farmaceutico: number | null,
  ): Promise<number> => {
    // A pendência de revisão médica do item no mesmo cabeçalho (UNIQUE avaliação + item): a nova decisão altera essa
    // linha (relida com trava, pela versão relida) em vez de incluir outra; a revisão fica na trilha da operação.
    const [revisao] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao FROM avaliacao_farmaceutica_item
        WHERE avaliacao_farmaceutica_id = ? AND prescricao_item_id = ? AND parecer = 'revisao_medica'
          AND excluido_em IS NULL`,
      [c.id, i.id],
    );
    let id: number;
    if (revisao) {
      id = n(revisao['id']);
      await tx.alterar('avaliacao_farmaceutica_item', id, n(revisao['versao']), {
        parecer,
        justificativa,
        liberador_profissional_id: farmaceutico,
        avaliado_em: agora(),
      });
    } else
      id = await tx.incluir('avaliacao_farmaceutica_item', {
        avaliacao_farmaceutica_id: c.id,
        sequencia: await proximaSequencia('avaliacao_farmaceutica_item', c.id),
        prescricao_item_id: i.id,
        parecer,
        justificativa,
        liberador_profissional_id: farmaceutico,
        avaliado_em: agora(),
      });
    if (c.situacao === 'pendente') {
      c.versao = await tx.alterar('avaliacao_farmaceutica', c.id, c.versao, {
        situacao: 'em_avaliacao',
        iniciada_em: agora(),
      });
      c.situacao = 'em_avaliacao';
    }
    // Conclui quando nenhum item vigente da prescrição está sem parecer (e há farmacêutico vinculado para assinar).
    const falta = await tx.uma<Linha>(
      `SELECT COUNT(*) AS n FROM prescricao_item pi
        WHERE pi.prescricao_id = ? AND pi.excluido_em IS NULL AND pi.situacao <> 'cancelado'
          AND NOT EXISTS (SELECT 1 FROM avaliacao_farmaceutica_item ai
                            JOIN avaliacao_farmaceutica a ON a.id = ai.avaliacao_farmaceutica_id
                           WHERE ai.prescricao_item_id = pi.id AND a.estabelecimento_id = ?
                             AND ai.parecer <> 'revisao_medica'
                             AND ai.excluido_em IS NULL AND a.excluido_em IS NULL)`,
      [i.prescricao, est],
    );
    // Uma pendência de revisão médica no cabeçalho o mantém em avaliação (mesmo de item que deixou de ser vigente): a
    // decisão final altera a linha da pendência neste mesmo cabeçalho.
    const revisoes = await tx.uma<Linha>(
      `SELECT COUNT(*) AS n FROM avaliacao_farmaceutica_item
        WHERE avaliacao_farmaceutica_id = ? AND parecer = 'revisao_medica' AND excluido_em IS NULL`,
      [c.id],
    );
    if (n(falta?.['n']) === 0 && n(revisoes?.['n']) === 0 && farmaceutico !== null) {
      const r = await tx.uma<Linha>(
        `SELECT SUM(ai.parecer = 'recusado') AS recusados,
                SUM(ai.parecer IN ('aprovado_com_ressalva','substituido')) AS ressalvas,
                (SELECT COUNT(*) FROM intervencao_farmaceutica iv
                  WHERE iv.avaliacao_farmaceutica_id = ? AND iv.excluido_em IS NULL) AS intervencoes
           FROM avaliacao_farmaceutica_item ai WHERE ai.avaliacao_farmaceutica_id = ? AND ai.excluido_em IS NULL`,
        [c.id, c.id],
      );
      const situacao =
        n(r?.['recusados']) > 0
          ? 'reprovada'
          : n(r?.['ressalvas']) + n(r?.['intervencoes']) > 0
            ? 'aprovada_com_intervencao'
            : 'aprovada';
      c.versao = await tx.alterar('avaliacao_farmaceutica', c.id, c.versao, {
        situacao,
        concluida_em: agora(),
        farmaceutico_profissional_id: farmaceutico,
      });
      c.situacao = situacao;
    }
    // A regra de integração com o estoque (05-SUP linha 7): o parecer que aprova o item libera as doses que esperavam
    // a liberação do farmacêutico. O recusado e o que volta ao médico não liberam nada.
    if (parecer === 'aprovado' || parecer === 'aprovado_com_ressalva')
      await liberarDosesPorEvento(tx, { est, evento: 'liberacao_farmaceutica', quando: agora(), item: i.id });
    return id;
  };

  return {
    async triar(t) {
      const farmaceutico = await profissionalDe(usuario);
      let novos = 0;
      for (const x of t.itens) {
        const i = await itemPrescrito(x.item);
        if (await jaAvaliado(i.id)) continue;
        const { c, novo } = await garantirCabecalho(i);
        if (x.destino === 'automatica') {
          // A regra automática aprova o baixo risco (o parecer registra a regra que aprovou).
          await registrarParecer(
            i,
            c,
            'aprovado',
            `Aprovado pela regra automática (${x.regra}).`.slice(0, 500),
            farmaceutico,
          );
          novos += 1;
        } else if (novo) novos += 1;
        extras.alvo = { tabela: 'avaliacao_farmaceutica', id: c.id };
      }
      extras.eventos.push({ tipo: 'farmacia.avaliacao.triada', carga: { novos } });
      return { novos };
    },

    async decidir(d) {
      const i = await itemPrescrito(d.item);
      recusar(
        conferirDecisaoAvaliacao({
          decisao: d.decisao,
          justificativa: d.justificativa,
          estado: (await jaAvaliado(i.id)) ? 'decidido' : 'pendente',
        }),
      );
      const parecer = PARECER_DA_DECISAO[d.decisao];
      const farmaceutico = await profissionalDe(usuario);
      const { c } = await garantirCabecalho(i);
      const id = await registrarParecer(i, c, parecer, d.justificativa.trim() || null, farmaceutico);
      extras.alvo = { tabela: 'avaliacao_farmaceutica_item', id };
      extras.eventos.push({
        tipo: 'farmacia.avaliacao.decidida',
        carga: { avaliacao: c.id, item: i.id, parecer, situacao: c.situacao },
      });
      return { id };
    },

    async intervir(x) {
      const i = await itemPrescrito(x.item);
      const farmaceutico = await profissionalDe(usuario);
      if (farmaceutico === null)
        throw recusa(
          'sem-vinculo-profissional',
          'O usuário da sessão não tem vínculo profissional no estabelecimento: a intervenção leva o farmacêutico.',
        );
      const tipo = await tx.uma<Linha>(
        `SELECT id FROM tipo_intervencao_farmaceutica
          WHERE ativo = TRUE AND (codigo = ? OR categoria = ?)
          ORDER BY codigo = ? DESC, id LIMIT 1`,
        [x.tipo, CATEGORIA_DO_TIPO[x.tipo], x.tipo],
      );
      if (!tipo)
        throw recusa('dominio-nao-configurado', 'O tipo de intervenção não está cadastrado.', {
          campos: ['tipo'],
        });
      // A intervenção vai à avaliação da prescrição (a aberta, ou a mais recente; cria a pendente se não houver).
      const c = (await cabecalhoDa(i.prescricao, false)) ?? (await garantirCabecalho(i)).c;
      const id = await tx.incluir('intervencao_farmaceutica', {
        avaliacao_farmaceutica_id: c.id,
        sequencia: await proximaSequencia('intervencao_farmaceutica', c.id),
        prescricao_item_id: i.id,
        tipo_intervencao_farmaceutica_id: n(tipo['id']),
        farmaceutico_profissional_id: farmaceutico,
        realizada_em: agora(),
        proposta: x.texto,
        prescritor_profissional_id: i.prescritor,
        aceite: 'pendente',
      });
      extras.alvo = { tabela: 'intervencao_farmaceutica', id };
      extras.eventos.push({
        tipo: 'farmacia.intervencao.registrada',
        carga: { intervencao: id, item: i.id },
      });
      return { id, prescritor: await loginDoProfissional(i.prescritor) };
    },

    async responder(r) {
      const [x] = await tx.consultarParaAtualizar<Linha>(
        `SELECT iv.id, iv.versao, iv.aceite, iv.prescritor_profissional_id, ua.login AS autor
           FROM intervencao_farmaceutica iv
           JOIN avaliacao_farmaceutica a ON a.id = iv.avaliacao_farmaceutica_id
           LEFT JOIN usuario ua ON ua.id = iv.criado_por
          WHERE iv.id = ? AND a.estabelecimento_id = ? AND iv.excluido_em IS NULL AND a.excluido_em IS NULL`,
        [r.id, est],
      );
      if (!x)
        throw recusa('intervencao-inexistente', 'A intervenção não existe.', { campos: ['intervencao'] });
      const prescritor = await loginDoProfissional(
        x['prescritor_profissional_id'] === null ? null : n(x['prescritor_profissional_id']),
      );
      if (!prescritor || prescritor.toUpperCase() !== r.respondente.toUpperCase())
        throw recusa(
          'nao-e-o-prescritor',
          prescritor
            ? 'Só o prescritor do item responde à intervenção.'
            : 'A intervenção não tem prescritor com usuário: responda pelo contato da unidade.',
          { campos: ['intervencao'] },
        );
      const aceite = String(x['aceite']);
      recusar(
        conferirRespostaIntervencao({
          estado: aceite === 'pendente' ? 'aberta' : 'respondida',
          resposta: r.resposta,
          justificativa: r.justificativa,
          respondente: r.respondente,
          autorIntervencao: x['autor'] === null ? '' : String(x['autor']),
        }),
      );
      await tx.alterar('intervencao_farmaceutica', n(x['id']), n(x['versao']), {
        aceite: r.resposta === 'aceita' ? 'aceita' : 'recusada',
        aceite_em: agora(),
        justificativa_recusa: r.resposta === 'recusada' ? r.justificativa.trim().slice(0, 500) : null,
      });
      extras.alvo = { tabela: 'intervencao_farmaceutica', id: n(x['id']) };
      extras.eventos.push({
        tipo: 'farmacia.intervencao.respondida',
        carga: { intervencao: n(x['id']), resposta: r.resposta },
      });
    },
  };
}
