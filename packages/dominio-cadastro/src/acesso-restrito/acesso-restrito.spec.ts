import { describe, expect, it } from 'vitest';
import {
  acessoRestritoPermite,
  decidirAcessoRestrito,
  errosLiberacaoRestrita,
  errosMarcaRestrita,
  instante,
  type MarcaRestrita,
  marcaViva,
  nomeExibidoRestrito,
  type SujeitoAcessoRestrito,
} from './acesso-restrito.js';

const marca = (p: Partial<MarcaRestrita> = {}): MarcaRestrita => ({
  id: 1,
  estabelecimentoId: null,
  situacao: 'ativa',
  inicio: '2026-01-01',
  fim: null,
  exigeQuebraVidro: true,
  ...p,
});
const sujeito = (p: Partial<SujeitoAcessoRestrito> = {}): SujeitoAcessoRestrito => ({
  profissionalId: 10,
  equipes: [],
  atendeAgora: false,
  emergenciaVigente: false,
  plataforma: false,
  ...p,
});
const AGORA = '2026-06-01T10:00';

describe('marca de acesso restrito', () => {
  it('aceita a marca completa e recusa campo a campo', () => {
    const ok = {
      tipo: 'confidencial',
      motivo: 'Pedido do paciente por escrito',
      exibicao: 'normal',
      pseudonimo: null,
      inicio: '2026-01-01',
      fim: null,
    };
    expect(errosMarcaRestrita(ok)).toEqual([]);
    expect(errosMarcaRestrita({ ...ok, tipo: 'x', motivo: 'curto', exibicao: 'pseudonimo' })).toEqual([
      'tipo-invalido',
      'motivo-curto',
      'pseudonimo-ausente',
    ]);
    expect(errosMarcaRestrita({ ...ok, exibicao: 'y' })).toEqual(['exibicao-invalida']);
    expect(errosMarcaRestrita({ ...ok, inicio: '01/01/2026' })).toEqual(['inicio-invalido']);
    expect(errosMarcaRestrita({ ...ok, fim: '2025-12-31' })).toEqual(['fim-antes-do-inicio']);
  });

  it('vale no estabelecimento dela ou em todos, só ativa e na vigência', () => {
    expect(marcaViva(marca(), AGORA, 5)).toBe(true);
    expect(marcaViva(marca({ estabelecimentoId: 6 }), AGORA, 5)).toBe(false);
    expect(marcaViva(marca({ situacao: 'encerrada' }), AGORA, 5)).toBe(false);
    expect(marcaViva(marca({ fim: '2026-06-01T10:00' }), AGORA, 5)).toBe(false);
    expect(marcaViva(marca({ inicio: '2026-07-01' }), AGORA, 5)).toBe(false);
    expect(instante('2026-06-01')).toBe('2026-06-01T00:00:00.000');
  });
});

describe('liberação nominal', () => {
  const ok = {
    profissionalId: 10,
    equipeId: null,
    justificativa: 'Médico assistente do caso',
    inicio: '2026-01-01',
    fim: null,
  };
  it('um só destino, justificativa e vigência dentro da marca', () => {
    expect(errosLiberacaoRestrita(ok, { situacao: 'ativa', inicio: '2026-01-01', fim: null })).toEqual([]);
    expect(
      errosLiberacaoRestrita(
        { ...ok, equipeId: 3, justificativa: 'x' },
        { situacao: 'ativa', inicio: '2026-01-01', fim: null },
      ),
    ).toEqual(['destino-unico', 'justificativa-curta']);
    expect(errosLiberacaoRestrita(ok, { situacao: 'encerrada', inicio: '2026-01-01', fim: null })).toEqual([
      'marca-encerrada',
    ]);
    expect(
      errosLiberacaoRestrita(ok, { situacao: 'ativa', inicio: '2026-01-01', fim: '2026-12-31' }),
    ).toEqual(['alem-da-marca']);
  });
});

describe('decisão de acesso ao prontuário restrito', () => {
  it('sem marca viva, livre', () => {
    expect(decidirAcessoRestrito([], [], sujeito(), AGORA, 5).desfecho).toBe('livre');
    expect(decidirAcessoRestrito([marca({ situacao: 'encerrada' })], [], sujeito(), AGORA, 5).desfecho).toBe(
      'livre',
    );
  });
  it('liberado nominal pelo profissional ou pela equipe em vigor', () => {
    const l = { marcaId: 1, profissionalId: 10, equipeId: null, inicio: '2026-01-01', fim: null };
    expect(decidirAcessoRestrito([marca()], [l], sujeito(), AGORA, 5).desfecho).toBe('liberado');
    expect(
      decidirAcessoRestrito([marca()], [{ ...l, fim: '2026-05-01' }], sujeito(), AGORA, 5).desfecho,
    ).toBe('quebra-de-vidro');
    const e = { marcaId: 1, profissionalId: null, equipeId: 7, inicio: '2026-01-01', fim: null };
    expect(decidirAcessoRestrito([marca()], [e], sujeito({ equipes: [7] }), AGORA, 5).desfecho).toBe(
      'liberado',
    );
    expect(decidirAcessoRestrito([marca()], [e], sujeito({ equipes: [8] }), AGORA, 5).desfecho).toBe(
      'quebra-de-vidro',
    );
  });
  it('liberação de uma marca não abre a outra marca viva', () => {
    const l = { marcaId: 1, profissionalId: 10, equipeId: null, inicio: '2026-01-01', fim: null };
    expect(decidirAcessoRestrito([marca(), marca({ id: 2 })], [l], sujeito(), AGORA, 5).desfecho).toBe(
      'quebra-de-vidro',
    );
  });
  it('quem atende agora, a quebra de vidro vigente e a plataforma entram; conta sem profissional não', () => {
    expect(decidirAcessoRestrito([marca()], [], sujeito({ atendeAgora: true }), AGORA, 5).desfecho).toBe(
      'atende',
    );
    expect(
      decidirAcessoRestrito([marca()], [], sujeito({ profissionalId: null, atendeAgora: true }), AGORA, 5)
        .desfecho,
    ).toBe('quebra-de-vidro');
    expect(
      decidirAcessoRestrito([marca()], [], sujeito({ emergenciaVigente: true }), AGORA, 5).desfecho,
    ).toBe('emergencia');
    expect(decidirAcessoRestrito([marca()], [], sujeito({ plataforma: true }), AGORA, 5).desfecho).toBe(
      'liberado',
    );
  });
  it('marca sem quebra de vidro nega', () => {
    const d = decidirAcessoRestrito([marca({ exigeQuebraVidro: false })], [], sujeito(), AGORA, 5);
    expect(d).toEqual({ desfecho: 'negado', marcas: [1] });
    expect(acessoRestritoPermite(d.desfecho)).toBe(false);
    expect(acessoRestritoPermite('atende')).toBe(true);
  });
});

describe('nome exibido', () => {
  it('segue a exibição da marca', () => {
    expect(nomeExibidoRestrito('Ana de Souza Lima', null)).toBe('Ana de Souza Lima');
    expect(nomeExibidoRestrito('Ana de Souza Lima', { exibicao: 'iniciais', pseudonimo: null })).toBe(
      'A. S. L.',
    );
    expect(nomeExibidoRestrito('Ana', { exibicao: 'pseudonimo', pseudonimo: 'Paciente Azul' })).toBe(
      'Paciente Azul',
    );
    expect(nomeExibidoRestrito('Ana', { exibicao: 'oculto', pseudonimo: null })).toBe('Paciente reservado');
  });
});
