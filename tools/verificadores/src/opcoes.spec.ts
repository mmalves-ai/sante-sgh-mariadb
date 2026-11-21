// Ficha do M06, regra 2 (teste nomeado na ficha: opções do legado): o retrato versionado da árvore de
// TBOPCOES do pc tem 6.985 opções lidas, 5.593 ativas, distribuição por nível 86/322/1.743/3.109/1.368/351/6
// e 75 módulos; o catálogo gerado em quatro passos está coberto pelo catálogo-base e pelo mapa do conector.
import { CATALOGO_BASE, CATALOGO_BASE_ORIGEM } from '@sgh/contratos/catalogo-base';
import { construirCatalogo } from '@sgh/dominio-acesso';
import { describe, expect, it } from 'vitest';
import { conferirOrigem, lerMapaDoConector } from './permissoes.ts';
import { lerRetrato } from './permissoes-dados.ts';

const retrato = lerRetrato('pc');

describe('opções do legado (TBOPCOES) e o catálogo gerado', () => {
  it('6.985 opções, 5.593 ativas, por nível 86/322/1.743/3.109/1.368/351/6, 75 módulos', () => {
    expect(retrato).not.toBeNull();
    const r = retrato!;
    expect(r.opcoes).toHaveLength(6_985);
    expect(r.opcoes.filter((o) => o.ativo)).toHaveLength(5_593);
    const porNivel = [0, 0, 0, 0, 0, 0, 0];
    for (const o of r.opcoes) porNivel[o.nivel] = (porNivel[o.nivel] ?? 0) + 1;
    expect(porNivel).toEqual([86, 322, 1_743, 3_109, 1_368, 351, 6]);
    expect(r.modulos).toHaveLength(75);
    expect(r.grupos).toHaveLength(42);
    expect(new Set(r.permissoesGrupos.map(([g]) => g)).size).toBe(39);
    expect(r.permissoesGrupos).toHaveLength(17_907);
    expect(r.permissoesPapeis).toHaveLength(520);
  });

  it('quatro passos: árvore sem salto, opções inativas e SGO/SGS fora com registro, catálogo em dia', () => {
    const c = construirCatalogo(retrato!.opcoes, retrato!.modulos);
    expect(c.contagens.saltosDeNivel).toBe(0);
    expect(c.exclusoes.filter((e) => e.motivo === 'opcao-inativa')).toHaveLength(1_392);
    expect(c.exclusoes.filter((e) => e.motivo === 'sistema-sgo-sgs')).toHaveLength(233);
    expect(c.exclusoes.filter((e) => e.motivo === 'modulo-sem-destino')).toHaveLength(0);
    expect(conferirOrigem(c, CATALOGO_BASE, lerMapaDoConector())).toEqual([]);
    expect(CATALOGO_BASE).toHaveLength(c.permissoes.length);
    expect(CATALOGO_BASE_ORIGEM.permissoes).toBe(CATALOGO_BASE.length);
    // Toda opção ativa do SGH tem exatamente uma permissão; cada permissão gerada tem opção do menu de origem.
    expect(c.permissaoDaOpcao.size).toBe(5_593 - 233);
    expect(c.permissoes.every((p) => p.opcoesLegado.length > 0)).toBe(true);
  });

  it('o retrato não tem pessoa: usuários só em faixa (0, "<5" ou 5 ou mais)', () => {
    for (const g of retrato!.grupos)
      expect(
        g.usuariosAtivos === '<5' ||
          (typeof g.usuariosAtivos === 'number' && (g.usuariosAtivos === 0 || g.usuariosAtivos >= 5)),
      ).toBe(true);
    expect(JSON.stringify(retrato)).not.toMatch(/"(login|usuario|cpf|senha)":/i);
  });
});
