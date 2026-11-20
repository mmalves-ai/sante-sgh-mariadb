// Banco FALSO em memória para os testes da imagem antes/depois e da correção do "como" (ADR 0021). Entende só
// os comandos que nucleo/como.ts e suporte/correcao.ts montam (catálogo de chave e colunas, SELECT com
// igualdades, INSERT … VALUES com RETURNING, UPDATE … SET … WHERE, DELETE … WHERE, NEXT VALUE FOR, a leitura
// das imagens). Tabelas e dados sintéticos; nada conecta a banco. Um "gatilho" BI gera o ID quando vem nulo.
import type { Linha } from './driver.js';
import type { Escritor } from './transacao.js';

export interface TabelaFalsa {
  readonly chave: readonly string[];
  readonly colunas: readonly string[];
  /** Colunas COMPUTED BY (aparecem no catálogo, nunca são graváveis). */
  readonly calculadas?: readonly string[];
  readonly linhas: Linha[];
  /** Gatilho BI: gera o valor da chave numérica quando vem nulo. */
  readonly gerador?: string;
  /** M10: gatilho BI/BU qualquer (gera ID vindo 0, preenche padrão, recusa), sobre a linha a gravar. */
  readonly antes?: (linha: Linha, seq: () => number) => void;
  /** M10: gatilho AU qualquer (efeito em outra tabela), sobre a linha já alterada. */
  readonly depoisAlterar?: (linha: Linha) => void;
  /** M10: restrição única além da chave (colunas), como um índice UNIQUE. */
  readonly unica?: readonly string[];
}

export interface Comando {
  readonly tipo: 'consultar' | 'executar' | 'retornando';
  readonly sql: string;
  readonly parametros: readonly unknown[];
}

const limpo = (c: string) => c.trim().replace(/^"|"$/g, '').toUpperCase();
const semApelido = (c: string) => limpo(c.replace(/^[A-Za-z_][A-Za-z0-9_]*\./, ''));

export class BancoFalso {
  readonly tabelas = new Map<string, TabelaFalsa>();
  readonly comandos: Comando[] = [];
  private seq = 100;
  /** Falha simulada ao gravar nesta tabela. */
  falharEm: string | null = null;

  tabela(nome: string, t: TabelaFalsa): this {
    this.tabelas.set(nome, t);
    return this;
  }

  copia(nome: string): Linha[] {
    return (this.tabelas.get(nome)?.linhas ?? []).map((l) => ({ ...l }));
  }

  private t(nome: string): TabelaFalsa {
    const t = this.tabelas.get(nome.toUpperCase());
    if (!t) throw new Error(`tabela desconhecida no banco falso: ${nome}`);
    return t;
  }

  private onde(cond: string, parametros: readonly unknown[]): (l: Linha) => boolean {
    const partes = cond.split(/\s+AND\s+/i).map((p) => /^\s*([A-Za-z0-9_.$"]+)\s*=\s*\?\s*$/.exec(p));
    if (partes.some((p) => !p)) throw new Error(`condição não suportada: ${cond}`);
    const pares = partes.map((p, i) => [semApelido(p![1]!), parametros[i]] as const);
    const igual = (a: unknown, b: unknown) =>
      a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : String(a) === String(b);
    return (l) => pares.every(([c, v]) => igual(l[c], v));
  }

  escritor(hospital = 'pc'): Escritor {
    const registrar = (c: Comando) => this.comandos.push(c);
    return {
      hospital,
      consultar: async <T extends Linha>(sql: string, p: readonly unknown[] = []) => {
        registrar({ tipo: 'consultar', sql, parametros: p });
        return this.consultar(sql, p) as T[];
      },
      lerBlob: async (b: unknown) => (Buffer.isBuffer(b) ? b : Buffer.from(String(b))),
      executar: async (sql: string, p: readonly unknown[] = []) => {
        registrar({ tipo: 'executar', sql, parametros: p });
        return this.executar(sql, p).n;
      },
      executarRetornando: async (sql: string, p: readonly unknown[] = []) => {
        registrar({ tipo: 'retornando', sql, parametros: p });
        const r = this.executar(sql, p);
        if (!r.linha) throw new Error('sem RETURNING');
        return r.linha;
      },
    };
  }

  private consultar(sql: string, p: readonly unknown[]): Linha[] {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.includes('RDB$RELATION_CONSTRAINTS')) {
      const t = this.tabelas.get(String(p[0]));
      return (t?.chave ?? []).map((c) => ({ C: c }));
    }
    if (s.includes('RDB$RELATION_FIELDS')) {
      const t = this.tabelas.get(String(p[0]));
      return (t?.colunas ?? []).filter((c) => !t?.calculadas?.includes(c)).map((c) => ({ C: c }));
    }
    if (/NEXT VALUE FOR/.test(s)) {
      const id = String(++this.seq);
      return [
        { ID: id, I: new Date(0), F: new Date(3_600_000), H: '2026-10-20 12:00:00.0000', D: '2026-10-20' },
      ];
    }
    if (s.includes('FROM SGH_SUP_IMAGEM i')) {
      const sessao = String(p[0]);
      const acao = p[1] === undefined ? null : String(p[1]);
      const correcoes = this.tabelas.get('SGH_SUP_CORRECAO')?.linhas ?? [];
      return this.t('SGH_SUP_IMAGEM')
        .linhas.filter(
          (l) => String(l['ID_SESSAO']) === sessao && (acao === null || String(l['ID_ACAO']) === acao),
        )
        .map((l) => ({
          ...l,
          CORRIGIDA: correcoes.filter((c) => String(c['ID_IMAGEM']) === String(l['ID'])).length,
        }));
    }
    if (/^SELECT FIRST 1 HASH_LINHA FROM SGH_TRILHA/.test(s)) return [];
    const m =
      /^SELECT (.+?) FROM ([A-Z0-9_$]+)(?: ([A-Za-z_][A-Za-z0-9_]*))?(?: WHERE (.+?))?( WITH LOCK)?$/.exec(s);
    if (!m) throw new Error(`consulta não suportada: ${s}`);
    const t = this.t(m[2]!);
    const filtro = m[4] ? this.onde(m[4], p) : () => true;
    if (m[1] === 'COUNT(*) N') return [{ N: t.linhas.filter(filtro).length }];
    const cols = m[1]!.split(',').map(semApelido);
    return t.linhas.filter(filtro).map((l) => Object.fromEntries(cols.map((c) => [c, l[c] ?? null])));
  }

  private executar(sql: string, p: readonly unknown[]): { n: number; linha: Linha | null } {
    const s = sql.replace(/\s+/g, ' ').trim();
    const ins = /^INSERT INTO ([A-Z0-9_$]+) \(([^)]*)\) VALUES \((.*)\)(?: RETURNING (.+))?$/.exec(s);
    if (ins) {
      const nome = ins[1]!;
      if (this.falharEm === nome) throw new Error(`falha simulada em ${nome}`);
      const t = this.t(nome);
      const cols = ins[2]!.split(',').map(limpo);
      const valores = ins[3]!;
      // Cada coluna tem um "?" (direto ou dentro de CAST); literais 'S'/'N' contam como valor fixo.
      const pedacos = valoresDeCima(valores);
      let i = 0;
      const linha: Linha = Object.fromEntries(t.colunas.map((c) => [c, null]));
      cols.forEach((c, k) => {
        const v = pedacos[k] ?? '?';
        if (v.includes('?')) linha[c] = p[i++] ?? null;
        else if (/^'.*'$/.test(v)) linha[c] = v.slice(1, -1);
        else if (/CURRENT_TIMESTAMP/.test(v)) linha[c] = new Date(0);
      });
      if (t.gerador && (linha[t.gerador] === null || linha[t.gerador] === undefined))
        linha[t.gerador] = ++this.seq;
      t.antes?.(linha, () => ++this.seq);
      if (t.chave.length > 0 && t.linhas.some((l) => t.chave.every((c) => String(l[c]) === String(linha[c]))))
        throw new Error(`violation of PRIMARY or UNIQUE KEY constraint "PK_${nome}" on table "${nome}"`);
      if (t.unica && t.linhas.some((l) => t.unica!.every((c) => String(l[c]) === String(linha[c]))))
        throw new Error(`violation of PRIMARY or UNIQUE KEY constraint "UQ_${nome}" on table "${nome}"`);
      t.linhas.push(linha);
      const ret = ins[4]?.split(',').map(limpo) ?? null;
      return { n: 1, linha: ret ? Object.fromEntries(ret.map((c) => [c, linha[c]])) : null };
    }
    const upd = /^UPDATE ([A-Z0-9_$]+) SET (.+?) WHERE (.+)$/.exec(s);
    if (upd) {
      const nome = upd[1]!;
      if (this.falharEm === nome) throw new Error(`falha simulada em ${nome}`);
      const t = this.t(nome);
      const sets = upd[2]!.split(',').map((x) => /^\s*([A-Z0-9_$]+)\s*=\s*(.+?)\s*$/.exec(x)!);
      let i = 0;
      const valores = sets.map(([, c, v]) => [c!, v!.includes('?') ? p[i++] : v] as const);
      const filtro = this.onde(upd[3]!, p.slice(i));
      let n = 0;
      for (const l of t.linhas.filter(filtro)) {
        for (const [c, v] of valores) l[c] = v;
        t.depoisAlterar?.(l);
        n++;
      }
      return { n, linha: null };
    }
    const del = /^DELETE FROM ([A-Z0-9_$]+) WHERE (.+)$/.exec(s);
    if (del) {
      const t = this.t(del[1]!);
      const filtro = this.onde(del[2]!, p);
      const antes = t.linhas.length;
      const ficam = t.linhas.filter((l) => !filtro(l));
      t.linhas.splice(0, t.linhas.length, ...ficam);
      return { n: antes - ficam.length, linha: null };
    }
    throw new Error(`comando não suportado: ${s}`);
  }
}

/** Valores de VALUES (…) separados no nível de cima (CAST(CAST(? AS …) AS …) conta como um). */
function valoresDeCima(texto: string): string[] {
  const r: string[] = [];
  let nivel = 0;
  let atual = '';
  for (const c of texto) {
    if (c === '(') nivel++;
    if (c === ')') nivel--;
    if (c === ',' && nivel === 0) {
      r.push(atual.trim());
      atual = '';
    } else atual += c;
  }
  if (atual.trim()) r.push(atual.trim());
  return r;
}

/** Banco com as tabelas do suporte e uma tabela de teste com chave gerada e coluna calculada. */
export function bancoDoSuporte(): BancoFalso {
  return new BancoFalso()
    .tabela('TBTESTE', {
      chave: ['ID'],
      colunas: ['ID', 'NOME', 'VALOR', 'QUANDO', 'DOBRO'],
      calculadas: ['DOBRO'],
      gerador: 'ID',
      linhas: [
        { ID: 1, NOME: 'Um', VALOR: 10, QUANDO: new Date(Date.UTC(2026, 0, 1)), DOBRO: 20 },
        { ID: 2, NOME: 'Dois', VALOR: 20, QUANDO: null, DOBRO: 40 },
      ],
    })
    .tabela('TBUSERS', {
      chave: ['NOME'],
      colunas: ['NOME', 'NOMEC', 'SENHA', 'SALT'],
      linhas: [{ NOME: 'SINT.X', NOMEC: 'Sintético', SENHA: 'HASH-SINTETICO', SALT: 'SAL' }],
    })
    .tabela('TBSEMCHAVE', { chave: [], colunas: ['A'], linhas: [{ A: 1 }] })
    .tabela('SGH_TRILHA', { chave: ['ID'], colunas: [], linhas: [] })
    .tabela('SGH_SUP_IMAGEM', {
      chave: ['ID'],
      colunas: [
        'ID',
        'ID_SESSAO',
        'ID_ACAO',
        'REDE',
        'HOSPITAL',
        'ATOR_TIPO',
        'ID_CONTA',
        'ALVO_LOGIN',
        'TABELA',
        'OPERACAO',
        'CHAVE',
        'COLUNAS',
        'ANTES',
        'DEPOIS',
      ],
      linhas: [],
    })
    .tabela('SGH_SUP_CORRECAO', {
      chave: ['ID'],
      colunas: [
        'ID',
        'ID_IMAGEM',
        'ID_SESSAO',
        'ID_ACAO',
        'ATOR_TIPO',
        'ID_CONTA',
        'COMPENSACAO',
        'CONFLITO',
      ],
      linhas: [],
    });
}
