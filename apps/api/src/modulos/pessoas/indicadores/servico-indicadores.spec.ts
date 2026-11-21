// W0-06, parte 7b: o painel de indicadores de pessoas sobre a porta em memória, conferido contra a base de teste do
// domínio (indicadores-pessoas.spec.ts, conferida à mão): os fatos do 1º trimestre dão os mesmos números; os de fora
// do período e de outro estabelecimento não entram; o setor recorta; a fonte fora vira aviso; o parâmetro ajusta a
// referência da COFEN.
import { esquemaPainelIndicadoresPessoas, type ValorParametro } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { PortaIndicadoresPessoasMemoria } from './porta-indicadores-memoria.js';
import { horasSemente, SEMENTE_INDICADORES_PESSOAS, SETOR_CLINICA_SEMENTE } from './semente-indicadores.js';
import { ServicoIndicadoresPessoas } from './servico-indicadores.js';

const CLI = SETOR_CLINICA_SEMENTE;
const h = horasSemente;
const FATOS_BASE_TESTE = SEMENTE_INDICADORES_PESSOAS;

const sessao = (hospital = 'aa'): SessaoCadastro => ({
  req: { headers: {}, ip: '127.0.0.1', sgh: { sessao: { unidadeAtiva: null } } } as never,
  hospital,
  rede: 'rede-sintetica',
  login: 'SINT.RH',
  porta: {
    cliente: 'sintetico',
    estabelecimento: 1,
    usuario: 1,
    correlacao: 'teste',
    rede: 'rede-sintetica',
    hospital,
  },
  pode: () => true,
});

function montar(parametros: ValorParametro[] = []) {
  const porta = new PortaIndicadoresPessoasMemoria();
  porta.semear('aa', FATOS_BASE_TESTE);
  porta.semear('bb', { ponto: [{ ...CLI, data: '2026-01-15', ...h(1, 1, 1, 1, 1) }] });
  const cfg = fonteConfiguracaoMemoria(new RegistradorTrilhaMemoria(), {
    parametrosIniciais: () => parametros,
  });
  return { porta, servico: new ServicoIndicadoresPessoas(porta, cfg) };
}
const TRIMESTRE = { inicio: '2026-01-01', fim: '2026-03-31' };
const porCodigo = (p: { indicadores: { ficha: { codigo: string } }[] }) =>
  Object.fromEntries(p.indicadores.map((i) => [i.ficha.codigo, i])) as Record<string, never>;

describe('painel de indicadores de pessoas (W0-06, parte 7b)', () => {
  it('os fatos do trimestre dão os números conferidos à mão; nada de fora do período entra', async () => {
    const { servico } = montar();
    const p = await servico.painel(sessao(), TRIMESTRE);
    expect(() => esquemaPainelIndicadoresPessoas.parse(p)).not.toThrow();
    expect([p.hospital, p.setor, p.avisos]).toEqual(['aa', null, []]);
    const r = porCodigo(p) as Record<
      string,
      {
        valor: number | null;
        numerador: number;
        denominador: number;
        referencia: number | null;
        complementos: { valor: string }[];
        parcelas: { nomeSetor: string }[];
      }
    >;
    expect([r.turnover!.numerador, r.turnover!.denominador, r.turnover!.valor]).toEqual([2, 7, 28.57]);
    expect([r.absenteismo!.numerador, r.absenteismo!.denominador, r.absenteismo!.valor]).toEqual([
      90, 3000, 3,
    ]);
    expect(r.horasExtras!.valor).toBe(3.96);
    expect(r.horasExtras!.complementos.map((c) => c.valor)).toEqual(['120 h', 'R$ 2.000,00']);
    expect([r.horasEnfermagemPacienteDia!.valor, r.horasEnfermagemPacienteDia!.referencia]).toEqual([
      12.63, 11.16,
    ]);
    expect(r.turnover!.parcelas.map((x) => x.nomeSetor)).toEqual(['Clínica', 'UTI']);
  });

  it('o setor recorta todas as fontes; outro estabelecimento é 403 e o filtro inválido é 400', async () => {
    const { servico } = montar();
    const p = await servico.painel(sessao(), { ...TRIMESTRE, setor: 20 });
    const r = porCodigo(p) as Record<
      string,
      { valor: number | null; referencia: number | null; parcelas: unknown[] }
    >;
    expect(r.absenteismo!.valor).toBe(2.5);
    expect(r.turnover!.valor).toBe(25);
    expect(r.horasEnfermagemPacienteDia!.referencia).toBe(18);
    for (const i of Object.values(r)) expect(i.parcelas.length).toBeLessThanOrEqual(1);
    const erro = (x: unknown) => (x as ErroProblema).getStatus();
    expect(erro(await servico.painel(sessao(), { ...TRIMESTRE, hospital: 'bb' }).catch((e) => e))).toBe(403);
    expect(
      erro(await servico.painel(sessao(), { inicio: '2026-03-31', fim: '2026-01-01' }).catch((e) => e)),
    ).toBe(400);
    expect(
      erro(await servico.painel(sessao(), { inicio: '2025-01-01', fim: '2026-03-31' }).catch((e) => e)),
    ).toBe(400);
    // O estabelecimento é o da sessão: o "bb" só vê os próprios fatos.
    const bb = porCodigo(await servico.painel(sessao('bb'), TRIMESTRE)) as Record<
      string,
      { valor: number | null }
    >;
    expect(bb.absenteismo!.valor).toBe(100);
  });

  it('a fonte que não pôde ser lida vira aviso com os indicadores afetados, sem derrubar o painel', async () => {
    const { porta, servico } = montar();
    porta.indisponiveis.set('censo', 'chave do censo desligada');
    const p = await servico.painel(sessao(), TRIMESTRE);
    expect(p.avisos).toHaveLength(1);
    expect(p.avisos[0]).toContain('chave do censo desligada');
    expect(p.avisos[0]).toContain('Afeta: ');
    const r = porCodigo(p) as Record<string, { valor: number | null }>;
    expect(r.horasEnfermagemPacienteDia!.valor).toBeNull();
    expect(r.turnover!.valor).toBe(28.57);
  });

  it('o parâmetro ajusta as horas da COFEN (a referência muda) e o apoio mostra o que vale', async () => {
    const ajuste: ValorParametro = {
      id: 'p1',
      chave: 'pessoas.indicadores.horasCofen.intensivos',
      nivel: 'estabelecimento',
      alvo: 'aa',
      valor: '16',
      vigenteDesde: '2020-01-01T00:00:00',
      vigenteAte: null,
      justificativa: 'teste sintético',
      autor: 'SINT.ADMIN',
    };
    const { porta, servico } = montar([ajuste]);
    porta.hojeFixo = '2026-04-01';
    const p = await servico.painel(sessao(), { ...TRIMESTRE, setor: 20 });
    expect(
      (porCodigo(p) as Record<string, { referencia: number | null }>).horasEnfermagemPacienteDia!.referencia,
    ).toBe(16);
    const a = await servico.apoio(sessao());
    expect(a.hoje).toBe('2026-04-01');
    expect(a.setores).toEqual([
      { codigo: 10, rotulo: 'Clínica' },
      { codigo: 20, rotulo: 'UTI' },
    ]);
    expect(a.horasCofen.find((x) => x.categoria === 'intensivos')).toMatchObject({
      horas: 16,
      ajustada: true,
    });
    expect(a.horasCofen.find((x) => x.categoria === 'minimos')).toMatchObject({ horas: 4, ajustada: false });
  });
});
