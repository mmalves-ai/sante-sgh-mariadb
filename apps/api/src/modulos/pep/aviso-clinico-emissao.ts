// Emissão do aviso clínico pelas regras (F3.3, 03-PEP L133), como serviço interno chamado NA MESMA TRANSAÇÃO do evento
// clínico que o dispara: o valor crítico e a retificação do resultado (SADT), o acesso de emergência ao prontuário e o
// teste da regra pela central de regras. A decisão de quem recebe é do domínio (@sgh/dominio-pep, aviso-clinico-regra);
// aqui só se lê e grava.
//   - O evento vem pelo tipo de aviso (código do catálogo do cliente) ou pela categoria (valor_critico, resultado,
//     acesso_emergencia...): pela categoria, cada tipo ativo da categoria passa pelas regras. Sem tipo nem regra que
//     cubra o evento, nada é gravado (o evento nunca falha por falta de regra).
//   - O setor e a especialidade do evento saem do atendimento quando o chamador não os dá.
//   - Tudo o que o evento aponta é conferido contra o estabelecimento da sessão (atendimento, paciente, setor) e a
//     especialidade contra o catálogo ativo: o aviso de um estabelecimento nunca aponta para dado de outro (422, sem
//     gravar).
//   - Cada regra que cobre o evento gera um aviso_clinico com os destinatários em aviso_clinico_destinatario: canal
//     'sistema' cai na central de avisos; canal 'email' fica pendente para o despacho de e-mail do worker
//     (aviso-clinico-email.service.ts), que marca enviado ou falha (fora de produção a saída é a captura local).
import {
  type AlvoAvisoClinico,
  type CandidatoAvisoClinico,
  type CanalAvisoClinico,
  destinatariosDoAviso,
  prioridadeDoAviso,
  type RegraAvisoClinicoAplicavel,
} from '@sgh/dominio-pep';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';

/** As tabelas que a emissão grava (para a declaração da operação que a chama). */
export const TABELAS_EMISSAO_AVISO_CLINICO = ['aviso_clinico', 'aviso_clinico_destinatario'] as const;

export const CENARIO_AVISO_CLINICO = 'aviso_clinico';
const TETO = 5000;

export interface EventoAvisoClinicoNaTx {
  /** O tipo de aviso pelo código (o teste da regra). */
  readonly tipoAviso?: string | null;
  /** Ou a categoria do evento: cada tipo ativo da categoria passa pelas regras. */
  readonly categoria?: string | null;
  readonly paciente?: number | null;
  readonly atendimento?: number | null;
  readonly setor?: number | null;
  readonly especialidade?: number | null;
  readonly resultadoExame?: number | null;
  readonly titulo?: string | null;
  readonly mensagem?: string | null;
  readonly moduloOrigem?: string | null;
  readonly entidadeOrigem?: string | null;
  readonly chaveOrigem?: number | null;
  /** Teste da regra pela central: o título sai com "Teste da regra:" na frente. */
  readonly teste?: boolean;
}

export interface RegraAvisoClinicoGravada {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly nome: string;
  readonly tipoAviso: string | null;
  readonly setorEvento: number | null;
  readonly especialidadeEvento: number | null;
  readonly mensagem: string;
  readonly canais: CanalAvisoClinico[];
  readonly alvos: { tipo: AlvoAvisoClinico; id: number }[];
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
  readonly numeroVersao: number;
}

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean =>
  v === true || v === 1 || v === '1' || (typeof v === 'bigint' && v === 1n);
const txtOuNull = (v: unknown): string | null =>
  v === null || v === undefined || String(v) === '' ? null : String(v);
export const diaIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = v as Date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const json = (v: unknown): Record<string, unknown> => {
  const x = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  return x && typeof x === 'object' ? (x as Record<string, unknown>) : {};
};
const ids = (v: unknown): number[] =>
  v === null || v === undefined || v === ''
    ? []
    : String(v)
        .split(',')
        .map(Number)
        .filter((n) => n > 0);

const recusaEvento = (codigo: string, detalhe: string) =>
  new ErroOperacao(422, codigo, 'Evento de aviso clínico recusado', detalhe);

/** As regras do cenário de aviso clínico do estabelecimento (e as globais), com os destinatários ativos. */
export async function lerRegrasAvisoClinico(
  l: Pick<Leitor, 'consultar'>,
  est: number,
): Promise<RegraAvisoClinicoGravada[]> {
  const linhas = await l.consultar(
    `SELECT r.id, r.versao, r.codigo, r.nome, r.condicao, r.mensagem, r.notifica_tela, r.notifica_email,
            r.vigencia_inicio, r.vigencia_fim, r.numero_versao_vigente, r.estabelecimento_id,
            (r.ativo AND COALESCE(re.ativo, TRUE)) AS ativo
       FROM regra_alerta r
       JOIN cenario_alerta ca ON ca.id = r.cenario_alerta_id AND ca.codigo = ?
       LEFT JOIN regra_alerta_estabelecimento re ON re.regra_alerta_id = r.id AND re.estabelecimento_id = ?
      WHERE r.estabelecimento_id IS NULL OR r.estabelecimento_id = ?
      ORDER BY r.nome, r.id`,
    [CENARIO_AVISO_CLINICO, est, est],
    { teto: TETO },
  );
  const alvos =
    linhas.length === 0
      ? []
      : await l.consultar(
          `SELECT regra_alerta_id, tipo_destinatario, destino_id FROM regra_alerta_destinatario
            WHERE regra_alerta_id IN (${linhas.map(() => '?').join(',')}) AND ativo AND excluido_em IS NULL
              AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
            ORDER BY id`,
          [...linhas.map((r) => r['id']), est],
          { teto: TETO },
        );
  return linhas.map((r) => {
    const cond = json(r['condicao']);
    return {
      id: num(r['id']),
      versao: num(r['versao']),
      codigo: String(r['codigo']),
      nome: String(r['nome']),
      tipoAviso: txtOuNull(cond['tipoAviso']),
      setorEvento: numOuNull(cond['setorEvento']),
      especialidadeEvento: numOuNull(cond['especialidadeEvento']),
      mensagem: String(r['mensagem']),
      canais: [
        ...(bool(r['notifica_tela']) ? (['sistema'] as const) : []),
        ...(bool(r['notifica_email']) ? (['email'] as const) : []),
      ],
      alvos: alvos
        .filter((a) => num(a['regra_alerta_id']) === num(r['id']))
        .map((a) => ({ tipo: String(a['tipo_destinatario']) as AlvoAvisoClinico, id: num(a['destino_id']) })),
      vigenciaInicio: diaIso(r['vigencia_inicio'])!,
      vigenciaFim: diaIso(r['vigencia_fim']),
      ativo: bool(r['ativo']),
      numeroVersao: num(r['numero_versao_vigente']),
    };
  });
}

/**
 * Quem pode receber no estabelecimento: usuários ativos com acesso vigente, o profissional vigente da conta, os
 * setores da lotação ativa, as especialidades ativas, as categorias pelo conselho da inscrição ativa e os perfis
 * vigentes no estabelecimento. Só o fato de ter e-mail é lido, nunca o endereço.
 */
export async function candidatosAvisoClinico(
  l: Pick<Leitor, 'consultar'>,
  est: number,
): Promise<CandidatoAvisoClinico[]> {
  const linhas = await l.consultar(
    `SELECT u.id AS usuario, up.profissional_id AS profissional,
            (u.email IS NOT NULL AND u.email <> '') AS tem_email,
            (SELECT GROUP_CONCAT(DISTINCT lp.setor_funcional_id) FROM lotacao_profissional lp
              WHERE lp.profissional_id = up.profissional_id AND lp.estabelecimento_id = ? AND lp.ativo
                AND lp.excluido_em IS NULL AND lp.setor_funcional_id IS NOT NULL) AS setores,
            (SELECT GROUP_CONCAT(DISTINCT pe.especialidade_medica_id) FROM profissional_especialidade pe
              WHERE pe.profissional_id = up.profissional_id AND pe.ativo AND pe.excluido_em IS NULL) AS especialidades,
            (SELECT GROUP_CONCAT(DISTINCT cp.id) FROM inscricao_conselho ic
               JOIN categoria_profissional cp ON cp.conselho_classe_id = ic.conselho_classe_id AND cp.ativo
              WHERE ic.profissional_id = up.profissional_id AND ic.situacao = 'ativa'
                AND ic.excluido_em IS NULL) AS categorias,
            (SELECT GROUP_CONCAT(DISTINCT p.perfil_acesso_id) FROM usuario_perfil p
              WHERE p.usuario_id = u.id AND p.estabelecimento_id = ? AND p.excluido_em IS NULL
                AND p.vigencia_inicio <= CURDATE()
                AND (p.vigencia_fim IS NULL OR p.vigencia_fim >= CURDATE())) AS perfis
       FROM usuario u
       JOIN usuario_estabelecimento ue ON ue.usuario_id = u.id AND ue.estabelecimento_id = ?
            AND ue.excluido_em IS NULL AND ue.vigencia_inicio <= CURDATE()
            AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= CURDATE())
       LEFT JOIN usuario_profissional up ON up.usuario_id = u.id AND up.excluido_em IS NULL
            AND up.vigencia_inicio <= CURDATE() AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= CURDATE())
      WHERE u.excluido_em IS NULL AND u.situacao = 'ativo'
      ORDER BY u.id`,
    [est, est, est],
    { teto: TETO },
  );
  return linhas.map((r) => ({
    usuario: num(r['usuario']),
    profissional: numOuNull(r['profissional']),
    setores: ids(r['setores']),
    especialidades: ids(r['especialidades']),
    categorias: ids(r['categorias']),
    perfis: ids(r['perfis']),
    temEmail: bool(r['tem_email']),
  }));
}

/** Confere o setor do estabelecimento e a especialidade ativa (a condição da regra e o evento). */
export async function conferirSetorEspecialidade(
  tx: Pick<TxOperacao, 'uma'>,
  est: number,
  setor: number | null | undefined,
  especialidade: number | null | undefined,
): Promise<void> {
  if (setor) {
    const s = await tx.uma(
      'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [setor, est],
    );
    if (!s) throw recusaEvento('setor-de-outro-estabelecimento', 'O setor não é deste estabelecimento.');
  }
  if (especialidade) {
    const e = await tx.uma('SELECT id FROM especialidade_medica WHERE id = ? AND ativo', [especialidade]);
    if (!e) throw recusaEvento('especialidade-inexistente', 'Especialidade inexistente ou inativa.');
  }
}

/**
 * O evento clínico passa pelas regras na transação de quem o grava: um aviso por regra que o cobre, com os
 * destinatários por canal, sem o autor do evento.
 */
export async function emitirAvisoClinicoNaTx(
  tx: TxOperacao,
  est: number,
  autor: number | null,
  e: EventoAvisoClinicoNaTx,
): Promise<{ avisos: number[]; destinatarios: number }> {
  // O teste da regra (corpo da requisição) recusa o vínculo de outro estabelecimento; o evento real nunca falha pelo
  // aviso: o vínculo que não confere fica de fora do aviso (o registro do evento segue).
  const recusar = (codigo: string, detalhe: string) => {
    if (e.teste) throw recusaEvento(codigo, detalhe);
  };
  let setor = e.setor ?? null;
  let especialidade = e.especialidade ?? null;
  let paciente = e.paciente ?? null;
  let atendimento = e.atendimento ?? null;
  if (atendimento) {
    const at = await tx.uma(
      `SELECT paciente_id, setor_funcional_id, especialidade_medica_id FROM atendimento
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [atendimento, est],
    );
    if (!at) {
      recusar('atendimento-de-outro-estabelecimento', 'O atendimento não é deste estabelecimento.');
      atendimento = null;
    } else if (paciente !== null && num(at['paciente_id']) !== paciente) {
      recusar('paciente-fora-do-atendimento', 'O paciente não é o do atendimento.');
      atendimento = null;
    } else {
      paciente = num(at['paciente_id']);
      setor ??= numOuNull(at['setor_funcional_id']);
      especialidade ??= numOuNull(at['especialidade_medica_id']);
    }
  }
  if (paciente !== null && atendimento === null) {
    const p = await tx.uma(
      `SELECT p.id FROM paciente p
        WHERE p.id = ? AND p.excluido_em IS NULL
          AND EXISTS (SELECT 1 FROM atendimento a WHERE a.paciente_id = p.id AND a.estabelecimento_id = ?)`,
      [paciente, est],
    );
    if (!p) {
      recusar('paciente-de-outro-estabelecimento', 'O paciente não tem atendimento neste estabelecimento.');
      if (e.teste) paciente = null;
    }
  }
  if (e.teste) await conferirSetorEspecialidade(tx, est, e.setor, e.especialidade);

  const tipos = e.tipoAviso
    ? await tx.consultar(
        'SELECT codigo, descricao, prioridade FROM tipo_aviso_clinico WHERE codigo = ? AND ativo',
        [e.tipoAviso],
      )
    : e.categoria
      ? await tx.consultar(
          'SELECT codigo, descricao, prioridade FROM tipo_aviso_clinico WHERE categoria = ? AND ativo ORDER BY codigo',
          [e.categoria],
          { teto: 100 },
        )
      : [];
  if (e.tipoAviso && tipos.length === 0)
    throw new ErroOperacao(
      409,
      'tipo-inexistente',
      'Evento de aviso clínico recusado',
      'Tipo de aviso inexistente ou inativo.',
    );
  if (tipos.length === 0) return { avisos: [], destinatarios: 0 };
  const lidas = await lerRegrasAvisoClinico(tx, est);
  if (!lidas.some((r) => tipos.some((t) => String(t['codigo']) === r.tipoAviso)))
    return { avisos: [], destinatarios: 0 };
  const regras: RegraAvisoClinicoAplicavel[] = lidas.map((r) => ({
    id: r.id,
    tipoAviso: r.tipoAviso ?? '',
    setorEvento: r.setorEvento,
    especialidadeEvento: r.especialidadeEvento,
    ativa: r.ativo,
    vigenciaInicio: r.vigenciaInicio,
    vigenciaFim: r.vigenciaFim,
    canais: r.canais,
    alvos: r.alvos,
  }));
  const mensagens = new Map(lidas.map((r) => [r.id, r.mensagem]));
  const candidatos = await candidatosAvisoClinico(tx, est);
  const agora = new Date();
  const gravados: number[] = [];
  let total = 0;
  for (const tipo of tipos) {
    const avisos = destinatariosDoAviso(
      regras,
      { tipoAviso: String(tipo['codigo']), setor, especialidade, dia: diaIso(agora)! },
      candidatos,
      autor,
    );
    const prioridade = prioridadeDoAviso(String(tipo['prioridade']));
    for (const a of avisos) {
      const aviso = await tx.incluir('aviso_clinico', {
        estabelecimento_id: est,
        regra_alerta_id: a.regra,
        paciente_id: paciente,
        atendimento_id: atendimento,
        resultado_exame_id: e.resultadoExame ?? null,
        especialidade_medica_id: especialidade,
        titulo: `${e.teste ? 'Teste da regra: ' : ''}${e.titulo ?? String(tipo['descricao'])}`.slice(0, 200),
        mensagem: (e.mensagem ?? mensagens.get(a.regra) ?? String(tipo['descricao'])).slice(0, 4000),
        prioridade,
        canal: a.destinos.some((d) => d.canal === 'email') ? 'email' : 'sistema',
        exibe_janela: prioridade === 'critica',
        situacao: 'pendente',
        gerado_em: agora,
        modulo_origem: e.moduloOrigem ?? 'pep.aviso_clinico',
        entidade_origem: e.entidadeOrigem ?? null,
        entidade_origem_chave: e.chaveOrigem ?? null,
      });
      let seq = 0;
      for (const d of a.destinos)
        await tx.incluir('aviso_clinico_destinatario', {
          aviso_clinico_id: aviso,
          sequencia: ++seq,
          usuario_id: d.usuario,
          profissional_id: d.profissional,
          canal: d.canal,
          situacao: 'pendente',
        });
      total += seq;
      gravados.push(aviso);
    }
  }
  return { avisos: gravados, destinatarios: total };
}
