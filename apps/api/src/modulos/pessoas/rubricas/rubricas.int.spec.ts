// API das rubricas, incidências e tabelas legais sobre a cópia (M53, etapa F1; ficha, seções 4, 7 e regra 7): o serviço
// da tela com a porta do legado (transação READ ONLY) devolve respostas que passam pelos esquemas do contrato; as rubricas
// em vigor numa competência mais as fora de vigência somam a lista completa; a conferência só cita rubricas da lista; a
// tabela legal em vigor é a de início mais recente até o primeiro dia da competência; o apoio traz os domínios do eSocial
// com rótulo e a gravação desligada sem a chave `pessoas.folha`. Medido o tempo de cada leitura. Só contagens e formatos
// (rubrica e tabela legal são parâmetros da empresa, não dado de pessoa).
import {
  esquemaApoioRubricas,
  esquemaRubricasDaCompetencia,
  esquemaTabelasLegaisDaCompetencia,
} from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { type AmbienteM27, ambienteM27, NA_COPIA } from '../../acesso/aplicacao/copia.spec-util.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { portaRubricasLegado } from './porta-rubricas-legado.js';
import { CADASTROS_RUBRICAS, ServicoRubricas } from './servico-rubricas.js';

const sessao = (c: { rede: string; hospital: string }, pode: (p: string) => boolean): SessaoCadastro =>
  ({
    req: { sgh: undefined, headers: {} },
    hospital: c.hospital,
    rede: c.rede,
    login: 'SGH.TESTE',
    porta: { rede: c.rede, hospital: c.hospital },
    pode,
  }) as unknown as SessaoCadastro;

describe.skipIf(!NA_COPIA)('API das rubricas e tabelas legais na cópia (só leitura)', () => {
  let a: AmbienteM27;
  let servico: ServicoRubricas;
  beforeAll(async () => {
    a = await ambienteM27();
    const trilha = new RegistradorTrilhaMemoria();
    servico = new ServicoRubricas(
      portaRubricasLegado(a.nucleo),
      trilha,
      fonteConfiguracaoMemoria(trilha, { chavesIniciais: () => [], prerequisitosIniciais: () => [] }),
      null,
    );
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('rubricas da competência: contrato, vigência e conferência coerentes, em menos de 3 s', async () => {
    const s = sessao(a.c, () => true);
    const t0 = performance.now();
    const vigentes = esquemaRubricasDaCompetencia.parse(
      await servico.rubricas(s, '2026-10', { empresa: null, todas: false }),
    );
    const ms = performance.now() - t0;
    const todas = esquemaRubricasDaCompetencia.parse(
      await servico.rubricas(s, '2026-10', { empresa: null, todas: true }),
    );
    expect(vigentes.dataReferencia).toBe('2026-10-01');
    expect(vigentes.rubricas.length).toBeGreaterThan(0);
    expect(vigentes.rubricas.length + vigentes.foraDeVigencia).toBe(todas.rubricas.length);
    const ids = new Set(vigentes.rubricas.map((r) => r.id));
    expect(vigentes.conferencia.every((c) => ids.has(c.rubrica))).toBe(true);
    for (const r of vigentes.rubricas) {
      if (r.vigencia.inicio) expect(r.vigencia.inicio <= '2026-10-01').toBe(true);
      if (r.vigencia.fim) expect(r.vigencia.fim >= '2026-10-01').toBe(true);
    }
    const empresa = vigentes.rubricas[0]!.empresa;
    const daEmpresa = await servico.rubricas(s, '2026-10', { empresa, todas: false });
    expect(daEmpresa.rubricas.every((r) => r.empresa === empresa)).toBe(true);
    expect(ms).toBeLessThan(3_000);
    console.info(
      `[M53.2 int] rubricas em vigor ${vigentes.rubricas.length}, fora ${vigentes.foraDeVigencia}, ` +
        `divergências ${vigentes.conferencia.length}, ${Math.round(ms)} ms`,
    );
  });

  it('tabela legal da competência: a de início mais recente até o primeiro dia, vigências em ordem', async () => {
    const s = sessao(a.c, () => true);
    const t0 = performance.now();
    const r = esquemaTabelasLegaisDaCompetencia.parse(await servico.tabelasLegais(s, '2026-10'));
    const ms = performance.now() - t0;
    expect(r.vigencias.length).toBeGreaterThan(0);
    expect([...r.vigencias].sort().reverse()).toEqual(r.vigencias);
    const esperada = r.vigencias.find((v) => v <= '2026-10-01') ?? null;
    expect(r.vigente?.inicio ?? null).toBe(esperada);
    if (r.vigente) expect(r.vigente.salarioMinimo).toBeGreaterThan(0);
    // Uma competência antes de toda vigência não tem tabela em vigor.
    // Os dias de afastamento a cargo da empresa (FPHSTDIAAFAST) com a mesma data de referência.
    expect(r.afastamento.vigencias.length).toBeGreaterThan(0);
    if (r.afastamento.vigente) expect(r.afastamento.vigente.inicio <= r.dataReferencia).toBe(true);
    const antes = await servico.tabelasLegais(s, '1990-01');
    expect(antes.vigente === null || antes.vigente.inicio <= '1990-01-01').toBe(true);
    expect(ms).toBeLessThan(3_000);
    console.info(
      `[M53.2 int] vigências ${r.vigencias.length}, divergências ${r.conferencia.length}, ${Math.round(ms)} ms`,
    );
  });

  it('apoio: domínios do eSocial com rótulo, cadastros da tela e a gravação desligada sem a chave da folha', async () => {
    const editor = esquemaApoioRubricas.parse(await servico.apoioTela(sessao(a.c, () => true)));
    expect(editor.cadastros).toEqual([...CADASTROS_RUBRICAS]);
    for (const lista of Object.values(editor.incidenciasEsocial))
      expect(lista.every((x) => x.codigo !== '' && x.rotulo !== '')).toBe(true);
    expect(editor.gravacaoLigada).toBe(false);
    expect(editor.motivoDesligada).toBeTruthy();
    const leitor = esquemaApoioRubricas.parse(
      await servico.apoioTela(sessao(a.c, (p) => p !== 'pessoas.rubrica.editar')),
    );
    expect(leitor.gravacaoLigada).toBe(false);
    expect(leitor.motivoDesligada).toBeTruthy();
  });
});
