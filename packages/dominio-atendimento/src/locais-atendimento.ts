// Locais de atendimento (consultórios e salas) — 02-REC linha 34. Regras da manutenção do local, sem banco:
//   - horário de funcionamento por dia da semana e em dia não útil, com faixas que não se sobrepõem no mesmo dia;
//   - encaminhamento entre locais: só para outro local ativo da mesma unidade, e só quando o local de origem
//     encaminha;
//   - visibilidade entre locais (quais locais cada local consulta) e quem opera ou atende em cada local;
//   - se o local está aberto num instante (a fila do consultório e a recepção usam).
// Desenho próprio: a semana inteira é gravada de uma vez (a tela mostra a grade e valida na hora), e o vínculo do
// usuário diz se ele atende no local, se só o opera ou as duas coisas.

export interface RecusaLocal {
  readonly codigo: string;
  readonly mensagem: string;
}

/** Faixa de funcionamento. Dia da semana de 1 (domingo) a 7 (sábado); em dia não útil, sem dia da semana. */
export interface FaixaHorarioLocal {
  readonly diaSemana: number | null;
  readonly diaNaoUtil: boolean;
  readonly inicio: string; // HH:MM
  readonly fim: string; // HH:MM
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutos = (h: string): number => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const chaveDia = (f: FaixaHorarioLocal): string => (f.diaNaoUtil ? 'nao-util' : String(f.diaSemana));

/** Confere a semana de funcionamento do local; devolve as faixas em ordem (dia, início) ou a recusa. */
export function validarHorarioLocal(
  faixas: readonly FaixaHorarioLocal[],
): { faixas: FaixaHorarioLocal[] } | { recusa: RecusaLocal } {
  for (const f of faixas) {
    if (f.diaNaoUtil && f.diaSemana !== null)
      return {
        recusa: {
          codigo: 'horario-dia-invalido',
          mensagem: 'A faixa de dia não útil não leva dia da semana.',
        },
      };
    if (
      !f.diaNaoUtil &&
      (f.diaSemana === null || !Number.isInteger(f.diaSemana) || f.diaSemana < 1 || f.diaSemana > 7)
    )
      return {
        recusa: { codigo: 'horario-dia-invalido', mensagem: 'Informe o dia da semana (domingo a sábado).' },
      };
    if (!HORA.test(f.inicio) || !HORA.test(f.fim))
      return { recusa: { codigo: 'horario-invalido', mensagem: 'Informe as horas no formato HH:MM.' } };
    if (minutos(f.fim) <= minutos(f.inicio))
      return {
        recusa: {
          codigo: 'horario-faixa-invertida',
          mensagem: 'O fim da faixa tem de ser depois do início.',
        },
      };
  }
  const ordenadas = [...faixas].sort(
    (a, b) =>
      (a.diaNaoUtil ? 8 : (a.diaSemana ?? 0)) - (b.diaNaoUtil ? 8 : (b.diaSemana ?? 0)) ||
      minutos(a.inicio) - minutos(b.inicio),
  );
  for (let i = 1; i < ordenadas.length; i++) {
    const a = ordenadas[i - 1]!;
    const b = ordenadas[i]!;
    if (chaveDia(a) === chaveDia(b) && minutos(b.inicio) < minutos(a.fim))
      return {
        recusa: {
          codigo: 'horario-sobreposto',
          mensagem: `As faixas ${a.inicio}–${a.fim} e ${b.inicio}–${b.fim} se sobrepõem no mesmo dia.`,
        },
      };
  }
  return { faixas: ordenadas };
}

/** O local está aberto no dia (1 domingo a 7 sábado), em dia não útil ou não, na hora HH:MM? Sem horário: aberto. */
export function localAberto(
  faixas: readonly FaixaHorarioLocal[],
  diaSemana: number,
  diaNaoUtil: boolean,
  hora: string,
): boolean {
  if (faixas.length === 0) return true;
  const m = minutos(hora);
  const doDia = faixas.filter((f) =>
    diaNaoUtil ? f.diaNaoUtil : !f.diaNaoUtil && f.diaSemana === diaSemana,
  );
  return doDia.some((f) => m >= minutos(f.inicio) && m < minutos(f.fim));
}

/** Um local da unidade, como a regra de ligação entre locais precisa. */
export interface LocalDaUnidade {
  readonly id: number;
  readonly ativo: boolean;
  readonly permiteEncaminhamento: boolean;
}

/**
 * Confere a lista de locais ligados a um local (para onde ele encaminha, ou quais ele consulta): sem repetição, nunca
 * ele mesmo, só locais ativos da mesma unidade. Encaminhar exige que o local de origem encaminhe.
 */
export function validarLigacaoLocais(
  tipo: 'encaminhamento' | 'visibilidade',
  origem: LocalDaUnidade,
  destinos: readonly number[],
  locaisDaUnidade: readonly LocalDaUnidade[],
): { destinos: number[] } | { recusa: RecusaLocal } {
  const unicos = [...new Set(destinos)];
  if (unicos.includes(origem.id))
    return {
      recusa: {
        codigo: 'local-ligado-a-si',
        mensagem:
          tipo === 'encaminhamento'
            ? 'O local não encaminha para ele mesmo.'
            : 'O local já vê os próprios atendimentos.',
      },
    };
  const porId = new Map(locaisDaUnidade.map((l) => [l.id, l]));
  for (const d of unicos) {
    const l = porId.get(d);
    if (!l || !l.ativo)
      return {
        recusa: {
          codigo: 'local-destino-invalido',
          mensagem: 'Só se liga a um local ativo da mesma unidade.',
        },
      };
  }
  if (tipo === 'encaminhamento' && unicos.length > 0 && !origem.permiteEncaminhamento)
    return {
      recusa: {
        codigo: 'local-nao-encaminha',
        mensagem: 'Este local não encaminha pacientes: marque "encaminha para outros locais" antes.',
      },
    };
  return { destinos: unicos.sort((a, b) => a - b) };
}

/**
 * Local inativo não recebe encaminhamento nem é consultado. Ao gravar o local como inativo, as ligações vigentes que
 * apontam para ele (quem encaminha para ele, quem o consulta) saem junto, por exclusão lógica, na mesma gravação:
 * assim nenhum outro local fica preso a um destino que a regra recusa. Reativar o local não as devolve (quem liga de
 * novo decide). As ligações que partem dele ficam: voltam a valer quando ele for reativado.
 */
export function ligacoesQueSaemAoInativar<T>(ativoDepois: boolean, entradas: readonly T[]): T[] {
  return ativoDepois ? [] : [...entradas];
}

/**
 * Das ligações de um local, as que valem (com local ativo da unidade). A tela usa para o envio: a ligação antiga com
 * um local hoje inativo (dado anterior à regra acima) aparece marcada e sai sozinha na primeira gravação.
 */
export function ligacoesComLocalAtivo(
  ligados: readonly number[],
  locaisDaUnidade: readonly Pick<LocalDaUnidade, 'id' | 'ativo'>[],
): number[] {
  const ativos = new Set(locaisDaUnidade.filter((l) => l.ativo).map((l) => l.id));
  return [...new Set(ligados)].filter((id) => ativos.has(id)).sort((a, b) => a - b);
}

/** Vínculo do usuário com o local: atende nele (consultório) e/ou o opera (recepção, chamada). */
export interface UsuarioDoLocal {
  readonly usuario: number;
  readonly atuaNoLocal: boolean;
  readonly podeOperar: boolean;
}

/** Confere a lista de quem vê (opera ou atende) o local: sem repetição e com ao menos um dos dois papéis. */
export function validarUsuariosLocal(
  usuarios: readonly UsuarioDoLocal[],
): { usuarios: UsuarioDoLocal[] } | { recusa: RecusaLocal } {
  const vistos = new Set<number>();
  for (const u of usuarios) {
    if (vistos.has(u.usuario))
      return {
        recusa: { codigo: 'usuario-repetido', mensagem: 'O usuário aparece duas vezes na lista do local.' },
      };
    vistos.add(u.usuario);
    if (!u.atuaNoLocal && !u.podeOperar)
      return {
        recusa: {
          codigo: 'usuario-sem-papel',
          mensagem: 'Marque se o usuário atende no local, se o opera, ou retire-o da lista.',
        },
      };
  }
  return { usuarios: [...usuarios].sort((a, b) => a.usuario - b.usuario) };
}

/** O que muda numa lista de ligações: o que entra, o que sai e o que volta (linha excluída que é reativada). */
export function diferencaLista(
  atuais: readonly number[],
  excluidas: readonly number[],
  desejadas: readonly number[],
): { incluir: number[]; reativar: number[]; retirar: number[] } {
  const a = new Set(atuais);
  const x = new Set(excluidas);
  const d = new Set(desejadas);
  return {
    incluir: [...d].filter((i) => !a.has(i) && !x.has(i)),
    reativar: [...d].filter((i) => !a.has(i) && x.has(i)),
    retirar: [...a].filter((i) => !d.has(i)),
  };
}
