// Regra 1 do M27: a página inicial é a fila do perfil, ordenada por prioridade e prazo; só os componentes que o servidor
// devolveu; quem acumula perfis escolhe o ativo.
import type {
  FilaNutricao,
  AltasPrevistas,
  FilaNir,
  PaginaInicio,
  QuadroPa,
  WorklistMedico,
  WorklistRecepcao,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  componentesDoPerfil,
  guardarPerfil,
  lerPerfilGuardado,
  montarCartoes,
  perfilAtivo,
  resumoAssinaturas,
  resumoMedico,
  resumoMensagens,
  barreirasAbertas,
  resumoNir,
  resumoNutricao,
  resumoPa,
  resumoAgravos,
  resumoCcih,
  resumoQualidade,
  resumoRecepcao,
} from './inicio.js';

const comp = (id: PaginaInicio['componentes'][number]['id']) => ({
  id,
  titulo: id,
  rota: `/${id}`,
  pendentes: null,
  prioridade: 0,
  prazo: null,
});
const pagina: PaginaInicio = {
  perfis: [
    { id: 'medico', titulo: 'Médico' },
    { id: 'recepcao', titulo: 'Recepção' },
  ],
  componentes: [comp('medico'), comp('recepcao'), comp('assinaturas'), comp('mensagens')],
};

describe('página inicial por perfil', () => {
  it('quem acumula vê só a fila do perfil ativo (as demais filas continuam)', () => {
    expect(componentesDoPerfil(pagina, 'recepcao').map((c) => c.id)).toEqual([
      'recepcao',
      'assinaturas',
      'mensagens',
    ]);
    expect(componentesDoPerfil(pagina, null).map((c) => c.id)).toHaveLength(4);
    expect(componentesDoPerfil({ ...pagina, perfis: [pagina.perfis[0]!] }, 'recepcao')).toHaveLength(4);
  });
  it('o perfil guardado vale só se a sessão ainda o tem', () => {
    expect(perfilAtivo(pagina, 'recepcao')).toBe('recepcao');
    expect(perfilAtivo(pagina, 'enfermagem')).toBe('medico');
    expect(perfilAtivo({ ...pagina, perfis: [] }, 'medico')).toBeNull();
  });
  it('ordena por prioridade e prazo; sem resumo, fica pela ordem padrão no fim', () => {
    const cartoes = montarCartoes(pagina.componentes, {
      mensagens: { pendentes: 2, prioridade: 30, prazo: null },
      recepcao: { pendentes: 5, prioridade: 90, prazo: '2026-10-22T07:00:00' },
      medico: { pendentes: 3, prioridade: 90, prazo: '2026-10-22T06:00:00' },
    });
    expect(cartoes.map((c) => c.id)).toEqual(['medico', 'recepcao', 'mensagens', 'assinaturas']);
    expect(cartoes[3]).toMatchObject({ pendentes: null, prioridade: 0 });
  });
  it('os resumos de cada fila', () => {
    const w = {
      pacientes: [
        { prioridade: 100, prazo: null, pendencias: [{}] },
        { prioridade: 0, prazo: null, pendencias: [] },
        { prioridade: 50, prazo: '2026-10-22T14:00', pendencias: [{}] },
      ],
    } as unknown as WorklistMedico;
    expect(resumoMedico(w)).toEqual({ pendentes: 2, prioridade: 100, prazo: '2026-10-22T14:00' });
    expect(resumoMedico({ pacientes: [] } as unknown as WorklistMedico)).toEqual({
      pendentes: 0,
      prioridade: 0,
      prazo: null,
    });
    const r = (senhas: { prioridade: string; emitidaEm: string }[], guias: { abertoEm: string }[]) =>
      resumoRecepcao({ senhas, guias, chegadas: [] } as unknown as WorklistRecepcao);
    expect(r([{ prioridade: '0', emitidaEm: '2026-10-22T08:00' }], [])).toMatchObject({
      prioridade: 90,
      pendentes: 1,
    });
    expect(
      r([{ prioridade: '2', emitidaEm: '2026-10-22T08:00' }], [{ abertoEm: '2026-10-22T07:00' }]),
    ).toEqual({
      pendentes: 2,
      prioridade: 45,
      prazo: '2026-10-22T07:00',
    });
    expect(r([], [{ abertoEm: '2026-10-22T07:00' }]).prioridade).toBe(25);
    expect(r([], []).prioridade).toBe(0);
    const m = (naoLidas: number, cienciasPendentes: number) =>
      resumoMensagens({ naoLidas, cienciasPendentes, recebidas: [], enviadas: [], teto: 100 });
    expect(m(3, 1)).toEqual({ pendentes: 3, prioridade: 30, prazo: null });
    expect(m(3, 0).prioridade).toBe(10);
    expect(m(0, 0).prioridade).toBe(0);
  });

  it('assinaturas: os documentos aguardando sobem a urgência; o perfil guardado só vale se a sessão ainda o tem', () => {
    expect(resumoAssinaturas(4)).toEqual({ pendentes: 4, prioridade: 35, prazo: null });
    expect(resumoAssinaturas(0)).toEqual({ pendentes: 0, prioridade: 0, prazo: null });
    const mapa = new Map<string, string>();
    const armazenamento = {
      getItem: (k: string) => mapa.get(k) ?? null,
      setItem: (k: string, v: string) => void mapa.set(k, v),
    } as unknown as Storage;
    expect(lerPerfilGuardado(() => armazenamento)).toBeNull();
    guardarPerfil('recepcao', () => armazenamento);
    expect(lerPerfilGuardado(() => armazenamento)).toBe('recepcao');
    expect(
      perfilAtivo(
        pagina,
        lerPerfilGuardado(() => armazenamento),
      ),
    ).toBe('recepcao');
    // Sem armazenamento (navegação privada, bloqueado): nada quebra; vale o primeiro perfil.
    const quebrado = () => {
      throw new Error('bloqueado');
    };
    expect(lerPerfilGuardado(quebrado)).toBeNull();
    expect(() => guardarPerfil('medico', quebrado)).not.toThrow();
    expect(perfilAtivo(pagina, null)).toBe('medico');
    expect(perfilAtivo({ perfis: [], componentes: [] }, 'medico')).toBeNull();
  });
});

describe('M44 (etapa 3): os cartões do PA e do NIR na fila de trabalho', () => {
  const cartao = (reg: number, risco: unknown, protocolos?: unknown) =>
    ({ reg, risco, ...(protocolos ? { protocolos } : {}) }) as QuadroPa['colunas'][number]['cartoes'][number];
  const risco = (cor: string, estourado: boolean, prazoEm: string) => ({
    cor,
    nomeCor: cor,
    prioridade: 1,
    classificadoEm: '2026-10-24T10:00:00',
    prazoEm,
    minutosRestantes: estourado ? -5 : 5,
    estourado,
    reclassificar: estourado,
    reclassificacoes: 0,
  });
  const quadro = (cs: ReturnType<typeof cartao>[]) =>
    ({ colunas: [{ codigo: 'a', rotulo: 'A', cartoes: cs }] }) as unknown as QuadroPa;

  it('o PA: estourado ou protocolo vencido no topo; laranja ou vermelho; sem classificação; vazio', () => {
    expect(resumoPa(quadro([]))).toEqual({ pendentes: 0, prioridade: 0, prazo: null });
    expect(resumoPa(quadro([cartao(1, null)])).prioridade).toBe(60);
    expect(resumoPa(quadro([cartao(1, risco('verde', false, '2026-10-24T12:00:00'))]))).toEqual({
      pendentes: 1,
      prioridade: 30,
      prazo: '2026-10-24T12:00:00',
    });
    expect(resumoPa(quadro([cartao(1, risco('laranja', false, '2026-10-24T10:10:00'))])).prioridade).toBe(85);
    expect(resumoPa(quadro([cartao(1, risco('amarelo', true, '2026-10-24T09:00:00'))]))).toMatchObject({
      prioridade: 95,
      prazo: null,
    });
    expect(
      resumoPa(quadro([cartao(1, risco('verde', false, 'x'), [{ tipo: 'sepse', atrasadas: 1 }])])).prioridade,
    ).toBe(95);
  });

  it('o NIR: prazo estourado ou conflito no topo; o prazo mais próximo dos que correm', () => {
    const fila = (itens: unknown[], estourados = 0, conflitos: unknown[] = []) =>
      ({ itens, estourados, conflitos }) as unknown as FilaNir;
    expect(resumoNir(fila([]))).toEqual({ pendentes: 0, prioridade: 0, prazo: null });
    expect(
      resumoNir(
        fila([
          { prazoEstourado: false, prazoEm: '2026-10-24T14:00:00' },
          { prazoEstourado: true, prazoEm: '2026-10-24T08:00:00' },
        ]),
      ),
    ).toEqual({ pendentes: 2, prioridade: 50, prazo: '2026-10-24T14:00:00' });
    expect(resumoNir(fila([{ prazoEstourado: true, prazoEm: 'x' }], 1)).prioridade).toBe(90);
    expect(resumoNir(fila([], 0, [{}])).prioridade).toBe(90);
  });

  it('o NIR: as barreiras de alta abertas entram no selo; a vencida sobe a urgência; a resolvida não conta', () => {
    const fila = { itens: [], estourados: 0, conflitos: [] } as unknown as FilaNir;
    const leito = { bloco: 'B1', acomodacao: 'A10', leito: 'L1' };
    const b = (id: number, prazo: string, vencida: boolean, situacao = 'aberta') => ({
      id,
      tipo: 'exame',
      descricao: 'sintética',
      responsavel: 'equipe',
      prazo,
      vencida,
      situacao,
      criadaPor: 'SINT',
      criadaEm: '2026-10-20T08:00:00',
      resolvidaEm: null,
    });
    const altas = {
      itens: [
        { internacao: 1, nome: 'PACIENTE SINTETICO A', leito, barreiras: [b(1, '2026-10-26', false)] },
        {
          internacao: 2,
          nome: 'PACIENTE SINTETICO B',
          leito,
          barreiras: [b(2, '2026-10-22', true), b(3, '2026-10-21', true, 'resolvida')],
        },
      ],
    } as unknown as AltasPrevistas;
    const abertas = barreirasAbertas(altas);
    expect(abertas.map((x) => x.id)).toEqual([2, 1]);
    expect(abertas[0]).toMatchObject({ nome: 'PACIENTE SINTETICO B', leito: 'B1 · A10 · L1', vencida: true });
    expect(resumoNir(fila, abertas)).toEqual({ pendentes: 2, prioridade: 90, prazo: '2026-10-26' });
    expect(
      resumoNir(
        fila,
        abertas.filter((x) => !x.vencida),
      ),
    ).toEqual({
      pendentes: 1,
      prioridade: 50,
      prazo: '2026-10-26',
    });
  });
});

describe('M45 (etapa 5): o cartão da nutrição na fila de trabalho', () => {
  const fila = (itens: { situacao: string; prazoEm: string }[]): FilaNutricao =>
    ({
      itens,
      contagens: {
        vencida: itens.filter((i) => i.situacao === 'vencida').length,
        atencao: itens.filter((i) => i.situacao === 'atencao').length,
        'a-triar': itens.filter((i) => i.situacao === 'a-triar').length,
        reavaliar: itens.filter((i) => i.situacao === 'reavaliar').length,
        triado: itens.filter((i) => i.situacao === 'triado').length,
      },
    }) as unknown as FilaNutricao;
  it('pendentes sem os triados; vencida é a mais urgente; o prazo mais próximo dos não vencidos', () => {
    expect(resumoNutricao(fila([]))).toEqual({ pendentes: 0, prioridade: 0, prazo: null });
    expect(resumoNutricao(fila([{ situacao: 'triado', prazoEm: '2026-10-20T00:00' }])).pendentes).toBe(0);
    expect(
      resumoNutricao(
        fila([
          { situacao: 'a-triar', prazoEm: '2026-10-27T08:00' },
          { situacao: 'atencao', prazoEm: '2026-10-26T08:00' },
        ]),
      ),
    ).toEqual({ pendentes: 2, prioridade: 55, prazo: '2026-10-26T08:00' });
    expect(resumoNutricao(fila([{ situacao: 'a-triar', prazoEm: '2026-10-27T08:00' }])).prioridade).toBe(35);
    expect(
      resumoNutricao(
        fila([
          { situacao: 'vencida', prazoEm: '2026-10-20T08:00' },
          { situacao: 'reavaliar', prazoEm: '2026-10-21T08:00' },
        ]),
      ),
    ).toEqual({ pendentes: 2, prioridade: 80, prazo: null });
  });
});

describe('o cartão do NSP (M48, etapa 1)', () => {
  it('pendentes são os prazos em aberto; vencido é o mais urgente', () => {
    const r = (vencido: number, venceEmBreve: number, noPrazo: number) =>
      resumoQualidade({ porSituacao: { vencido, venceEmBreve, noPrazo } });
    expect(r(0, 0, 0)).toEqual({ pendentes: 0, prioridade: 0, prazo: null });
    expect(r(0, 0, 2)).toEqual({ pendentes: 2, prioridade: 30, prazo: null });
    expect(r(0, 1, 2).prioridade).toBe(60);
    expect(r(1, 1, 2)).toEqual({ pendentes: 4, prioridade: 85, prazo: null });
  });
});

describe('o cartão da CCIH (M48, etapa 3)', () => {
  it('pendentes são os pacientes em vigilância; o restrito sem liberação é o mais urgente', () => {
    expect(resumoCcih({ emVigilancia: 0, semLiberacao: 0 })).toEqual({
      pendentes: 0,
      prioridade: 0,
      prazo: null,
    });
    expect(resumoCcih({ emVigilancia: 3, semLiberacao: 0 })).toEqual({
      pendentes: 3,
      prioridade: 30,
      prazo: null,
    });
    expect(resumoCcih({ emVigilancia: 3, semLiberacao: 1 }).prioridade).toBe(75);
  });
});

describe('o cartão da notificação compulsória (M48, etapa 4)', () => {
  it('pendentes são os casos aguardando mais as sugestões; vencido acima do imediato, que fica acima do resto', () => {
    const base = { abertos: 0, imediatosAbertos: 0, vencidos: 0, gatilhosSemCaso: 0 };
    expect(resumoAgravos(base)).toEqual({ pendentes: 0, prioridade: 0, prazo: null });
    expect(resumoAgravos({ ...base, abertos: 2, gatilhosSemCaso: 3 })).toEqual({
      pendentes: 5,
      prioridade: 30,
      prazo: null,
    });
    expect(resumoAgravos({ ...base, abertos: 1, imediatosAbertos: 1 }).prioridade).toBe(70);
    expect(resumoAgravos({ ...base, abertos: 1, imediatosAbertos: 1, vencidos: 1 }).prioridade).toBe(90);
  });
});
