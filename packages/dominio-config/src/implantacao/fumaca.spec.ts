import { describe, expect, it } from 'vitest';
import {
  compararRelogios,
  conferirChaves,
  contarChavesLigadas,
  type EntradaFumacaServidor,
  formatarHoraDeParede,
  fusoEhUtc,
  horaDeParedeMs,
  itensDaFumaca,
  lerChavesEsperadas,
  piorSituacao,
  rotuloFuso,
} from './fumaca.js';

const T = Date.UTC(2026, 9, 27, 15, 0, 0, 0);

const base = (): EntradaFumacaServidor => ({
  ambiente: 'producao',
  relogio: compararRelogios(T, formatarHoraDeParede(T - 3 * 3_600_000 + 300), 'UTC'),
  valkey: { configurado: true, responde: true, latenciaMs: 1 },
  filas: [
    { codigo: 'email', consumidores: 1, aguardando: 0, ativos: 0, atrasados: 0, falhas: 0 },
    { codigo: 'relatorio', consumidores: 1, aguardando: 2, ativos: 0, atrasados: 0, falhas: 0 },
  ],
  impressao: {
    estado: 'homologado',
    resumo: 'abcdef0123456789',
    resumoHomologado: 'abcdef0123456789',
    verificadaEm: new Date(T).toISOString(),
  },
  chaves: conferirChaves([], []),
});

const sit = (e: EntradaFumacaServidor) =>
  Object.fromEntries(itensDaFumaca(e).map((i) => [i.codigo, i.situacao]));

describe('M60.3: relógio do servidor contra o do banco', () => {
  it('hora de parede ida e volta', () => {
    expect(horaDeParedeMs('2026-10-27T12:00:00.250')).toBe(Date.UTC(2026, 9, 27, 12, 0, 0, 250));
    expect(horaDeParedeMs('2026-10-27T12:00:00')).toBe(Date.UTC(2026, 9, 27, 12, 0, 0));
    expect(formatarHoraDeParede(Date.UTC(2026, 9, 27, 12, 0, 0, 5))).toBe('2026-10-27T12:00:00.005');
    expect(Number.isNaN(horaDeParedeMs('ontem'))).toBe(true);
  });

  it('deduz o fuso do banco (múltiplo de 15 min) e a deriva com sinal', () => {
    const r = compararRelogios(T, formatarHoraDeParede(T - 3 * 3_600_000 + 1_200), 'UTC');
    expect(r).toMatchObject({ fusoBancoMin: -180, derivaMs: 1_200 });
    expect(rotuloFuso(-180)).toBe('UTC-03:00');
    expect(rotuloFuso(330)).toBe('UTC+05:30');
    const atrasado = compararRelogios(T, formatarHoraDeParede(T - 4_000), 'UTC');
    expect(atrasado).toMatchObject({ fusoBancoMin: 0, derivaMs: -4_000 });
  });

  it('sem leitura do banco: deriva nula e o item do relógio em falha', () => {
    const r = compararRelogios(T, null, 'UTC');
    expect(r.derivaMs).toBeNull();
    expect(sit({ ...base(), relogio: r }).relogio).toBe('falha');
  });

  it('fuso fora de UTC-12..+14 não é fuso: tudo vira deriva e falha', () => {
    const r = compararRelogios(T, formatarHoraDeParede(T + 20 * 3_600_000), 'UTC');
    expect(r.fusoBancoMin).toBeNull();
    expect(sit({ ...base(), relogio: r }).relogio).toBe('falha');
  });

  it('deriva acima de 1 s alerta; acima de 5 s falha', () => {
    const alerta = compararRelogios(T, formatarHoraDeParede(T - 3 * 3_600_000 + 2_000), 'UTC');
    expect(sit({ ...base(), relogio: alerta }).relogio).toBe('alerta');
    const falha = compararRelogios(T, formatarHoraDeParede(T - 3 * 3_600_000 - 6_000), 'UTC');
    const i = itensDaFumaca({ ...base(), relogio: falha }).find((x) => x.codigo === 'relogio');
    expect(i?.situacao).toBe('falha');
    expect(i?.detalhe).toContain('6,0 s');
    expect(i?.detalhe).toContain('UTC-03:00');
  });

  it('fuso do processo: UTC e sinônimos ok; outro em produção falha, fora dela alerta', () => {
    expect(fusoEhUtc('Etc/UTC')).toBe(true);
    expect(fusoEhUtc('America/Sao_Paulo')).toBe(false);
    const e = base();
    const sp = { ...e, relogio: { ...e.relogio, fuso: 'America/Sao_Paulo' } };
    expect(sit(sp).fuso).toBe('falha');
    expect(sit({ ...sp, ambiente: 'homolog' }).fuso).toBe('alerta');
  });
});

describe('M60.3: chaves de liberação no estado esperado', () => {
  const linhas = [
    { tipo: 'recurso' as const, chave: 'sistema.saude.consulta', escopo: 'grupo', ligada: true },
    { tipo: 'recurso' as const, chave: 'sistema.saude.consulta', escopo: 'pessoa', ligada: true },
    { tipo: 'recurso' as const, chave: 'sistema.saude.consulta', escopo: 'pessoa', ligada: false },
    { tipo: 'recurso' as const, chave: 'pep.prontuario.consulta', escopo: 'hospital', ligada: null },
    { tipo: 'operacao' as const, chave: 'auditoria.registrarEventoLegado', escopo: 'hospital', ligada: true },
  ];

  it('conta as ligadas por escopo, sem o valor (nada de login de pessoa)', () => {
    const c = contarChavesLigadas(linhas);
    expect(c).toEqual([
      {
        tipo: 'operacao',
        chave: 'auditoria.registrarEventoLegado',
        hospital: 1,
        setor: 0,
        grupo: 0,
        pessoa: 0,
      },
      { tipo: 'recurso', chave: 'sistema.saude.consulta', hospital: 0, setor: 0, grupo: 1, pessoa: 1 },
    ]);
  });

  it('primeira implantação: nenhuma esperada, qualquer ligada é falha', () => {
    const c = conferirChaves(linhas, []);
    expect(c.inesperadas).toEqual([
      'operacao:auditoria.registrarEventoLegado',
      'recurso:sistema.saude.consulta',
    ]);
    expect(sit({ ...base(), chaves: c }).chaves).toBe('falha');
  });

  it('esperadas exatas e por prefixo', () => {
    const c = conferirChaves(linhas, lerChavesEsperadas('sistema.*, auditoria.registrarEventoLegado'));
    expect(c.inesperadas).toEqual([]);
    expect(sit({ ...base(), chaves: c }).chaves).toBe('ok');
  });

  it('M61, liberação full: todas e todas-exceto (a exceção ligada é inesperada)', () => {
    expect(lerChavesEsperadas('todas')).toEqual(['*']);
    expect(lerChavesEsperadas('nenhuma')).toEqual([]);
    const fora = lerChavesEsperadas('todas-exceto:sistema.*,operadora.mensagens');
    expect(fora).toEqual(['*', '!sistema.*', '!operadora.mensagens']);
    expect(conferirChaves(linhas, fora).inesperadas).toEqual(['recurso:sistema.saude.consulta']);
    expect(conferirChaves(linhas, lerChavesEsperadas('todas')).inesperadas).toEqual([]);
    expect(() => lerChavesEsperadas('todas-exceto:a;b')).toThrow(/inválido/);
  });

  it('leitura falhou: falha; código inválido na variável é recusado', () => {
    expect(sit({ ...base(), chaves: conferirChaves(null, []) }).chaves).toBe('falha');
    expect(() => lerChavesEsperadas('pep;drop')).toThrow(/inválido/);
    expect(lerChavesEsperadas(undefined)).toEqual([]);
  });
});

describe('M60.3: Valkey, worker, filas e impressão digital', () => {
  it('a instalação correta: todos os itens ok', () => {
    const itens = itensDaFumaca(base());
    expect(itens.map((i) => i.codigo)).toEqual([
      'fuso',
      'relogio',
      'valkey',
      'worker',
      'filas',
      'impressao-digital',
      'chaves',
    ]);
    expect(piorSituacao(itens)).toBe('ok');
  });

  it('Valkey sem configuração (grave) e sem resposta (falha)', () => {
    expect(sit({ ...base(), valkey: { configurado: false, responde: false, latenciaMs: null } }).valkey).toBe(
      'falha',
    );
    expect(
      sit({ ...base(), ambiente: 'dev', valkey: { configurado: false, responde: false, latenciaMs: null } })
        .valkey,
    ).toBe('alerta');
    expect(sit({ ...base(), valkey: { configurado: true, responde: false, latenciaMs: null } }).valkey).toBe(
      'falha',
    );
  });

  it('worker: nenhum consumidor é falha; uma fila sem consumidor é alerta', () => {
    const e = base();
    const zero = e.filas.map((f) => ({ ...f, consumidores: 0 }));
    expect(sit({ ...e, filas: zero }).worker).toBe('falha');
    expect(sit({ ...e, filas: [e.filas[0]!, { ...e.filas[1]!, consumidores: 0 }] }).worker).toBe('alerta');
    const nulas = e.filas.map((f) => ({ ...f, consumidores: null, aguardando: null }));
    expect(sit({ ...e, filas: nulas }).worker).toBe('falha');
    expect(sit({ ...e, filas: nulas }).filas).toBe('falha');
  });

  it('filas: trabalhos com falha ou acúmulo acima do teto são alerta', () => {
    const e = base();
    expect(sit({ ...e, filas: [{ ...e.filas[0]!, falhas: 3 }] }).filas).toBe('alerta');
    expect(sit({ ...e, filas: [{ ...e.filas[0]!, aguardando: 101 }] }).filas).toBe('alerta');
  });

  it('impressão: divergente e indisponível falham; sem homologação é grave; não verificada é alerta', () => {
    const e = base();
    const com = (estado: EntradaFumacaServidor['impressao']['estado']) =>
      sit({ ...e, impressao: { ...e.impressao, estado } })['impressao-digital'];
    expect(com('divergente')).toBe('falha');
    expect(com('indisponivel')).toBe('falha');
    expect(com('sem-homologacao')).toBe('falha');
    expect(com(null)).toBe('alerta');
    const d = itensDaFumaca({
      ...e,
      impressao: { ...e.impressao, estado: 'divergente' },
    });
    expect(d.find((i) => i.codigo === 'impressao-digital')?.detalhe).toContain('atualizações do banco');
  });
});
