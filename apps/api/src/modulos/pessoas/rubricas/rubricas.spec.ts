// Tela das rubricas, incidências e tabelas legais (M53, etapa F1) sem a HTTP, com a porta em memória (dados
// sintéticos): a competência escolhe a vigência pelo primeiro dia (regra 7); a conferência das incidências e das
// faixas vem junto; a gravação só aparece ligada com a permissão de editar E a chave `pessoas.folha` (POL-3); os
// filtros recusam competência mal formada; a porta não grava (o CRUD genérico grava).
import type { ChaveGravada, PrerequisitoGravado } from '@sgh/legado';
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { corpo } from '../../exames/public-api.js';
import { portaRubricasIndisponivel, portaRubricasNaTransacao } from './porta-rubricas-legado.js';
import { PortaRubricasMemoria } from './porta-rubricas-memoria.js';
import {
  esquemaFiltroRubricas,
  esquemaFiltroTabelasLegais,
  RubricasController,
} from './rubricas.controller.js';
import { CADASTROS_RUBRICAS, ServicoRubricas } from './servico-rubricas.js';

const sessao = (pode: (c: string) => boolean = () => true): SessaoCadastro =>
  ({
    req: { sgh: undefined, headers: {} },
    hospital: 'aa',
    rede: '',
    login: 'SINT.DP',
    porta: { rede: '', hospital: 'aa' },
    pode,
  }) as unknown as SessaoCadastro;

const chave = (ligada: boolean): ChaveGravada => ({
  id: 'pessoas.folha',
  tipo: 'recurso',
  chave: 'pessoas.folha',
  escopo: 'hospital',
  valor: '*',
  ligada,
  ligadaAntes: null,
  lote: null,
  justificativa: 'teste sintético',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-26T10:00:00',
});
const nenhumPrerequisito: PrerequisitoGravado[] = [];

function montar(ligada: boolean | null) {
  const trilha = new RegistradorTrilhaMemoria();
  const fonte =
    ligada === null
      ? null
      : fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: () => [chave(ligada)],
          prerequisitosIniciais: () => nenhumPrerequisito,
        });
  return new ServicoRubricas(new PortaRubricasMemoria(), trilha, fonte, null);
}

describe('rubricas da competência', () => {
  it('só as em vigor na competência, com a contagem das fora de vigência e a conferência', async () => {
    const r = await montar(null).rubricas(sessao(), '2025-03', { empresa: null, todas: false });
    expect(r.dataReferencia).toBe('2025-03-01');
    expect(r.rubricas.map((x) => x.id)).toEqual([1, 2, 3, 4, 5]);
    expect(r.foraDeVigencia).toBe(1);
    // A rubrica 3 tem a base de FGTS no eSocial sem incidir FGTS (divergência sintética de propósito).
    expect(r.conferencia).toEqual([{ rubrica: 3, codigo: 'base-esocial-sem-incidencia', tributo: 'fgts' }]);
  });
  it('todas=1 traz também as fora de vigência (a antiga sem natureza aparece na conferência)', async () => {
    const r = await montar(null).rubricas(sessao(), '2025-03', { empresa: null, todas: true });
    expect(r.rubricas).toHaveLength(6);
    expect(r.conferencia.map((c) => [c.rubrica, c.codigo])).toContainEqual([6, 'sem-natureza-esocial']);
  });
  it('na competência em que a antiga ainda vale, ela entra na lista', async () => {
    const r = await montar(null).rubricas(sessao(), '2024-12', { empresa: 1, todas: false });
    expect(r.rubricas.map((x) => x.id)).toContain(6);
    expect(r.foraDeVigencia).toBe(0);
    const outra = await montar(null).rubricas(sessao(), '2024-12', { empresa: 2, todas: false });
    expect(outra.rubricas).toEqual([]);
  });
});

describe('tabelas legais da competência (regra 7)', () => {
  it('a vigência pelo primeiro dia da competência, da mais nova para a mais antiga', async () => {
    const s = montar(null);
    const a = await s.tabelasLegais(sessao(), '2026-01');
    expect(a.vigente?.inicio).toBe('2026-01-01');
    expect(a.conferencia).toEqual([]);
    expect(a.vigencias).toEqual(['2026-01-01', '2025-01-01']);
    const b = await s.tabelasLegais(sessao(), '2025-12');
    expect(b.vigente?.inicio).toBe('2025-01-01');
    // O buraco sintético entre a faixa 2 e a 3 do INSS de 2025.
    expect(b.conferencia).toEqual([{ codigo: 'faixas-com-buraco', tabela: 'inss', faixa: 3 }]);
  });
  it('dias de afastamento a cargo da empresa pela mesma data de referência (regra 7)', async () => {
    const s = montar(null);
    const a = await s.tabelasLegais(sessao(), '2026-01');
    expect(a.afastamento.vigente).toEqual({ inicio: '2026-01-01', dias: 15 });
    expect(a.afastamento.vigencias.map((d) => d.inicio)).toEqual(['2026-01-01', '2015-03-01']);
    expect((await s.tabelasLegais(sessao(), '2025-12')).afastamento.vigente).toEqual({
      inicio: '2015-03-01',
      dias: 30,
    });
    expect((await s.tabelasLegais(sessao(), '2015-02')).afastamento.vigente).toBeNull();
  });
  it('competência antes de toda vigência: nenhuma em vigor', async () => {
    const r = await montar(null).tabelasLegais(sessao(), '2024-12');
    expect(r.vigente).toBeNull();
    expect(r.conferencia).toEqual([]);
  });
});

describe('inativação feita no Sante (SGH_CFG_DOMINIO_SITUACAO) na leitura da tela', () => {
  // Leitor falso por consulta (as leituras correm em paralelo): a tabela legal de 2026 foi inativada só no novo, e a
  // rubrica 10 e o vínculo de FGTS dela também.
  const dia = (iso: string) => new Date(`${iso}T12:00:00`);
  const leitor = {
    consultar: (sql: string, params: unknown[]) => {
      if (sql.includes('SGH_CFG_DOMINIO_SITUACAO')) {
        const t = params[0];
        if (t === 'TBTABIRR') return Promise.resolve([{ CHAVE: '2026-01-01' }]);
        if (t === 'FPEVENTO' || t === 'FPRUBRICAFGTS_FPEVENTO') return Promise.resolve([{ CHAVE: '10' }]);
        return Promise.resolve([]);
      }
      if (sql.includes('FROM TBTABIRR'))
        return Promise.resolve([
          { DTA_INSS_IRRF: dia('2026-01-01'), SAL_MIN: 2000 },
          { DTA_INSS_IRRF: dia('2025-01-01'), SAL_MIN: 1000 },
        ]);
      if (sql.includes('FROM FPEVENTO'))
        return Promise.resolve([
          {
            ID_EVENTO: 10,
            COD_EMP: 1,
            COD_EVENTO: 101,
            NOME: 'Sintética',
            SITUACAO: 'A',
            CI: '11',
            CF: '11',
          },
        ]);
      return Promise.resolve([]);
    },
  } as never;
  const servico = () =>
    new ServicoRubricas(portaRubricasNaTransacao(leitor), new RegistradorTrilhaMemoria(), null, null);
  it('a vigência inativada no Sante não é a em vigor: a competência usa a anterior', async () => {
    const r = await servico().tabelasLegais(sessao(), '2026-03');
    expect(r.vigente?.inicio).toBe('2025-01-01');
    expect(r.vigencias).toEqual(['2025-01-01']);
  });
  it('a rubrica inativada no Sante sai inativa e o vínculo inativado não traz o código do eSocial', async () => {
    const r = await servico().rubricas(sessao(), '2026-03', { empresa: null, todas: true });
    expect(r.rubricas[0]).toMatchObject({ id: 10, ativa: false, esocial: { inss: '11', fgts: null } });
  });
});

describe('apoio e gravação (POL-3)', () => {
  it('sem configuração: domínios e cadastros, gravação desligada com o motivo', async () => {
    const a = await montar(null).apoioTela(sessao());
    expect(a.incidenciasEsocial.inss.map((c) => c.codigo)).toContain('11');
    expect(a.naturezas.length).toBeGreaterThan(0);
    expect(a.gravacaoLigada).toBe(false);
    expect(a.motivoDesligada).toMatch(/configuração/);
    expect(a.cadastros).toEqual(CADASTROS_RUBRICAS);
    expect(CADASTROS_RUBRICAS).toContain('pessoas.rubrica');
    expect(CADASTROS_RUBRICAS).toContain('pessoas.tabelaLegalFolha');
    // As 12 migrar-crud da folha (ficha, seção 5): 8 do M53 e 4 que já eram cadastro do M14; as rubricas primeiro.
    expect(CADASTROS_RUBRICAS).toHaveLength(12);
    expect(CADASTROS_RUBRICAS[0]).toBe('pessoas.rubrica');
    for (const r of ['condicaoFuncionario', 'tributoIntegracao', 'esocialS1210', 'agrupadorRotina'])
      expect(CADASTROS_RUBRICAS).toContain(`pessoas.${r}`);
  });
  it('chave desligada: em consulta; ligada: grava; sem a permissão de editar: nunca', async () => {
    expect((await montar(false).apoioTela(sessao())).gravacaoLigada).toBe(false);
    const ligada = await montar(true).apoioTela(sessao());
    expect([ligada.gravacaoLigada, ligada.motivoDesligada]).toEqual([true, null]);
    const semPermissao = await montar(true).apoioTela(sessao((c) => c !== 'pessoas.rubrica.editar'));
    expect(semPermissao.gravacaoLigada).toBe(false);
    expect(semPermissao.motivoDesligada).toMatch(/perfil/);
  });
  it('tabela legal à parte (D-CHAVE-532): grava com as permissões mesmo com a chave da folha desligada', async () => {
    const a = await montar(false).apoioTela(sessao());
    expect(a.gravacaoLigada).toBe(false);
    expect(a.tabelaLegal).toEqual({ ler: true, gravacaoLigada: true, motivoDesligada: null });
    const semTabela = await montar(false).apoioTela(sessao((c) => c !== 'pessoas.tabelaLegalFolha.editar'));
    expect(semTabela.tabelaLegal.gravacaoLigada).toBe(false);
    expect(semTabela.tabelaLegal.motivoDesligada).toMatch(/tabelas legais/);
    // A gravação da tabela legal também pede a permissão do grupo (`pessoas.rubrica.editar`), como o CRUD genérico.
    const semGrupo = await montar(true).apoioTela(sessao((c) => c !== 'pessoas.rubrica.editar'));
    expect(semGrupo.tabelaLegal.gravacaoLigada).toBe(false);
  });
  it('cada parte pela sua permissão: só a tabela legal (opção 370) não vê as rubricas nem os outros cadastros', async () => {
    const so370 = await montar(true).apoioTela(sessao((c) => c.startsWith('pessoas.tabelaLegalFolha.')));
    expect(so370.lerRubricas).toBe(false);
    expect(so370.tabelaLegal.ler).toBe(true);
    expect(so370.cadastros).toEqual(['pessoas.tabelaLegalFolha']);
    const soEventos = await montar(true).apoioTela(sessao((c) => c === 'pessoas.rubrica.ler'));
    expect([soEventos.lerRubricas, soEventos.tabelaLegal.ler]).toEqual([true, false]);
    expect(soEventos.cadastros).toEqual(['pessoas.rubrica']);
  });
  it('os domínios ficam em cache curto por estabelecimento', async () => {
    const porta = new PortaRubricasMemoria();
    let lidas = 0;
    const dominios = porta.dominios.bind(porta);
    porta.dominios = async () => {
      lidas++;
      return dominios();
    };
    let agora = 1_000;
    const s = new ServicoRubricas(porta, new RegistradorTrilhaMemoria(), null, null, () => agora);
    await s.apoioTela(sessao());
    await s.apoioTela(sessao());
    expect(lidas).toBe(1);
    agora += 11 * 60_000;
    await s.apoioTela(sessao());
    expect(lidas).toBe(2);
  });
});

describe('filtros e portas', () => {
  const codigo = (f: () => unknown) => {
    try {
      f();
      return 'ok';
    } catch (e) {
      return e instanceof ErroProblema ? e.tipo : 'outro';
    }
  };
  it('competência obrigatória e no formato AAAA-MM; campo desconhecido é recusado', () => {
    expect(codigo(() => corpo(esquemaFiltroRubricas, { competencia: '2025-03', todas: '1' }))).toBe('ok');
    expect(codigo(() => corpo(esquemaFiltroRubricas, { competencia: '2025-3' }))).toBe('entrada-invalida');
    expect(codigo(() => corpo(esquemaFiltroRubricas, {}))).toBe('entrada-invalida');
    expect(codigo(() => corpo(esquemaFiltroRubricas, { competencia: '2025-03', x: '1' }))).toBe(
      'entrada-invalida',
    );
    expect(codigo(() => corpo(esquemaFiltroTabelasLegais, { competencia: '2025-13' }))).toBe(
      'entrada-invalida',
    );
  });
  it('o controlador converte empresa e todas', async () => {
    const c = new RubricasController(new PortaRubricasMemoria(), new RegistradorTrilhaMemoria());
    const req = {
      sgh: {
        sessao: { estabelecimentoAtivo: 'aa', rede: '', usuario: { login: 'SINT.DP', id: 'x' } },
        ability: { can: () => true },
      },
      headers: {},
    } as never;
    const r = await c.rubricas({ competencia: '2025-03', empresa: '1', todas: '1' }, req).catch((e) => e);
    if (r instanceof Error) throw r;
    expect(r.rubricas).toHaveLength(6);
  });
  it('as portas não gravam; a indisponível responde 503', async () => {
    const recusa = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: unknown) => (e instanceof ErroProblema ? e.getStatus() : 'outro'),
      );
    const m = new PortaRubricasMemoria();
    expect(await recusa(m.gravarSgh({ rede: '', hospital: 'aa' }, {} as never, async () => 1))).toBe(409);
    const t = portaRubricasNaTransacao({} as never);
    expect(await recusa(t.executar({ rede: '', hospital: 'aa' }, 'x', {}, {} as never))).toBe(409);
    expect(await recusa(portaRubricasIndisponivel().rubricas({ rede: '', hospital: 'aa' }, null))).toBe(503);
  });
});
