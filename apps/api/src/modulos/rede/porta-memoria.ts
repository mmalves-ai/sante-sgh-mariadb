// Porta do MPI da Rede em MEMÓRIA (M57, etapa 1): a sessão sintética de dev/ci (E2E e testes do serviço). Cada
// estabelecimento configurado é um "banco" separado em memória, com cadastros SINTÉTICOS (nenhuma pessoa real) e as
// tabelas do índice (pessoa, vínculo, candidato, marca), com as mesmas regras das gravações do índice: só o índice,
// idempotente, candidato decidido nunca muda. `falharEm` simula a queda de um banco no meio (regra 4: o outro grava,
// o relatório de divergência acha e o reparo completa). Nada vai à cópia nem ao banco.
import { normalizarChave } from '@sgh/contratos';
import { ErroProblema } from '../../problema.filter.js';
import type {
  AtendimentosRede,
  ContextoRede,
  EstabelecimentoRede,
  GravadorRede,
  MarcaRede,
  PortaRede,
  RecorteFilaRede,
} from './porta.js';
import type {
  CadastroRedeLido,
  CandidatoParaGravarRede,
  CandidatoRedeLido,
  ChavesProcuraRede,
  EscritaIndiceRede,
  ParNovo,
  TrilhaRede,
  VinculoRedeLido,
} from './tipos-indice.js';

interface Banco {
  readonly cadastros: Map<number, CadastroRedeLido>;
  readonly pessoas: Set<string>;
  readonly vinculos: Map<string, VinculoRedeLido & { id: number }>;
  readonly candidatos: Map<string, CandidatoRedeLido & { id: number }>;
  marca: MarcaRede | null;
  duplicidades: Set<string>;
  trilha: (TrilhaRede & { readonly estabelecimentoDoBanco: string })[];
  seq: number;
}

function cpfSintetico(base9: string): string {
  const d = base9.split('').map(Number);
  for (const n of [9, 10]) {
    let s = 0;
    for (let k = 0; k < n; k++) s += (d[k] as number) * (n + 1 - k);
    const r = (s * 10) % 11;
    d.push(r === 10 ? 0 : r);
  }
  return d.join('');
}

type Semente = Omit<
  CadastroRedeLido,
  'estabelecimento' | 'nomeFoneticoBanco' | 'maeFoneticaBanco' | 'atualizadoEm'
>;

const c = (
  id: number,
  nome: string,
  mae: string | null,
  nascimento: string | null,
  sexo: 'F' | 'M',
  cpf: string | null,
): Semente => ({
  id,
  prontuario: 50_000 + id,
  nome,
  mae,
  nascimento,
  sexo,
  cpf,
  cns: null,
  ativo: true,
  idUnificado: id,
});

/**
 * A massa SINTÉTICA dos dois primeiros estabelecimentos (o primeiro é o "local", o segundo o "remoto"):
 *   - par 1 (IDs 1 e 101): CPF, nome, mãe, nascimento e sexo iguais → vínculo automático;
 *   - par 2 (2 e 102): CPF igual com o nascimento diferente → fila (média, divergência);
 *   - par 3 (3 e 103): sem CPF de um lado, nome, mãe e nascimento iguais → fila (baixa);
 *   - par 4 (4 e 104): CPF, nome, mãe e nascimento iguais com o sexo diferente → fila (alta, divergência);
 *   - 5 e 6: o mesmo CPF no MESMO estabelecimento → fila de duplicidades do cadastro (regra 5), nunca a da Rede;
 *   - 7 (inativo) e 107: CPF igual, mas o inativo não pareia.
 */
export function massaSinteticaRede(): { local: Semente[]; remoto: Semente[] } {
  const cpf = (n: number) => cpfSintetico(`9000005${String(n).padStart(2, '0')}`);
  return {
    local: [
      c(1, 'ANA SINTETICA PRIMEIRA', 'MAE SINTETICA UM', '1980-05-17', 'F', cpf(1)),
      c(2, 'BRUNO SINTETICO SEGUNDO', 'MAE SINTETICA DOIS', '1975-02-03', 'M', cpf(2)),
      c(3, 'CARLA SINTETICA TERCEIRA', 'MAE SINTETICA TRES', '1990-09-09', 'F', null),
      c(4, 'DANIEL SINTETICO QUARTO', 'MAE SINTETICA QUATRO', '1966-12-01', 'M', cpf(4)),
      c(5, 'EDUARDO SINTETICO QUINTO', 'MAE SINTETICA CINCO', '1988-07-07', 'M', cpf(5)),
      c(6, 'EDUARDO SINTETICO QUINTO', 'MAE SINTETICA CINCO', '1988-07-07', 'M', cpf(5)),
      { ...c(7, 'FABIA SINTETICA SETIMA', 'MAE SINTETICA SETE', '1999-01-01', 'F', cpf(7)), ativo: false },
    ],
    remoto: [
      c(101, 'ANA SINTETICA PRIMEIRA', 'MAE SINTETICA UM', '1980-05-17', 'F', cpf(1)),
      c(102, 'BRUNO SINTETICO SEGUNDO', 'MAE SINTETICA DOIS', '1975-03-02', 'M', cpf(2)),
      c(103, 'CARLA SINTETICA TERCEIRA', 'MAE SINTETICA TRES', '1990-09-09', 'F', cpf(3)),
      c(104, 'DANIEL SINTETICO QUARTO', 'MAE SINTETICA QUATRO', '1966-12-01', 'F', cpf(4)),
      c(107, 'FABIA SINTETICA SETIMA', 'MAE SINTETICA SETE', '1999-01-01', 'F', cpf(7)),
    ],
  };
}

const fonetica = (v: string | null) => (v ? normalizarChave(v) || null : null);

function novoBanco(est: string, sementes: readonly Semente[]): Banco {
  const cadastros = new Map<number, CadastroRedeLido>();
  for (const s of sementes)
    cadastros.set(s.id, {
      ...s,
      estabelecimento: est,
      nomeFoneticoBanco: fonetica(s.nome),
      maeFoneticaBanco: fonetica(s.mae),
      atualizadoEm: '2026-10-01T10:00:00.000',
    });
  return {
    cadastros,
    pessoas: new Set(),
    vinculos: new Map(),
    candidatos: new Map(),
    marca: null,
    duplicidades: new Set(),
    trilha: [],
    seq: 0,
  };
}

export interface OpcoesPortaRedeMemoria {
  readonly rede: string;
  readonly estabelecimentos: readonly EstabelecimentoRede[];
  /** Cadastros por estabelecimento (padrão: a massa sintética nos dois primeiros). */
  readonly cadastros?: Readonly<Record<string, readonly Semente[]>>;
  /**
   * Etapa 2: atendimentos e internações por prontuário em cada estabelecimento (padrão: o cadastro 101 do segundo, par
   * do 1 do primeiro, com 3 atendimentos e 1 internação SINTÉTICOS; os demais sem nenhum).
   */
  readonly atendimentos?: Readonly<Record<string, Readonly<Record<number, AtendimentosRede>>>>;
  /**
   * Correção do M57.2: o CPF SINTÉTICO de cada login por estabelecimento (null: o login não existe lá). Padrão: o mesmo
   * CPF sintético, derivado do login, em todos (a sessão sintética é a mesma pessoa nos bancos sintéticos).
   */
  readonly cpfsDeLogin?: Readonly<Record<string, Readonly<Record<string, string | null>>>>;
}

/** CPF SINTÉTICO (11 dígitos) derivado do login: o mesmo em todos os bancos sintéticos. */
function cpfSinteticoDoLogin(login: string): string {
  let h = 7;
  for (const ch of login) h = (h * 31 + ch.charCodeAt(0)) % 1_000_000_000;
  return `99${String(h).padStart(9, '0')}`;
}

/** Os atendimentos SINTÉTICOS padrão do segundo estabelecimento (só contagens e datas). */
export const ATENDIMENTOS_SINTETICOS_REDE: Readonly<Record<number, AtendimentosRede>> = {
  50_101: {
    atendimentos: 3,
    ultimoAtendimento: '2026-09-14',
    internacoes: 1,
    ultimaInternacao: '2026-08-02',
  },
};

export class PortaRedeMemoria implements PortaRede {
  readonly destino = 'memoria' as const;
  private readonly bancos = new Map<string, Banco>();
  /** Estabelecimentos cujo banco está "fora do ar" para gravar (teste da queda entre as duas gravações). */
  readonly falharEm = new Set<string>();
  /** Etapa 2: estabelecimentos cujo banco não responde à leitura dos atendimentos (o aviso diz "não respondeu"). */
  readonly falharLeituraEm = new Set<string>();

  constructor(private readonly opcoes: OpcoesPortaRedeMemoria) {
    const m = massaSinteticaRede();
    opcoes.estabelecimentos.forEach((e, i) => {
      const sementes = opcoes.cadastros?.[e.codigo] ?? (i === 0 ? m.local : i === 1 ? m.remoto : []);
      this.bancos.set(e.codigo, novoBanco(e.codigo, sementes));
    });
  }

  redeConfigurada(): string {
    return this.opcoes.rede;
  }

  estabelecimentos(): readonly EstabelecimentoRede[] {
    return this.opcoes.estabelecimentos;
  }

  private banco(c: ContextoRede): Banco {
    if (c.rede !== this.opcoes.rede)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Fora da rede',
        'A rede da sessão não é a desta configuração.',
      );
    const b = this.bancos.get(c.hospital);
    if (!b) throw new ErroProblema('indisponivel', 503, 'Banco do estabelecimento indisponível');
    return b;
  }

  /** Só para testes: o estado de um banco (contagens; nada de dado pessoal sai daqui para a tela). */
  estado(est: string): Banco | undefined {
    return this.bancos.get(est);
  }

  async cadastrosPorIds(c: ContextoRede, ids: readonly number[]) {
    const b = this.banco(c);
    return [...new Set(ids)]
      .map((i) => b.cadastros.get(i))
      .filter((x): x is CadastroRedeLido => !!x)
      .sort((x, y) => x.id - y.id);
  }

  async procurarCandidatos(c: ContextoRede, k: ChavesProcuraRede) {
    const b = this.banco(c);
    const r = new Set<number>();
    for (const x of b.cadastros.values()) {
      if (!x.ativo) continue;
      if (k.cpf && x.cpf === k.cpf) r.add(x.id);
      if (k.cns && x.cns === k.cns) r.add(x.id);
      if (k.nomeFoneticoBanco && x.nomeFoneticoBanco === k.nomeFoneticoBanco) {
        if (k.nascimento && x.nascimento === k.nascimento) r.add(x.id);
        if (k.maeFoneticaBanco && x.maeFoneticaBanco === k.maeFoneticaBanco) r.add(x.id);
      }
    }
    return [...r].sort((x, y) => x - y);
  }

  async loteCadastros(c: ContextoRede, depoisDoId: number, tamanho: number) {
    const itens = [...this.banco(c).cadastros.values()]
      .filter((x) => x.id > depoisDoId)
      .sort((x, y) => x.id - y.id)
      .slice(0, tamanho);
    return { itens, ultimoId: itens.length ? (itens[itens.length - 1] as CadastroRedeLido).id : depoisDoId };
  }

  async cadastrosAlterados(c: ContextoRede, desde: Date, depoisDoId: number, tamanho: number) {
    const d = desde.toISOString().slice(0, 23);
    const em = (x: CadastroRedeLido) => (x.atualizadoEm ?? '').replace(/Z$/, '');
    return [...this.banco(c).cadastros.values()]
      .filter((x) => x.atualizadoEm !== null && (em(x) > d || (em(x) === d && x.id > depoisDoId)))
      .sort((x, y) => (em(x) < em(y) ? -1 : em(x) > em(y) ? 1 : x.id - y.id))
      .slice(0, tamanho);
  }

  async fila(c: ContextoRede, f: Parameters<PortaRede['fila']>[1]) {
    const todos = [...this.banco(c).candidatos.values()]
      .filter(
        (x) =>
          x.situacao === f.situacao &&
          (f.pontuacaoMinima === undefined || x.pontuacao >= f.pontuacaoMinima) &&
          (f.pontuacaoMaxima === undefined || x.pontuacao <= f.pontuacaoMaxima) &&
          (!f.estabelecimentoRemoto || x.estabelecimentoRemoto === f.estabelecimentoRemoto) &&
          (!f.estabelecimentosRemotos || f.estabelecimentosRemotos.includes(x.estabelecimentoRemoto)) &&
          (f.prontuarioLocal === undefined || x.prontuarioLocal === f.prontuarioLocal),
      )
      .sort(
        (x, y) =>
          Number(!x.criterios.includes('cpf')) - Number(!y.criterios.includes('cpf')) ||
          y.pontuacao - x.pontuacao ||
          x.id - y.id,
      );
    const ini = (f.pagina - 1) * f.porPagina;
    return { itens: todos.slice(ini, ini + f.porPagina), total: todos.length };
  }

  async filaPorFaixa(c: ContextoRede, situacao: CandidatoRedeLido['situacao'], f: RecorteFilaRede = {}) {
    const r = { alta: 0, media: 0, baixa: 0 };
    for (const x of this.banco(c).candidatos.values()) {
      if (
        x.situacao !== situacao ||
        (f.estabelecimentoRemoto && x.estabelecimentoRemoto !== f.estabelecimentoRemoto) ||
        (f.estabelecimentosRemotos && !f.estabelecimentosRemotos.includes(x.estabelecimentoRemoto)) ||
        (f.prontuarioLocal !== undefined && x.prontuarioLocal !== f.prontuarioLocal)
      )
        continue;
      if (x.pontuacao >= 85) r.alta++;
      else if (x.pontuacao >= 70) r.media++;
      else r.baixa++;
    }
    return r;
  }

  async candidato(c: ContextoRede, chave: string) {
    return this.banco(c).candidatos.get(chave) ?? null;
  }

  async situacoes(c: ContextoRede, chaves: readonly string[]) {
    const b = this.banco(c);
    const r = new Map<string, CandidatoRedeLido['situacao'] | 'reaberto'>();
    for (const k of chaves) {
      const x = b.candidatos.get(k);
      if (x) r.set(k, x.situacao === 'aberto' && x.origem === 'humano' ? 'reaberto' : x.situacao);
    }
    return r;
  }

  async vinculo(c: ContextoRede, chave: string) {
    return this.banco(c).vinculos.get(chave) ?? null;
  }

  async vinculosDoCadastro(c: ContextoRede, id: number) {
    return [...this.banco(c).vinculos.values()].filter((v) => v.idLocal === id).sort((x, y) => y.id - x.id);
  }

  async pessoasDosCadastros(c: ContextoRede, ids: readonly number[]) {
    const r = new Map<number, string>();
    const s = new Set(ids);
    for (const v of [...this.banco(c).vinculos.values()].sort((x, y) => x.id - y.id))
      if (v.situacao === 'ativo' && s.has(v.idLocal) && !r.has(v.idLocal)) r.set(v.idLocal, v.pessoa);
    return r;
  }

  async loteVinculos(c: ContextoRede, depoisDoId: number, tamanho: number) {
    const itens = [...this.banco(c).vinculos.values()]
      .filter((v) => v.id > depoisDoId)
      .sort((x, y) => x.id - y.id)
      .slice(0, tamanho);
    return { itens, ultimoId: itens.length ? (itens[itens.length - 1] as { id: number }).id : depoisDoId };
  }

  async marca(c: ContextoRede) {
    return this.banco(c).marca;
  }

  async atendimentos(c: ContextoRede, prontuario: number): Promise<AtendimentosRede> {
    this.banco(c);
    if (this.falharLeituraEm.has(c.hospital))
      throw new ErroProblema('indisponivel', 503, 'Banco do estabelecimento indisponível (simulado)');
    const i = this.opcoes.estabelecimentos.findIndex((e) => e.codigo === c.hospital);
    const porProntuario =
      this.opcoes.atendimentos?.[c.hospital] ?? (i === 1 ? ATENDIMENTOS_SINTETICOS_REDE : {});
    return (
      porProntuario[prontuario] ?? {
        atendimentos: 0,
        ultimoAtendimento: null,
        internacoes: 0,
        ultimaInternacao: null,
      }
    );
  }

  async cpfDoLogin(c: ContextoRede, login: string): Promise<string | null> {
    this.banco(c);
    const porLogin = this.opcoes.cpfsDeLogin?.[c.hospital];
    if (porLogin) return porLogin[login] ?? null;
    return cpfSinteticoDoLogin(login);
  }

  async gravar<T>(
    c: ContextoRede,
    fn: (g: GravadorRede) => Promise<T>,
    trilha: TrilhaRede | null,
  ): Promise<T> {
    const b = this.banco(c);
    if (this.falharEm.has(c.hospital))
      throw new ErroProblema('indisponivel', 503, 'Banco do estabelecimento indisponível');
    // A "transação": tudo numa cópia e só confirma no fim (falha no meio não deixa meio gravado).
    const copia: Banco = {
      cadastros: b.cadastros,
      pessoas: new Set(b.pessoas),
      vinculos: new Map(b.vinculos),
      candidatos: new Map(b.candidatos),
      marca: b.marca,
      duplicidades: new Set(b.duplicidades),
      trilha: [...b.trilha],
      seq: b.seq,
    };
    const r = await fn(this.gravador(c.hospital, copia));
    if (trilha) copia.trilha.push({ ...trilha, estabelecimentoDoBanco: c.hospital });
    this.bancos.set(c.hospital, copia);
    return r;
  }

  private gravador(est: string, b: Banco): GravadorRede {
    return {
      escritas: async (ws: readonly EscritaIndiceRede[]) => {
        for (const w of ws)
          if (w.alvo === 'vinculo' && w.linha.estabelecimento !== est)
            throw new Error('Linha de vínculo de outro estabelecimento no plano deste banco.');
        let gravadas = 0;
        let jaEstavam = 0;
        for (const w of ws) {
          if (w.alvo === 'pessoa') {
            if (b.pessoas.has(w.pessoa)) jaEstavam++;
            else {
              b.pessoas.add(w.pessoa);
              gravadas++;
            }
          } else if (w.alvo === 'vinculo') {
            if (!b.pessoas.has(w.linha.pessoa))
              throw new Error('Pessoa da Rede ausente (chave estrangeira).');
            const atual = b.vinculos.get(w.linha.chave);
            const l = w.linha;
            if (
              atual &&
              atual.pessoa === l.pessoa &&
              atual.situacao === l.situacao &&
              atual.origem === l.origem &&
              (atual.desfeitoEm === null) === (l.desfeitoEm === null)
            ) {
              jaEstavam++;
              continue;
            }
            b.vinculos.set(l.chave, { ...l, estabelecimento: est, id: atual?.id ?? ++b.seq });
            gravadas++;
          } else {
            const atual = b.candidatos.get(w.chave);
            if (!atual || atual.situacao === w.situacao) {
              jaEstavam++;
              continue;
            }
            b.candidatos.set(w.chave, {
              ...atual,
              situacao: w.situacao,
              origem: w.situacao === 'aberto' ? (w.origem ?? null) : (w.origem ?? 'humano'),
              decididoPor: w.por,
              decididoEm: w.em,
            });
            gravadas++;
          }
        }
        return { gravadas, jaEstavam };
      },
      candidatos: async (cs: readonly CandidatoParaGravarRede[]) => {
        let novos = 0;
        let atualizados = 0;
        let mantidos = 0;
        for (const x of cs) {
          const atual = b.candidatos.get(x.chave);
          // Reaberto por uma pessoa (aberto, origem humano): só a pontuação muda; nunca sobe a vinculado.
          const reaberto = atual?.situacao === 'aberto' && atual.origem === 'humano';
          const decidido = x.situacao === 'vinculado' && !reaberto;
          const linha = {
            estabelecimento: est,
            chave: x.chave,
            idLocal: x.idLocal,
            prontuarioLocal: x.prontuarioLocal,
            estabelecimentoRemoto: x.estabelecimentoRemoto,
            idRemoto: x.idRemoto,
            prontuarioRemoto: x.prontuarioRemoto,
            pontuacao: Math.max(0, Math.min(100, Math.round(x.pontuacao))),
            criterios: [...x.criterios],
            divergencias: [...x.divergencias],
            situacao: decidido ? ('vinculado' as const) : ('aberto' as const),
            origem: decidido ? ('automatico' as const) : reaberto ? ('humano' as const) : null,
            decididoPor: decidido ? x.por : reaberto ? atual.decididoPor : null,
            decididoEm: decidido ? x.em : reaberto ? atual.decididoEm : null,
            criadoEm: atual?.criadoEm ?? x.em,
          };
          if (!atual) {
            b.candidatos.set(x.chave, { ...linha, id: ++b.seq });
            novos++;
          } else if (atual.situacao !== 'aberto') mantidos++;
          else if (
            !decidido &&
            atual.pontuacao === linha.pontuacao &&
            atual.criterios.join(',') === linha.criterios.join(',') &&
            atual.divergencias.join(',') === linha.divergencias.join(',')
          )
            mantidos++;
          else {
            b.candidatos.set(x.chave, { ...linha, id: atual.id, criadoEm: atual.criadoEm });
            atualizados++;
          }
        }
        return { novos, atualizados, mantidos };
      },
      marca: async (m: MarcaRede) => {
        b.marca = { ...m };
      },
      duplicidadesLocais: async (pares: readonly ParNovo[]) => {
        let n = 0;
        for (const p of pares) {
          const k = [p.a.id, p.b.id].sort((x, y) => x - y).join('|');
          if (b.duplicidades.has(k)) continue;
          b.duplicidades.add(k);
          n++;
        }
        return n;
      },
    };
  }
}

/**
 * Os estabelecimentos da sessão sintética para o MPI: os configurados, e (só dev/ci) o estabelecimento SINTÉTICO da rede
 * de REDE_SINTETICA_SEGUNDO ("cod:Nome"), para o E2E ter dois bancos quando só um está configurado.
 */
export function estabelecimentosSinteticosRede(
  configurados: readonly EstabelecimentoRede[],
  segundo: string | undefined,
): EstabelecimentoRede[] {
  const r = [...configurados];
  const s = segundo?.trim();
  if (s) {
    const i = s.indexOf(':');
    const codigo = (i === -1 ? s : s.slice(0, i)).trim();
    const nome = (i === -1 ? '' : s.slice(i + 1)).trim() || `Estabelecimento sintético ${codigo}`;
    if (!/^[a-z][a-z0-9]{1,9}$/.test(codigo)) throw new Error('REDE_SINTETICA_SEGUNDO: código inválido.');
    if (!r.some((e) => e.codigo === codigo)) r.push({ codigo, nome });
  }
  return r;
}
