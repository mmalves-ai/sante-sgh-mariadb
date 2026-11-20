import { esquemaVerificacaoJanela, FASES_ROTEIRO_JANELA, type VerificacaoJanela } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  avaliarChecagensJanela,
  avaliarRetiradaRestricao,
  avaliarVerificacaoJanela,
  compararContagensJanela,
  estimarJanelaDoRoteiro,
  estimarVoltaAtras,
  minutosDaEtapa,
  montarRoteiroJanela,
  verificacaoVigente,
} from './janela.js';

const SEM_TEMPOS = {
  backupS: null,
  restauracaoS: null,
  integridadeS: null,
  voltaAtrasS: null,
  conversaoS: null,
  equivalenciaS: null,
  contagensS: null,
};
// Os tempos do ensaio da F2/F3 no pc (docs/marcos/M58/pc/firebird5.json e utf8.json).
const TEMPOS = {
  backupS: 7835,
  restauracaoS: 6302,
  integridadeS: 189,
  voltaAtrasS: 6699,
  conversaoS: 5317,
  equivalenciaS: 1200,
  contagensS: 210,
};
const H = 'b'.repeat(64);

const verificacao = (over: Partial<VerificacaoJanela> = {}): VerificacaoJanela =>
  esquemaVerificacaoJanela.parse({
    passo: 'firebird5',
    ambiente: 'producao',
    em: '2026-11-20T10:00:00.000Z',
    inicio: '2026-11-20T02:00:00.000Z',
    fim: '2026-11-20T08:30:00.000Z',
    papel: 'ti',
    plataforma: { versaoMotor: '5.0.3', charsetBanco: 'NONE', charsetParametro: 'CP1252' },
    schema: { esperada: '0123456789abcdef', obtida: '0123456789abcdef', diferencas: 0 },
    contagens: { tabelas: 4142, iguais: 4142, diferentes: [], ausentes: [], hashAntes: H, hashDepois: H },
    saude: { conectou: true, latenciaMs: 40, codecConfere: true },
    operacoes: { total: 12, verdes: 12, falhas: [] },
    ...over,
  });

describe('roteiro da janela (M58-F5)', () => {
  it('cada passo vem em ordem de fase, numerado, com o hospital nos comandos', () => {
    for (const p of ['desligamento', 'firebird5', 'utf8'] as const) {
      const r = montarRoteiroJanela(p, 'pc', TEMPOS);
      expect(r.map((e) => e.ordem)).toEqual(r.map((_, i) => i + 1));
      const fases = r.map((e) => FASES_ROTEIRO_JANELA.indexOf(e.fase));
      expect(fases).toEqual([...fases].sort((a, b) => a - b));
      expect(r[0]?.etapa).toBe('confirmar-autorizacao');
      expect(r.find((e) => e.etapa === 'verificar')?.comando).toContain(`--hospital=pc --passo=${p}`);
      for (const e of r) expect(e.comando ?? '').not.toMatch(/senha|password|\d+\.\d+\.\d+\.\d+/i);
    }
  });

  it('só o UTF-8 retira a restrição; o desligamento não para o banco', () => {
    expect(montarRoteiroJanela('utf8', 'pc', TEMPOS).some((e) => e.etapa === 'retirar-restricao')).toBe(true);
    expect(montarRoteiroJanela('firebird5', 'pc', TEMPOS).some((e) => e.etapa === 'retirar-restricao')).toBe(
      false,
    );
    const d = montarRoteiroJanela('desligamento', 'pc', TEMPOS);
    expect(d.some((e) => e.etapa === 'backup' || e.etapa === 'contar-antes')).toBe(false);
    expect(estimarJanelaDoRoteiro(d)).toBeNull();
  });

  it('conta o antes com o banco já parado e logo antes do backup, no comando do passo (achados da revisão)', () => {
    for (const p of ['firebird5', 'utf8'] as const) {
      const r = montarRoteiroJanela(p, 'pc', TEMPOS);
      const ordem = (etapa: string) => r.find((e) => e.etapa === etapa)?.ordem ?? -1;
      const contar = r.find((e) => e.etapa === 'contar-antes');
      expect(contar?.fase).toBe('parada');
      expect(ordem('contar-antes')).toBeGreaterThan(ordem('parar-acesso'));
      expect(ordem('contar-antes')).toBe(ordem('backup') - 1);
      expect(contar?.comando).toBe(`pnpm janela:contagens -- --hospital=pc --passo=${p} --ambiente=producao`);
    }
  });

  it('as operações-chave vêm antes do verificar, que as recebe (a verificação gravada sai completa)', () => {
    for (const p of ['desligamento', 'firebird5', 'utf8'] as const) {
      const r = montarRoteiroJanela(p, 'pc', TEMPOS);
      const ordem = (etapa: string) => r.find((e) => e.etapa === etapa)?.ordem ?? -1;
      expect(ordem('operacoes-chave')).toBe(ordem('verificar') - 1);
      const cmd = r.find((e) => e.etapa === 'verificar')?.comando ?? '';
      expect(cmd).toContain('--operacoes=');
      expect(cmd).toContain('--inicio=');
      expect(cmd).toContain('--fim=');
    }
    const u = montarRoteiroJanela('utf8', 'pc', TEMPOS);
    const ordem = (etapa: string) => u.find((e) => e.etapa === etapa)?.ordem ?? -1;
    expect(ordem('definir-charset')).toBeLessThan(ordem('verificar'));
  });

  it('estima a janela pelos tempos do ensaio, em blocos de 15 min, e a volta atrás', () => {
    expect(minutosDaEtapa(null)).toBeNull();
    expect(minutosDaEtapa(0)).toBe(1);
    expect(minutosDaEtapa(7835)).toBe(196);
    const f5 = montarRoteiroJanela('firebird5', 'pc', TEMPOS);
    // contagens antes 6 + backup 196 + restauração 158 + integridade 5 + verificação 6 = 371 → 375
    expect(estimarJanelaDoRoteiro(f5)).toBe(375);
    expect(estimarVoltaAtras(f5)).toBe(168);
    expect(estimarJanelaDoRoteiro(montarRoteiroJanela('firebird5', 'pc', SEM_TEMPOS))).toBeNull();
    expect(estimarVoltaAtras(montarRoteiroJanela('firebird5', 'pc', SEM_TEMPOS))).toBeNull();
  });
});

describe('verificação depois da janela', () => {
  it('aprova a verificação completa e mede a duração', () => {
    const a = avaliarVerificacaoJanela(verificacao());
    expect(a.aprovada).toBe(true);
    expect(a.duracaoMinutos).toBe(390);
    expect(a.checagens.map((c) => c.checagem)).toEqual([
      'plataforma',
      'schema',
      'contagens',
      'saude',
      'operacoes',
    ]);
  });

  it('reprova pelos números, não pela situação escrita', () => {
    const c = (v: VerificacaoJanela) =>
      Object.fromEntries(avaliarChecagensJanela(v).map((x) => [x.checagem, x.achados]));
    expect(
      c(
        verificacao({
          plataforma: { versaoMotor: '3.0.14', charsetBanco: 'NONE', charsetParametro: 'UTF8' },
        }),
      ).plataforma,
    ).toEqual(['motor-diferente-do-alvo', 'charset-desencontrado']);
    expect(c(verificacao({ schema: { esperada: null, obtida: 'x', diferencas: 0 } })).schema).toEqual([
      'sem-impressao-homologada',
    ]);
    expect(c(verificacao({ schema: { esperada: 'a', obtida: 'a', diferencas: 2 } })).schema).toEqual([
      'impressao-diferente',
    ]);
    expect(
      c(
        verificacao({
          contagens: {
            tabelas: 3,
            iguais: 1,
            diferentes: ['TBA'],
            ausentes: ['TBB'],
            esperadas: [],
            hashAntes: H,
            hashDepois: 'c'.repeat(64),
          },
        }),
      ).contagens,
    ).toEqual(['contagens-diferentes', 'tabelas-ausentes']);
    expect(
      c(
        verificacao({
          contagens: {
            tabelas: 3,
            iguais: 3,
            diferentes: [],
            ausentes: [],
            esperadas: [],
            hashAntes: null,
            hashDepois: H,
          },
        }),
      ).contagens,
    ).toEqual(['sem-contagem-antes']);
    expect(
      c(verificacao({ saude: { conectou: false, latenciaMs: null, codecConfere: false } })).saude,
    ).toEqual(['conexao-falhou']);
    expect(
      c(verificacao({ saude: { conectou: true, latenciaMs: 5000, codecConfere: false } })).saude,
    ).toEqual(['latencia-alta', 'codec-desencontrado']);
    expect(
      c(verificacao({ operacoes: { total: 3, verdes: 2, falhas: ['convenio.alterarSituacao'] } })).operacoes,
    ).toEqual(['operacoes-com-falha']);
    expect(c(verificacao({ operacoes: { total: 0, verdes: 0, falhas: [] } })).operacoes).toEqual([
      'sem-operacoes',
    ]);
  });

  it('UTF-8 seguindo o roteiro: a linha do charset (definir-charset) é a mudança esperada e aprova', () => {
    const antes = { PACIENTE: 10, SGH_CFG_PARAMETRO: 40, SGH_TRILHA: 500 };
    const ok = (passo: 'firebird5' | 'utf8', depois: Record<string, number>) => {
      const k = compararContagensJanela(passo, antes, depois);
      return avaliarVerificacaoJanela(
        verificacao({
          passo,
          plataforma:
            passo === 'utf8'
              ? { versaoMotor: '5.0.3', charsetBanco: 'UTF8', charsetParametro: 'UTF8' }
              : { versaoMotor: '5.0.3', charsetBanco: 'NONE', charsetParametro: 'CP1252' },
          contagens: { ...k, hashAntes: k.hashAntes, hashDepois: k.hashDepois },
        }),
      );
    };
    // O caso do ensaio (docs/marcos/M58/pc/janela.json): só SGH_CFG_PARAMETRO com uma linha a mais.
    const u = ok('utf8', { ...antes, SGH_CFG_PARAMETRO: 41 });
    expect(u.aprovada).toBe(true);
    expect(u.checagens.find((c) => c.checagem === 'contagens')?.situacao).toBe('aprovada');
    expect(ok('utf8', { ...antes, SGH_CFG_PARAMETRO: 41, SGH_TRILHA: 507 }).aprovada).toBe(true);
    // Fora da faixa, fora do passo ou perda de linha continuam reprovando.
    expect(ok('utf8', { ...antes, SGH_CFG_PARAMETRO: 42 }).aprovada).toBe(false);
    expect(ok('utf8', { ...antes, SGH_CFG_PARAMETRO: 41, SGH_TRILHA: 499 }).aprovada).toBe(false);
    expect(ok('utf8', { ...antes, SGH_CFG_PARAMETRO: 41, PACIENTE: 11 }).aprovada).toBe(false);
    expect(ok('firebird5', { ...antes, SGH_CFG_PARAMETRO: 41 }).aprovada).toBe(false);
    expect(ok('firebird5', { ...antes, SGH_TRILHA: 503 }).aprovada).toBe(true);
    // A esperada escrita à mão fora da faixa do passo não aprova (o domínio reconfere).
    const forjada = avaliarChecagensJanela(
      verificacao({
        passo: 'firebird5',
        contagens: {
          tabelas: 2,
          iguais: 1,
          diferentes: [],
          ausentes: [],
          esperadas: [{ tabela: 'PACIENTE', delta: 1 }],
          hashAntes: H,
          hashDepois: 'c'.repeat(64),
        },
      }),
    ).find((c) => c.checagem === 'contagens');
    expect(forjada?.achados).toEqual(['contagens-diferentes']);
  });

  it('checagem sem número é não executada e reprova (falha fechada)', () => {
    const a = avaliarVerificacaoJanela(verificacao({ contagens: null, inicio: null }));
    expect(a.aprovada).toBe(false);
    expect(a.duracaoMinutos).toBeNull();
    expect(a.checagens.find((x) => x.checagem === 'contagens')?.situacao).toBe('nao-executada');
  });

  it('o desligamento não exige contagens; o UTF-8 exige o banco em UTF8', () => {
    const d = avaliarVerificacaoJanela(
      verificacao({
        passo: 'desligamento',
        contagens: null,
        plataforma: { versaoMotor: '3.0.14', charsetBanco: 'NONE', charsetParametro: 'CP1252' },
      }),
    );
    expect(d.aprovada).toBe(true);
    const u = avaliarChecagensJanela(verificacao({ passo: 'utf8' }));
    expect(u.find((x) => x.checagem === 'plataforma')?.achados).toEqual(['charset-diferente-do-alvo']);
    const ok = avaliarVerificacaoJanela(
      verificacao({
        passo: 'utf8',
        plataforma: { versaoMotor: '5.0.3', charsetBanco: 'UTF8', charsetParametro: 'UTF8' },
      }),
    );
    expect(ok.aprovada).toBe(true);
  });

  it('vale a mais recente do passo e do ambiente', () => {
    const a = verificacao({ em: '2026-11-20T10:00:00.000Z' });
    const b = verificacao({ em: '2026-11-21T10:00:00.000Z', operacoes: { total: 1, verdes: 0, falhas: [] } });
    const e = verificacao({ ambiente: 'ensaio', em: '2026-11-22T10:00:00.000Z' });
    expect(verificacaoVigente([b, a, e], 'firebird5', 'producao')).toBe(b);
    expect(verificacaoVigente([a, b, e], 'firebird5', 'ensaio')).toBe(e);
    expect(verificacaoVigente([a], 'utf8', 'producao')).toBeNull();
  });
});

describe('retirada da restrição de entrada (regra 6)', () => {
  const pronto = {
    registroValido: true,
    utf8Autorizado: true,
    utf8Executado: true,
    verificacaoProducaoAprovada: true,
    charsetBanco: 'UTF8',
    charsetParametro: 'UTF8' as const,
    chaveLigada: false,
  };

  it('pode retirar só com tudo de pé; ligada vira retirada', () => {
    expect(avaliarRetiradaRestricao(pronto)).toEqual({ situacao: 'pode-retirar', motivos: [] });
    expect(avaliarRetiradaRestricao({ ...pronto, chaveLigada: true }).situacao).toBe('retirada');
  });

  it('o padrão de hoje (CP1252, nada registrado) fica restrito com todos os motivos', () => {
    expect(
      avaliarRetiradaRestricao({
        registroValido: false,
        utf8Autorizado: false,
        utf8Executado: false,
        verificacaoProducaoAprovada: null,
        charsetBanco: 'NONE',
        charsetParametro: 'CP1252',
        chaveLigada: false,
      }),
    ).toEqual({
      situacao: 'restrita',
      motivos: [
        'registro-invalido',
        'utf8-nao-autorizado',
        'utf8-nao-executado',
        'verificacao-ausente',
        'banco-nao-utf8',
        'parametro-nao-utf8',
      ],
    });
  });

  it('chave ligada com a verificação reprovada continua restrita', () => {
    expect(
      avaliarRetiradaRestricao({ ...pronto, chaveLigada: true, verificacaoProducaoAprovada: false }),
    ).toEqual({ situacao: 'restrita', motivos: ['verificacao-reprovada'] });
  });
});
