// M59-F1 (regra 4): os artefatos do privilégio mínimo por módulo estão em dia com o código e só trazem privilégio.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { alcanceVersionado } from '@sgh/legado';
import { describe, expect, it } from 'vitest';
import {
  arquivosAlcancadosPeloExecutor,
  caminhoAlcance,
  caminhoScripts,
  entradaDoRepositorio,
  gerarArtefatos,
  lerRetratoDependencias,
  NOME_PASSO_PAPEIS,
  RAIZ,
} from './privilegios.ts';

const ler = (p: string) => readFileSync(resolve(RAIZ, p), 'utf8');

describe('privilégio mínimo por módulo (pc)', () => {
  const a = gerarArtefatos('pc');

  it('alcance e scripts versionados iguais ao gerador (rode pnpm privilegios:gerar)', () => {
    expect(a.semDependencias).toBe(false);
    expect(ler(caminhoAlcance('pc'))).toBe(a.alcanceJson);
    expect(ler(`${caminhoScripts('pc')}/${NOME_PASSO_PAPEIS}.aplicar.sql`)).toBe(a.aplicar);
    expect(ler(`${caminhoScripts('pc')}/${NOME_PASSO_PAPEIS}.recolher.sql`)).toBe(a.recolher);
    expect(alcanceVersionado('pc')?.versao).toBe(a.versao);
    expect(alcanceVersionado('hs')).toBeNull();
    expect(a.descartes).toEqual([]);
  });

  it('os scripts só criam papéis e concedem ou revogam privilégio; nenhum segredo, nenhum administrador', () => {
    for (const texto of [a.aplicar, a.recolher]) {
      const comandos = texto.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('--'));
      for (const c of comandos) {
        expect(c).toMatch(/^(CREATE ROLE|GRANT|REVOKE|DROP ROLE|COMMIT;)/);
        expect(c).not.toMatch(/SYSDBA|PASSWORD|WITH GRANT OPTION|ALTER |CREATE TABLE|TRIGGER/);
      }
      expect(texto).not.toMatch(/(UPDATE|DELETE) ON "SGH_TRILHA/);
    }
  });

  it('cada módulo grava no sistema anterior só o que as receitas e o código dele gravam', () => {
    const e = entradaDoRepositorio(lerRetratoDependencias('pc'));
    const gravadas = new Set(
      e.receitas.flatMap((r) => [...r.passos, ...r.efeitos].map((p) => p.tabela.trim().toUpperCase())),
    );
    for (const u of Object.values(e.usosPorGrupo)) {
      for (const [o, acoes] of Object.entries(u)) {
        if (acoes.some((x) => x === 'INSERT' || x === 'UPDATE' || x === 'DELETE') && !o.startsWith('SGH_'))
          gravadas.add(o);
      }
    }
    // O que os gatilhos das tabelas gravadas gravam (catálogo; o gatilho roda com o privilégio de quem grava).
    for (const xs of Object.values(e.tabelasPorTabela ?? {}))
      for (const [o, acoes] of Object.entries(xs)) if (acoes.some((x) => x !== 'SELECT')) gravadas.add(o);
    for (const al of alcanceVersionado('pc')?.alcances ?? []) {
      for (const [o, acoes] of Object.entries(al.objetos)) {
        if (o.startsWith('SGH_')) continue;
        if (acoes.some((x) => x === 'INSERT' || x === 'UPDATE' || x === 'DELETE'))
          expect(gravadas.has(o), `${al.modulo} grava ${o}`).toBe(true);
      }
    }
  });

  it('as tabelas que os gatilhos das tabelas gravadas usam entram no papel de quem grava (revisão do M59.1)', () => {
    const dep = lerRetratoDependencias('pc');
    expect(Object.keys(dep?.tabelasPorTabela ?? {}).length).toBeGreaterThan(100);
    const al = Object.fromEntries(
      (alcanceVersionado('pc')?.alcances ?? []).map((x) => [x.modulo, x.objetos]),
    );
    const atendimento = al['atendimento'] ?? {};
    for (const t of ['ATCABECATEND', 'FCCTAEXT']) {
      expect(
        atendimento[t]?.some((x) => x !== 'SELECT'),
        `atendimento grava ${t}`,
      ).toBe(true);
      for (const [x, acoes] of Object.entries(dep?.tabelasPorTabela[t] ?? {}))
        for (const a of acoes) expect(atendimento[x], `gatilho de ${t}: ${a} em ${x}`).toContain(a);
    }
  });

  it('o evento na trilha do legado, gravado pelo executor com a conta de qualquer módulo, está em todo papel', () => {
    for (const x of alcanceVersionado('pc')?.alcances ?? []) {
      expect(x.objetos['TBCABTRILHA'], x.modulo).toEqual(['SELECT', 'INSERT']);
      expect(x.objetos['TBLANTRILHASGH'], x.modulo).toEqual(['SELECT', 'INSERT']);
      expect(x.objetos['TBUSERS_TBPAPEL'], x.modulo).toContain('SELECT');
    }
    expect(arquivosAlcancadosPeloExecutor().map((f) => f.slice(RAIZ.length + 1))).toEqual([
      'packages/legado/src/auditoria/gravacao/registrarEventoLegado.ts',
    ]);
  });

  it('W1-01 (revisão): as tabelas SGH_ 1206 a 1211 do acesso estão no papel do módulo com o que o código grava', () => {
    const acesso = alcanceVersionado('pc')?.alcances.find((x) => x.modulo === 'acesso');
    const esperado: Record<string, string[]> = {
      SGH_ACESSO_RECERT_CAMPANHA: ['SELECT', 'INSERT', 'UPDATE'],
      SGH_ACESSO_RECERT_ITEM: ['SELECT', 'INSERT', 'UPDATE'],
      SGH_ACESSO_PEDIDO: ['SELECT', 'INSERT', 'UPDATE'],
      SGH_ACESSO_RH_PERFIL_CARGO: ['SELECT', 'INSERT'],
      SGH_ACESSO_RH_TAREFA: ['SELECT', 'INSERT'],
      SGH_ACESSO_PIN: ['SELECT', 'INSERT', 'UPDATE'],
      // Parte 11d: conferência do conselho (só inclusão).
      SGH_ACESSO_CONSELHO_CONFER: ['SELECT', 'INSERT'],
      SGH_GEN_ACESSO_CONSELHO_CONFER: ['USAGE'],
      SGH_GEN_ACESSO_RECERT_CAMP: ['USAGE'],
      SGH_GEN_ACESSO_RECERT_ITEM: ['USAGE'],
      SGH_GEN_ACESSO_PEDIDO: ['USAGE'],
      SGH_GEN_ACESSO_RH_PERFIL_CARGO: ['USAGE'],
      SGH_GEN_ACESSO_RH_TAREFA: ['USAGE'],
      SGH_GEN_ACESSO_PIN: ['USAGE'],
    };
    for (const [o, acoes] of Object.entries(esperado)) expect(acesso?.objetos[o], o).toEqual(acoes);
    for (const t of Object.keys(esperado).filter((o) => !o.startsWith('SGH_GEN_')))
      for (const acao of esperado[t]!)
        expect(a.aplicar).toContain(`GRANT ${acao} ON "${t}" TO ROLE "SGH_MOD_ACESSO";`);
  });
});
