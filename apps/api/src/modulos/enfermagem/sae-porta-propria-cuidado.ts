// Prescrição de enfermagem no banco próprio (família sae-atendimento, modulos-proprios-2): a atividade de cuidado que o
// enfermeiro prescreve a partir de uma intervenção do plano vigente (com a frequência e os horários do dia), a
// suspensão (na própria linha, com o motivo), a checagem de cada horário (feita ou não feita, só de acréscimo) e o
// estorno da checagem (registro novo; a checagem fica). Mesmo comportamento da porta de memória: as recusas
// sae-mudou, intervencao-de-outro-processo, nao-encontrado, ja-suspensa, atividade-suspensa, ja-checado e ja-estornado.
// Tabelas: 06_PEP/96_cuidado_enfermagem. Toda leitura filtra o estabelecimento da sessão e os registros excluídos.
// Vigente: a atividade cujo diagnóstico de origem segue ativo (o novo registro do processo inativa os diagnósticos, e
// as atividades do lote anterior deixam de ser vigentes, como a última versão da memória).
import type { ChecagemCuidadoLida } from '@sgh/contratos';
import { type Leitor, recusa, type ResultadoOperacao } from '@sgh/nucleo';
import {
  booleano,
  civilDe,
  exigirProfissional,
  instanteDe,
  type Linha,
  LOGIN_DE,
  marcadores,
  num,
  texto,
  textoOuNulo,
} from './banco-apoio.js';
import type { ContextoSae, GravadorSae } from './sae-porta.js';
import type { Escrita } from './sae-porta-propria.js';
import type { AtividadeVigente } from './sae-tipos.js';

export const OPERACOES_CUIDADO_SAE = {
  prescrever: 'sae.prescrever-atividade',
  suspender: 'sae.suspender-atividade',
  checar: 'sae.checar-cuidado',
  estornar: 'sae.estornar-checagem',
} as const;

/** O teto das checagens lidas de uma vez (a tela pede um turno). */
export const TETO_CHECAGENS = 2000;

type Esc = <R extends ResultadoOperacao>(
  w: Escrita<R>,
) => Promise<{ resultado: R; repetida: boolean; eventos: readonly number[] }>;

const SAE_MUDOU = () =>
  recusa(
    'sae-mudou',
    'O processo de enfermagem mudou depois da sua leitura: recarregue e confira antes de gravar.',
  );

const ids = (v: unknown): number[] =>
  String(v ?? '')
    .split(',')
    .filter(Boolean)
    .map(Number);

/** "AAAA-MM-DDTHH:MM" sem segundos (a chave do horário é por minuto, como a memória). */
const minuto = (civil: string): string => civil.slice(0, 16);

/** As gravações da prescrição de enfermagem (o gravador da SAE as expõe). */
export function gravadorCuidadoSae(
  c: ContextoSae,
  esc: Esc,
): Pick<GravadorSae, 'prescrever' | 'suspender' | 'checar' | 'estornar'> {
  return {
    prescrever: async (x) => {
      const s = await esc({
        nome: OPERACOES_CUIDADO_SAE.prescrever,
        tabelas: ['atividade_cuidado_enfermagem'],
        chave: x.chave,
        entrada: { ...x },
        alvo: () => ({ tabela: 'processo_enfermagem', id: x.sae }),
        saida: (r) => ({ ids: ids(r['ids']) }),
        gravar: async (tx, est, fuso) => {
          const prof = await exigirProfissional(tx, c, est);
          const proc = await tx.uma<{ id: number }>(
            `SELECT id FROM processo_enfermagem
              WHERE atendimento_id = ? AND estabelecimento_id = ? AND situacao = 'aberto' AND excluido_em IS NULL
              ORDER BY id DESC LIMIT 1`,
            [x.atendimento, est],
          );
          if (!proc || num(proc.id) !== x.sae) throw SAE_MUDOU();
          const planos = new Set(
            (
              await tx.consultar<{ id: number }>(
                `SELECT p.id FROM plano_intervencao_enfermagem p
                   JOIN diagnostico_enfermagem_paciente d ON d.id = p.diagnostico_enfermagem_paciente_id
                  WHERE d.atendimento_id = ? AND d.estabelecimento_id = ? AND d.situacao = 'ativo'
                    AND d.excluido_em IS NULL AND p.excluido_em IS NULL`,
                [x.atendimento, est],
              )
            ).map((p) => num(p.id)),
          );
          if (x.atividades.some((a) => !planos.has(a.intervencao)))
            throw recusa('intervencao-de-outro-processo', 'A intervenção não é do processo vigente.');
          const novos: number[] = [];
          for (const a of x.atividades)
            novos.push(
              await tx.incluir('atividade_cuidado_enfermagem', {
                estabelecimento_id: est,
                paciente_id: x.paciente,
                atendimento_id: x.atendimento,
                processo_enfermagem_id: x.sae,
                plano_intervencao_enfermagem_id: a.intervencao,
                codigo_classificacao: a.codigo,
                descricao: a.descricao,
                frequencia_dia: a.frequenciaDia,
                horarios: a.horarios.join(','),
                inicio_em: instanteDe(a.inicio, fuso),
                fim_em: a.fim ? instanteDe(a.fim, fuso) : null,
                prescritor_profissional_id: prof,
                situacao: 'ativa',
              }),
            );
          return { ids: novos.join(',') };
        },
      });
      return { ids: ids(s.resultado['ids']), repetida: s.repetida };
    },

    suspender: async (x) => {
      const s = await esc({
        nome: OPERACOES_CUIDADO_SAE.suspender,
        tabelas: ['atividade_cuidado_enfermagem'],
        chave: null,
        entrada: { ...x },
        alvo: () => ({ tabela: 'atividade_cuidado_enfermagem', id: x.atividade }),
        gravar: async (tx, est) => {
          const prof = await exigirProfissional(tx, c, est);
          const [a] = await tx.consultarParaAtualizar<Linha>(
            `SELECT id, versao, situacao FROM atividade_cuidado_enfermagem
              WHERE id = ? AND atendimento_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
            [x.atividade, x.atendimento, est],
          );
          if (!a) throw recusa('nao-encontrado', 'Atividade não encontrada neste atendimento.');
          if (texto(a['situacao']) === 'suspensa')
            throw recusa('ja-suspensa', 'Esta atividade já foi suspensa.');
          await tx.alterar('atividade_cuidado_enfermagem', x.atividade, num(a['versao']), {
            situacao: 'suspensa',
            suspensa_em: new Date(),
            suspensa_por_profissional_id: prof,
            motivo_suspensao: x.motivo,
          });
          return { id: x.atividade };
        },
      });
      return num(s.resultado['id']);
    },

    checar: async (x) => {
      const s = await esc({
        nome: OPERACOES_CUIDADO_SAE.checar,
        tabelas: ['checagem_cuidado_enfermagem'],
        chave: x.chave,
        entrada: { ...x },
        alvo: (r) => ({ tabela: 'checagem_cuidado_enfermagem', id: num(r['id']) }),
        gravar: async (tx, est, fuso) => {
          const prof = await exigirProfissional(tx, c, est);
          const [a] = await tx.consultarParaAtualizar<Linha>(
            `SELECT id, situacao FROM atividade_cuidado_enfermagem
              WHERE id = ? AND atendimento_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
            [x.atividade, x.atendimento, est],
          );
          if (!a) throw recusa('nao-encontrado', 'Atividade não encontrada neste atendimento.');
          if (texto(a['situacao']) === 'suspensa')
            throw recusa('atividade-suspensa', 'A atividade foi suspensa: nada foi checado.');
          const previsto = instanteDe(minuto(x.previsto), fuso);
          const est2 = await tx.uma<{ n: number; vigente: number }>(
            `SELECT COUNT(e.id) AS n, COUNT(ch.id) - COUNT(e.id) AS vigente
               FROM checagem_cuidado_enfermagem ch
               LEFT JOIN estorno_checagem_cuidado_enfermagem e ON e.checagem_cuidado_enfermagem_id = ch.id
              WHERE ch.atividade_cuidado_enfermagem_id = ? AND ch.previsto_em = ? AND ch.excluido_em IS NULL`,
            [x.atividade, previsto],
          );
          if (num(est2?.vigente) > 0)
            throw recusa(
              'ja-checado',
              'Este horário já foi checado: para corrigir, estorne a checagem com a justificativa.',
            );
          const id = await tx.incluir('checagem_cuidado_enfermagem', {
            estabelecimento_id: est,
            atendimento_id: x.atendimento,
            atividade_cuidado_enfermagem_id: x.atividade,
            previsto_em: previsto,
            geracao: num(est2?.n),
            feita: x.feita,
            motivo_nao_feita: x.motivo,
            realizada_em: instanteDe(minuto(x.horaReal), fuso),
            origem_offline: x.origemOffline,
            categoria: x.categoria,
            profissional_id: prof,
          });
          return { id };
        },
      });
      return { id: num(s.resultado['id']), repetida: s.repetida };
    },

    estornar: async (x) => {
      const s = await esc({
        nome: OPERACOES_CUIDADO_SAE.estornar,
        tabelas: ['estorno_checagem_cuidado_enfermagem'],
        chave: null,
        entrada: { ...x },
        alvo: () => ({ tabela: 'checagem_cuidado_enfermagem', id: x.checagem }),
        gravar: async (tx, est) => {
          const prof = await exigirProfissional(tx, c, est);
          const [o] = await tx.consultarParaAtualizar<Linha>(
            `SELECT id FROM checagem_cuidado_enfermagem
              WHERE id = ? AND atendimento_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
            [x.checagem, x.atendimento, est],
          );
          if (!o) throw recusa('nao-encontrado', 'Checagem não encontrada neste atendimento.');
          const ja = await tx.uma<{ id: number }>(
            'SELECT id FROM estorno_checagem_cuidado_enfermagem WHERE checagem_cuidado_enfermagem_id = ?',
            [x.checagem],
          );
          if (ja) throw recusa('ja-estornado', 'Esta checagem já foi estornada.');
          const id = await tx.incluir('estorno_checagem_cuidado_enfermagem', {
            estabelecimento_id: est,
            checagem_cuidado_enfermagem_id: x.checagem,
            motivo: x.motivo,
            categoria: x.categoria,
            profissional_id: prof,
          });
          return { id };
        },
      });
      return num(s.resultado['id']);
    },
  };
}

// ── Leituras ────────────────────────────────────────────────────────────────────────────────────────────────

const SQL_ATIVIDADE = `
  SELECT a.id, a.codigo_classificacao, a.descricao, a.frequencia_dia, a.horarios, a.inicio_em, a.fim_em,
         a.situacao, a.suspensa_em, a.motivo_suspensao, a.criado_em, a.atendimento_id, a.processo_enfermagem_id,
         a.paciente_id, d.situacao AS situacao_diagnostico, d.fim_em AS diagnostico_fim_em,
         ${LOGIN_DE('a.criado_por')} AS login, ${LOGIN_DE('a.alterado_por')} AS login_suspensao
    FROM atividade_cuidado_enfermagem a
    JOIN plano_intervencao_enfermagem p ON p.id = a.plano_intervencao_enfermagem_id
    JOIN diagnostico_enfermagem_paciente d ON d.id = p.diagnostico_enfermagem_paciente_id
   WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL`;

function atividadeDe(a: Linha, fuso: string): AtividadeVigente {
  const em = (v: unknown) => minuto(civilDe(v, fuso) ?? '');
  const h = texto(a['horarios']);
  return {
    id: num(a['id']),
    codigo: textoOuNulo(a['codigo_classificacao']),
    descricao: texto(a['descricao']),
    frequenciaDia: num(a['frequencia_dia']),
    horarios: h ? h.split(',') : [],
    inicio: em(a['inicio_em']),
    fim: a['fim_em'] ? em(a['fim_em']) : null,
    suspensa:
      texto(a['situacao']) === 'suspensa'
        ? {
            motivo: texto(a['motivo_suspensao']),
            usuario: texto(a['login_suspensao']),
            em: em(a['suspensa_em']),
          }
        : null,
    usuario: texto(a['login']),
    em: em(a['criado_em']),
    atendimento: num(a['atendimento_id']),
    sae: num(a['processo_enfermagem_id']),
  };
}

export async function lerAtividadesVigentes(
  l: Leitor,
  est: number,
  fuso: string,
  atendimentos: readonly number[],
): Promise<AtividadeVigente[]> {
  const lista = [...new Set(atendimentos)];
  if (!lista.length) return [];
  const linhas = await l.consultar<Linha>(
    `${SQL_ATIVIDADE} AND a.atendimento_id IN (${marcadores(lista.length)}) AND d.situacao = 'ativo'
        AND d.excluido_em IS NULL
      ORDER BY a.id`,
    [est, ...lista],
  );
  return linhas.map((a) => atividadeDe(a, fuso));
}

export async function lerAtividade(
  l: Leitor,
  est: number,
  fuso: string,
  id: number,
): Promise<(AtividadeVigente & { readonly paciente: number; readonly revisadoEm: string | null }) | null> {
  const a = await l.uma<Linha>(`${SQL_ATIVIDADE} AND a.id = ?`, [est, id]);
  if (!a) return null;
  // Revisada: o processo foi registrado de novo e o diagnóstico de origem saiu (a atividade deixou de ser vigente).
  const revisado =
    texto(a['situacao_diagnostico']) !== 'ativo' && a['diagnostico_fim_em']
      ? minuto(civilDe(a['diagnostico_fim_em'], fuso) ?? '')
      : null;
  return { ...atividadeDe(a, fuso), paciente: num(a['paciente_id']), revisadoEm: revisado };
}

const SQL_CHECAGEM = `
  SELECT ch.id, ch.atividade_cuidado_enfermagem_id, ch.atendimento_id, ch.previsto_em, ch.feita, ch.motivo_nao_feita,
         ch.realizada_em, ch.origem_offline, ch.categoria, ch.criado_em, ${LOGIN_DE('ch.criado_por')} AS login,
         e.id AS estorno_id, e.motivo AS estorno_motivo, ${LOGIN_DE('e.criado_por')} AS estorno_login
    FROM checagem_cuidado_enfermagem ch
    LEFT JOIN estorno_checagem_cuidado_enfermagem e ON e.checagem_cuidado_enfermagem_id = ch.id
   WHERE ch.estabelecimento_id = ? AND ch.excluido_em IS NULL`;

function checagemDe(x: Linha, fuso: string): ChecagemCuidadoLida & { atendimento: number } {
  const em = (v: unknown) => minuto(civilDe(v, fuso) ?? '');
  return {
    id: num(x['id']),
    atividade: num(x['atividade_cuidado_enfermagem_id']),
    atendimento: num(x['atendimento_id']),
    previsto: em(x['previsto_em']),
    feita: booleano(x['feita']),
    motivo: textoOuNulo(x['motivo_nao_feita']),
    horaReal: em(x['realizada_em']),
    origemOffline: booleano(x['origem_offline']),
    categoria: texto(x['categoria']) === 'tecnico' ? 'tecnico' : 'enfermeiro',
    usuario: texto(x['login']),
    em: civilDe(x['criado_em'], fuso) ?? '',
    estorno:
      x['estorno_id'] !== null && x['estorno_id'] !== undefined
        ? { id: num(x['estorno_id']), motivo: texto(x['estorno_motivo']), usuario: texto(x['estorno_login']) }
        : null,
  };
}

export async function lerChecagens(
  l: Leitor,
  est: number,
  fuso: string,
  o: { readonly atividades: readonly number[]; readonly de: string; readonly ate: string },
): Promise<{ itens: (ChecagemCuidadoLida & { atendimento: number })[]; cortada: boolean }> {
  const lista = [...new Set(o.atividades)];
  if (!lista.length) return { itens: [], cortada: false };
  const linhas = await l.consultar<Linha>(
    `${SQL_CHECAGEM} AND ch.atividade_cuidado_enfermagem_id IN (${marcadores(lista.length)})
        AND ch.previsto_em >= ? AND ch.previsto_em < ?
      ORDER BY ch.previsto_em, ch.id LIMIT ${TETO_CHECAGENS + 1}`,
    [est, ...lista, instanteDe(minuto(o.de), fuso), instanteDe(minuto(o.ate), fuso)],
  );
  return {
    itens: linhas.slice(0, TETO_CHECAGENS).map((x) => checagemDe(x, fuso)),
    cortada: linhas.length > TETO_CHECAGENS,
  };
}

export async function lerChecagem(
  l: Leitor,
  est: number,
  fuso: string,
  id: number,
): Promise<(ChecagemCuidadoLida & { atendimento: number }) | null> {
  const x = await l.uma<Linha>(`${SQL_CHECAGEM} AND ch.id = ?`, [est, id]);
  return x ? checagemDe(x, fuso) : null;
}
