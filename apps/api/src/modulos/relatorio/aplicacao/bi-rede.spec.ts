// Serviço do BI consolidado da Rede (M57, etapa 3) sobre o serviço do M16 com a fonte SINTÉTICA (dois estabelecimentos
// de movimento diferente): regra 12 (sem rede, rede de outra hospedagem ou estabelecimento fora: recusa ANTES de ler),
// a chave `rede.bi` por estabelecimento (o desligado fica fora com o motivo), o banco fora (indisponível, o resto
// segue), a mesma ficha (parâmetro da terapia intensiva diferente: o consolidado é recusado só nesse indicador), o modo
// do pseudônimo (comum só com a liberação em todos) e a planilha com as parcelas.
import { describe, expect, it } from 'vitest';
import { PARAMETROS_PADRAO, type ParametrosM16 } from '../../internacao/configuracao.js';
import { FonteInternacaoMemoria } from '../../internacao/fonte-memoria.js';
import { ServicoInternacao } from '../../internacao/servico.js';
import {
  definicaoDoIndicador,
  planilhaDaSerieRede,
  ServicoBiRede,
  type DependenciasBiRede,
} from './bi-rede.js';
import { fichaDe } from '@sgh/dominio-relatorio';

const REDE = 'rede-teste';
const ESTS = [
  { codigo: 'pc', nome: 'Estabelecimento sintético A' },
  { codigo: 'sx', nome: 'Estabelecimento sintético B' },
];

function montar(extra: Partial<DependenciasBiRede> = {}, lidos: string[] = []) {
  const fonte = new FonteInternacaoMemoria({ variantes: { sx: { semente: 2057, fator: 0.6 } } });
  const internacao = new ServicoInternacao(fonte, null);
  const espiao: DependenciasBiRede['internacao'] = {
    indice: (c, p, de, ate) => {
      lidos.push(c.hospital);
      return internacao.indice(c, p, de, ate);
    },
    motor: (c, p) => internacao.motor(c, p),
    painelGerencial: (c, p, painel, de, ate) => {
      lidos.push(c.hospital);
      return internacao.painelGerencial(c, p, painel, de, ate);
    },
  };
  return new ServicoBiRede({
    lista: { redeConfigurada: () => REDE, estabelecimentos: () => ESTS },
    internacao: espiao,
    parametros: async () => PARAMETROS_PADRAO,
    biLigado: async () => true,
    pseudonimoComum: async () => false,
    agora: () => new Date('2026-10-25T12:00:00.000Z'),
    ...extra,
  });
}

const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'aceito';
  } catch (e) {
    return (e as { extras?: { codigo?: string } }).extras?.codigo ?? 'erro';
  }
};

describe('BI consolidado da Rede (serviço)', () => {
  it('regra 12: sem rede, rede de outra hospedagem ou estabelecimento fora da rede: recusa antes de ler', async () => {
    const lidos: string[] = [];
    const s = montar({}, lidos);
    expect(await codigo(s.consolidado({ rede: '', hospital: 'pc' }))).toBe('rede-ausente');
    expect(await codigo(s.consolidado({ rede: 'outra-rede', hospital: 'pc' }))).toBe('rede-diferente');
    expect(await codigo(s.consolidado({ rede: REDE, hospital: 'zz' }))).toBe('fora-da-rede');
    expect(await codigo(s.painel({ rede: '', hospital: 'pc' }, 'operacional'))).toBe('rede-ausente');
    expect(lidos).toEqual([]);
  });

  it('o desligado fica fora (com o motivo) e o banco fora fica indisponível; o resto entra', async () => {
    const lidos: string[] = [];
    const s = montar({ biLigado: async (_r, h) => h !== 'sx' }, lidos);
    const b = await s.consolidado({ rede: REDE, hospital: 'pc' }, '2025-01', '2025-03');
    expect(b.estabelecimentos.map((e) => [e.codigo, e.situacao])).toEqual([
      ['pc', 'incluido'],
      ['sx', 'desligado'],
    ]);
    expect(b.estabelecimentos[1]!.motivo).toMatch(/ainda não foi liberado/);
    expect(lidos).toEqual(['pc']);
    expect(b.notas.join(' ')).toMatch(/um só estabelecimento/);
    const fora = montar({
      parametros: async (_r, h) => {
        if (h === 'sx') throw new Error('banco fora');
        return PARAMETROS_PADRAO;
      },
    });
    const f = await fora.consolidado({ rede: REDE, hospital: 'pc' }, '2025-01', '2025-03');
    expect(f.estabelecimentos[1]).toMatchObject({ situacao: 'indisponivel' });
    expect(f.indicadores[0]!.ultimo!.parcelas).toHaveLength(1);
    const nenhum = montar({
      parametros: async () => {
        throw new Error('fora');
      },
    });
    const n = await nenhum.consolidado({ rede: REDE, hospital: 'pc' });
    expect(n.indicadores[0]!.recusa?.motivo).toBe('sem-parcelas');
    expect(n.periodo).toEqual({ de: '2026-10', ate: '2026-10' });
  });

  it('a mesma ficha: tipos de terapia intensiva diferentes recusam só os indicadores da terapia intensiva', async () => {
    const outra: ParametrosM16 = { ...PARAMETROS_PADRAO, intensivas: [3, 99] };
    const s = montar({ parametros: async (_r, h) => (h === 'sx' ? outra : PARAMETROS_PADRAO) });
    const b = await s.consolidado({ rede: REDE, hospital: 'pc' }, '2025-01', '2025-03');
    const uti = b.indicadores.find((i) => i.ficha.codigo === 'taxaOcupacaoIntensiva')!;
    expect(uti.recusa?.motivo).toBe('ficha-diferente');
    expect(uti.ultimo).toBeNull();
    expect(b.indicadores.find((i) => i.ficha.codigo === 'admissoes')!.recusa).toBeNull();
    expect(definicaoDoIndicador(fichaDe('admissoes')!, PARAMETROS_PADRAO).parametros).toEqual({});
    expect(
      Object.keys(definicaoDoIndicador(fichaDe('taxaOcupacaoIntensiva')!, outra).parametros).sort(),
    ).toEqual(['horaFechamento', 'intensivas']);
  });

  it('o pseudônimo comum só com a liberação em todos os estabelecimentos', async () => {
    const um = montar({ pseudonimoComum: async (_r, h) => h === 'pc' });
    expect((await um.consolidado({ rede: REDE, hospital: 'pc' }, '2025-01', '2025-01')).pseudonimo).toBe(
      'por-estabelecimento',
    );
    const todos = montar({ pseudonimoComum: async () => true });
    const b = await todos.consolidado({ rede: REDE, hospital: 'pc' }, '2025-01', '2025-01');
    expect(b.pseudonimo).toBe('comum');
    expect(b.notas.join(' ')).toMatch(/mesmo pseudônimo/);
  });

  it('a série e a planilha: cada mês com as parcelas e a conta; o período invertido é recusado', async () => {
    const s = montar();
    const x = await s.serie({ rede: REDE, hospital: 'sx' }, 'taxaMortalidadeGeral', '2025-01', '2025-02');
    expect(x.estabelecimentos.map((e) => e.codigo)).toEqual(['sx', 'pc']);
    expect(x.valores.map((v) => v.periodo)).toEqual(['2025-01', '2025-02']);
    const csv = planilhaDaSerieRede(x);
    const [cab, l1] = csv.split('\r\n');
    expect(cab).toMatch(/numerador Estabelecimento sintético B.*numerador Estabelecimento sintético A/);
    expect(l1).toMatch(/^2025-01;/);
    expect(l1).toMatch(/× 100 = /);
    expect(await codigo(s.serie({ rede: REDE, hospital: 'pc' }, 'naoExiste'))).toBe('erro');
    await expect(s.consolidado({ rede: REDE, hospital: 'pc' }, '2025-03', '2025-01')).rejects.toThrow();
    await expect(
      s.painel({ rede: REDE, hospital: 'pc' }, 'financeiro', '2025-03', '2025-01'),
    ).rejects.toThrow();
  });

  it('painéis: o banco fora fica indisponível; com nenhum, o período é o mês corrente e nada é somado', async () => {
    const s = montar({
      internacao: {
        indice: () => Promise.reject(new Error('fora')),
        motor: () => Promise.reject(new Error('fora')),
        painelGerencial: () => Promise.reject(new Error('fora')),
      },
    });
    const p = await s.painel({ rede: REDE, hospital: 'pc' }, 'operacional');
    expect(p.estabelecimentos.every((e) => e.situacao === 'indisponivel')).toBe(true);
    expect(p.series).toEqual([]);
    expect(p.periodo).toEqual({ de: '2026-10', ate: '2026-10' });
    const b = await s.consolidado({ rede: REDE, hospital: 'pc' });
    expect(b.estabelecimentos.every((e) => e.situacao === 'indisponivel')).toBe(true);
  });
});
