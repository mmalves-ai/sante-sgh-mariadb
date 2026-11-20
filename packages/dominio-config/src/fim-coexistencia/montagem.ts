// A montagem da entrada do painel do fim (M43, campo 4 e regras 1 e 3), pura, para a API e para o relatório do fim
// (`pnpm coexistencia:fim`) medirem igual: os ativos com trilha e acesso, os dias da janela (retrato do dia e a série
// das conexões ao banco) e o "verde desde" de cada item derivado das próprias fontes (D-VERDE-43: nada é gravado na
// leitura). Sem dado de pessoa na saída: só contagens e datas.
import { PAPEIS_TREINAMENTO } from '@sgh/contratos';
import { papelDoGrupo, pessoaNoSetor, type SetorDoLote } from '../coexistencia/acesso-apos-trilha.js';
import type { DiaSessoes } from './sem-sessao.js';
import { ehLoginDePainel } from './usuarios-restantes.js';

/** Dias avaliados para a sequência sem sessão (o conjunto do cap-14 pede 30; folga para a sequência inteira). */
export const JANELA_DIAS_FIM = 60;

const up = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();
const somarDias = (dia: string, n: number) =>
  new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const maiorData = (xs: readonly (string | null | undefined)[]): string | null =>
  xs.reduce<string | null>((m, x) => (x && (m === null || x > m) ? x : m), null);
export const menorData = (xs: readonly (string | null | undefined)[]): string | null =>
  xs.reduce<string | null>((m, x) => (x && (m === null || x < m) ? x : m), null);

export interface PessoaFim {
  readonly login: string;
  readonly grupo: string | null;
  readonly unidades: readonly number[];
  readonly locais: readonly number[];
}
export interface ConclusaoFim {
  readonly login: string;
  readonly papel: string;
  readonly resultado: string;
  readonly concluidoEm: string;
}
export interface ChaveFim {
  readonly escopo: string;
  readonly valor: string;
  readonly ligada: boolean | null;
  readonly alteradoEm: string;
}

export interface UsuariosFimPorPapel {
  readonly papel: string;
  readonly ativos: number;
  readonly semTrilha: number;
  readonly semAcesso: number;
}

export interface UsuariosFimMedidos {
  readonly u: { ativos: number; comTrilhaEAcesso: number; semTrilha: number; semAcesso: number };
  /**
   * Campo 4 ("agregado por papel"): os ativos, os sem trilha e os sem acesso por papel do treinamento (o papel do grupo),
   * na ordem dos papéis, só os papéis com ativos. Contagens cruas: a tela e o relatório aplicam o "<5".
   */
  readonly porPapel: readonly UsuariosFimPorPapel[];
  /** O dia em que o último ativo passou a ter trilha e acesso (null: nenhum). */
  readonly verdeDesde: string | null;
}

/**
 * Os ativos (critério do M37: a leitura das pessoas já traz só ativos e não bloqueados), fora os logins de painel e as
 * contas combinadas: com a trilha do papel concluída (aprovada) e o acesso ao novo (chave ligada para a pessoa, o
 * grupo, o setor dela ou o estabelecimento).
 */
export function medirUsuariosFim(
  pessoas: readonly PessoaFim[],
  conclusoes: readonly ConclusaoFim[],
  chaves: readonly ChaveFim[],
  setores: readonly SetorDoLote[],
  combinadas: ReadonlySet<string>,
): UsuariosFimMedidos {
  const ligadas = chaves.filter((k) => k.ligada === true);
  const ativos = pessoas.filter((p) => !ehLoginDePainel(p.grupo) && !combinadas.has(up(p.login)));
  let comTrilhaEAcesso = 0;
  let semTrilha = 0;
  let semAcesso = 0;
  const desde: string[] = [];
  const porPapel = new Map<string, { ativos: number; semTrilha: number; semAcesso: number }>();
  for (const p of ativos) {
    const papel = papelDoGrupo(p.grupo);
    const doPapel = porPapel.get(papel) ?? { ativos: 0, semTrilha: 0, semAcesso: 0 };
    porPapel.set(papel, doPapel);
    doPapel.ativos += 1;
    const aprovadas = conclusoes
      .filter(
        (x) =>
          up(x.login) === up(p.login) &&
          x.resultado === 'aprovado' &&
          (PAPEIS_TREINAMENTO as readonly string[]).includes(x.papel) &&
          x.papel === papel,
      )
      .map((x) => x.concluidoEm.slice(0, 10));
    const doSetor = new Set(
      setores.filter((st) => pessoaNoSetor({ ...p, ativo: true }, st)).map((st) => st.codigo),
    );
    const acesso = ligadas.filter(
      (k) =>
        k.escopo === 'hospital' ||
        (k.escopo === 'pessoa' && up(k.valor) === up(p.login)) ||
        (k.escopo === 'grupo' && p.grupo !== null && up(k.valor) === up(p.grupo)) ||
        (k.escopo === 'setor' && doSetor.has(k.valor)),
    );
    const temTrilha = aprovadas.length > 0;
    const temAcesso = acesso.length > 0;
    if (temTrilha && temAcesso) {
      comTrilhaEAcesso += 1;
      const d = maiorData([menorData(aprovadas), menorData(acesso.map((k) => k.alteradoEm.slice(0, 10)))]);
      if (d) desde.push(d);
    }
    if (!temTrilha) {
      semTrilha += 1;
      doPapel.semTrilha += 1;
    }
    if (!temAcesso) {
      semAcesso += 1;
      doPapel.semAcesso += 1;
    }
  }
  return {
    u: { ativos: ativos.length, comTrilhaEAcesso, semTrilha, semAcesso },
    porPapel: (PAPEIS_TREINAMENTO as readonly string[])
      .filter((papel) => porPapel.has(papel))
      .map((papel) => ({ papel, ...porPapel.get(papel)! })),
    verdeDesde: maiorData(desde),
  };
}

/** O primeiro dia da janela que termina em `hoje`. */
export const inicioDaJanelaFim = (hoje: string, janela = JANELA_DIAS_FIM): string =>
  somarDias(hoje, -(janela - 1));

/**
 * Os dias da janela (regra 3): o retrato do dia (os logins com conexão nova; dia sem retrato é null) e o pico das
 * conexões do outro sistema ao banco (dia sem coleta é null). Falha fechada: o que não se mediu não conta como limpo.
 */
export function diasDaJanelaFim(
  hoje: string,
  retratos: readonly { dia: string; login: string; mudou: boolean }[],
  serie: readonly { dia: string; conexoes: number }[],
  janela = JANELA_DIAS_FIM,
): DiaSessoes[] {
  const inicio = inicioDaJanelaFim(hoje, janela);
  const porDia = new Map<string, Set<string>>();
  for (const r of retratos) {
    const s = porDia.get(r.dia) ?? new Set<string>();
    if (r.mudou) s.add(r.login);
    porDia.set(r.dia, s);
  }
  const mon = new Map(serie.map((x) => [x.dia, x.conexoes]));
  return Array.from({ length: janela }, (_, i) => {
    const dia = somarDias(inicio, i);
    const logins = porDia.get(dia);
    return {
      dia,
      loginsComConexao: logins ? [...logins] : null,
      conexoesProgramaAnterior: mon.has(dia) ? mon.get(dia)! : null,
    };
  });
}
