// Perfil complementar (ficha do M06, regra 3): recurso novo, sem opção no legado, só por SGH_ACESSO_PERFIL_
// USUARIO (concessão com vigência e área que aprovou) e pelo mapa SGH_ACESSO_MAPA_OPCAO (perfil → permissão,
// aprovado). O banco recusa conceder a si (CHECK). Na transação desfeita; usuário e concedente sintéticos.
import { CATALOGO_DECLARADO } from '@sgh/contratos';
import { conceder } from '@sgh/dominio-acesso';
import { lerMapaPerfis, lerPerfisConcedidos } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, ctx, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

describe.skipIf(!PODE_ESCREVER)('perfil complementar (M06, regra 3)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('concessão vigente e mapa aprovado concedem o recurso novo; vencida e revogada não; a si é recusado', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const ins = (sql: string, p: unknown[]) => e.executar(sql, p);
      await ins(
        `INSERT INTO SGH_ACESSO_PERFIL_USUARIO (ID, ID_TBUSERS, LOGIN, PERFIL, CONCEDIDO_POR, AREA_APROVOU, INICIO)
         VALUES (NEXT VALUE FOR SGH_GEN_ACESSO_PERFIL_USUARIO, 0, 'SGH.SINT.A', 'auditor', 'SGH.SINT.GESTOR', 'auditoria', DATEADD(-1 DAY TO CURRENT_TIMESTAMP))`,
        [],
      );
      await ins(
        `INSERT INTO SGH_ACESSO_PERFIL_USUARIO (ID, ID_TBUSERS, LOGIN, PERFIL, CONCEDIDO_POR, AREA_APROVOU, INICIO, FIM)
         VALUES (NEXT VALUE FOR SGH_GEN_ACESSO_PERFIL_USUARIO, 0, 'SGH.SINT.A', 'operador-backup', 'SGH.SINT.GESTOR', 'ti', DATEADD(-9 DAY TO CURRENT_TIMESTAMP), DATEADD(-1 DAY TO CURRENT_TIMESTAMP))`,
        [],
      );
      await ins(
        `INSERT INTO SGH_ACESSO_MAPA_OPCAO (ID, TIPO, PERFIL, PERMISSAO, ORIGEM, SITUACAO, CRIADO_POR)
         VALUES (NEXT VALUE FOR SGH_GEN_ACESSO_MAPA_OPCAO, 'perfil-permissao', 'auditor', 'sistema.saude.ler', 'revisao-area', 'aprovada', 'SGH.SINT.GESTOR')`,
        [],
      );
      let aSi = 'aceito';
      try {
        await ins(
          `INSERT INTO SGH_ACESSO_PERFIL_USUARIO (ID, ID_TBUSERS, LOGIN, PERFIL, CONCEDIDO_POR, AREA_APROVOU, INICIO)
           VALUES (NEXT VALUE FOR SGH_GEN_ACESSO_PERFIL_USUARIO, 0, 'SGH.SINT.B', 'auditor', 'SGH.SINT.B', 'auditoria', CURRENT_TIMESTAMP)`,
          [],
        );
      } catch (x) {
        aSi = /SGH_CK_ACESSO_PERFIL_A_SI/.test(String(x)) ? 'recusado' : 'outro erro';
      }
      const perfis = await lerPerfisConcedidos(e, 'SGH.SINT.A');
      const mapa = await lerMapaPerfis(e);
      const c = conceder({
        legado: { grupo: null, opcoesGrupo: [], opcoesPapel: [], papeis: [4], flags: [], conselho: false },
        catalogo: CATALOGO_DECLARADO,
        perfisConcedidos: perfis,
        mapaPerfis: mapa,
      });
      return { perfis: perfis.map((p) => p.perfil), aSi, permissoes: [...c.permissoes] };
    });
    expect(r.perfis).toEqual(['auditor']);
    expect(r.aSi).toBe('recusado');
    expect(r.permissoes).toEqual(
      expect.arrayContaining(['acesso.emergencia.revisar', 'auditoria.trilha.ler', 'sistema.saude.ler']),
    );
    expect(r.permissoes).not.toContain('acesso.emergencia.solicitar');
  });
});
