// Schema Zod de cada tabela legada, montado dos metadados gerados (src/tipos/catalogo.json): tamanho,
// nulidade e tipo por coluna; domínio, CHECK e padrão vão na descrição (o CHECK do Firebird não se
// traduz em Zod genérico; quem o garante é o banco, e a violação vira 409 em erros.ts).
import { z } from 'zod';
import type { CatalogoTipos, ColunaCompacta } from './gerar-tipos.js';

export function esquemaDaColuna(c: ColunaCompacta): z.ZodType {
  const [, tipo, anulavel, dominio, check, padrao] = c;
  let e: z.ZodType;
  const m = /^(?:CHAR|VARCHAR)\((\d+)\)$/.exec(tipo);
  if (m) e = z.string().max(Number(m[1]));
  else if (/^(SMALLINT|INTEGER|BIGINT)$/.test(tipo)) e = z.number().int();
  else if (/^(NUMERIC|DECIMAL|DOUBLE|FLOAT)/.test(tipo)) e = z.number();
  else if (/^(DATE|TIME|TIMESTAMP)$/.test(tipo)) e = z.date();
  else if (tipo === 'BOOLEAN') e = z.boolean();
  else e = z.unknown();
  const descricao = [tipo, dominio && `domínio ${dominio}`, check && `CHECK ${check}`, padrao && padrao]
    .filter(Boolean)
    .join('; ');
  e = e.describe(descricao);
  return anulavel === 1 ? e.nullable() : e;
}

export function esquemaDaTabela(catalogo: CatalogoTipos, tabela: string): z.ZodObject {
  const t = catalogo.tabelas[tabela];
  if (!t) throw new Error(`Tabela "${tabela}" não está no catálogo gerado.`);
  return z.object(Object.fromEntries(t.colunas.map((c) => [c[0], esquemaDaColuna(c)])));
}
