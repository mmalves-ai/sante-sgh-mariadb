// Leitura da configuração dos locais de atendimento (02-REC linha 34) no banco próprio, para quem a USA: a fila do
// consultório (locais visíveis ao usuário, horário de agora) e a recepção (destinos de encaminhamento, na lista e na
// gravação do encaminhamento). As regras são do domínio (uso-locais.ts); aqui só a leitura das tabelas vigentes
// (horário, encaminhamento, visibilidade e usuários do local, sem as linhas excluídas) e do dia não útil (feriado do
// dia inteiro, pelo leitor comum do calendário).
import {
  type FaixaHorarioLocal,
  type HorarioAgora,
  type LocalConfigurado,
  destinosDeEncaminhamento,
  horarioDoLocalAgora,
  locaisVisiveisAoUsuario,
} from '@sgh/dominio-atendimento';
import type { Leitor } from '@sgh/nucleo';
import { lerFeriadosDoPeriodo } from '../agenda/dias-sem-expediente-leitor.js';

const n = (v: unknown): number => Number(v);
const b = (v: unknown): boolean => v === true || v === 1 || v === '1' || (typeof v === 'bigint' && v === 1n);
const hhmm = (v: unknown): string => String(v ?? '').slice(0, 5);

export interface LocalComUso extends LocalConfigurado {
  readonly descricao: string;
  readonly destinos: number[];
  readonly visivel: boolean;
  readonly horario: HorarioAgora;
}

/** Destinos de encaminhamento configurados por local de origem (só as ligações vigentes). */
export async function lerEncaminhamentosConfigurados(
  l: Pick<Leitor, 'consultar'>,
  estabelecimento: number,
): Promise<Map<number, number[]>> {
  const linhas = await l.consultar(
    `SELECT e.local_atendimento_id AS o, e.destino_local_atendimento_id AS d
       FROM local_atendimento_encaminhamento e JOIN local_atendimento la ON la.id = e.local_atendimento_id
      WHERE la.estabelecimento_id = ? AND e.excluido_em IS NULL`,
    [estabelecimento],
    { teto: 20_000 },
  );
  const m = new Map<number, number[]>();
  for (const x of linhas) {
    const o = n(x['o']);
    m.set(o, [...(m.get(o) ?? []), n(x['d'])]);
  }
  return m;
}

/** Os locais do estabelecimento, como o uso da configuração precisa (inclui os inativos, para a regra recusar). */
export async function lerLocaisConfigurados(
  l: Pick<Leitor, 'consultar'>,
  estabelecimento: number,
): Promise<(LocalConfigurado & { descricao: string })[]> {
  return (
    await l.consultar(
      `SELECT id, ponto_recepcao_id, descricao, ativo, permite_encaminhamento FROM local_atendimento
        WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY descricao, id`,
      [estabelecimento],
      { teto: 5_000 },
    )
  ).map((x) => ({
    id: n(x['id']),
    recepcao: n(x['ponto_recepcao_id']),
    descricao: String(x['descricao'] ?? ''),
    ativo: b(x['ativo']),
    permiteEncaminhamento: b(x['permite_encaminhamento']),
  }));
}

/** O encaminhamento de `origem` para `destino` vale pela configuração vigente? (A recepção grava só se valer.) */
export async function encaminhamentoConfiguradoPermite(
  l: Pick<Leitor, 'consultar'>,
  estabelecimento: number,
  origem: number,
  destino: number,
): Promise<boolean> {
  const [locais, enc] = await Promise.all([
    lerLocaisConfigurados(l, estabelecimento),
    lerEncaminhamentosConfigurados(l, estabelecimento),
  ]);
  return destinosDeEncaminhamento(origem, enc.get(origem) ?? [], locais).includes(destino);
}

/**
 * Os locais ativos com o uso da configuração para o usuário da sessão: destinos de encaminhamento, se ele o vê na
 * fila (pelos vínculos dele e pela visibilidade entre locais) e o horário no instante local `agoraLocal`.
 */
export async function lerLocaisComUso(
  l: Pick<Leitor, 'uma' | 'consultar'>,
  estabelecimento: number,
  usuario: number | null,
  agoraLocal: string,
): Promise<LocalComUso[]> {
  const locais = await lerLocaisConfigurados(l, estabelecimento);
  const enc = await lerEncaminhamentosConfigurados(l, estabelecimento);
  const horarios = await l.consultar(
    `SELECT h.local_atendimento_id AS l, h.dia_semana, h.dia_nao_util, h.hora_inicio, h.hora_fim
       FROM local_atendimento_horario h JOIN local_atendimento la ON la.id = h.local_atendimento_id
      WHERE la.estabelecimento_id = ?`,
    [estabelecimento],
    { teto: 20_000 },
  );
  const visibilidade = await l.consultar(
    `SELECT v.local_atendimento_id AS l, v.consultado_local_atendimento_id AS c
       FROM local_atendimento_visibilidade v JOIN local_atendimento la ON la.id = v.local_atendimento_id
      WHERE la.estabelecimento_id = ? AND v.excluido_em IS NULL`,
    [estabelecimento],
    { teto: 20_000 },
  );
  const vinculos = usuario
    ? await l.consultar(
        `SELECT u.local_atendimento_id AS l, u.atua_no_local, u.pode_operar
           FROM usuario_local_atendimento u JOIN local_atendimento la ON la.id = u.local_atendimento_id
          WHERE u.usuario_id = ? AND la.estabelecimento_id = ? AND u.excluido_em IS NULL`,
        [usuario, estabelecimento],
        { teto: 5_000 },
      )
    : [];
  // Dia não útil: o feriado do dia inteiro pelo leitor comum do calendário (nacionais calculados e cadastro único).
  const hoje = agoraLocal.slice(0, 10);
  const diaNaoUtil = (await lerFeriadosDoPeriodo(l, estabelecimento, hoje, hoje)).length > 0;
  const faixas = new Map<number, FaixaHorarioLocal[]>();
  for (const h of horarios) {
    const id = n(h['l']);
    faixas.set(id, [
      ...(faixas.get(id) ?? []),
      {
        diaSemana: h['dia_semana'] === null ? null : n(h['dia_semana']),
        diaNaoUtil: b(h['dia_nao_util']),
        inicio: hhmm(h['hora_inicio']),
        fim: hhmm(h['hora_fim']),
      },
    ]);
  }
  const visiveis = new Set(
    locaisVisiveisAoUsuario(
      vinculos.map((v) => ({
        local: n(v['l']),
        atuaNoLocal: b(v['atua_no_local']),
        podeOperar: b(v['pode_operar']),
      })),
      visibilidade.map((v) => ({ local: n(v['l']), consultado: n(v['c']) })),
      locais,
    ),
  );
  return locais
    .filter((x) => x.ativo)
    .map((x) => ({
      ...x,
      destinos: destinosDeEncaminhamento(x.id, enc.get(x.id) ?? [], locais),
      visivel: visiveis.has(x.id),
      horario: horarioDoLocalAgora(faixas.get(x.id) ?? [], agoraLocal, diaNaoUtil),
    }));
}
