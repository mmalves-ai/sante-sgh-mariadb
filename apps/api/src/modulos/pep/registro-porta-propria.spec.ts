// Unidade da porta própria dos registros clínicos, com dublê do Leitor: o cliente vem da configuração, toda leitura
// filtra o estabelecimento da sessão e a exclusão lógica, o SQL é parametrizado e o mapeamento não cria sentinela.
import type { Leitor, Linha } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { PortaRegistroPropria, dataHora, fusoValido } from './registro-porta-propria.js';
import type { NucleoRegistroGravacao } from './registro-propria-gravacao.js';
import type { PortaRegistro } from './registro-porta.js';
import { ServicoRegistro, situacaoAdmin } from './registro-servico.js';
import { type AtendimentoLido, type ModeloDoRegistro, atendimentoEmCurso } from './tipos-pep.js';

interface Chamada {
  readonly sql: string;
  readonly parametros: readonly unknown[];
}

function duble(respostas: (sql: string) => Linha[]) {
  const chamadas: Chamada[] = [];
  const contextos: { cliente: string; correlacao: string }[] = [];
  const leitor: Leitor = {
    cliente: 'x',
    async consultar<T extends Linha = Linha>(sql: string, parametros: readonly unknown[] = []) {
      chamadas.push({ sql, parametros });
      return respostas(sql) as T[];
    },
    async uma<T extends Linha = Linha>(sql: string, parametros: readonly unknown[] = []) {
      chamadas.push({ sql, parametros });
      return (respostas(sql)[0] as T | undefined) ?? null;
    },
  };
  const nucleo: NucleoRegistroGravacao = {
    lerSomente: async (contexto, fn) => {
      contextos.push({ ...contexto });
      return fn(leitor);
    },
    criarExecutor: () => {
      throw new Error('o dublê de leitura não grava');
    },
  };
  return { nucleo, chamadas, contextos };
}

const C = {
  rede: 'rede-a',
  hospital: 'h1',
  cliente: 'c',
  estabelecimento: 7,
  usuario: null,
  correlacao: 't',
};

describe('PortaRegistroPropria (dublê)', () => {
  it('usa o cliente da sessão (ou o da configuração) e resolve o estabelecimento pelo código, sem excluídos', async () => {
    const d = duble((sql) => (sql.includes('FROM estabelecimento') ? [{ id: 7 }] : []));
    await new PortaRegistroPropria(d.nucleo, 'cliente_x').atendimentos(C, 10);
    expect(d.contextos[0]).toEqual({ cliente: 'c', correlacao: 'pep.registro.atendimentos' });
    await new PortaRegistroPropria(d.nucleo, 'cliente_x').agora({ ...C, cliente: '' });
    expect(d.contextos[1]?.cliente).toBe('cliente_x');
    expect(d.chamadas[0]?.sql).toMatch(/codigo = \? AND excluido_em IS NULL/);
    expect(d.chamadas[0]?.parametros).toEqual(['h1']);
    expect(d.chamadas[1]?.sql).toMatch(/a\.estabelecimento_id = \? AND a\.excluido_em IS NULL/);
    expect(d.chamadas[1]?.parametros).toEqual([10, 7]);
  });

  it('atendimentos: número não numérico fica null, tipo completo da categoria e em curso pela situação', async () => {
    const d = duble((sql) =>
      sql.includes('FROM estabelecimento')
        ? [{ id: 1, fuso_horario: 'America/Sao_Paulo' }]
        : [
            {
              id: 5,
              numero: '000123',
              tipo_base: 'internacao',
              situacao: 'aberto',
              entrada_em: new Date('2026-11-01T12:00:00Z'),
            },
            // Pronto atendimento aberto há mais de 2 dias: continua em curso (sem janela de dias).
            {
              id: 6,
              numero: 'PA-9',
              tipo_base: 'pronto_atendimento',
              situacao: 'em_observacao',
              entrada_em: null,
            },
            // Ambulatório encerrado no mesmo dia: fechado.
            {
              id: 7,
              numero: '9',
              tipo_base: 'ambulatorio',
              situacao: 'encerrado',
              entrada_em: new Date('2026-11-20T11:00:00Z'),
              saida_em: new Date('2026-11-20T11:30:00Z'),
            },
          ],
    );
    const lista = await new PortaRegistroPropria(d.nucleo, 'c').atendimentos(C, 1);
    expect(lista.map((a) => [a.id, a.numero, a.tipo, a.aberto])).toEqual([
      [5, 123, 'internacao', true],
      [6, null, 'pronto_atendimento', true],
      [7, 9, 'ambulatorio', false],
    ]);
    expect(lista[1]?.entrada).toBeNull();
    // Hora civil do estabelecimento (UTC-3), não a do processo.
    expect(lista[0]?.entrada).toBe('2026-11-01T09:00:00');
    expect(lista[2]?.saida).toBe('2026-11-20T08:30:00');
  });

  it('datas no fuso do estabelecimento; fuso inválido cai no padrão', () => {
    const t = new Date('2026-11-10T08:00:00Z');
    expect(dataHora(t, 'America/Sao_Paulo')).toBe('2026-11-10T05:00:00');
    expect(dataHora(t, 'UTC')).toBe('2026-11-10T08:00:00');
    expect(dataHora(new Date('2026-11-11T01:30:00Z'), 'America/Sao_Paulo')).toBe('2026-11-10T22:30:00');
    expect(fusoValido('Fuso/Inexistente')).toBe('America/Sao_Paulo');
    expect(fusoValido(null)).toBe('America/Sao_Paulo');
    expect(fusoValido('America/Manaus')).toBe('America/Manaus');
  });

  it('agora: instante do banco no fuso do estabelecimento', async () => {
    const d = duble((sql) =>
      sql.includes('FROM estabelecimento')
        ? [{ id: 1, fuso_horario: 'America/Sao_Paulo' }]
        : [{ agora: new Date('2026-11-21T01:15:00Z') }],
    );
    // 22h15 do dia 20 em Brasília: o "hoje" do serviço não vira o dia seguinte.
    expect(await new PortaRegistroPropria(d.nucleo, 'c').agora(C)).toBe('2026-11-20T22:15:00');
  });

  it('em curso: só situação em curso sem saída nem alta', () => {
    expect(atendimentoEmCurso({ situacao: 'aberto', altaMedica: null, saida: null })).toBe(true);
    expect(
      atendimentoEmCurso({ situacao: 'em_atendimento', altaMedica: '2026-11-20T10:00:00', saida: null }),
    ).toBe(false);
    expect(atendimentoEmCurso({ situacao: 'cancelado', altaMedica: null, saida: null })).toBe(false);
    expect(
      atendimentoEmCurso({ situacao: 'encerrado', altaMedica: null, saida: '2026-11-20T10:00:00' }),
    ).toBe(false);
  });

  it('modelos: especialidades da lista agregada e uso recente do estabelecimento', async () => {
    const d = duble((sql) =>
      sql.includes('FROM estabelecimento')
        ? [{ id: 3 }]
        : [
            {
              id: 1,
              codigo: 'EVO',
              titulo: 'Evolução',
              situacao: 'publicado',
              tipo_id: 2,
              tipo_nome: 'Evolução',
              especialidades: '4,9',
              uso: 5,
            },
            {
              id: 2,
              codigo: 'NOVO',
              titulo: 'Novo',
              situacao: 'publicado',
              tipo_id: 2,
              tipo_nome: 'Evolução',
              especialidades: null,
              uso: 0,
            },
            {
              id: 3,
              codigo: 'VELHO',
              titulo: 'Velho',
              situacao: 'aposentado',
              tipo_id: 2,
              tipo_nome: 'Evolução',
              especialidades: null,
              uso: 9,
            },
          ],
    );
    const [mod, novo, velho] = await new PortaRegistroPropria(d.nucleo, 'c').modelos(C);
    expect(mod).toEqual({
      id: 1,
      codigo: 'EVO',
      nome: 'Evolução',
      tipoComposicao: 2,
      nomeTipoComposicao: 'Evolução',
      especialidades: [4, 9],
      aposentado: false,
      usoRecente: 5,
    });
    // Publicado sem uso continua publicado (o uso só ordena); o aposentado vem marcado.
    expect([novo?.aposentado, novo?.usoRecente, velho?.aposentado]).toEqual([false, 0, true]);
    expect(d.chamadas[1]?.sql).toMatch(/m\.situacao IN \('publicado', 'aposentado'\)/);
    expect(d.chamadas[1]?.parametros[0]).toBe(3);
  });

  it('estabelecimento ausente: 404 sem ler mais nada', async () => {
    const d = duble(() => []);
    await expect(new PortaRegistroPropria(d.nucleo, 'c').modelos(C)).rejects.toMatchObject({
      problema: { status: 404, codigo: 'estabelecimento-inexistente' },
    });
    expect(d.chamadas).toHaveLength(1);
  });

  it('liberação e definição vêm da família registro (leitura no estabelecimento da sessão, sem gravar)', async () => {
    const d = duble(() => []);
    const p = new PortaRegistroPropria(d.nucleo, 'c');
    await expect(p.podeGravar(C, 'pep.evolucao', 'medico')).rejects.toMatchObject({
      problema: { status: 404, codigo: 'estabelecimento-inexistente' },
    });
    await expect(p.definicao(C, 1)).rejects.toMatchObject({ problema: { status: 404 } });
    expect(d.contextos.map((x) => x.correlacao)).toEqual([
      'pep.registro.podeGravar',
      'pep.registro.definicao',
    ]);
  });

  it('serviço: publicado sem uso continua liberável; só o aposentado é descontinuado', () => {
    const base: ModeloDoRegistro = {
      id: 1,
      codigo: 'X1',
      nome: null,
      tipoComposicao: 2,
      nomeTipoComposicao: 'Evolução',
      especialidades: [],
      aposentado: false,
      usoRecente: 0,
    };
    expect(situacaoAdmin(base, [], 0).situacao).not.toBe('descontinuado');
    expect(situacaoAdmin({ ...base, aposentado: true, usoRecente: 40 }, [], 0).situacao).toBe(
      'descontinuado',
    );
  });

  it('serviço: "aberto" vem da porta (sem janela de 2 dias) e o tipo vai ao contrato da tela', async () => {
    const lidos: AtendimentoLido[] = [
      {
        id: 1,
        numero: 1,
        tipo: 'ambulatorio',
        aberto: false,
        entrada: '2026-11-20T08:00:00',
        unidade: null,
        leito: null,
        altaMedica: null,
        saida: '2026-11-20T09:00:00',
      },
      {
        id: 2,
        numero: 2,
        tipo: 'pronto_atendimento',
        aberto: true,
        entrada: '2026-11-01T08:00:00',
        unidade: null,
        leito: null,
        altaMedica: null,
        saida: null,
      },
      {
        id: 3,
        numero: 3,
        tipo: 'internacao',
        aberto: true,
        entrada: '2026-10-01T08:00:00',
        unidade: null,
        leito: '1A',
        altaMedica: null,
        saida: null,
      },
    ];
    const porta = { destino: 'memoria', atendimentos: async () => lidos } as unknown as PortaRegistro;
    const r = await new ServicoRegistro(porta).atendimentos(C, 1);
    expect(r.map((a) => [a.id, a.tipo, a.aberto])).toEqual([
      [1, 'externo', false],
      [2, 'externo', true],
      [3, 'internacao', true],
    ]);
  });
});
