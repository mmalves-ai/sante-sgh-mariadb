import { describe, expect, it, vi } from 'vitest';
import {
  daConta,
  densidadeParaCasca,
  mudancasParaConta,
  destinoInicialDaConta,
  gravarPreferenciasDaConta,
  gravarVisaoDaTela,
  reiniciarDestinoInicial,
  visaoInicialDaTela,
  type PreferenciasDaConta,
} from './preferencias-servidor.js';

const CONTA: PreferenciasDaConta = {
  guardadas: true,
  geral: { tema: 'escuro', densidade: 'normal', textoAmpliado: true, tipoAtendimentoPadrao: null },
  telaInicial: { codigo: 'AGENDA', titulo: 'Agenda', rota: '/agenda' },
  telasDoMenu: [],
  visoes: [
    {
      tela: 'MAPA',
      nome: 'padrao',
      colunas: ['leito'],
      ordenacao: [],
      filtros: null,
      itensPorPagina: null,
      padrao: false,
    },
    {
      tela: 'MAPA',
      nome: 'Noite',
      colunas: ['leito', 'paciente'],
      ordenacao: [{ coluna: 'leito', direcao: 'asc' }],
      filtros: null,
      itensPorPagina: 50,
      padrao: true,
    },
  ],
  visaoInicialPorTela: { MAPA: 'Noite' },
};
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

describe('preferências guardadas na conta (01-ADM L84)', () => {
  it('a densidade normal da conta abre como compacta; texto ampliado vira fonte ampliada', () => {
    expect(daConta(CONTA.geral)).toEqual({ tema: 'escuro', densidade: 'compacta', fonteAmpliada: true });
  });

  it('a conta guarda as três densidades; a casca desenha a normal como a sua padrão', () => {
    expect(densidadeParaCasca('normal')).toBe('compacta');
    expect(densidadeParaCasca('compacta')).toBe('compacta');
    expect(densidadeParaCasca('confortavel')).toBe('confortavel');
  });

  it('grava só o que a pessoa mudou: abrir a tela sem mudar nada não grava', () => {
    const guardado = { tema: 'escuro', densidade: 'normal', textoAmpliado: true, telaInicial: null };
    expect(mudancasParaConta(guardado, { ...guardado })).toEqual({});
    expect(mudancasParaConta(guardado, { densidade: 'normal' })).toEqual({});
    expect(mudancasParaConta(guardado, { densidade: 'compacta' })).toEqual({ densidade: 'compacta' });
    expect(mudancasParaConta(guardado, { telaInicial: 'AGE01', tema: 'escuro' })).toEqual({
      telaInicial: 'AGE01',
    });
  });

  it('o início aplica as preferências da conta e abre a tela inicial escolhida, uma vez por carga', async () => {
    reiniciarDestinoInicial();
    const buscar = vi.fn(async () => resposta(CONTA));
    const aplicar = vi.fn();
    expect(await destinoInicialDaConta(aplicar, buscar as unknown as typeof fetch)).toBe('/agenda');
    expect(aplicar).toHaveBeenCalledWith({ tema: 'escuro', densidade: 'compacta', fonteAmpliada: true });
    expect(await destinoInicialDaConta(aplicar, buscar as unknown as typeof fetch)).toBeNull();
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it('falha de leitura não impede a entrada', async () => {
    reiniciarDestinoInicial();
    const buscar = vi.fn(async () => resposta({ title: 'x' }, 503));
    expect(await destinoInicialDaConta(vi.fn(), buscar as unknown as typeof fetch)).toBeNull();
  });

  it('grava com CSRF e chave de idempotência; a visão vai para a tela certa', async () => {
    const buscar = vi.fn(async () => resposta({ id: 1 }));
    await gravarPreferenciasDaConta({ tema: 'claro' }, buscar as unknown as typeof fetch);
    await gravarVisaoDaTela(
      'MAPA',
      { colunas: ['leito'], ordenacao: [], itensPorPagina: null, padrao: true },
      buscar as unknown as typeof fetch,
    );
    const [url1, i1] = buscar.mock.calls[0] as unknown as [string, RequestInit];
    const [url2] = buscar.mock.calls[1] as unknown as [string, RequestInit];
    expect(url1).toBe('/api/acesso/preferencias/minhas');
    expect(i1.method).toBe('PUT');
    expect((i1.headers as Record<string, string>)['idempotency-key']).toMatch(/^pref-.{8,}/);
    expect(url2).toBe('/api/acesso/preferencias/minhas/telas/MAPA');
  });

  it('a tela abre na visão marcada', async () => {
    const buscar = vi.fn(async () => resposta(CONTA));
    expect((await visaoInicialDaTela('MAPA', buscar as unknown as typeof fetch))?.nome).toBe('Noite');
  });
});
