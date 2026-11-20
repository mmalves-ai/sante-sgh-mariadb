// Porta do índice em memória para os testes da orquestração (M57, etapa 1): cada estabelecimento é um "banco" com
// cadastros SINTÉTICOS e as tabelas do índice; `gravar` aplica numa cópia e só confirma no fim (a transação de um
// banco); `falhar` simula a queda de um banco. Nenhum dado de pessoa real.
import type { OrigemVinculoRede, SituacaoCandidatoRede, SituacaoParAnteriorRede } from '@sgh/contratos';
import type { VinculoIndice } from './indice.js';
import type {
  CadastroLidoRede,
  CandidatoParaGravar,
  GravadorIndiceRede,
  MarcaPareamento,
  ParDuplicidadeLocal,
  PortaIndiceRede,
  RotuloGravacao,
} from './orquestracao.js';
import type { CadastroRede } from './cadastro.js';

export interface BancoMemoria {
  cadastros: CadastroLidoRede[];
  pessoas: Set<string>;
  vinculos: Map<string, VinculoIndice & { id: number }>;
  candidatos: Map<
    string,
    Omit<CandidatoParaGravar, 'situacao'> & {
      situacao: SituacaoCandidatoRede;
      origem?: OrigemVinculoRede | null;
    }
  >;
  marca: MarcaPareamento | null;
  duplicidades: ParDuplicidadeLocal[];
  rotulos: RotuloGravacao[];
  seq: number;
}

export function lido(c: CadastroRede, extra: Partial<CadastroLidoRede> = {}): CadastroLidoRede {
  return {
    ...c,
    nomeFoneticoBanco: c.nome,
    maeFoneticaBanco: c.mae,
    atualizadoEm: '2026-10-01T10:00:00.000',
    ...extra,
  };
}

export class PortaIndiceMemoria implements PortaIndiceRede {
  readonly bancos = new Map<string, BancoMemoria>();
  readonly falhar = new Set<string>();

  constructor(cadastros: Readonly<Record<string, readonly CadastroLidoRede[]>>) {
    for (const [est, cs] of Object.entries(cadastros))
      this.bancos.set(est, {
        cadastros: [...cs],
        pessoas: new Set(),
        vinculos: new Map(),
        candidatos: new Map(),
        marca: null,
        duplicidades: [],
        rotulos: [],
        seq: 0,
      });
  }

  b(est: string): BancoMemoria {
    const x = this.bancos.get(est);
    if (!x) throw new Error(`banco ${est} ausente`);
    return x;
  }

  async marca(est: string) {
    return this.b(est).marca;
  }
  async loteCadastros(est: string, depois: number, n: number) {
    const itens = this.b(est)
      .cadastros.filter((c) => c.id > depois)
      .sort((x, y) => x.id - y.id)
      .slice(0, n);
    return { itens, ultimoId: itens.at(-1)?.id ?? depois };
  }
  async cadastrosAlterados(est: string, desde: Date, depoisDoId: number, n: number) {
    const d = desde.toISOString().slice(0, 23);
    const em = (c: CadastroLidoRede) => (c.atualizadoEm ?? '').replace(/Z$/, '');
    return this.b(est)
      .cadastros.filter((c) => c.atualizadoEm !== null && (em(c) > d || (em(c) === d && c.id > depoisDoId)))
      .sort((x, y) => (em(x) < em(y) ? -1 : em(x) > em(y) ? 1 : x.id - y.id))
      .slice(0, n);
  }
  async procurarCandidatos(
    est: string,
    k: Parameters<PortaIndiceRede['procurarCandidatos']>[1],
  ): Promise<number[]> {
    return this.b(est)
      .cadastros.filter(
        (c) =>
          c.ativo &&
          ((k.cpf !== null && String(c.cpf) === k.cpf) ||
            (k.nomeFoneticoBanco !== null &&
              c.nomeFoneticoBanco === k.nomeFoneticoBanco &&
              (c.nascimento === k.nascimento || c.maeFoneticaBanco === k.maeFoneticaBanco))),
      )
      .map((c) => c.id);
  }
  async cadastrosPorIds(est: string, ids: readonly number[]) {
    return this.b(est).cadastros.filter((c) => ids.includes(c.id));
  }
  async situacoes(est: string, chaves: readonly string[]) {
    const m = new Map<string, SituacaoParAnteriorRede>();
    for (const k of chaves) {
      const x = this.b(est).candidatos.get(k);
      if (x) m.set(k, x.situacao === 'aberto' && x.origem === 'humano' ? 'reaberto' : x.situacao);
    }
    return m;
  }
  async pessoasDosCadastros(est: string, ids: readonly number[]) {
    const m = new Map<number, string>();
    for (const v of this.b(est).vinculos.values())
      if (v.situacao === 'ativo' && ids.includes(v.idLocal)) m.set(v.idLocal, v.pessoa);
    return m;
  }
  async loteVinculos(est: string, depois: number, n: number) {
    const itens = [...this.b(est).vinculos.values()].filter((v) => v.id > depois).slice(0, n);
    return { itens, ultimoId: itens.at(-1)?.id ?? depois };
  }
  async gravar<T>(
    est: string,
    fn: (g: GravadorIndiceRede) => Promise<T>,
    rotulo: RotuloGravacao,
  ): Promise<T> {
    if (this.falhar.has(est)) throw new Error(`banco ${est} fora (simulado)`);
    const o = this.b(est);
    const b: BancoMemoria = {
      ...o,
      pessoas: new Set(o.pessoas),
      vinculos: new Map(o.vinculos),
      candidatos: new Map(o.candidatos),
      duplicidades: [...o.duplicidades],
      rotulos: [...o.rotulos],
    };
    const g: GravadorIndiceRede = {
      escritas: async (ws) => {
        let gravadas = 0;
        let jaEstavam = 0;
        for (const w of ws) {
          if (w.tabela === 'SGH_REDE_PESSOA') {
            if (b.pessoas.has(w.pessoa)) jaEstavam++;
            else {
              b.pessoas.add(w.pessoa);
              gravadas++;
            }
          } else if (w.tabela === 'SGH_REDE_VINCULO') {
            const a = b.vinculos.get(w.linha.chave);
            if (a && a.situacao === w.linha.situacao && a.pessoa === w.linha.pessoa) jaEstavam++;
            else {
              b.vinculos.set(w.linha.chave, { ...w.linha, id: a?.id ?? ++b.seq });
              gravadas++;
            }
          } else {
            const a = b.candidatos.get(w.chave);
            if (!a || a.situacao === w.situacao) jaEstavam++;
            else {
              b.candidatos.set(w.chave, {
                ...a,
                situacao: w.situacao,
                origem: w.situacao === 'aberto' ? (w.origem ?? null) : (w.origem ?? 'humano'),
              });
              gravadas++;
            }
          }
        }
        return { gravadas, jaEstavam };
      },
      candidatos: async (cs) => {
        for (const c of cs) {
          const a = b.candidatos.get(c.chave);
          if (!a)
            b.candidatos.set(c.chave, { ...c, origem: c.situacao === 'vinculado' ? 'automatico' : null });
          else if (a.situacao === 'aberto') {
            // O par reaberto por uma pessoa nunca sobe a vinculado pelo automático (e guarda a marca).
            const reaberto = a.origem === 'humano';
            b.candidatos.set(c.chave, {
              ...c,
              situacao: reaberto ? 'aberto' : c.situacao,
              origem: reaberto ? 'humano' : c.situacao === 'vinculado' ? 'automatico' : null,
            });
          }
        }
      },
      marca: async (m) => {
        b.marca = m;
      },
      duplicidadesLocais: async (ps) => {
        b.duplicidades.push(...ps);
        return ps.length;
      },
    };
    const r = await fn(g);
    b.rotulos.push(rotulo);
    this.bancos.set(est, b);
    return r;
  }
}
