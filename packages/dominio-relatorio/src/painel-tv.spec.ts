import { describe, expect, it } from 'vitest';
import {
  atrasoMinutos,
  type BlocoTvEntrada,
  conferirAtivacaoTv,
  conferirBlocosTv,
  conferirTemposTv,
  diasDePermanencia,
  dispositivoNoAr,
  gerarCodigoPareamento,
  iniciaisDoNome,
  MAXIMO_BLOCOS_TV,
  minutosDesde,
  normalizarCodigoPareamento,
  resumoOcupacaoTv,
} from './painel-tv.js';

const bloco = (b: Partial<BlocoTvEntrada> = {}): BlocoTvEntrada => ({
  fonte: 'uti',
  titulo: 'UTI adulto',
  forma: 'tabela',
  tempoEmTelaSegundos: null,
  unidadeInternacaoId: null,
  salaCirurgicaId: null,
  limite: 20,
  ...b,
});

describe('painel de TV: blocos', () => {
  it('aceita as quatro fontes com filtros próprios', () => {
    expect(
      conferirBlocosTv([
        bloco({ unidadeInternacaoId: 3, forma: 'mapa' }),
        bloco({ fonte: 'farmacia', titulo: 'Farmácia' }),
        bloco({ fonte: 'mapa_cirurgico', titulo: 'Centro cirúrgico', salaCirurgicaId: 2 }),
        bloco({ fonte: 'laboratorio', titulo: 'Laboratório', forma: 'lista', tempoEmTelaSegundos: 20 }),
      ]),
    ).toEqual([]);
  });

  it('recusa filtro fora da fonte, mapa na farmácia, título curto, tempo e limite inválidos, tudo de uma vez', () => {
    const erros = conferirBlocosTv([
      bloco({ fonte: 'farmacia', unidadeInternacaoId: 3, forma: 'mapa', titulo: 'F' }),
      bloco({ fonte: 'laboratorio', salaCirurgicaId: 1, tempoEmTelaSegundos: 2, limite: 0 }),
    ]);
    expect(erros.map((e) => `${e.campo}:${e.codigo}`)).toEqual([
      'blocos.0.titulo:titulo-curto',
      'blocos.0.unidadeInternacaoId:filtro-fora-da-fonte',
      'blocos.0.forma:forma-fora-da-fonte',
      'blocos.1.tempoEmTelaSegundos:tempo-invalido',
      'blocos.1.limite:limite-invalido',
      'blocos.1.salaCirurgicaId:filtro-fora-da-fonte',
    ]);
  });

  it('recusa bloco repetido (mesma fonte, filtro e forma) e blocos demais', () => {
    expect(conferirBlocosTv([bloco(), bloco({ titulo: 'Outro' })]).map((e) => e.codigo)).toEqual([
      'bloco-repetido',
    ]);
    const muitos = Array.from({ length: MAXIMO_BLOCOS_TV + 1 }, (_, i) =>
      bloco({ unidadeInternacaoId: i + 1 }),
    );
    expect(conferirBlocosTv(muitos).map((e) => e.codigo)).toEqual(['blocos-demais']);
  });

  it('ativar exige bloco; tempos entre 5 s e 1 h', () => {
    expect(conferirAtivacaoTv(0).map((e) => e.codigo)).toEqual(['painel-sem-bloco']);
    expect(conferirAtivacaoTv(1)).toEqual([]);
    expect(conferirTemposTv(30, 60)).toEqual([]);
    expect(conferirTemposTv(4, 3601).map((e) => e.campo)).toEqual([
      'tempoRotacaoSegundos',
      'atualizacaoSegundos',
    ]);
  });
});

describe('painel de TV: exibição sem nome (LGPD)', () => {
  it('iniciais sem partículas, no máximo 4 letras', () => {
    expect(iniciaisDoNome('Ana Maria da Silva')).toBe('A. M. S.');
    expect(iniciaisDoNome('joão  de souza e costa')).toBe('J. S. C.');
    expect(iniciaisDoNome('Ana Beatriz Carla Dias Esteves')).toBe('A. B. C. E.');
    expect(iniciaisDoNome('Élvis')).toBe('É.');
    expect(iniciaisDoNome(null)).toBe('—');
    expect(iniciaisDoNome('  ')).toBe('—');
  });

  it('tempos: espera, permanência e atraso', () => {
    const agora = new Date('2026-11-25T12:00:00Z');
    expect(minutosDesde(new Date('2026-11-25T11:15:30Z'), agora)).toBe(44);
    expect(minutosDesde(new Date('2026-11-25T13:00:00Z'), agora)).toBe(0);
    expect(diasDePermanencia(new Date('2026-11-25T08:00:00Z'), agora)).toBe(1);
    expect(diasDePermanencia(new Date('2026-11-22T13:00:00Z'), agora)).toBe(3);
    expect(atrasoMinutos(null, agora)).toBe(0);
    expect(atrasoMinutos(new Date('2026-11-25T13:00:00Z'), agora)).toBe(0);
    expect(atrasoMinutos(new Date('2026-11-25T10:30:00Z'), agora)).toBe(90);
  });

  it('ocupação com as parcelas e taxa de 1 casa', () => {
    expect(resumoOcupacaoTv(10, 7)).toEqual({ leitos: 10, ocupados: 7, livres: 3, taxa: 70 });
    expect(resumoOcupacaoTv(3, 2)).toEqual({ leitos: 3, ocupados: 2, livres: 1, taxa: 66.7 });
    expect(resumoOcupacaoTv(0, 0).taxa).toBeNull();
  });
});

describe('painel de TV: pareamento do televisor', () => {
  it('gera 6 caracteres legíveis de longe e normaliza o digitado', () => {
    let i = 0;
    const c = gerarCodigoPareamento((n) => i++ % n);
    expect(c).toBe('234567');
    expect(normalizarCodigoPareamento(' ab-c 2 3 4')).toBe('ABC234');
    expect(normalizarCodigoPareamento('ABC10O')).toBeNull();
    expect(normalizarCodigoPareamento('ABC')).toBeNull();
  });

  it('no ar quando o contato é de até 3 atualizações atrás', () => {
    const agora = new Date('2026-11-25T12:00:00Z');
    expect(dispositivoNoAr(null, agora, 60)).toBe(false);
    expect(dispositivoNoAr(new Date('2026-11-25T11:57:30Z'), agora, 60)).toBe(true);
    expect(dispositivoNoAr(new Date('2026-11-25T11:56:59Z'), agora, 60)).toBe(false);
  });
});
