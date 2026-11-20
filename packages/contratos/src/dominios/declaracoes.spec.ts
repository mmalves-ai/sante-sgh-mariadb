// Regra 2 do M14 (ficha, seção 8): domínio declarado uma vez, gerado em lote. A parte pública do lote (175
// domínios: os editáveis da matriz e as oficiais e a enumeração do ramo) e das consultas (514) é válida: ids
// únicos, ação `ler` sempre, só o editável grava, toda permissão no catálogo com opção do legado ou perfil, e
// nenhum rótulo cita o sistema anterior (ADR 0023).
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOGO_DECLARADO } from '../permissoes/catalogo.js';
import { CONSULTAS_DECLARADAS, ITENS_CONSULTA_PROVISORIA } from '../consultas/catalogo.js';
import { permissaoDaConsulta } from '../consultas/tipos.js';
import { DOMINIOS_DECLARADOS, DOMINIOS_POR_PREFIXO } from './catalogo.js';
import { DOMINIOS_M14 } from './lote-m14.gerado.js';
import { MESTRE_DETALHE } from './mestre-detalhe.js';
import {
  faltasIae,
  lacunasIae,
  PORTAO_IAE_OBRIGATORIO,
  relatorioIae,
  violacoesExclusao,
} from './portao-iae.js';
import { SUBITENS_DOMINIOS, permissaoDoDominio, permissoesExigidasDoDominio } from './tipos.js';

const TERMO_PROIBIDO = /\bSP[\s-]?DATA\b|\blegad[oa]s?\b|\bsistemas? (?:atual|atuais|antigos?)\b/i;
const permissoes = new Map(CATALOGO_DECLARADO.map((p) => [p.codigo, p]));

describe('lote do M14: domínios', () => {
  it('175 domínios gerados (W1-04: a procedência saiu para o prefixo da recepção), com ids únicos em todos os declarados', () => {
    expect(DOMINIOS_M14).toHaveLength(175);
    const ids = DOMINIOS_DECLARADOS.map((d) => `${d.modulo}.${d.recurso}`);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('naturezas: editáveis, de sistema, travados, oficiais (17) e a enumeração (1)', () => {
    const por: Record<string, number> = {};
    for (const d of DOMINIOS_M14) por[d.natureza] = (por[d.natureza] ?? 0) + 1;
    expect(por['carga-referencia']).toBe(17);
    expect(por['enumeracao']).toBe(1);
    expect((por['editavel'] ?? 0) + (por['sistema'] ?? 0) + (por['travado'] ?? 0)).toBe(157);
  });
  it('só o editável grava; o resto diz por que é só consulta', () => {
    for (const d of DOMINIOS_M14) {
      expect(d.acoes).toContain('ler');
      const grava = d.acoes.some((a) => a === 'criar' || a === 'editar' || a === 'inativar');
      if (d.natureza !== 'editavel') {
        expect(grava, `${d.modulo}.${d.recurso}`).toBe(false);
        expect(d.motivoSomenteLeitura, `${d.modulo}.${d.recurso}`).toBeTruthy();
      } else expect(d.acoes, `${d.modulo}.${d.recurso}`).toContain('inativar');
      if (d.natureza === 'editavel' && !d.acoes.includes('criar')) expect(d.semInclusao).toBeTruthy();
    }
  });
  it('toda ação tem permissão no catálogo, com opção do legado', () => {
    for (const d of DOMINIOS_M14)
      for (const a of d.acoes) {
        const p = permissoes.get(permissaoDoDominio(d, a));
        expect(p, permissaoDoDominio(d, a)).toBeDefined();
        expect(p?.opcoesLegado.length, permissaoDoDominio(d, a)).toBeGreaterThan(0);
      }
  });
  it('subitem existe e nenhum rótulo cita o sistema anterior', () => {
    for (const d of DOMINIOS_M14) {
      expect(d.subitem in SUBITENS_DOMINIOS).toBe(true);
      expect(TERMO_PROIBIDO.test(d.rotulo.plural) || TERMO_PROIBIDO.test(d.rotulo.singular)).toBe(false);
      expect(
        TERMO_PROIBIDO.test(d.motivoSomenteLeitura ?? '') || TERMO_PROIBIDO.test(d.semInclusao ?? ''),
      ).toBe(false);
    }
  });
  it('mestre e detalhes das telas de grupo são domínios declarados', () => {
    const ids = new Set(DOMINIOS_DECLARADOS.map((d) => `${d.modulo}.${d.recurso}`));
    for (const md of Object.values(MESTRE_DETALHE)) {
      expect(ids.has(md!.mestre), md!.mestre).toBe(true);
      for (const x of md!.detalhes) expect(ids.has(x.dominio), x.dominio).toBe(true);
    }
  });
});

describe('lote do M14: consultas', () => {
  it('401 consultas (as 532 da ficha menos as 17 oficiais e a enumeração, que são domínios em leitura, o histórico de senhas, nunca lido, as 7 da assinatura digital que viraram cadastro no M49 e as 63 migrar-crud da operadora que viraram cadastro no M56 e as 6 do controle de acesso que viraram cadastro no M50 e as 7 da agência transfusional que viraram cadastro no M47.2 e a dos médicos solicitantes SUS que virou cadastro no M51.2 e a dos leitos de UTI habilitados que virou cadastro no M51.4 e as 8 da folha que viraram cadastro no M53.2 e as 3 da qualidade que viraram cadastro no M48.5 e as 5 da estrutura de custos que viraram cadastro no M54.4 e as 9 da contabilidade e do patrimônio que viraram cadastro no M54.1), mais as 24 do M34', () => {
    expect(CONSULTAS_DECLARADAS.filter((c) => c.marco === 'M14')).toHaveLength(401);
    expect(CONSULTAS_DECLARADAS.filter((c) => c.marco === 'M34')).toHaveLength(24);
    expect(CONSULTAS_DECLARADAS).toHaveLength(425);
    const ids = CONSULTAS_DECLARADAS.map((c) => `${c.modulo}.${c.recurso}`);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('classes e tabelas grandes', () => {
    const clinicas = CONSULTAS_DECLARADAS.filter((c) => c.classe === 'clinica');
    expect(clinicas.length).toBe(7);
    expect(CONSULTAS_DECLARADAS.filter((c) => c.grande).length).toBe(11);
    expect(CONSULTAS_DECLARADAS.filter((c) => c.classe === 'pessoal').length).toBeGreaterThan(5);
  });
  it('a permissão de toda consulta está no catálogo (clínica: a do PEP, com perfil do auditor)', () => {
    for (const c of CONSULTAS_DECLARADAS)
      for (const a of ['ler', 'exportar'] as const)
        expect(permissoes.has(permissaoDaConsulta(c, a))).toBe(true);
    expect(permissoes.get('pep.consultaClinica.ler')?.perfis).toContain('auditor');
  });
  it('itens das Fases 5 e 6 com consulta provisória e rótulos sem o sistema anterior', () => {
    expect(ITENS_CONSULTA_PROVISORIA.length).toBeGreaterThanOrEqual(46);
    for (const i of ITENS_CONSULTA_PROVISORIA) expect([5, 6]).toContain(i.fase);
    for (const c of CONSULTAS_DECLARADAS) expect(TERMO_PROIBIDO.test(c.rotulo), c.rotulo).toBe(false);
  });
});

describe('permissão do grupo exigida na gravação (M47, etapa 2)', () => {
  it('os cadastros da agência gravam só com a do domínio e a sadt.agenciaCadastro.editar (no catálogo)', () => {
    const grupo = DOMINIOS_DECLARADOS.filter((d) => d.permissaoGravacaoGrupo);
    expect(grupo.length).toBeGreaterThanOrEqual(7);
    for (const d of grupo) {
      expect(permissoes.has(d.permissaoGravacaoGrupo!), d.recurso).toBe(true);
      expect(permissoesExigidasDoDominio(d, 'ler')).toEqual([permissaoDoDominio(d, 'ler')]);
      for (const a of ['criar', 'editar', 'inativar'] as const)
        expect(permissoesExigidasDoDominio(d, a)).toEqual([
          permissaoDoDominio(d, a),
          d.permissaoGravacaoGrupo,
        ]);
    }
    expect(grupo.find((d) => d.recurso === 'agenciaLocal')?.permissaoGravacaoGrupo).toBe(
      'sadt.agenciaCadastro.editar',
    );
  });
});

describe('W0-01: DOMINIOS_DECLARADOS montado pelo agregador dos prefixos', () => {
  const pasta = resolve(import.meta.dirname, 'prefixos');
  const fonte = readFileSync(resolve(import.meta.dirname, 'catalogo.ts'), 'utf8');
  const prefixos = readdirSync(pasta)
    .filter((f) => /^[a-z]+\.ts$/.test(f))
    .map((f) => f.slice(0, -3));

  it('os 462 domínios de antes do fatiamento continuam declarados (o número só cresce)', () => {
    expect(DOMINIOS_DECLARADOS.length).toBeGreaterThanOrEqual(462);
  });

  it('nenhum domínio Mxx definido em catalogo.ts: ele só importa e espalha', () => {
    expect(fonte).not.toMatch(/export const DOMINIOS_M\d/);
    expect(fonte).not.toMatch(/^\s*(?:const|function) /m);
  });

  it('o agregador importa todos os prefixos, inclusive os vazios (os 31 do catálogo de operações, no mínimo)', () => {
    expect(prefixos.length).toBeGreaterThanOrEqual(31);
    expect(Object.keys(DOMINIOS_POR_PREFIXO).sort()).toEqual([...prefixos].sort());
    for (const p of prefixos) {
      expect(fonte, p).toContain(`from './prefixos/${p}.js'`);
      for (const d of DOMINIOS_POR_PREFIXO[p]!) expect(DOMINIOS_DECLARADOS).toContain(d);
    }
  });

  it('nenhum arquivo de domínio solto em dominios/ (revisão): o plano diz dominios/<prefixo>.ts, vale prefixos/<prefixo>.ts', () => {
    const soltos = readdirSync(import.meta.dirname).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
    );
    const conhecidos =
      /^(?:ajudantes|catalogo|tipos|versao|duplicidade|mestre-detalhe|portao-iae|subitens-m\d+|lote-m\d+\.gerado|dominios-m\d+(?:-[a-z]+)?(?:\.gerado)?)\.ts$/;
    expect(
      soltos.filter((f) => !conhecidos.test(f)),
      'domínio novo entra em dominios/prefixos/<prefixo>.ts (docs/operacoes/README.md §2); um dominios/<prefixo>.ts ninguém importa',
    ).toEqual([]);
    // Toda lista DOMINIOS_* fora de prefixos/ (os dominios-mNN.ts e os gerados) é importada e espalhada pelo agregador.
    for (const f of soltos.filter((x) => x !== 'catalogo.ts')) {
      const texto = readFileSync(resolve(import.meta.dirname, f), 'utf8');
      for (const [, nome] of texto.matchAll(/export const (DOMINIOS_[A-Z0-9_]+)\b/g)) {
        expect(fonte, `${f}: ${nome} fora do agregador`).toContain(`from './${f.slice(0, -3)}.js'`);
        expect(fonte, `${f}: ${nome} fora de DOMINIOS_DECLARADOS`).toMatch(new RegExp(`\\.\\.\\.${nome}\\b`));
      }
    }
  });

  it('cada domínio está no arquivo do prefixo do seu módulo', () => {
    for (const [p, lista] of Object.entries(DOMINIOS_POR_PREFIXO))
      for (const d of lista) expect(`${d.modulo}.${d.recurso}`).toMatch(new RegExp(`^${p}\\.`));
  });
});

/** O domínio sem as chaves opcionais (exactOptionalPropertyTypes: sem `undefined` explícito). */
function sem<T extends object>(o: T, ...chaves: (keyof T)[]): T {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !chaves.includes(k as keyof T))) as T;
}

describe('W0-02: portão do I/A/E dos domínios (modo relatório até o W4-01)', () => {
  const lacunas = lacunasIae(DOMINIOS_DECLARADOS);

  it('gera a lista dos domínios editáveis sem I/A/E completo (relatório da onda; obrigatório no W4-01)', () => {
    const editaveis = DOMINIOS_DECLARADOS.filter((d) => d.natureza === 'editavel');
    expect(lacunas.every((x) => editaveis.some((d) => `${d.modulo}.${d.recurso}` === x.dominio))).toBe(true);
    expect(relatorioIae(DOMINIOS_DECLARADOS, '2026-11-18')).toContain(
      `sem I/A/E completo: **${lacunas.length}**`,
    );
    console.log(
      `[portão I/A/E] ${editaveis.length} editáveis; ${lacunas.length} sem I/A/E completo (modo ${PORTAO_IAE_OBRIGATORIO ? 'obrigatório' : 'relatório'})`,
    );
    if (PORTAO_IAE_OBRIGATORIO) expect(lacunas).toEqual([]);
  });

  it('a regra: criar (ou semInclusao), editar e inativar ou excluir (ou semExclusao)', () => {
    const base = DOMINIOS_DECLARADOS.find((d) => d.natureza === 'editavel')!;
    expect(faltasIae({ ...base, acoes: ['ler', 'criar', 'editar', 'inativar'] })).toEqual([]);
    expect(
      faltasIae({ ...base, acoes: ['ler', 'criar', 'editar', 'excluir'], categoria: 'dominio' }),
    ).toEqual([]);
    const semMotivos = sem(base, 'semInclusao', 'semExclusao');
    expect(faltasIae({ ...semMotivos, acoes: ['ler'] })).toEqual(['criar', 'editar', 'inativar-ou-excluir']);
    expect(
      faltasIae({ ...base, acoes: ['ler', 'editar'], semInclusao: 'motivo', semExclusao: 'lei' }),
    ).toEqual([]);
    expect(faltasIae({ ...base, natureza: 'sistema', acoes: ['ler'] })).toEqual([]);
  });

  it('domínio marcado como regra de apoio à decisão ou formulário não aceita excluir; excluir exige a categoria (sempre)', () => {
    expect(violacoesExclusao(DOMINIOS_DECLARADOS)).toEqual([]);
    const base = DOMINIOS_DECLARADOS.find((d) => d.natureza === 'editavel')!;
    const comExcluir = { ...base, acoes: [...base.acoes, 'excluir' as const] };
    expect(violacoesExclusao([{ ...comExcluir, categoria: 'regra-apoio-decisao' }])).toEqual([
      `${base.modulo}.${base.recurso}: regra-apoio-decisao não aceita excluir (só inativação, com nova versão)`,
    ]);
    expect(violacoesExclusao([{ ...comExcluir, categoria: 'formulario' }])).toHaveLength(1);
    expect(violacoesExclusao([sem(comExcluir, 'categoria')])).toEqual([
      `${base.modulo}.${base.recurso}: declara excluir sem a categoria da matriz`,
    ]);
    expect(violacoesExclusao([{ ...comExcluir, categoria: 'dominio' }])).toEqual([]);
  });

  it('nenhum rótulo, motivo de semInclusao nem de semExclusao cita o sistema anterior', () => {
    for (const d of DOMINIOS_DECLARADOS)
      expect(TERMO_PROIBIDO.test(d.semExclusao ?? ''), d.recurso).toBe(false);
  });
});
