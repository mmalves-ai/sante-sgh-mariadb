// Domínios vistos (M03): o perfil passivo exporta, por coluna de domínio, os valores já gravados pelo
// legado (packages/legado/src/<grupo>/assinaturas/dominios-vistos.json). O codec usa a lista para RECUSAR
// por padrão valor nunca visto naquela coluna (convencoes.md §5; cap-10 §10.4, Atenção). Coluna sem lista
// também é recusada: sem perfil, não se sabe o que o legado grava (falha fechada).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { conferirDominio, ErroCodec } from './codec.js';

export interface DominioVisto {
  /** União dos estabelecimentos (o que o codec aceita). */
  readonly valores: readonly string[];
  /** Valores por estabelecimento (o perfil de um não apaga os do outro). */
  readonly porEstabelecimento?: Readonly<Record<string, readonly string[]>>;
  /** Código de baixa confiança (DP-46): só valores vistos, legenda "a confirmar". */
  readonly aConfirmar?: boolean;
}

export interface ArquivoDominiosVistos {
  readonly formato: 1;
  readonly grupo: string;
  /** Por estabelecimento: período da versão congelada de onde saíram os valores. */
  readonly origem: Readonly<Record<string, string>>;
  /** Chave `TABELA.COLUNA`. */
  readonly colunas: Readonly<Record<string, DominioVisto>>;
}

const chave = (tabela: string, coluna: string) => `${tabela.toUpperCase()}.${coluna.toUpperCase()}`;

export class DominiosVistos {
  private readonly mapa = new Map<string, { vistos: ReadonlySet<string>; aConfirmar: boolean }>();

  constructor(arquivos: readonly ArquivoDominiosVistos[]) {
    for (const a of arquivos) {
      if (a.formato !== 1) throw new ErroCodec('dominios-vistos.json: formato desconhecido.');
      for (const [k, d] of Object.entries(a.colunas)) {
        const atual = this.mapa.get(k);
        const vistos = new Set([...(atual?.vistos ?? []), ...d.valores]);
        this.mapa.set(k, { vistos, aConfirmar: Boolean(atual?.aConfirmar || d.aConfirmar) });
      }
    }
  }

  /** Valores já vistos na coluna, ou null se a coluna não tem domínio exportado. */
  vistos(tabela: string, coluna: string): ReadonlySet<string> | null {
    return this.mapa.get(chave(tabela, coluna))?.vistos ?? null;
  }

  aConfirmar(tabela: string, coluna: string): boolean {
    return this.mapa.get(chave(tabela, coluna))?.aConfirmar ?? false;
  }

  /** Gravação: o valor tem de ter sido visto naquela coluna; senão, recusa (ErroCodec). */
  conferir(tabela: string, coluna: string, valor: string | number): string {
    const vistos = this.vistos(tabela, coluna);
    if (!vistos) throw new ErroCodec('Coluna sem domínio visto no perfil do legado: gravação recusada.');
    return conferirDominio(typeof valor === 'number' ? String(valor) : valor.replace(/ +$/, ''), vistos);
  }

  get colunas(): string[] {
    return [...this.mapa.keys()].sort();
  }
}

/** Lê todos os `src/<grupo>/assinaturas/dominios-vistos.json` do pacote. */
export function carregarDominiosVistos(pastaSrc: string): DominiosVistos {
  const arquivos: ArquivoDominiosVistos[] = [];
  for (const grupo of readdirSync(pastaSrc, { withFileTypes: true })) {
    if (!grupo.isDirectory()) continue;
    const p = join(pastaSrc, grupo.name, 'assinaturas', 'dominios-vistos.json');
    if (existsSync(p)) arquivos.push(JSON.parse(readFileSync(p, 'utf8')) as ArquivoDominiosVistos);
  }
  return new DominiosVistos(arquivos);
}
