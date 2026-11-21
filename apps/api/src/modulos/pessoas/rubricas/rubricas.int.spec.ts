// Integração da porta PRÓPRIA das rubricas e tabelas legais (F2.2, lote 03-10) contra o MariaDB do cliente de teste
// da onda 3 (f22_o3), com massa SINTÉTICA: a rubrica do estabelecimento (só a dele), os valores em centavos e
// centésimos de ponto, a tabela legal montada por vigência e os dias de afastamento; o serviço da tela devolve respostas
// que passam pelos esquemas do contrato. A tabela legal sintética fica numa vigência antiga (1991), para não mexer na
// vigente de outros testes, e é apagada no fim. As marcas de tributo saem do código do eSocial (regra do domínio) lido
// na vigência de cada versão da rubrica; a rubrica inativa, a incidência excluída e a vigência legal inativa ficam de fora.
import {
  esquemaApoioRubricas,
  esquemaRubricasDaCompetencia,
  esquemaTabelasLegaisDaCompetencia,
} from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import {
  CLIENTE_O3,
  ctxSesmt,
  encerrarMassaSesmt,
  type MassaSesmt,
  prepararMassaSesmt,
  SEM_BANCO_O3,
} from '../sesmt/massa-sesmt.spec-util.js';
import { PortaRubricasPropria } from './porta-rubricas-propria.js';
import { ServicoRubricas } from './servico-rubricas.js';

const VIG = '1991-01-01';
const VIG_INATIVA = '1992-01-01';

describe.skipIf(SEM_BANCO_O3)('porta própria das rubricas contra o MariaDB (f22_o3)', () => {
  let m: MassaSesmt;
  let porta: PortaRubricasPropria;
  let rubrica = 0;
  const r: Record<string, number> = {};
  const tabelas: number[] = [];
  const codigosCriados: number[] = [];

  beforeAll(async () => {
    m = await prepararMassaSesmt('R');
    porta = new PortaRubricasPropria(m.nucleo);
    await m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 'preparo-rubricas-03-10' }, async (e) => {
      const agora = new Date();
      const um = async (sel: string, ins: string, p: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, []);
        return l ? Number(l.id) : e.inserir(ins, p);
      };
      const tipo = await um(
        "SELECT id FROM tipo_rubrica WHERE codigo = 'L0310P'",
        "INSERT INTO tipo_rubrica (codigo, descricao, natureza, sinal, criado_em) VALUES ('L0310P', 'PROVENTO SINTETICO', 'provento', 1, ?)",
        [agora],
      );
      const ref = await um(
        "SELECT id FROM tipo_referencia_rubrica WHERE codigo = 'L0310V'",
        "INSERT INTO tipo_referencia_rubrica (codigo, descricao, unidade, casas_decimais, criado_em) VALUES ('L0310V', 'VALOR SINTETICO', 'percentual', 2, ?)",
        [agora],
      );
      const nat = await um(
        'SELECT id FROM natureza_rubrica ORDER BY id LIMIT 1',
        "INSERT INTO natureza_rubrica (codigo_esocial, descricao, vigencia_inicio, versao_fonte, criado_em) VALUES ('1000', 'NATUREZA SINTETICA', '2000-01-01', 'teste', ?)",
        [agora],
      );
      await e.executar('DELETE FROM rubrica WHERE estabelecimento_id IN (?, ?)', [m.est, m.outro]);
      rubrica = await e.inserir(
        "INSERT INTO rubrica (estabelecimento_id, codigo, descricao, tipo_rubrica_id, natureza_rubrica_id, tipo_referencia_rubrica_id, percentual_incidencia, vigencia_inicio, usa_em_ferias, compoe_media_ferias, criado_em) VALUES (?, '101', 'ADICIONAL SINTETICO', ?, ?, ?, 20, '2020-01-01', TRUE, TRUE, ?)",
        [m.est, tipo, nat, ref, agora],
      );
      await e.inserir(
        "INSERT INTO rubrica (estabelecimento_id, codigo, descricao, tipo_rubrica_id, natureza_rubrica_id, tipo_referencia_rubrica_id, vigencia_inicio, criado_em) VALUES (?, '102', 'RUBRICA DE OUTRO ESTAB', ?, ?, ?, '2020-01-01', ?)",
        [m.outro, tipo, nat, ref, agora],
      );
      const nova = (codigo: string, ini: string, fim: string | null, ativo = true) =>
        e.inserir(
          'INSERT INTO rubrica (estabelecimento_id, codigo, descricao, tipo_rubrica_id, natureza_rubrica_id, tipo_referencia_rubrica_id, vigencia_inicio, vigencia_fim, ativo, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [m.est, codigo, `RUBRICA SINTETICA ${codigo}`, tipo, nat, ref, ini, fim, ativo, agora],
        );
      r['desconto'] = await nova('103', '2020-01-01', null);
      r['decimo'] = await nova('104', '2020-01-01', null);
      r['versao1'] = await nova('105', '2020-01-01', '2021-12-31');
      r['versao2'] = await nova('105', '2022-01-01', null);
      r['inativa'] = await nova('106', '2020-01-01', null, false);
      // Tributos e códigos do eSocial: os do catálogo do cliente, ou sintéticos (apagados no fim) quando faltam.
      const tributo = (codigo: string, t: string) =>
        um(
          `SELECT id FROM tributo_folha WHERE codigo = '${codigo}'`,
          'INSERT INTO tributo_folha (codigo, descricao, tipo, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `TRIBUTO SINTETICO ${codigo}`, t, agora],
        );
      const trib = {
        inss: await tributo('L0310INSS', 'contribuicao_previdenciaria'),
        irrf: await tributo('L0310IRRF', 'imposto_renda'),
        fgts: await tributo('L0310FGTS', 'fundo_garantia'),
      };
      const codigoEsocial = async (t: 'inss' | 'irrf' | 'fgts', c: string) => {
        const l = await e.uma<{ id: number }>(
          'SELECT id FROM codigo_incidencia_rubrica WHERE tributo = ? AND codigo_incidencia = ? ORDER BY id LIMIT 1',
          [t, c],
        );
        if (l) return Number(l.id);
        const id = await e.inserir(
          "INSERT INTO codigo_incidencia_rubrica (tributo, codigo_incidencia, descricao, vigencia_inicio, criado_em) VALUES (?, ?, 'CODIGO SINTETICO', '1990-01-01', ?)",
          [t, c, agora],
        );
        codigosCriados.push(id);
        return id;
      };
      const incidir = async (
        rub: number,
        t: 'inss' | 'irrf' | 'fgts',
        c: string,
        ini = '2020-01-01',
        fim: string | null = null,
        excluida = false,
      ) =>
        e.inserir(
          'INSERT INTO incidencia_rubrica (rubrica_id, tributo_folha_id, codigo_incidencia_rubrica_id, vigencia_inicio, vigencia_fim, excluido_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [rub, trib[t], await codigoEsocial(t, c), ini, fim, excluida ? agora : null, agora],
        );
      await incidir(rubrica, 'inss', '11');
      await incidir(rubrica, 'irrf', '09');
      await incidir(rubrica, 'fgts', '11');
      await incidir(r['desconto'], 'inss', '31');
      await incidir(r['desconto'], 'irrf', '31');
      for (const t of ['inss', 'irrf', 'fgts'] as const) await incidir(r['decimo'], t, '12');
      await incidir(r['versao1'], 'inss', '11', '2020-01-01', '2021-12-31');
      await incidir(r['versao2'], 'inss', '00', '2022-01-01');
      await incidir(r['inativa'], 'inss', '11');
      await incidir(r['inativa'], 'fgts', '11', '2020-01-01', null, true);
      await e.executar(
        'DELETE f FROM faixa_tabela_legal f JOIN tabela_legal_vigencia t ON t.id = f.tabela_legal_vigencia_id WHERE t.vigencia_inicio = ?',
        [VIG],
      );
      await e.executar('DELETE FROM tabela_legal_vigencia WHERE vigencia_inicio = ?', [VIG]);
      const irrf = await e.inserir(
        "INSERT INTO tabela_legal_vigencia (tipo_tabela, vigencia_inicio, deducao_dependente, desconto_simplificado, criado_em) VALUES ('irrf', ?, 189.59, 528.00, ?)",
        [VIG, agora],
      );
      const inss = await e.inserir(
        "INSERT INTO tabela_legal_vigencia (tipo_tabela, vigencia_inicio, teto, criado_em) VALUES ('inss', ?, 7786.02, ?)",
        [VIG, agora],
      );
      const dias = await e.inserir(
        "INSERT INTO tabela_legal_vigencia (tipo_tabela, vigencia_inicio, quantidade_dias, criado_em) VALUES ('dias_afastamento_empresa', ?, 15, ?)",
        [VIG, agora],
      );
      await e.executar('DELETE FROM tabela_legal_vigencia WHERE vigencia_inicio = ?', [VIG_INATIVA]);
      const inativa = await e.inserir(
        "INSERT INTO tabela_legal_vigencia (tipo_tabela, vigencia_inicio, deducao_dependente, ativo, criado_em) VALUES ('irrf', ?, 999.99, FALSE, ?)",
        [VIG_INATIVA, agora],
      );
      tabelas.push(irrf, inss, dias, inativa);
      await e.inserir(
        'INSERT INTO faixa_tabela_legal (tabela_legal_vigencia_id, sequencia, limite_inferior, limite_superior, aliquota, parcela_deduzir, criado_em) VALUES (?, 1, 0, 2259.20, 0, 0, ?)',
        [irrf, agora],
      );
      await e.inserir(
        'INSERT INTO faixa_tabela_legal (tabela_legal_vigencia_id, sequencia, limite_inferior, limite_superior, aliquota, parcela_deduzir, criado_em) VALUES (?, 2, 2259.21, NULL, 7.5, 169.44, ?)',
        [irrf, agora],
      );
      await e.inserir(
        'INSERT INTO faixa_tabela_legal (tabela_legal_vigencia_id, sequencia, limite_inferior, limite_superior, aliquota, parcela_deduzir, criado_em) VALUES (?, 1, 0, 1412.00, 7.5, 0, ?)',
        [inss, agora],
      );
    });
  }, 60_000);
  afterAll(async () => {
    if (m)
      await m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 'limpeza-rubricas-03-10' }, async (e) => {
        if (tabelas.length) {
          await e.executar(
            `DELETE FROM faixa_tabela_legal WHERE tabela_legal_vigencia_id IN (${tabelas.map(() => '?').join(', ')})`,
            tabelas,
          );
          await e.executar(
            `DELETE FROM tabela_legal_vigencia WHERE id IN (${tabelas.map(() => '?').join(', ')})`,
            tabelas,
          );
        }
        await e.executar(
          'DELETE i FROM incidencia_rubrica i JOIN rubrica r ON r.id = i.rubrica_id WHERE r.estabelecimento_id IN (?, ?)',
          [m.est, m.outro],
        );
        if (codigosCriados.length)
          await e.executar(
            `DELETE FROM codigo_incidencia_rubrica WHERE id IN (${codigosCriados.map(() => '?').join(', ')})`,
            codigosCriados,
          );
      });
    await encerrarMassaSesmt(m);
  });

  it('rubricas: só as do estabelecimento da sessão, com percentual em centésimos de ponto e os usos', async () => {
    const c = ctxSesmt(m.est, m.usuario);
    const rs = (await porta.rubricas(c, null)).filter((x) => x.codigo === 101);
    expect(rs.map((x) => x.id)).toEqual([rubrica]);
    expect(rs[0]).toMatchObject({
      empresa: m.est,
      codigo: 101,
      tipo: 'provento',
      referencia: 'percentual',
      percentual: 2000,
      ativa: true,
      vigencia: { inicio: '2020-01-01', fim: null },
      usos: ['mensal', 'ferias'],
    });
    expect(rs[0]?.incidencias.mediaFerias).toBe(true);
    expect(await porta.rubricas(c, m.outro)).toEqual([]);
  });

  it('marcas de tributo pelo código do eSocial (domínio), na vigência de cada versão da rubrica', async () => {
    const rs = await porta.rubricas(ctxSesmt(m.est, m.usuario), null);
    const de = (id: number | undefined) => rs.find((x) => x.id === id)!;
    // 101: INSS 11 e FGTS 11 são base mensal; IRRF 09 não é base; usada nas férias, o INSS das férias também.
    expect(de(rubrica).esocial).toMatchObject({ inss: '11', irrf: '09', fgts: '11' });
    expect(de(rubrica).incidencias).toMatchObject({
      inss: true,
      fgts: true,
      irrf: false,
      irrfFerias: false,
      inssFerias: true,
      inss13: false,
    });
    // 103: INSS 31 e IRRF 31 (contribuição descontada, retenção) não são base.
    expect(de(r['desconto']).incidencias).toMatchObject({
      inss: false,
      irrf: false,
      inss13: false,
      irrf13: false,
    });
    // 104: código 12 é a base do 13º, não a mensal.
    expect(de(r['decimo']).incidencias).toMatchObject({
      inss: false,
      irrf: false,
      fgts: false,
      inss13: true,
      irrf13: true,
      fgts13: true,
    });
    // 105: a versão encerrada lê o código da vigência dela (11); a vigente, o código novo (00).
    expect([de(r['versao1']).esocial.inss, de(r['versao1']).incidencias.inss]).toEqual(['11', true]);
    expect([de(r['versao2']).esocial.inss, de(r['versao2']).incidencias.inss]).toEqual(['00', false]);
    // 106: inativa sai inativa; a incidência excluída não traz o código.
    expect(de(r['inativa'])).toMatchObject({ ativa: false, esocial: { inss: '11', fgts: null } });
  });

  it('tabelas legais e dias de afastamento: valores em centavos e alíquota em centésimos, pela vigência', async () => {
    const c = ctxSesmt(m.est, m.usuario);
    const t = (await porta.tabelasLegais(c)).find((x) => x.inicio === VIG);
    expect(t?.irrf.faixas).toEqual([
      { de: 0, ate: 225_920, aliquota: 0, deducao: 0 },
      { de: 225_921, ate: null, aliquota: 750, deducao: 16_944 },
    ]);
    expect(t?.irrf.deducaoDependente).toBe(18_959);
    expect(t?.inss).toEqual({ faixas: [{ de: 0, ate: 141_200, aliquota: 750, deducao: 0 }], teto: 778_602 });
    expect((await porta.diasAfastamento(c)).find((d) => d.inicio === VIG)).toEqual({ inicio: VIG, dias: 15 });
  });

  it('o serviço da tela sobre a porta própria passa pelos esquemas do contrato', async () => {
    const trilha = new RegistradorTrilhaMemoria();
    const servico = new ServicoRubricas(
      porta,
      trilha,
      fonteConfiguracaoMemoria(trilha, { chavesIniciais: () => [], prerequisitosIniciais: () => [] }),
      null,
    );
    const s = {
      req: { sgh: undefined, headers: {} },
      hospital: 'x',
      rede: '',
      login: m.login,
      porta: ctxSesmt(m.est, m.usuario),
      pode: () => true,
    } as unknown as SessaoCadastro;
    const r = esquemaRubricasDaCompetencia.parse(
      await servico.rubricas(s, '2026-10', { empresa: null, todas: true }),
    );
    expect(r.rubricas.map((x) => x.id)).toContain(rubrica);
    esquemaTabelasLegaisDaCompetencia.parse(await servico.tabelasLegais(s, '1991-06'));
    // A vigência inativa (ativo = falso) não é a em vigor: a competência seguinte usa a anterior.
    const t = esquemaTabelasLegaisDaCompetencia.parse(await servico.tabelasLegais(s, '1992-03'));
    expect(t.vigente?.inicio).not.toBe(VIG_INATIVA);
    expect(t.vigencias).not.toContain(VIG_INATIVA);
    const apoio = esquemaApoioRubricas.parse(await servico.apoioTela(s));
    expect(apoio.gravacaoLigada).toBe(false);
  });
});
