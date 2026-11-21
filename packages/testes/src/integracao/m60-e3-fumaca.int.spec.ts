// M60, etapa 3 (testes pós-implantação), na CÓPIA compartilhada, sob a trava da cópia: só leitura. O relógio do banco
// é lido sem erro e a deriva contra o relógio do processo, descontado o fuso do servidor do banco, fica dentro do
// limite; a impressão digital da parte legada confere com a homologada; as chaves de liberação são lidas e contadas
// (sessão 2: o escopo pessoa só como contagem) e a fumaça inteira sai com os sete itens. Saída só com fuso, deriva,
// estados e contagens agregadas.
import { ITENS_FUMACA_SERVIDOR } from '@sgh/contratos';
import { compararRelogios, conferirChaves, conferirHoraConfiavel, itensDaFumaca } from '@sgh/dominio-config';
import { lerChavesLiberacao, lerRelogioBanco } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, ctx, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

describe.skipIf(!PODE_ESCREVER)('M60.3: fumaça do servidor na cópia', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('o relógio do banco: fuso reconhecido e deriva abaixo de 5 s', async () => {
    const antes = Date.now();
    const banco = await a.nucleo.lerSomente(ctx(a), (l) => lerRelogioBanco(l));
    const depois = Date.now();
    expect(banco).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/);
    const r = compararRelogios(Math.round((antes + depois) / 2), banco, process.env['TZ'] ?? '');
    console.log(`[${a.cod}] relógio do banco: fuso ${r.fusoBancoMin} min, deriva ${r.derivaMs} ms`);
    expect(r.fusoBancoMin).not.toBeNull();
    expect(Math.abs(r.derivaMs ?? Infinity)).toBeLessThan(5_000);
  });

  it('a impressão digital da parte legada confere com a homologada', async () => {
    const m = await a.nucleo.verificarSchema(a.cod);
    console.log(`[${a.cod}] estrutura: ${m.estado}`);
    expect(m.estado).toBe('homologado');
  });

  it('as chaves de liberação: lidas, contadas por escopo e conferidas contra as esperadas', async () => {
    const linhas = await a.nucleo.lerSomente(ctx(a), (l) => lerChavesLiberacao(l, a.cod));
    const brutas = linhas.map((x) => ({ tipo: x.tipo, chave: x.chave, escopo: x.escopo, ligada: x.ligada }));
    const nenhuma = conferirChaves(brutas, []);
    expect(nenhuma.lidas).toBe(true);
    // Nada de login: só a chave e as contagens por escopo.
    for (const c of nenhuma.ligadas)
      expect(Object.keys(c).sort()).toEqual(['chave', 'grupo', 'hospital', 'pessoa', 'setor', 'tipo']);
    expect(nenhuma.inesperadas.length).toBe(new Set(nenhuma.ligadas.map((c) => c.chave)).size);
    const todas = conferirChaves(brutas, [...new Set(nenhuma.ligadas.map((c) => c.chave))]);
    expect(todas.inesperadas).toEqual([]);
    const prefixos = [...new Set(nenhuma.ligadas.map((c) => `${c.chave.split('.')[0]}.*`))];
    expect(conferirChaves(brutas, prefixos).inesperadas).toEqual([]);
    const n = nenhuma.ligadas.length;
    console.log(
      `[${a.cod}] chaves: ${linhas.length < 5 ? '<5' : linhas.length} linha(s), ${n < 5 ? '<5' : n} ligada(s)`,
    );
  });

  it('a fumaça inteira com o banco real (Valkey ausente): os oito itens, relógio e estrutura em ordem', async () => {
    const antes = Date.now();
    const banco = await a.nucleo.lerSomente(ctx(a), (l) => lerRelogioBanco(l));
    const relogio = compararRelogios(Math.round((antes + Date.now()) / 2), banco, 'UTC');
    const m = await a.nucleo.verificarSchema(a.cod);
    const linhas = await a.nucleo.lerSomente(ctx(a), (l) => lerChavesLiberacao(l, a.cod));
    // W0-09 (M2): a hora confiável com o relógio real do banco (NTP sem rede no teste: o servidor como referência).
    const horaConfiavel = conferirHoraConfiavel({
      servidorNtp: 'a.st1.ntp.br',
      deslocamentoNtpMs: 0,
      servidorMs: antes,
      relogio,
      limiarMs: 1_000,
      fusoInstituicao: 'America/Sao_Paulo',
    });
    expect(horaConfiavel.desvioBancoMs).toBe(relogio.derivaMs);
    const itens = itensDaFumaca({
      ambiente: 'producao',
      relogio,
      horaConfiavel,
      valkey: { configurado: false, responde: false, latenciaMs: null },
      filas: [],
      impressao: {
        estado: m.estado,
        resumo: null,
        resumoHomologado: null,
        verificadaEm: null,
      },
      chaves: conferirChaves(
        linhas.map((x) => ({ tipo: x.tipo, chave: x.chave, escopo: x.escopo, ligada: x.ligada })),
        [],
      ),
    });
    expect(itens.map((i) => i.codigo)).toEqual([...ITENS_FUMACA_SERVIDOR]);
    const por = Object.fromEntries(itens.map((i) => [i.codigo, i.situacao]));
    expect(por['fuso']).toBe('ok');
    expect(por['relogio']).not.toBe('falha');
    expect(por['impressao-digital']).toBe('ok');
    expect(por['valkey']).toBe('falha');
    console.log(`[${a.cod}] fumaça: ${itens.map((i) => `${i.codigo}=${i.situacao}`).join(' ')}`);
  });
});
