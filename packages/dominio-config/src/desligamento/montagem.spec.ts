import { esquemaRegistroDesligamento } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { avaliarItem } from './inventario.js';
import { estadoDesligamento, resolucoesDoRegistro, sessoesCumpridas } from './montagem.js';
import { avaliarPassos } from './passos.js';
import { avaliarSessoes } from './sessoes.js';
import { INVENTARIO_DESLIGAMENTO } from '@sgh/contratos';

const vazio = esquemaRegistroDesligamento.parse({ formato: 1, estabelecimento: 'pc' });
const fatos = {
  fimRegistrado: true,
  dp6Decidida: true,
  sessoesCumprido: true,
  inventarioResolvido: true,
  funcoesPendentes: [] as string[],
};

describe('M58: montagem do estado dos passos', () => {
  it('registro vazio: tudo bloqueado, cada passo pelo ensaio e os dois últimos também pelo anterior', () => {
    const p = avaliarPassos(estadoDesligamento(vazio, fatos));
    expect(p.map((x) => x.situacao)).toEqual(['bloqueado', 'bloqueado', 'bloqueado']);
    expect(p[0]!.motivos).toEqual(['ensaio-nao-aprovado']);
    expect(p[1]!.motivos).toEqual([
      'passo-anterior-pendente',
      'parceiros-nao-avisados',
      'sante-api-sem-contrato',
      'ensaio-nao-aprovado',
    ]);
  });

  it('com o ensaio aprovado e a autorização, o primeiro passo fica autorizado; executado libera o segundo', () => {
    const r = esquemaRegistroDesligamento.parse({
      formato: 1,
      estabelecimento: 'pc',
      passos: {
        desligamento: {
          ensaio: { data: '2027-02-01', relatorio: 'checklist da etapa um', resultado: 'aprovado' },
          autorizacao: { data: '2027-02-02', referencia: 'Autorizações do dono' },
        },
      },
      parceirosAvisados: { data: '2027-02-03', referencia: 'aviso aos parceiros' },
      contratosHalAi: { data: '2027-02-03', referencia: 'verificação do provedor' },
      funcoes: [{ nome: 'VLR_MED', resolucao: 'substituida', referencia: 'ADR da etapa dois' }],
    });
    expect(avaliarPassos(estadoDesligamento(r, fatos))[0]!.situacao).toBe('autorizado');
    expect(resolucoesDoRegistro(r)).toEqual({ VLR_MED: 'substituida' });
    const executado = esquemaRegistroDesligamento.parse({
      ...r,
      passos: {
        ...r.passos,
        desligamento: { ...r.passos.desligamento, execucao: { data: '2027-02-10', referencia: 'janela' } },
      },
    });
    const p = avaliarPassos(estadoDesligamento(executado, { ...fatos, funcoesPendentes: ['SUBSTR'] }));
    expect(p[0]!.situacao).toBe('executado');
    expect(p[1]!.motivos).toEqual(['funcoes-externas-pendentes', 'ensaio-nao-aprovado']);
  });

  it('o registro recusa execução sem autorização ou sem ensaio aprovado, e função repetida', () => {
    const r = esquemaRegistroDesligamento.safeParse({
      formato: 1,
      estabelecimento: 'pc',
      passos: { utf8: { execucao: { data: '2027-03-01', referencia: 'janela' } } },
      funcoes: [
        { nome: 'SUBSTR', resolucao: 'pendente', referencia: 'a' },
        { nome: 'SUBSTR', resolucao: 'substituida', referencia: 'b' },
      ],
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.message)).toEqual([
      'execução sem autorização ou sem ensaio aprovado',
      'função repetida',
    ]);
    // Referência com dado pessoal (sequência de dígitos ou e-mail) é recusada.
    expect(
      esquemaRegistroDesligamento.safeParse({
        formato: 1,
        estabelecimento: 'pc',
        contratosHalAi: { data: '2027-01-01', referencia: 'fulano@exemplo' },
      }).success,
    ).toBe(false);
  });

  it('regra 3 inteira: a tabela zerada sem a medida diária não cumpre (falha fechada)', () => {
    const tabela = avaliarSessoes([], '2026-10-26');
    expect(tabela.cumprido).toBe(true);
    expect(sessoesCumpridas(tabela, { dias: 0 })).toBe(false);
    expect(sessoesCumpridas(tabela, { dias: 13 })).toBe(false);
    expect(sessoesCumpridas(tabela, { dias: 14 })).toBe(true);
    const comUso = avaliarSessoes([{ dia: '2026-10-20', pessoas: 3 }], '2026-10-26');
    expect(sessoesCumpridas(comUso, { dias: 30 })).toBe(false);
  });

  it('o item avaliado leva o papel e a evidência do registro', () => {
    const item = INVENTARIO_DESLIGAMENTO.find((i) => i.id === 'paineis-tv')!;
    const a = avaliarItem(item, {
      item: 'paineis-tv',
      situacao: 'aceito-como-perdido',
      contingencia: 'nenhuma',
      registradoEm: '2026-10-26T12:00:00.000Z',
      papelResponsavel: 'TI',
      evidencia: 'chamado',
    });
    expect(a).toMatchObject({ resolvido: true, papelResponsavel: 'TI', evidencia: 'chamado' });
    expect(avaliarItem(item, undefined)).toMatchObject({ papelResponsavel: null, evidencia: null });
  });
});
