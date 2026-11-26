// Operações da recepção pelo Executor do @sgh/nucleo (F2.2): emitir, chamar e conduzir a senha, registrar e desfazer a
// chegada do agendado, abrir e fechar o guichê. Cada operação declara as tabelas que grava; a trilha, o outbox e a
// idempotência ficam na mesma transação (o Executor). As regras de estado da senha são as do domínio
// (decidirEvento, ordenarFila, @sgh/contratos), nunca do banco.
//
// Melhoria: o número da senha sai do contador do dia do serviço com o serviço travado (FOR UPDATE no gerador), com o
// limite do dia, a numeração máxima e o reinício (diário, semanal, mensal, nunca) do cadastro do serviço.
// Melhoria: o guichê aberto é uma ocupação com início e fim (ocupacao_guiche), sem apagar o histórico; fechar o
// guichê de outra pessoa exige a justificativa, que vai à trilha.
// Melhoria: cada chamada e cada evento da senha publicam um evento de saída (outbox) para os painéis de outras
// instâncias, na mesma transação.
// Melhoria: a chamada da próxima segue a ordem do cadastro do serviço (chegada, prioridade, horário da marcação), com o
// peso do grupo de prioridade legal; o botão do serviço com grupo atribui o grupo à senha emitida (regra-fila.ts).
// Melhoria: a chegada do agendado muda a situação da marcação para a de significado "chegou" e grava o histórico da
// marcação (evento "chegada"); desfazer devolve a situação anterior guardada no histórico. Marcação cancelada, com
// falta, realizada ou em atendimento é recusada com mensagem de negócio.
import {
  decidirEvento,
  esquemaAbrirGuiche,
  esquemaChamarSenha,
  esquemaDesfazerChegada,
  esquemaEmitirSenha,
  esquemaFecharGuiche,
  esquemaRegistrarChegada,
  esquemaRegistrarEventoSenha,
  eventoSenha,
  type EventoSenha,
  MOTIVO_LIBERACAO_DIVERSOS,
  textoDoMotivoSuspensao,
  textoSenha,
} from '@sgh/contratos';
import { grupoDaSenhaAoDesfazer, grupoDaSenhaNaChegada } from '@sgh/dominio-recepcao';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Operacao,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import {
  bool,
  dataIso,
  type EstabelecimentoDaSessao,
  horaCivil,
  num,
  numOuNull,
  senhaPorId,
  txt,
} from './banco.js';
import { grupoDaEmissao, ordemDosServicos, ordenarCandidatas } from './regra-fila.js';
import { encaminhamentoConfiguradoPermite } from '../atendimento/uso-locais-propria.js';
import { CODIGO_DO_GRUPO, senhaNaTela } from './codigos-senha.js';

/** Evento do catálogo e recurso de cada operação (a trilha da memória usa os mesmos). */
export interface MetaOperacao {
  readonly evento: string;
  readonly recurso: string;
}

const inexistente = (titulo: string, detalhe: string) =>
  new ErroOperacao(404, 'registro-inexistente', titulo, detalhe);

function contexto(ctx: ContextoOperacao): { estabelecimento: number; usuario: number } {
  if (ctx.estabelecimento === null || ctx.usuario === null)
    throw recusa(
      'contexto-incompleto',
      'A gravação da recepção pede o estabelecimento e o usuário da sessão.',
    );
  return { estabelecimento: ctx.estabelecimento, usuario: ctx.usuario };
}

async function estabelecimento(
  tx: TxOperacao,
  id: number,
): Promise<EstabelecimentoDaSessao & { hoje: string }> {
  const e = await tx.uma(
    'SELECT id, fuso_horario FROM estabelecimento WHERE id = ? AND excluido_em IS NULL',
    [id],
  );
  if (!e) throw recusa('estabelecimento-inexistente', 'O estabelecimento da sessão não existe.');
  const fuso = txt(e['fuso_horario']) || 'America/Sao_Paulo';
  return { id, fuso, hoje: horaCivil(new Date(), fuso).slice(0, 10) };
}

async function acaoFluxo(tx: TxOperacao, codigo: string): Promise<number> {
  const a = await tx.uma('SELECT id FROM acao_fluxo_senha WHERE codigo = ? AND ativo = TRUE', [codigo]);
  if (!a)
    throw recusa(
      'acao-fluxo-nao-cadastrada',
      `A ação "${codigo}" do fluxo da senha não está cadastrada: peça ao administrador para cadastrá-la.`,
    );
  return num(a['id']);
}

async function exigirLocal(tx: TxOperacao, est: number, local: number, recepcao: number): Promise<void> {
  const l = await tx.uma(
    `SELECT l.ponto_recepcao_id, l.ativo FROM local_atendimento l
      WHERE l.id = ? AND l.estabelecimento_id = ? AND l.excluido_em IS NULL`,
    [local, est],
  );
  if (!l) throw recusa('local-inexistente', 'O local de atendimento não existe.');
  if (num(l['ponto_recepcao_id']) !== recepcao)
    throw recusa('local-de-outra-recepcao', 'O local escolhido não pertence a esta recepção.');
  if (!bool(l['ativo'])) throw recusa('local-inativo', 'O local de atendimento está inativo.');
}

async function guicheCadastrado(
  tx: TxOperacao,
  est: number,
  recepcao: number,
  numero: number,
): Promise<number> {
  const g = await tx.uma(
    `SELECT gr.id FROM guiche_recepcao gr JOIN ponto_recepcao p ON p.id = gr.ponto_recepcao_id
      WHERE gr.ponto_recepcao_id = ? AND gr.numero = ? AND p.estabelecimento_id = ?
        AND gr.excluido_em IS NULL AND gr.ativo = TRUE AND p.excluido_em IS NULL`,
    [recepcao, numero, est],
  );
  if (!g)
    throw recusa(
      'guiche-nao-cadastrado',
      'Este número de guichê não está cadastrado nesta recepção: escolha um dos guichês da recepção.',
    );
  return num(g['id']);
}

interface Ocupacao {
  readonly id: number;
  readonly versao: number;
  readonly ocupante: number;
  readonly local: number | null;
}

async function ocupacoesAbertas(tx: TxOperacao, guiche: number): Promise<Ocupacao[]> {
  const ls = await tx.consultarParaAtualizar(
    'SELECT id, versao, ocupante_usuario_id, local_atendimento_id FROM ocupacao_guiche WHERE guiche_recepcao_id = ? AND fim_em IS NULL',
    [guiche],
  );
  return ls.map((x) => ({
    id: num(x['id']),
    versao: num(x['versao']),
    ocupante: num(x['ocupante_usuario_id']),
    local: numOuNull(x['local_atendimento_id']),
  }));
}

/** O guichê aberto por quem grava, no local pedido; devolve o id do guichê. */
async function exigirMeuGuiche(
  tx: TxOperacao,
  est: number,
  g: { recepcao: number; local: number; guiche: number },
  usuario: number,
): Promise<number> {
  const id = await guicheCadastrado(tx, est, g.recepcao, g.guiche);
  const ocupacao = await ocupacoesAbertas(tx, id);
  if (ocupacao.some((y) => y.ocupante !== usuario))
    throw recusa('guiche-de-outro', 'Este guichê está aberto por outra pessoa.');
  const meu = ocupacao.find((y) => y.ocupante === usuario);
  if (!meu) throw recusa('guiche-fechado', 'Abra o guichê antes de chamar ou conduzir senhas.');
  if (meu.local !== g.local)
    throw recusa('guiche-de-outro-local', 'Este guichê está aberto em outro local da recepção.');
  return id;
}

async function registrarEvento(
  tx: TxOperacao,
  r: {
    senha: number;
    acao: number;
    local: number;
    guiche: number | null;
    destino?: number | null;
    usuario: number;
  },
): Promise<number> {
  return tx.incluir('evento_senha', {
    senha_emitida_id: r.senha,
    operacao: 'inclusao',
    ocorrido_em: new Date(),
    usuario_id: r.usuario,
    acao_fluxo_senha_id: r.acao,
    local_atendimento_id: r.local,
    guiche_recepcao_id: r.guiche,
    destino_local_atendimento_id: r.destino ?? null,
  });
}

function senhaInexistente(): never {
  throw inexistente('Senha não encontrada', 'A senha não existe mais.');
}

// ── recepcao.emitirSenha ─────────────────────────────────────────────────────────────────────────

/** Primeiro dia do período de numeração do serviço (reinício). */
function inicioDoPeriodo(hoje: string, reinicio: string): string | null {
  if (reinicio === 'nunca') return null;
  if (reinicio === 'mensal') return `${hoje.slice(0, 8)}01`;
  if (reinicio === 'semanal') {
    const d = new Date(`${hoje}T00:00:00Z`);
    const recuo = (d.getUTCDay() + 6) % 7; // segunda-feira
    return new Date(d.getTime() - recuo * 86_400_000).toISOString().slice(0, 10);
  }
  return hoje;
}

const emitirSenha = definirOperacao({
  nome: 'recepcao.emitir_senha',
  tabelas: ['senha_emitida'],
  entrada: esquemaEmitirSenha,
  async gravar(tx, e, ctx) {
    const { estabelecimento: idEst, usuario } = contexto(ctx);
    const est = await estabelecimento(tx, idEst);
    const [g] = await tx.consultarParaAtualizar(
      `SELECT g.id, g.prefixo, g.tipo, g.ativo, g.gera_prioritaria, g.limite_dia, g.numero_inicial, g.numero_maximo,
              g.reinicio, g.ponto_recepcao_id, gb.id AS grupo_botao
         FROM gerador_senha g JOIN ponto_recepcao p ON p.id = g.ponto_recepcao_id
         LEFT JOIN grupo_prioridade_legal gb ON gb.id = g.grupo_prioridade_legal_id AND gb.ativo = TRUE
        WHERE g.id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL`,
      [e.gerador, est.id],
      { teto: 1 },
    );
    if (!g) throw inexistente('Serviço não encontrado', 'O gerador de senha não existe mais.');
    if (!bool(g['ativo'])) throw recusa('gerador-inativo', 'O serviço está inativo: escolha outro.');
    if (e.prioridade !== '2' && !bool(g['gera_prioritaria']))
      throw recusa(
        'prioridade-nao-oferecida',
        'Este serviço não emite senha prioritária: escolha o serviço de prioridade da recepção.',
      );
    const grupoContrato = e.prioridade === '2' ? null : (e.grupo ?? (e.prioridade === '0' ? 0 : 1));
    let escolhido: number | null = null;
    if (grupoContrato !== null) {
      const codigo = CODIGO_DO_GRUPO[grupoContrato];
      const gp = codigo
        ? await tx.uma('SELECT id FROM grupo_prioridade_legal WHERE codigo = ? AND ativo = TRUE', [codigo])
        : null;
      if (!gp)
        throw recusa(
          'grupo-prioridade-nao-cadastrado',
          'O grupo de prioridade escolhido não está cadastrado no estabelecimento.',
        );
      escolhido = num(gp['id']);
    }
    const grupo = grupoDaEmissao(escolhido, numOuNull(g['grupo_botao']));
    const limite = numOuNull(g['limite_dia']) ?? 0;
    if (limite > 0 && !e.forcarLimite) {
      const c = await tx.uma(
        'SELECT COUNT(*) AS n FROM senha_emitida WHERE gerador_senha_id = ? AND data_referencia = ? AND excluido_em IS NULL',
        [e.gerador, est.hoje],
      );
      if (num(c?.['n']) >= limite)
        throw recusa('limite-do-dia', `O serviço chegou ao limite de ${limite} senhas do dia.`);
    }
    const inicio = inicioDoPeriodo(est.hoje, txt(g['reinicio']) || 'diario');
    const ultimo = await tx.uma(
      `SELECT MAX(numero) AS n FROM senha_emitida WHERE gerador_senha_id = ?${inicio ? ' AND data_referencia >= ?' : ''}`,
      inicio ? [e.gerador, inicio] : [e.gerador],
    );
    const numero = Math.max(num(g['numero_inicial']), (numOuNull(ultimo?.['n']) ?? 0) + 1);
    const maximo = numOuNull(g['numero_maximo']);
    if (maximo !== null && numero > maximo)
      throw recusa('numeracao-esgotada', 'O serviço chegou ao número máximo de senhas do período.');
    const totem = e.origem === 'totem';
    const id = await tx.incluir('senha_emitida', {
      estabelecimento_id: est.id,
      gerador_senha_id: e.gerador,
      data_referencia: est.hoje,
      numero,
      codigo_exibicao: textoSenha(txt(g['prefixo']), numero).slice(0, 12),
      prioritaria: grupo !== null,
      grupo_prioridade_legal_id: grupo,
      situacao: 'aguardando',
      emitida_em: new Date(),
      emitida_usuario_id: totem ? null : usuario,
    });
    return { senha: id, numero, gerador: e.gerador };
  },
  alvo: (_e, r) => ({ tabela: 'senha_emitida', id: r.senha }),
});

// ── recepcao.chamarSenha ─────────────────────────────────────────────────────────────────────────

const chamarSenha = definirOperacao({
  nome: 'recepcao.chamar_senha',
  tabelas: ['senha_emitida', 'evento_senha'],
  entrada: esquemaChamarSenha,
  async gravar(tx, e, ctx) {
    const { estabelecimento: idEst, usuario } = contexto(ctx);
    const est = await estabelecimento(tx, idEst);
    await exigirLocal(tx, est.id, e.local, e.recepcao);
    const guiche = await exigirMeuGuiche(tx, est.id, e, usuario);
    const geradores = await tx.consultar(
      `SELECT id, ponto_recepcao_id, ordem_lista FROM gerador_senha WHERE id IN (${e.geradores.map(() => '?').join(', ')})`,
      e.geradores,
    );
    if (
      geradores.length !== e.geradores.length ||
      geradores.some((g) => num(g['ponto_recepcao_id']) !== e.recepcao)
    )
      throw recusa('gerador-de-outra-recepcao', 'Um dos serviços escolhidos não é desta recepção.');
    const livres = await tx.consultar(
      `SELECT s.id, s.numero, s.emitida_em, s.prioritaria, gp.peso AS peso_grupo,
              (SELECT MIN(h.inicio_em) FROM senha_emitida_marcacao sm
                 JOIN marcacao_horario mh ON mh.id = sm.marcacao_horario_id
                 JOIN horario_agenda h ON h.id = mh.horario_agenda_id
                WHERE sm.senha_emitida_id = s.id AND sm.excluido_em IS NULL) AS horario_marcacao
         FROM senha_emitida s LEFT JOIN grupo_prioridade_legal gp ON gp.id = s.grupo_prioridade_legal_id
        WHERE s.estabelecimento_id = ? AND s.data_referencia = ? AND s.situacao = 'aguardando'
          AND s.guiche_recepcao_id IS NULL AND s.excluido_em IS NULL
          AND s.gerador_senha_id IN (${e.geradores.map(() => '?').join(', ')})
          AND NOT EXISTS (SELECT 1 FROM atendimento_senha a WHERE a.senha_emitida_id = s.id AND a.excluido_em IS NULL)`,
      [est.id, est.hoje, ...e.geradores],
      { teto: 5_000 },
    );
    let alvo: number;
    if (e.senha) {
      const x = await senhaPorId(tx, est, e.senha);
      if (!x) senhaInexistente();
      if (x.atendida) throw recusa('senha-em-atendimento', 'A senha já tem atendimento aberto.');
      if (!x.emitidaEm.startsWith(est.hoje)) throw recusa('senha-de-outro-dia', 'A senha não é de hoje.');
      if (!livres.some((l) => num(l['id']) === e.senha))
        throw recusa('senha-ja-chamada', 'A senha já foi chamada, suspensa ou concluída.');
      alvo = e.senha;
    } else {
      const recentes = await tx.consultar(
        `SELECT s.prioritaria FROM evento_senha ev
           JOIN acao_fluxo_senha a ON a.id = ev.acao_fluxo_senha_id AND a.codigo = 'chamar'
           JOIN senha_emitida s ON s.id = ev.senha_emitida_id
          WHERE ev.guiche_recepcao_id = ? AND ev.local_atendimento_id = ? AND s.data_referencia = ?
          ORDER BY ev.ocorrido_em DESC, ev.id DESC LIMIT 20`,
        [guiche, e.local, est.hoje],
      );
      const ordem = ordemDosServicos(geradores.map((g) => txt(g['ordem_lista'])));
      if (!ordem.ok) throw recusa(ordem.codigo, ordem.motivo);
      let seguidas = 0;
      for (const r of recentes) {
        if (!bool(r['prioritaria'])) break;
        seguidas++;
      }
      const fila = ordenarCandidatas(
        livres.map((l) => ({
          id: num(l['id']),
          emitidaEm: (l['emitida_em'] as Date).toISOString(),
          prioritaria: bool(l['prioritaria']),
          pesoGrupo: numOuNull(l['peso_grupo']),
          horarioMarcacao: l['horario_marcacao'] ? (l['horario_marcacao'] as Date).toISOString() : null,
        })),
        ordem.ordem,
        { prioritariasSeguidas: seguidas },
      );
      if (!fila[0]) throw recusa('fila-vazia', 'Não há senha aguardando nos serviços deste guichê.');
      alvo = fila[0].id;
    }
    const [trava] = await tx.consultarParaAtualizar(
      "SELECT id, versao, situacao, guiche_recepcao_id FROM senha_emitida WHERE id = ? AND situacao = 'aguardando' AND guiche_recepcao_id IS NULL",
      [alvo],
      { teto: 1 },
    );
    if (!trava)
      throw recusa('senha-ja-chamada', 'A senha acabou de ser chamada por outro guichê: chame a próxima.');
    const linha = await tx.uma('SELECT chamadas FROM senha_emitida WHERE id = ?', [alvo]);
    await tx.alterar('senha_emitida', alvo, num(trava['versao']), {
      situacao: 'chamada',
      guiche_recepcao_id: guiche,
      local_atendimento_id: e.local,
      chamadas: num(linha?.['chamadas']) + 1,
    });
    await registrarEvento(tx, {
      senha: alvo,
      acao: await acaoFluxo(tx, 'chamar'),
      local: e.local,
      guiche,
      usuario,
    });
    return {
      senha: alvo,
      numero: num(livres.find((l) => num(l['id']) === alvo)?.['numero']),
      guiche: e.guiche,
    };
  },
  eventos: (_e, r) => [{ tipo: 'recepcao.senha_chamada', carga: { senha: r.senha, guiche: r.guiche } }],
  alvo: (_e, r) => ({ tabela: 'senha_emitida', id: r.senha }),
});

// ── recepcao.registrarEventoSenha ────────────────────────────────────────────────────────────────

/** Ação do fluxo gravada por evento (o código do cadastro acao_fluxo_senha). */
const ACAO_DO_EVENTO: Readonly<Record<string, string>> = {
  rechamar: 'chamar',
  retomar: 'chamar',
  chamarNoLocal: 'chamar',
  liberar: 'liberar',
  liberarDoLocal: 'liberar',
  suspender: 'suspender',
  naoLocalizado: 'nao_localizado',
  naoLocalizadoNoLocal: 'nao_localizado',
  cancelarChamada: 'cancelar_chamada',
  encaminhar: 'encaminhar',
};

const NO_GUICHE: readonly string[] = ['rechamar', 'retomar', 'liberar', 'suspender', 'naoLocalizado'];

const registrarEventoSenha = definirOperacao({
  nome: 'recepcao.registrar_evento_senha',
  tabelas: ['senha_emitida', 'evento_senha'],
  entrada: esquemaRegistrarEventoSenha,
  async gravar(tx, e, ctx) {
    const { estabelecimento: idEst, usuario } = contexto(ctx);
    if (e.evento === 'chamarNoLocal' || e.evento === 'liberarDoLocal')
      throw recusa(
        'evento-do-fluxo-do-local',
        'Este evento é registrado pela tela do fluxo do paciente por local de atendimento.',
      );
    const est = await estabelecimento(tx, idEst);
    const [trava] = await tx.consultarParaAtualizar(
      'SELECT id, versao, chamadas FROM senha_emitida WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.senha, est.id],
      { teto: 1 },
    );
    if (!trava) senhaInexistente();
    const x = await senhaPorId(tx, est, e.senha);
    if (!x) senhaInexistente();
    if (!x.emitidaEm.startsWith(est.hoje)) throw recusa('senha-de-outro-dia', 'A senha não é de hoje.');
    const noGuiche = NO_GUICHE.includes(e.evento);
    let meuGuiche: number | null = null;
    if (noGuiche)
      meuGuiche = await exigirMeuGuiche(
        tx,
        est.id,
        { recepcao: x.recepcao, local: e.local, guiche: e.guiche },
        usuario,
      );
    // As regras de estado são as do contrato (decidirEvento), sobre a senha traduzida para ele.
    const t = senhaNaTela(x);
    const d = decidirEvento(
      { situacao: t.situacao, guiche: t.guiche, atendida: x.atendida, tipoGerador: t.tipoGerador },
      e.evento as EventoSenha,
      noGuiche ? e.guiche : 0,
    );
    if (!d.ok) throw recusa(d.codigo, d.motivo);
    if (e.evento === 'encaminhar') {
      // O destino tem de estar entre os que a configuração do local de origem permite (02-REC 34): a lista do
      // cadastro, só locais ativos da mesma recepção, e a origem tem de encaminhar.
      if (!e.destino || !(await encaminhamentoConfiguradoPermite(tx, est.id, e.local, e.destino)))
        throw recusa('destino-nao-permitido', 'Este local não encaminha para o destino escolhido.');
    }
    const ef = d.efeito;
    const valores: Record<string, unknown> = {};
    if (ef.situacao) {
      valores['situacao'] = ef.situacao;
      if (ef.situacao === 'atendida') valores['encerrada_em'] = new Date();
    }
    if (ef.guiche === 'zero') valores['guiche_recepcao_id'] = null;
    if (ef.guiche === 'meu') valores['guiche_recepcao_id'] = meuGuiche;
    if (ef.motivo)
      valores['motivo_complemento'] =
        ef.motivo === 'diversos'
          ? MOTIVO_LIBERACAO_DIVERSOS
          : ef.motivo === 'nao-localizado'
            ? textoDoMotivoSuspensao('NAO-LOCALIZADO')
            : textoDoMotivoSuspensao(e.motivo ?? 'OUTRO', e.complemento);
    if (e.evento === 'rechamar' || e.evento === 'retomar') {
      valores['chamadas'] = num(trava['chamadas']) + 1;
      valores['local_atendimento_id'] = e.local;
    }
    if (e.evento === 'encaminhar') valores['local_atendimento_id'] = e.destino;
    if (Object.keys(valores).length > 0)
      await tx.alterar('senha_emitida', e.senha, num(trava['versao']), valores);
    const fluxo = await registrarEvento(tx, {
      senha: e.senha,
      acao: await acaoFluxo(tx, ACAO_DO_EVENTO[e.evento] ?? eventoSenha(e.evento)?.codigo ?? e.evento),
      local: e.local,
      guiche: noGuiche ? meuGuiche : null,
      destino: e.evento === 'encaminhar' ? (e.destino ?? null) : null,
      usuario,
    });
    return { senha: e.senha, fluxo };
  },
  eventos: (e, r) => [{ tipo: 'recepcao.senha_conduzida', carga: { senha: r.senha, evento: e.evento } }],
  alvo: (_e, r) => ({ tabela: 'senha_emitida', id: r.senha }),
});

// ── recepcao.registrarChegada / recepcao.desfazerChegada ─────────────────────────────────────────

/** Recusa da chegada pela situação atual da marcação (significado do cadastro). */
const RECUSA_DA_SITUACAO: Readonly<Record<string, readonly [string, string]>> = {
  cancelada: ['marcacao-cancelada', 'O agendamento foi cancelado: não há chegada a registrar.'],
  falta: [
    'marcacao-com-falta',
    'O agendamento tem falta registrada: desfaça a falta na agenda antes da chegada.',
  ],
  realizada: ['marcacao-realizada', 'O agendamento já foi realizado.'],
  em_atendimento: ['marcacao-em-atendimento', 'O agendamento já está em atendimento.'],
  chegou: ['marcacao-ja-chegou', 'A chegada deste agendamento já foi registrada.'],
  bloqueada: ['marcacao-bloqueada', 'O horário do agendamento está bloqueado.'],
  nao_informada: ['marcacao-nao-informada', 'Marcação migrada sem situação na origem: encerrada.'],
};

async function situacaoChegou(tx: TxOperacao): Promise<number> {
  const s = await tx.uma(
    "SELECT id FROM situacao_marcacao WHERE significado = 'chegou' AND ativo = TRUE ORDER BY ordem, id LIMIT 1",
  );
  if (!s)
    throw recusa(
      'situacao-marcacao-nao-cadastrada',
      'Não há situação de marcação com o significado "chegou" no cadastro: peça ao administrador para cadastrá-la.',
    );
  return num(s['id']);
}

const registrarChegada = definirOperacao({
  nome: 'recepcao.registrar_chegada',
  tabelas: ['senha_emitida_marcacao', 'marcacao_horario', 'marcacao_horario_historico', 'senha_emitida'],
  entrada: esquemaRegistrarChegada,
  async gravar(tx, e, ctx) {
    const { estabelecimento: idEst, usuario } = contexto(ctx);
    const est = await estabelecimento(tx, idEst);
    const [trava] = await tx.consultarParaAtualizar(
      `SELECT s.id, s.versao, s.paciente_id, s.grupo_prioridade_legal_id, gs.peso AS grupo_peso, gs.ativo AS grupo_ativo
         FROM senha_emitida s LEFT JOIN grupo_prioridade_legal gs ON gs.id = s.grupo_prioridade_legal_id
        WHERE s.id = ? AND s.estabelecimento_id = ? AND s.excluido_em IS NULL`,
      [e.senha, est.id],
      { teto: 1 },
    );
    if (!trava) senhaInexistente();
    const x = await senhaPorId(tx, est, e.senha);
    if (!x) senhaInexistente();
    if (!x.emitidaEm.startsWith(est.hoje)) throw recusa('senha-de-outro-dia', 'A senha não é de hoje.');
    if (x.atendida) throw recusa('senha-em-atendimento', 'A senha já tem atendimento aberto.');
    if (x.agendamento) throw recusa('senha-ja-ligada', 'A senha já está ligada a um agendamento.');
    if (x.situacao === 'atendida' || x.situacao === 'cancelada')
      throw recusa('senha-concluida', 'A senha já foi concluída.');
    if (x.tipoServico !== 'atendimento')
      throw recusa(
        'senha-de-servico-diverso',
        'A chegada do agendado é registrada numa senha de recepção, não de serviços diversos: emita a senha da recepção.',
      );
    const [m] = await tx.consultarParaAtualizar(
      `SELECT m.id, m.versao, m.paciente_id, m.pre_cadastro_id, m.chegada_em, m.situacao_marcacao_id, sm.significado,
              h.data_referencia, t.natureza, m.grupo_prioridade_legal_id, gm.peso AS grupo_peso, gm.ativo AS grupo_ativo
         FROM marcacao_horario m JOIN horario_agenda h ON h.id = m.horario_agenda_id
         JOIN tipo_marcacao t ON t.id = m.tipo_marcacao_id
         JOIN situacao_marcacao sm ON sm.id = m.situacao_marcacao_id
         LEFT JOIN grupo_prioridade_legal gm ON gm.id = m.grupo_prioridade_legal_id
        WHERE m.id = ? AND m.estabelecimento_id = ? AND m.excluido_em IS NULL`,
      [e.marcacao, est.id],
      { teto: 1 },
    );
    if (!m || (txt(m['natureza']) === 'exame') !== (e.tipo === 'exame'))
      throw recusa('marcacao-inexistente', 'O agendamento não existe mais.');
    if (dataIso(m['data_referencia']) !== est.hoje)
      throw recusa('marcacao-de-outro-dia', 'O agendamento não é de hoje.');
    const recusada = RECUSA_DA_SITUACAO[txt(m['significado'])];
    if (recusada) throw recusa(recusada[0], recusada[1]);
    // 02-AGE 42 e 44: a marcação feita sem prontuário só tem chegada depois da conversão do pré-cadastro em paciente
    // (a conversão passa as marcações ao paciente na mesma transação): sem isso a senha e o atendimento ficariam
    // sem paciente e a recepção abriria um cadastro duplicado.
    if (m['paciente_id'] === null && m['pre_cadastro_id'] !== null)
      throw recusa(
        'pre-cadastro-a-converter',
        'A marcação foi feita sem prontuário: converta o pré-cadastro em paciente antes de registrar a chegada.',
      );
    const ligada = await tx.uma(
      'SELECT id FROM senha_emitida_marcacao WHERE marcacao_horario_id = ? AND excluido_em IS NULL',
      [e.marcacao],
    );
    if (ligada || m['chegada_em'] !== null)
      throw recusa('marcacao-ja-chegou', 'A chegada deste agendamento já foi registrada.');
    const chegou = await situacaoChegou(tx);
    // 02-AGE 49: o grupo de prioridade legal escolhido na marcação segue o paciente na senha (regra do domínio: o
    // mais forte vence; grupo desativado não vale). O grupo anterior da senha fica no histórico para o desfazer.
    const grupoLegal = (r: Record<string, unknown>) =>
      r['grupo_prioridade_legal_id'] === null
        ? null
        : {
            id: num(r['grupo_prioridade_legal_id']),
            peso: num(r['grupo_peso']),
            ativo: bool(r['grupo_ativo']),
          };
    const prioridade = grupoDaSenhaNaChegada({ senha: grupoLegal(trava), marcacao: grupoLegal(m) });
    const grupoAnterior = numOuNull(trava['grupo_prioridade_legal_id']);
    const agora = new Date();
    await tx.incluir('senha_emitida_marcacao', {
      senha_emitida_id: e.senha,
      marcacao_horario_id: e.marcacao,
    });
    await tx.alterar('marcacao_horario', e.marcacao, num(m['versao']), {
      chegada_em: agora,
      situacao_marcacao_id: chegou,
    });
    await tx.incluir('marcacao_horario_historico', {
      marcacao_horario_id: e.marcacao,
      operacao: 'alteracao',
      evento: 'chegada',
      situacao_marcacao_id: chegou,
      dados: JSON.stringify({
        situacao_marcacao_id: chegou,
        situacao_anterior_id: num(m['situacao_marcacao_id']),
        chegada_em: agora.toISOString(),
        senha_emitida_id: e.senha,
        ...(prioridade.mudou
          ? { senha_grupo_anterior_id: grupoAnterior, senha_grupo_aplicado_id: prioridade.grupo }
          : {}),
      }),
      ocorrido_em: agora,
      usuario_id: usuario,
    });
    const naSenha: Record<string, unknown> = {};
    if (trava['paciente_id'] === null && m['paciente_id'] !== null)
      naSenha['paciente_id'] = num(m['paciente_id']);
    if (prioridade.mudou) {
      naSenha['grupo_prioridade_legal_id'] = prioridade.grupo;
      naSenha['prioritaria'] = prioridade.grupo !== null;
    }
    if (Object.keys(naSenha).length)
      await tx.alterar('senha_emitida', e.senha, num(trava['versao']), naSenha);
    return { senha: e.senha, marcacao: e.marcacao };
  },
  alvo: (_e, r) => ({ tabela: 'senha_emitida_marcacao', id: r.senha }),
});

/** A situação da marcação antes da chegada: a guardada no histórico da chegada, ou a do histórico anterior a ela. */
async function situacaoAntesDaChegada(tx: TxOperacao, marcacao: number): Promise<number> {
  const hs = await tx.consultar(
    `SELECT id, evento, situacao_marcacao_id, dados FROM marcacao_horario_historico
      WHERE marcacao_horario_id = ? ORDER BY ocorrido_em DESC, id DESC LIMIT 50`,
    [marcacao],
  );
  const i = hs.findIndex((h) => txt(h['evento']) === 'chegada');
  if (i >= 0) {
    const bruto = hs[i]!['dados'];
    const d = (typeof bruto === 'string' ? JSON.parse(bruto) : bruto) as { situacao_anterior_id?: unknown };
    if (typeof d?.situacao_anterior_id === 'number') return d.situacao_anterior_id;
    const antes = hs.slice(i + 1).find((h) => h['situacao_marcacao_id'] !== null);
    if (antes) return num(antes['situacao_marcacao_id']);
  }
  const padrao = await tx.uma(
    "SELECT id FROM situacao_marcacao WHERE significado = 'aguardando' AND ativo = TRUE ORDER BY ordem, id LIMIT 1",
  );
  if (!padrao)
    throw recusa(
      'situacao-marcacao-nao-cadastrada',
      'Não foi possível saber a situação anterior da marcação: peça ao administrador para conferir o cadastro de situações.',
    );
  return num(padrao['id']);
}

/** Os dados gravados no histórico da última chegada da marcação (o grupo da senha antes e depois dela). */
async function dadosDaChegada(
  tx: TxOperacao,
  marcacao: number,
): Promise<{ senha_grupo_anterior_id?: number | null; senha_grupo_aplicado_id?: number | null }> {
  const h = await tx.uma(
    `SELECT dados FROM marcacao_horario_historico WHERE marcacao_horario_id = ? AND evento = 'chegada'
      ORDER BY ocorrido_em DESC, id DESC LIMIT 1`,
    [marcacao],
  );
  const bruto = h?.['dados'];
  if (bruto === null || bruto === undefined) return {};
  const d = (typeof bruto === 'string' ? JSON.parse(bruto) : bruto) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' ? v : null);
  return 'senha_grupo_aplicado_id' in d
    ? {
        senha_grupo_anterior_id: n(d['senha_grupo_anterior_id']),
        senha_grupo_aplicado_id: n(d['senha_grupo_aplicado_id']),
      }
    : {};
}

const desfazerChegada = definirOperacao({
  nome: 'recepcao.desfazer_chegada',
  tabelas: ['senha_emitida_marcacao', 'marcacao_horario', 'marcacao_horario_historico', 'senha_emitida'],
  entrada: esquemaDesfazerChegada,
  async gravar(tx, e, ctx) {
    const { estabelecimento: idEst, usuario } = contexto(ctx);
    const est = await estabelecimento(tx, idEst);
    const x = await senhaPorId(tx, est, e.senha);
    if (!x) senhaInexistente();
    if (x.atendida)
      throw recusa(
        'chegada-com-ficha',
        'A chegada já tem ficha de atendimento: exclua a ficha no Atendimento (a marcação volta ao estado anterior) e então desfaça a chegada.',
      );
    const [v] = await tx.consultarParaAtualizar(
      `SELECT v.id, v.versao, v.marcacao_horario_id, m.versao AS versao_marcacao, sm.significado, t.natureza
         FROM senha_emitida_marcacao v JOIN marcacao_horario m ON m.id = v.marcacao_horario_id
         JOIN tipo_marcacao t ON t.id = m.tipo_marcacao_id
         JOIN situacao_marcacao sm ON sm.id = m.situacao_marcacao_id
        WHERE v.senha_emitida_id = ? AND v.excluido_em IS NULL`,
      [e.senha],
      { teto: 1 },
    );
    if (!v) throw recusa('sem-chegada', 'Esta senha não tem chegada registrada.');
    if (txt(v['significado']) !== 'chegou')
      throw recusa(
        'marcacao-mudou',
        'O agendamento já saiu da situação "chegou" (atendimento, realização ou cancelamento): a chegada não pode ser desfeita aqui.',
      );
    const marcacao = num(v['marcacao_horario_id']);
    const anterior = await situacaoAntesDaChegada(tx, marcacao);
    const agora = new Date();
    // 02-AGE 49: o grupo que a chegada pôs na senha volta ao anterior (se ninguém o mudou depois).
    const daChegada = await dadosDaChegada(tx, marcacao);
    const [sv] = await tx.consultarParaAtualizar(
      'SELECT id, versao, grupo_prioridade_legal_id FROM senha_emitida WHERE id = ?',
      [e.senha],
      { teto: 1 },
    );
    const volta = sv
      ? grupoDaSenhaAoDesfazer({
          atual: numOuNull(sv['grupo_prioridade_legal_id']),
          aplicadoNaChegada: daChegada.senha_grupo_aplicado_id,
          anteriorNaChegada: daChegada.senha_grupo_anterior_id,
        })
      : null;
    if (sv && volta)
      await tx.alterar('senha_emitida', e.senha, num(sv['versao']), {
        grupo_prioridade_legal_id: volta.grupo,
        prioritaria: volta.grupo !== null,
      });
    await tx.alterar('senha_emitida_marcacao', num(v['id']), num(v['versao']), {
      excluido_em: agora,
      excluido_por: usuario,
    });
    await tx.alterar('marcacao_horario', marcacao, num(v['versao_marcacao']), {
      chegada_em: null,
      situacao_marcacao_id: anterior,
    });
    await tx.incluir('marcacao_horario_historico', {
      marcacao_horario_id: marcacao,
      operacao: 'alteracao',
      evento: 'alteracao',
      situacao_marcacao_id: anterior,
      justificativa: e.motivo.slice(0, 600),
      dados: JSON.stringify({ situacao_marcacao_id: anterior, chegada_em: null, chegada_desfeita: true }),
      ocorrido_em: agora,
      usuario_id: usuario,
    });
    return { senha: e.senha, marcacao, tipo: txt(v['natureza']) === 'exame' ? 'exame' : 'consulta' };
  },
  alvo: (_e, r) => ({ tabela: 'senha_emitida_marcacao', id: r.senha }),
  trilha: (e) => ({ motivo: e.motivo }),
});

// ── recepcao.abrirGuiche / recepcao.fecharGuiche ─────────────────────────────────────────────────

const abrirGuiche = definirOperacao({
  nome: 'recepcao.abrir_guiche',
  tabelas: ['ocupacao_guiche'],
  entrada: esquemaAbrirGuiche,
  async gravar(tx, e, ctx) {
    const { estabelecimento: idEst, usuario } = contexto(ctx);
    await exigirLocal(tx, idEst, e.local, e.recepcao);
    const guiche = await guicheCadastrado(tx, idEst, e.recepcao, e.guiche);
    const ocupacao = await ocupacoesAbertas(tx, guiche);
    if (ocupacao.some((y) => y.ocupante !== usuario))
      throw recusa(
        'guiche-ocupado',
        'Este guichê está em uso por outra pessoa. Escolha outro número ou peça a liberação ao supervisor.',
      );
    if (ocupacao.some((y) => y.local === e.local))
      throw recusa('guiche-ja-aberto', 'Você já está neste guichê.');
    const agora = new Date();
    // Uma pessoa, um guichê: as outras ocupações abertas dela neste estabelecimento terminam agora.
    const minhas = await tx.consultarParaAtualizar(
      `SELECT o.id, o.versao FROM ocupacao_guiche o
         JOIN guiche_recepcao gr ON gr.id = o.guiche_recepcao_id JOIN ponto_recepcao p ON p.id = gr.ponto_recepcao_id
        WHERE o.ocupante_usuario_id = ? AND o.fim_em IS NULL AND p.estabelecimento_id = ?`,
      [usuario, idEst],
    );
    for (const o of minhas)
      await tx.alterar('ocupacao_guiche', num(o['id']), num(o['versao']), {
        operacao: 'alteracao',
        fim_em: agora,
      });
    await tx.incluir('ocupacao_guiche', {
      guiche_recepcao_id: guiche,
      operacao: 'inclusao',
      ocorrido_em: agora,
      usuario_id: usuario,
      ocupante_usuario_id: usuario,
      local_atendimento_id: e.local,
      inicio_em: agora,
    });
    return { guiche: e.guiche, local: e.local, recepcao: e.recepcao };
  },
  alvo: () => ({ tabela: 'ocupacao_guiche', id: null }),
});

const fecharGuiche = definirOperacao({
  nome: 'recepcao.fechar_guiche',
  tabelas: ['ocupacao_guiche'],
  entrada: esquemaFecharGuiche,
  async gravar(tx, e, ctx) {
    const { estabelecimento: idEst, usuario } = contexto(ctx);
    const guiche = await guicheCadastrado(tx, idEst, e.recepcao, e.guiche);
    const atual = (await ocupacoesAbertas(tx, guiche)).find((y) => y.local === e.local);
    if (!atual) throw recusa('guiche-fechado', 'O guichê já está fechado.');
    if (atual.ocupante !== usuario && !e.justificativa)
      throw recusa(
        'guiche-de-outro',
        'O guichê é de outra pessoa: a liberação pelo supervisor pede a justificativa.',
      );
    await tx.alterar('ocupacao_guiche', atual.id, atual.versao, {
      operacao: 'alteracao',
      fim_em: new Date(),
    });
    return { guiche: e.guiche, local: e.local, recepcao: e.recepcao };
  },
  alvo: () => ({ tabela: 'ocupacao_guiche', id: null }),
  trilha: (e) => ({ motivo: e.justificativa ?? null }),
});

// ── Catálogo ─────────────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OperacaoQualquer = Operacao<any, ResultadoOperacao>;

/** As operações pelo nome da tela (o nome no Executor e na trilha é o mesmo em snake_case). */
export const OPERACOES_RECEPCAO: Readonly<Record<string, OperacaoQualquer>> = {
  'recepcao.emitirSenha': emitirSenha,
  'recepcao.chamarSenha': chamarSenha,
  'recepcao.registrarEventoSenha': registrarEventoSenha,
  'recepcao.registrarChegada': registrarChegada,
  'recepcao.desfazerChegada': desfazerChegada,
  'recepcao.abrirGuiche': abrirGuiche,
  'recepcao.fecharGuiche': fecharGuiche,
};

export const META_OPERACOES: Readonly<Record<string, MetaOperacao>> = {
  'recepcao.emitirSenha': { evento: 'recepcao.senha.emitida', recurso: 'recepcao.senha' },
  'recepcao.chamarSenha': { evento: 'recepcao.senha.chamada', recurso: 'recepcao.senha' },
  'recepcao.registrarEventoSenha': { evento: 'recepcao.senha.conduzida', recurso: 'recepcao.senha' },
  'recepcao.registrarChegada': { evento: 'recepcao.chegada.registrada', recurso: 'recepcao.checkin' },
  'recepcao.desfazerChegada': { evento: 'recepcao.chegada.registrada', recurso: 'recepcao.checkin' },
  'recepcao.abrirGuiche': { evento: 'recepcao.guiche.aberto', recurso: 'recepcao.guiche' },
  'recepcao.fecharGuiche': { evento: 'recepcao.guiche.fechado', recurso: 'recepcao.guiche' },
};

/** A operação pelo nome; desconhecida: recusa (nada é gravado). */
export function operacaoDaRecepcao(nome: string): OperacaoQualquer {
  const op = OPERACOES_RECEPCAO[nome];
  if (!op) throw recusa('operacao-desconhecida', `A operação ${nome} não existe na recepção.`);
  return op;
}
