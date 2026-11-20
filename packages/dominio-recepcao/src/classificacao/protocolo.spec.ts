// M44, regra 2: o protocolo é dado; versão publicada imutável, com autor, aprovador e licença (dados SINTÉTICOS).
import type { ConteudoProtocolo } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  conteudoCanonico,
  coresEmOrdem,
  linhasDaVersao,
  podeEditarVersao,
  problemasDaPublicacao,
} from './protocolo.js';
import { PROTOCOLO_SINTETICO } from './protocolo-sintetico.js';

const ctx = { hoje: '2026-10-23', autor: 'ENF.AUTORA', aprovador: 'DIR.CLINICA' };
const codigos = (c: ConteudoProtocolo, x = ctx) => problemasDaPublicacao(c, x).map((p) => p.codigo);

describe('publicação do protocolo', () => {
  it('o protocolo sintético publica (ACCR, sem licença)', () => {
    expect(problemasDaPublicacao(PROTOCOLO_SINTETICO, ctx)).toEqual([]);
  });

  it('Manchester só publica com a licença registrada e válida', () => {
    const m: ConteudoProtocolo = { ...PROTOCOLO_SINTETICO, tipo: 'manchester' };
    expect(codigos(m)).toEqual(['licenca-ausente']);
    const vencida = { ...m, licenca: { registro: 'GBCR-0001', titular: 'Rede', validaAte: '2026-10-22' } };
    expect(codigos(vencida)).toEqual(['licenca-vencida']);
    expect(codigos({ ...vencida, licenca: { ...vencida.licenca, validaAte: '2026-10-23' } })).toEqual([]);
  });

  it('cinco cores; a mais grave nunca espera mais; de-para sem opção repetida', () => {
    const c = PROTOCOLO_SINTETICO.cores;
    expect(codigos({ ...PROTOCOLO_SINTETICO, cores: [c[0]!, c[0]!, c[2]!, c[3]!, c[4]!] })).toContain(
      'cores-incompletas',
    );
    const lento = c.map((x) => (x.cor === 'laranja' ? { ...x, tempoAlvoMin: 90 } : x));
    expect(codigos({ ...PROTOCOLO_SINTETICO, cores: lento })).toEqual(['tempo-fora-de-ordem']);
    const rep = c.map((x) => (x.cor === 'azul' ? { ...x, opcaoE08: 4 } : x));
    expect(codigos({ ...PROTOCOLO_SINTETICO, cores: rep })).toEqual(['opcao-e08-repetida']);
    const sem = c.map((x) => (x.cor === 'azul' ? { ...x, opcaoE08: null } : x));
    expect(codigos({ ...PROTOCOLO_SINTETICO, cores: sem })).toEqual([]);
    expect(coresEmOrdem({ cores: [...c].reverse() }).map((x) => x.cor)).toEqual([
      'vermelho',
      'laranja',
      'amarelo',
      'verde',
      'azul',
    ]);
  });

  it('fluxogramas e discriminadores coerentes; regra inválida não publica', () => {
    const d = PROTOCOLO_SINTETICO.discriminadores;
    expect(
      codigos({ ...PROTOCOLO_SINTETICO, discriminadores: [...d, { ...d[0]!, fluxograma: 'trauma' }] }),
    ).toEqual(['fluxograma-inexistente']);
    expect(codigos({ ...PROTOCOLO_SINTETICO, discriminadores: [...d, d[1]!] })).toEqual([
      'discriminador-repetido',
    ]);
    expect(
      codigos({
        ...PROTOCOLO_SINTETICO,
        fluxogramas: [
          ...PROTOCOLO_SINTETICO.fluxogramas,
          PROTOCOLO_SINTETICO.fluxogramas[0]!,
          { codigo: 'vazio', titulo: 'Vazio' },
        ],
      }),
    ).toEqual(['fluxograma-repetido', 'fluxograma-sem-discriminador']);
    const ruim = d.map((x, i) => (i === 1 ? { ...x, regra: { '+': [1, 2] } } : x));
    expect(problemasDaPublicacao({ ...PROTOCOLO_SINTETICO, discriminadores: ruim }, ctx)).toEqual([
      {
        codigo: 'regra-invalida',
        mensagem: 'operação não permitida: +',
        onde: 'geral/saturacao-muito-baixa',
      },
    ]);
  });

  it('quem aprova não é quem escreveu', () => {
    expect(codigos(PROTOCOLO_SINTETICO, { ...ctx, aprovador: ' enf.autora ' })).toEqual(['autoaprovacao']);
  });

  it('forma canônica estável (chaves em ordem) e versão publicada não se edita', () => {
    const embaralhado = JSON.parse(JSON.stringify(PROTOCOLO_SINTETICO)) as Record<string, unknown>;
    const invertido = Object.fromEntries(Object.entries(embaralhado).reverse()) as ConteudoProtocolo;
    expect(conteudoCanonico(invertido)).toBe(conteudoCanonico(PROTOCOLO_SINTETICO));
    expect(conteudoCanonico(PROTOCOLO_SINTETICO).startsWith('{"cores":')).toBe(true);
    expect(podeEditarVersao('rascunho')).toBe(true);
    expect(podeEditarVersao('publicado')).toBe(false);
    expect(podeEditarVersao('substituido')).toBe(false);
  });
});

describe('linhas da versão', () => {
  it('cores na ordem da prioridade e discriminadores na ordem do autor', () => {
    const l = linhasDaVersao({
      ...PROTOCOLO_SINTETICO,
      cores: [...PROTOCOLO_SINTETICO.cores].reverse(),
    });
    expect(l.cores.map((c) => c.prioridade)).toEqual([1, 2, 3, 4, 5]);
    expect(l.discriminadores.map((d) => d.codigo)).toEqual(
      PROTOCOLO_SINTETICO.discriminadores.map((d) => d.codigo),
    );
    expect(
      l.discriminadores.every((d) => d.sugereProtocolo === null || typeof d.sugereProtocolo === 'string'),
    ).toBe(true);
  });
});
