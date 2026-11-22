// Unidade da ponte dos módulos para a porta de arquivos (ADR 0004): formato das chaves dos módulos, a escolha pelo
// ambiente (sem núcleo: memória; com núcleo e sem ARQUIVOS_RAIZ: 503) e a guarda legal. Sem banco e sem disco.
import type { NucleoArmazem } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import type { DynamicModule } from '@nestjs/common';
import {
  ARMAZEM_FOTOS,
  ArmazemFotosMemoria,
  chaveFotoDoArquivo,
  CHAVE_FOTO,
  criarArmazemFotos,
} from './adt/fotos.js';
import { modulo as moduloAdt } from './adt/modulo.js';
import type { PortaNir } from './adt/nir-porta.js';
import type { PortaAdt } from './adt/porta.js';
import { moduloPortaria } from './portaria/modulo.js';
import type { PortaPortaria } from './portaria/porta.js';
import type { ContextoModulo } from './registro.js';
import { ambienteCurto, arquivosDoAmbiente, dataDaqui, idNaChave } from './arquivos-locais.js';
import {
  ArmazemDigitalizacaoMemoria,
  CHAVE_DIGITALIZACAO,
  chaveDigitalizacaoDoArquivo,
  criarArmazemDigitalizacao,
} from './digitalizacao/armazem.js';
import {
  ArmazemProvasMemoria,
  CHAVE_PROVA,
  chaveProvaDoArquivo,
  criarArmazemProvas,
} from './portal-paciente/aplicacao/provas.js';
import {
  ARMAZEM_FOTOS_PORTARIA,
  ArmazemFotosPortariaMemoria,
  CHAVE_FOTO_VISITANTE,
  chaveFotoVisitante,
  criarArmazemFotosPortaria,
} from './portaria/fotos.js';
import type { Configuracao } from '../configuracao.js';

const nucleoFalso = { criarExecutor: () => ({}) } as unknown as NucleoArmazem;
const cfg = { clientePadrao: 'teste' } as Configuracao;

describe('chaves dos módulos sobre a porta de arquivos', () => {
  it('levam o id do arquivo e passam no formato que cada módulo aceita', () => {
    expect(chaveFotoDoArquivo(12, 'a'.repeat(24), 'png')).toBe(
      `higienizacao/arquivo-12-${'a'.repeat(24)}.png`,
    );
    expect(CHAVE_FOTO.test(chaveFotoDoArquivo(1, 'b'.repeat(24), 'jpg'))).toBe(true);
    expect(CHAVE_FOTO_VISITANTE.test(chaveFotoVisitante(7, 'image/webp'))).toBe(true);
    expect(CHAVE_DIGITALIZACAO.test(chaveDigitalizacaoDoArquivo(99))).toBe(true);
    expect(idNaChave('visitante/arquivo-7.webp')).toBe(7);
    expect(idNaChave('same/digitalizacao/arquivo-0.pdf')).toBeNull();
    expect(idNaChave('higienizacao/abc.jpg')).toBeNull();
  });

  it('a prova: 8 hex do id e 24 hex do sinal; fora disso, nenhuma chave', () => {
    const c = chaveProvaDoArquivo(255, 'a'.repeat(24), 'pdf');
    expect(c).toBe(`portal/provas/000000ff${'a'.repeat(24)}-pdf`);
    expect(CHAVE_PROVA.test(c!)).toBe(true);
    expect(chaveProvaDoArquivo(0x1_0000_0000, 'a'.repeat(24), 'pdf')).toBeNull();
    expect(chaveProvaDoArquivo(1, 'curto', 'pdf')).toBeNull();
  });

  it('guarda legal: data em anos e ambiente curto só em dev/ci', () => {
    expect(dataDaqui(20, new Date('2026-11-21T12:00:00Z'))).toBe('2046-11-21');
    expect(ambienteCurto({})).toBe(true);
    expect(ambienteCurto({ AMBIENTE: 'ci' })).toBe(true);
    expect(ambienteCurto({ AMBIENTE: 'producao' })).toBe(false);
  });
});

describe('armazém pelo ambiente', () => {
  it('sem núcleo: memória em todos os módulos (nada de armazenamento externo)', () => {
    expect(arquivosDoAmbiente(null, 'teste', {})).toBeNull();
    expect(criarArmazemFotos(cfg, {})).toBeInstanceOf(ArmazemFotosMemoria);
    expect(criarArmazemFotosPortaria(cfg, {})).toBeInstanceOf(ArmazemFotosPortariaMemoria);
    expect(criarArmazemDigitalizacao(null, 'teste', {})).toBeInstanceOf(ArmazemDigitalizacaoMemoria);
    expect(criarArmazemProvas(null, 'teste', {})).toBeInstanceOf(ArmazemProvasMemoria);
  });

  it('com núcleo e sem ARQUIVOS_RAIZ: 503 em toda chamada (falha fechada)', async () => {
    const a = criarArmazemFotos(cfg, {}, nucleoFalso);
    expect(a.destino).toBe('local');
    await expect(a.guardar('h', 'image/jpeg', new Uint8Array(12))).rejects.toMatchObject({
      tipo: 'indisponivel',
    });
    await expect(a.ler('h', `higienizacao/arquivo-1-${'a'.repeat(24)}.jpg`)).rejects.toMatchObject({
      tipo: 'indisponivel',
    });
    const p = criarArmazemProvas(nucleoFalso, null, { ARQUIVOS_RAIZ: '/tmp' });
    await expect(p.guardar('h', 'application/pdf', new Uint8Array(12))).rejects.toMatchObject({
      tipo: 'indisponivel',
    });
    const d = criarArmazemDigitalizacao(nucleoFalso, 'teste', {});
    await expect(d.ler('h', 'same/digitalizacao/arquivo-1.pdf')).rejects.toMatchObject({
      tipo: 'indisponivel',
    });
  });

  it('fiação: com o núcleo e a raiz, a portaria e a higienização gravam no disco local', async () => {
    const ctx = {
      configuracao: { clientePadrao: 'teste', ambiente: 'dev' },
      nucleo: nucleoFalso,
      env: { ARQUIVOS_RAIZ: '/tmp/arquivos-fiacao' },
    } as unknown as ContextoModulo;
    const armazem = (m: DynamicModule, s: symbol) =>
      (m.providers as { provide: unknown; useValue?: { destino?: string } }[]).find((p) => p.provide === s)
        ?.useValue;
    const portaria = await moduloPortaria(ctx, { porta: {} as PortaPortaria, configuracao: {} });
    expect(armazem(portaria, ARMAZEM_FOTOS_PORTARIA)?.destino).toBe('local');
    const adt = await moduloAdt(ctx, { adt: {} as PortaAdt, nir: {} as PortaNir });
    expect(armazem(adt, ARMAZEM_FOTOS)?.destino).toBe('local');
  });

  it('a memória da portaria usa o mesmo formato de chave', async () => {
    const m = new ArmazemFotosPortariaMemoria();
    const c = await m.guardar('h', 'image/png', new Uint8Array(12));
    expect(CHAVE_FOTO_VISITANTE.test(c)).toBe(true);
    expect((await m.ler('h', c))?.tipo).toBe('image/png');
  });
});
